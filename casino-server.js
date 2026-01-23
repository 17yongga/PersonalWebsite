const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs").promises;
const bcrypt = require("bcrypt");

// CS2 Betting API client (optional - only load if module exists)
let cs2ApiClient = null;
try {
  cs2ApiClient = require("./cs2-api-client");
  console.log("CS2 API client loaded successfully");
} catch (error) {
  console.warn("CS2 API client not available:", error.message);
  console.warn("CS2 betting features will be limited without API client");
}

// CS2 Odds Provider - Multi-source aggregator (optional - only load if module exists)
let cs2OddsProvider = null;
try {
  cs2OddsProvider = require("./cs2-odds-provider");
  console.log("CS2 Odds Provider (multi-source) loaded successfully");
  const availableSources = cs2OddsProvider.getAvailableSources();
  console.log(`  Available odds sources: ${availableSources.join(", ")}`);
} catch (error) {
  console.warn("CS2 Odds Provider not available:", error.message);
  console.warn("Falling back to single-source (OddsPapi only)");
  // Fallback to using cs2ApiClient directly
  cs2OddsProvider = cs2ApiClient;
}

// Scheduled tasks for CS2 betting (using node-cron if available)
let cron = null;
try {
  cron = require("node-cron");
  console.log("node-cron loaded successfully for scheduled tasks");
} catch (error) {
  console.warn("node-cron not available. Scheduled tasks will use setInterval instead");
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// CORS middleware for Express REST API
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  
  // Handle preflight requests
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// Serve static files
app.use(express.static("."));
app.use(express.json());

// Initial credits for new players
const INITIAL_CREDITS = 10000;

// User data file path
const USERS_FILE = path.join(__dirname, "casino-users.json");

// Player data: { socketId: { username, credits, roomId, userId } }
const players = {};

// Socket to user mapping: { socketId: userId }
const socketToUser = {};

// Load users from file
async function loadUsers() {
  try {
    const data = await fs.readFile(USERS_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      // File doesn't exist, create empty users object
      await saveUsers({});
      return {};
    }
    throw error;
  }
}

// Save users to file
async function saveUsers(users) {
  await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
}

// Get users object
let users = {};
let usersLoadedPromise = loadUsers().then(data => {
  users = data;
  console.log(`Loaded ${Object.keys(users).length} users from file`);
  return data;
}).catch(err => {
  console.error("Error loading users:", err);
  users = {};
  return {};
});

// Per-user balance lock: ensures joinCasino reads after in-flight REST (CS2 bet) updates
// Fixes race where user places CS2 bet -> navigates -> joinCasino sends stale balance
const userBalanceLocks = {};

function acquireUserBalanceLock(userId) {
  const tail = userBalanceLocks[userId] || Promise.resolve();
  return tail;
}

function runWithUserBalanceLock(userId, fn) {
  const prev = userBalanceLocks[userId] || Promise.resolve();
  const next = prev.then(() => fn());
  userBalanceLocks[userId] = next;
  return next;
}

// Save user balance
async function saveUserBalance(userId, credits) {
  if (users[userId]) {
    users[userId].credits = credits;
    users[userId].lastPlayed = new Date().toISOString();
    await saveUsers(users);
  }
}

// Roulette game state
let rouletteState = {
  currentBets: {}, // { socketId: { color: 'red'|'black'|'green', amount: number } }
  spinning: false,
  lastResult: null,
  spinTimer: null,
  nextSpinTime: null,
  history: [] // Array of last 50 results: { number, color, timestamp }
};

// Coinflip game state
// NOTE: All coinflip server logic is consolidated here in casino-server.js
// The separate coinflip/server.js file is not used - this is the single source of truth
// Room data: { roomId: { creatorId, betAmount, creatorChoice, players: [socketId1, socketId2], confirmed: false, gameState: 'waiting'|'confirmed'|'flipping'|'finished', coinResult: null, botId: string } }
const coinflipRooms = {};
let coinflipRoomCounter = 1;

// ========== CS2 BETTING STATE ==========
// CS2 betting data file path - moved to data/ subdirectory to reduce Live Server file watching
const CS2_BETTING_FILE = path.join(__dirname, "data", "cs2-betting-data.json");
// CS2 team rankings file path
const CS2_TEAM_RANKINGS_FILE = path.join(__dirname, "cs2-team-rankings.json");
// CS2 API cache file path
const CS2_API_CACHE_FILE = path.join(__dirname, "cs2-api-cache.json");

// CS2 betting state: { events: {}, bets: {}, lastApiSync: null, lastApiQuery: null, lastSettlementCheck: null }
// lastApiQuery: ISO timestamp of last API query (for daily check)
// lastSettlementCheck: ISO timestamp of last settlement check (for daily check)
let cs2BettingState = {
  events: {},  // { eventId: { id, teams, startTime, status, odds, ... } }
  bets: {},    // { betId: { id, userId, matchId, selection, amount, odds, status, ... } }
  lastApiSync: null,
  lastApiQuery: null, // Timestamp of last API query (for daily check)
  lastSettlementCheck: null // Timestamp of last settlement check (for daily check)
};

// CS2 team rankings: { teams: [], lastUpdated: null }
let cs2TeamRankings = {
  teams: [],
  lastUpdated: null
};

// Load CS2 betting data from file
async function loadCS2BettingData() {
  try {
    const data = await fs.readFile(CS2_BETTING_FILE, "utf8");
    cs2BettingState = JSON.parse(data);
    console.log(`Loaded CS2 betting data: ${Object.keys(cs2BettingState.events).length} events, ${Object.keys(cs2BettingState.bets).length} bets`);
  } catch (error) {
    if (error.code === "ENOENT") {
      // File doesn't exist, create empty state
      await saveCS2BettingData();
      console.log("Created new CS2 betting data file");
    } else {
      console.error("Error loading CS2 betting data:", error);
    }
  }
}

// Save CS2 betting data to file
// Uses atomic writes (write to temp file, then rename) to reduce file watcher triggers
async function saveCS2BettingData() {
  try {
    // Ensure data directory exists
    const dataDir = path.join(__dirname, "data");
    try {
      await fs.mkdir(dataDir, { recursive: true });
    } catch (mkdirError) {
      // Directory might already exist, ignore error
    }
    
    const tempFile = CS2_BETTING_FILE + '.tmp';
    await fs.writeFile(tempFile, JSON.stringify(cs2BettingState, null, 2), "utf8");
    await fs.rename(tempFile, CS2_BETTING_FILE);
  } catch (error) {
    console.error("Error saving CS2 betting data:", error);
    // Clean up temp file if rename failed
    try {
      await fs.unlink(CS2_BETTING_FILE + '.tmp');
    } catch (unlinkError) {
      // Ignore cleanup errors
    }
  }
}

// Initialize CS2 betting data on startup
loadCS2BettingData().catch(err => {
  console.error("Error initializing CS2 betting data:", err);
});

// CS2 API Cache: { matches: { data: [], timestamp: "ISO" }, odds: { [eventId]: { data: {}, timestamp: "ISO" } } }
let cs2ApiCache = {
  matches: { data: null, timestamp: null },
  odds: {}
};

// Cache TTL: 24 hours in milliseconds
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Load CS2 API cache from file
async function loadCS2ApiCache() {
  try {
    const data = await fs.readFile(CS2_API_CACHE_FILE, "utf8");
    cs2ApiCache = JSON.parse(data);
    console.log(`[CS2 Cache] Loaded API cache: ${cs2ApiCache.matches?.data?.length || 0} matches, ${Object.keys(cs2ApiCache.odds || {}).length} odds entries`);
    
    // Check if cache is still valid
    if (cs2ApiCache.matches?.timestamp) {
      const cacheAge = Date.now() - new Date(cs2ApiCache.matches.timestamp).getTime();
      const hoursOld = cacheAge / (1000 * 60 * 60);
      if (cacheAge < CACHE_TTL_MS) {
        console.log(`[CS2 Cache] Matches cache is valid (${hoursOld.toFixed(1)} hours old, ${(24 - hoursOld).toFixed(1)} hours remaining)`);
      } else {
        console.log(`[CS2 Cache] Matches cache expired (${hoursOld.toFixed(1)} hours old, will fetch fresh data)`);
        cs2ApiCache.matches = { data: null, timestamp: null };
      }
    }
    
    // Clean up expired odds entries
    const now = Date.now();
    let expiredOddsCount = 0;
    for (const [eventId, entry] of Object.entries(cs2ApiCache.odds || {})) {
      if (entry.timestamp) {
        const cacheAge = now - new Date(entry.timestamp).getTime();
        if (cacheAge >= CACHE_TTL_MS) {
          delete cs2ApiCache.odds[eventId];
          expiredOddsCount++;
        }
      }
    }
    if (expiredOddsCount > 0) {
      console.log(`[CS2 Cache] Removed ${expiredOddsCount} expired odds entries`);
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      // File doesn't exist, create empty cache
      cs2ApiCache = { matches: { data: null, timestamp: null }, odds: {} };
      await saveCS2ApiCache();
      console.log("[CS2 Cache] Created new API cache file");
    } else {
      console.error("[CS2 Cache] Error loading API cache:", error);
      cs2ApiCache = { matches: { data: null, timestamp: null }, odds: {} };
    }
  }
}

// Save CS2 API cache to file
async function saveCS2ApiCache() {
  try {
    await fs.writeFile(CS2_API_CACHE_FILE, JSON.stringify(cs2ApiCache, null, 2), "utf8");
  } catch (error) {
    console.error("[CS2 Cache] Error saving API cache:", error);
  }
}

// Check if cache entry is still valid (less than 24 hours old)
function isCacheValid(timestamp) {
  if (!timestamp) return false;
  const cacheAge = Date.now() - new Date(timestamp).getTime();
  return cacheAge < CACHE_TTL_MS;
}

// Get cached matches or null if expired/missing
function getCachedMatches() {
  if (cs2ApiCache.matches?.data && isCacheValid(cs2ApiCache.matches.timestamp)) {
    const cacheAge = Date.now() - new Date(cs2ApiCache.matches.timestamp).getTime();
    const hoursOld = cacheAge / (1000 * 60 * 60);
    console.log(`[CS2 Cache] Using cached matches (${hoursOld.toFixed(1)} hours old)`);
    return cs2ApiCache.matches.data;
  }
  return null;
}

// Cache matches data
async function cacheMatches(matches) {
  cs2ApiCache.matches = {
    data: matches,
    timestamp: new Date().toISOString()
  };
  await saveCS2ApiCache();
  console.log(`[CS2 Cache] Cached ${matches.length} matches`);
}

// Check if odds are real (not placeholder/default)
function areOddsReal(oddsData) {
  if (!oddsData || !oddsData.odds) {
    return false;
  }
  
  const odds = oddsData.odds;
  // Real odds must have both team1 and team2 values that are:
  // 1. Not null/undefined
  // 2. Not exactly 2.0 (which is the default placeholder)
  // 3. Valid numbers greater than 1.0 (decimal odds format)
  const hasTeam1 = odds.team1 !== null && odds.team1 !== undefined && typeof odds.team1 === 'number' && odds.team1 > 1.0;
  const hasTeam2 = odds.team2 !== null && odds.team2 !== undefined && typeof odds.team2 === 'number' && odds.team2 > 1.0;
  
  // Both teams must have real odds (not placeholder 2.0)
  const team1IsReal = hasTeam1 && odds.team1 !== 2.0;
  const team2IsReal = hasTeam2 && odds.team2 !== 2.0;
  
  // At least one team must have real odds (not 2.0)
  // But ideally both should have real odds
  return team1IsReal || team2IsReal;
}

// Get cached odds for an event or null if expired/missing/invalid
function getCachedOdds(eventId) {
  // Ensure cache is initialized
  if (!cs2ApiCache || !cs2ApiCache.odds) {
    return null;
  }
  
  const cached = cs2ApiCache.odds[eventId];
  if (cached && cached.data && isCacheValid(cached.timestamp)) {
    // Validate that cached odds are real (not placeholder)
    if (areOddsReal(cached.data)) {
      const cacheAge = Date.now() - new Date(cached.timestamp).getTime();
      const hoursOld = cacheAge / (1000 * 60 * 60);
      console.log(`[CS2 Cache] ✓ Using cached REAL odds for event ${eventId} (${hoursOld.toFixed(1)} hours old, ${(24 - hoursOld).toFixed(1)} hours remaining)`);
      return cached.data;
    } else {
      // Cached odds are placeholder - remove from cache and return null
      console.log(`[CS2 Cache] ✗ Cached odds for event ${eventId} are placeholder/fake, removing from cache`);
      delete cs2ApiCache.odds[eventId];
      saveCS2ApiCache().catch(err => console.error('[CS2 Cache] Error saving cache after cleanup:', err));
      return null;
    }
  }
  
  if (cached && cached.data) {
    // Cache exists but expired
    const cacheAge = Date.now() - new Date(cached.timestamp).getTime();
    const hoursOld = cacheAge / (1000 * 60 * 60);
    console.log(`[CS2 Cache] ✗ Cache expired for event ${eventId} (${hoursOld.toFixed(1)} hours old, will fetch fresh)`);
  }
  
  return null;
}

// Cache odds data for an event (only if they are real, not placeholder)
async function cacheOdds(eventId, oddsData) {
  // Only cache real odds, not placeholder/default odds
  if (!areOddsReal(oddsData)) {
    console.log(`[CS2 Cache] ✗ Not caching odds for event ${eventId} - odds are placeholder/fake (team1=${oddsData?.odds?.team1}, team2=${oddsData?.odds?.team2})`);
    return;
  }
  
  if (!cs2ApiCache.odds) {
    cs2ApiCache.odds = {};
  }
  cs2ApiCache.odds[eventId] = {
    data: oddsData,
    timestamp: new Date().toISOString()
  };
  await saveCS2ApiCache();
  console.log(`[CS2 Cache] ✓ Cached REAL odds for event ${eventId} (team1=${oddsData.odds.team1}, team2=${oddsData.odds.team2})`);
}

// Load CS2 team rankings from file
async function loadCS2TeamRankings() {
  try {
    const data = await fs.readFile(CS2_TEAM_RANKINGS_FILE, "utf8");
    cs2TeamRankings = JSON.parse(data);
    console.log(`Loaded CS2 team rankings: ${cs2TeamRankings.teams?.length || 0} teams`);
  } catch (error) {
    if (error.code === "ENOENT") {
      // File doesn't exist, create empty rankings
      cs2TeamRankings = { teams: [], lastUpdated: null };
      console.warn("CS2 team rankings file not found. Create cs2-team-rankings.json with top 250 teams.");
    } else {
      console.error("Error loading CS2 team rankings:", error);
      cs2TeamRankings = { teams: [], lastUpdated: null };
    }
  }
}

// Initialize team rankings on startup
loadCS2TeamRankings().catch(err => {
  console.error("Error initializing CS2 team rankings:", err);
});

// Initialize CS2 API cache on startup
loadCS2ApiCache().catch(err => {
  console.error("Error initializing CS2 API cache:", err);
});

/**
 * Normalize team name for matching (lowercase, remove special chars, trim)
 * @param {string} teamName - Team name to normalize
 * @returns {string} Normalized team name
 */
function normalizeTeamName(teamName) {
  if (!teamName) return '';
  return teamName
    .toLowerCase()
    .trim()
    .replace(/^team\s+/i, '') // Remove "Team" prefix (e.g., "Team Vitality" -> "Vitality")
    .replace(/[^\w\s]/g, '') // Remove special characters
    .replace(/\s+/g, ' '); // Normalize whitespace
}

/**
 * Fuzzy match team name - tries multiple variations
 * @param {string} teamName - Team name to match
 * @returns {string[]} Array of normalized variations to try
 */
function getTeamNameVariations(teamName) {
  if (!teamName) return [];
  
  const normalized = normalizeTeamName(teamName);
  const variations = [normalized];
  
  // Add variation without "team" prefix if it was there
  if (/^team\s+/i.test(teamName)) {
    variations.push(normalizeTeamName(teamName.replace(/^team\s+/i, '')));
  }
  
  // Add variation with "team" prefix if it wasn't there
  if (!/^team\s+/i.test(teamName)) {
    variations.push(normalizeTeamName(`Team ${teamName}`));
  }
  
  // Remove duplicates
  return [...new Set(variations)];
}

/**
 * Find team ranking by name (checks name and aliases with fuzzy matching)
 * @param {string} teamName - Team name to look up
 * @returns {Object|null} Team ranking object or null if not found
 */
function getTeamRanking(teamName) {
  if (!teamName || !cs2TeamRankings.teams || cs2TeamRankings.teams.length === 0) {
    return null;
  }
  
  // Try multiple variations of the team name
  const variations = getTeamNameVariations(teamName);
  
  for (const variation of variations) {
    for (const team of cs2TeamRankings.teams) {
      // Check main name
      if (normalizeTeamName(team.name) === variation) {
        console.log(`[CS2 Team Matching] Found "${teamName}" as "${team.name}" (rank ${team.rank})`);
        return team;
      }
      
      // Check aliases
      if (team.aliases && Array.isArray(team.aliases)) {
        for (const alias of team.aliases) {
          if (normalizeTeamName(alias) === variation) {
            console.log(`[CS2 Team Matching] Found "${teamName}" via alias "${alias}" for "${team.name}" (rank ${team.rank})`);
            return team;
          }
        }
      }
    }
  }
  
  console.log(`[CS2 Team Matching] Could not find team: "${teamName}" (tried variations: ${variations.join(', ')})`);
  return null;
}

/**
 * Check if both teams in a match are in top 250
 * @param {string} team1Name - First team name
 * @param {string} team2Name - Second team name
 * @returns {boolean} True if both teams are in top 250
 */
function areBothTeamsInTop250(team1Name, team2Name) {
  const team1Ranking = getTeamRanking(team1Name);
  const team2Ranking = getTeamRanking(team2Name);
  
  // Both teams must have rankings (meaning they're in the top 250)
  return team1Ranking !== null && team2Ranking !== null;
}

/**
 * Validate and correct odds based on team rankings
 * Lower ranked team (higher rank number) should have higher odds (underdog)
 * Higher ranked team (lower rank number) should have lower odds (favorite)
 * If one team is not in top 250, assume they are the underdog
 * @param {Object} odds - Odds object with team1 and team2
 * @param {string} team1Name - First team name
 * @param {string} team2Name - Second team name
 * @returns {Object} Corrected odds object
 */
function validateAndCorrectOdds(odds, team1Name, team2Name) {
  if (!odds || (!odds.team1 && !odds.team2)) {
    return odds; // No odds to validate
  }
  
  const team1Ranking = getTeamRanking(team1Name);
  const team2Ranking = getTeamRanking(team2Name);
  
  // Handle case where one or both teams are not in top 250
  let team1Rank = null;
  let team2Rank = null;
  
  if (team1Ranking) {
    team1Rank = team1Ranking.rank;
  } else {
    // Team not in top 250 - assume they are underdog (assign high rank number)
    team1Rank = 999; // Use 999 to represent "not in top 250" (worse than any ranked team)
    console.log(`[CS2 Odds Validation] ${team1Name} not found in top 250 - assuming underdog (rank 999)`);
  }
  
  if (team2Ranking) {
    team2Rank = team2Ranking.rank;
  } else {
    // Team not in top 250 - assume they are underdog (assign high rank number)
    team2Rank = 999; // Use 999 to represent "not in top 250" (worse than any ranked team)
    console.log(`[CS2 Odds Validation] ${team2Name} not found in top 250 - assuming underdog (rank 999)`);
  }
  
  // If both teams are not in top 250, can't determine favorite
  if (team1Rank === 999 && team2Rank === 999) {
    console.log(`[CS2 Odds Validation] Both teams (${team1Name}, ${team2Name}) not in top 250 - cannot validate odds`);
    return odds;
  }
  
  // Determine which team should be favorite (lower rank number = better team = favorite)
  const team1IsFavorite = team1Rank < team2Rank;
  const team2IsFavorite = team2Rank < team1Rank;
  
  // If teams have same rank, can't determine favorite
  if (team1Rank === team2Rank) {
    console.log(`[CS2 Odds Validation] Teams have same rank (${team1Rank}), skipping validation`);
    return odds;
  }
  
  // Check if odds match expectations
  // Favorite should have lower odds, underdog should have higher odds
  const correctedOdds = { ...odds };
  let needsCorrection = false;
  
  if (team1IsFavorite && odds.team1 && odds.team2) {
    // Team1 is favorite, should have lower odds
    if (odds.team1 > odds.team2) {
      // Odds are reversed - swap them
      console.warn(`[CS2 Odds Validation] Correcting odds: ${team1Name} (rank ${team1Rank}) should be favorite but has higher odds. Swapping.`);
      correctedOdds.team1 = odds.team2;
      correctedOdds.team2 = odds.team1;
      needsCorrection = true;
    }
  } else if (team2IsFavorite && odds.team1 && odds.team2) {
    // Team2 is favorite, should have lower odds
    if (odds.team2 > odds.team1) {
      // Odds are reversed - swap them
      console.warn(`[CS2 Odds Validation] Correcting odds: ${team2Name} (rank ${team2Rank}) should be favorite but has higher odds. Swapping.`);
      correctedOdds.team1 = odds.team2;
      correctedOdds.team2 = odds.team1;
      needsCorrection = true;
    }
  }
  
  if (needsCorrection) {
    console.log(`[CS2 Odds Validation] Corrected odds: ${team1Name} (rank ${team1Rank}) = ${correctedOdds.team1}, ${team2Name} (rank ${team2Rank}) = ${correctedOdds.team2}`);
  } else {
    const rank1Display = team1Rank === 999 ? 'not in top 250' : `rank ${team1Rank}`;
    const rank2Display = team2Rank === 999 ? 'not in top 250' : `rank ${team2Rank}`;
    console.log(`[CS2 Odds Validation] Odds validated correctly: ${team1Name} (${rank1Display}) = ${odds.team1}, ${team2Name} (${rank2Display}) = ${odds.team2}`);
  }
  
  return correctedOdds;
}

// ========== END CS2 BETTING STATE ==========

// Roulette numbers: 0-14, 0=green, 1-14 alternating red/black
const rouletteNumbers = [
  { num: 0, color: 'green' },
  { num: 1, color: 'red' },
  { num: 2, color: 'black' },
  { num: 3, color: 'red' },
  { num: 4, color: 'black' },
  { num: 5, color: 'red' },
  { num: 6, color: 'black' },
  { num: 7, color: 'red' },
  { num: 8, color: 'black' },
  { num: 9, color: 'red' },
  { num: 10, color: 'black' },
  { num: 11, color: 'red' },
  { num: 12, color: 'black' },
  { num: 13, color: 'red' },
  { num: 14, color: 'black' }
];

// Start auto-spin timer
function startRouletteTimer() {
  // Clear any existing timers
  if (rouletteState.spinTimer) {
    clearInterval(rouletteState.spinTimer);
    rouletteState.spinTimer = null;
  }
  if (rouletteState.countdownTimer) {
    clearTimeout(rouletteState.countdownTimer);
    rouletteState.countdownTimer = null;
  }

  // Only update next spin time if it's not already set (to avoid overwriting)
  if (!rouletteState.nextSpinTime || rouletteState.nextSpinTime < Date.now()) {
    updateNextSpinTime();
  }

  // Calculate time until spin based on nextSpinTime
  const timeUntilSpin = Math.max(0, rouletteState.nextSpinTime - Date.now());

  // Wait for countdown to complete before spinning
  rouletteState.countdownTimer = setTimeout(() => {
    if (!rouletteState.spinning) {
      spinRoulette();
      // Note: Next timer will be started after spin completes (in spinRoulette)
    }
  }, timeUntilSpin);
}

function updateNextSpinTime() {
  rouletteState.nextSpinTime = Date.now() + 15000; // 15 seconds - time for players to place bets
  io.emit('nextSpinTime', { time: rouletteState.nextSpinTime });
}

function spinRoulette() {
  if (rouletteState.spinning) return;

  rouletteState.spinning = true;
  
  // Pick random number
  const winningNumber = Math.floor(Math.random() * 15); // 0-14
  const winningColor = rouletteNumbers[winningNumber].color;

  // Emit spin start
  io.emit('rouletteSpinStart', {
    winningNumber,
    winningColor,
    bets: getBetsSnapshot()
  });

  // After 2 seconds (animation), calculate results
  setTimeout(() => {
    const results = {};
    const totalPayout = 0;

    // Calculate winnings for each player
    Object.keys(rouletteState.currentBets).forEach(socketId => {
      const bet = rouletteState.currentBets[socketId];
      if (bet.color === winningColor) {
        // Different payout multipliers based on color
        let multiplier = 2; // Default for red/black
        if (winningColor === 'green') {
          multiplier = 14; // 14x payout for green
        }
        const winnings = bet.amount * multiplier;
        if (players[socketId]) {
          players[socketId].credits += winnings;
          // Save balance to file
          const userId = players[socketId].userId;
          if (userId) {
            saveUserBalance(userId, players[socketId].credits).catch(err => {
              console.error("Error saving balance:", err);
            });
          }
          results[socketId] = {
            won: true,
            winnings: winnings,
            newCredits: players[socketId].credits,
            bet: bet
          };
        }
      } else {
        // Lost
        if (players[socketId]) {
          results[socketId] = {
            won: false,
            winnings: 0,
            newCredits: players[socketId].credits,
            bet: bet
          };
        }
      }
    });

    // Emit results
    io.emit('rouletteSpinResult', {
      winningNumber,
      winningColor,
      results,
      bets: getBetsSnapshot(),
      history: rouletteState.history
    });

    // Clear bets and reset
    rouletteState.currentBets = {};
    rouletteState.lastResult = { number: winningNumber, color: winningColor };
    rouletteState.spinning = false;
    
    // Add to history (keep last 50)
    rouletteState.history.unshift({
      number: winningNumber,
      color: winningColor,
      timestamp: Date.now()
    });
    if (rouletteState.history.length > 50) {
      rouletteState.history.pop();
    }

    // Wait for animation to complete and result to be displayed before starting timer
    // Animation takes ~4-6 seconds, then we show the result
    // So we wait ~6 seconds before starting the countdown
    setTimeout(() => {
      // Calculate next spin time: 15 seconds from now (after result is displayed)
      const timeUntilNextSpin = 15000; // 15 seconds
      rouletteState.nextSpinTime = Date.now() + timeUntilNextSpin;
      io.emit('nextSpinTime', { time: rouletteState.nextSpinTime });
      
      // Schedule next spin
      startRouletteTimer();
    }, 6000); // Wait 6 seconds for animation + result display
    }, 2000);
}

function getBetsSnapshot() {
  const snapshot = {};
  Object.keys(rouletteState.currentBets).forEach(socketId => {
    if (players[socketId]) {
      snapshot[socketId] = {
        playerName: players[socketId].username,
        color: rouletteState.currentBets[socketId].color,
        amount: rouletteState.currentBets[socketId].amount
      };
    }
  });
  return snapshot;
}

// Authentication endpoints
app.post("/api/register", async (req, res) => {
  try {
    // Ensure users are loaded before processing registration
    await usersLoadedPromise;
    
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ error: "Username must be between 3 and 20 characters" });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    // Check if user already exists
    if (users[username]) {
      return res.status(400).json({ error: "Username already exists" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user
    users[username] = {
      username,
      password: hashedPassword,
      credits: INITIAL_CREDITS,
      createdAt: new Date().toISOString(),
      lastPlayed: new Date().toISOString()
    };

    await saveUsers(users);

    res.json({ 
      success: true, 
      message: "Account created successfully",
      credits: INITIAL_CREDITS
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    // Ensure users are loaded before processing login
    await usersLoadedPromise;
    
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    // Check if user exists
    const user = users[username];
    if (!user) {
      console.log(`Login attempt failed: user '${username}' not found. Available users: ${Object.keys(users).join(', ')}`);
      return res.status(401).json({ error: "Invalid username or password" });
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      console.log(`Login attempt failed: invalid password for user '${username}'`);
      return res.status(401).json({ error: "Invalid username or password" });
    }

    console.log(`Login successful for user '${username}'`);

    // Update last played
    user.lastPlayed = new Date().toISOString();
    await saveUsers(users);

    res.json({ 
      success: true, 
      username: user.username,
      credits: user.credits
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Test connection handler (for debugging)
  socket.on("testConnection", (data, callback) => {
    if (callback) callback({ success: true, socketId: socket.id });
  });

  // Send current roulette state
  socket.emit('rouletteState', {
    spinning: rouletteState.spinning,
    lastResult: rouletteState.lastResult,
    currentBets: getBetsSnapshot(),
    nextSpinTime: rouletteState.nextSpinTime,
    history: rouletteState.history
  });

  socket.on("joinCasino", async ({ username }) => {
    if (!username || username.trim() === "") {
      socket.emit("error", "Please provide a valid username");
      return;
    }

    const uname = username.trim();

    // Check if user exists
    const user = users[uname];
    if (!user) {
      socket.emit("error", "User not found. Please register first.");
      return;
    }

    // Wait for any in-flight balance updates (e.g. CS2 bet) before reading
    await acquireUserBalanceLock(uname);
    const credits = users[uname] ? users[uname].credits : user.credits;

    players[socket.id] = {
      username: uname,
      credits,
      roomId: null,
      userId: uname
    };

    socketToUser[socket.id] = uname;

    socket.emit("playerData", {
      username: players[socket.id].username,
      credits: players[socket.id].credits
    });

    // Send current roulette state
    socket.emit('rouletteState', {
      spinning: rouletteState.spinning,
      lastResult: rouletteState.lastResult,
      currentBets: getBetsSnapshot(),
      nextSpinTime: rouletteState.nextSpinTime,
      history: rouletteState.history
    });
  });

  socket.on("placeRouletteBet", ({ color, amount }) => {
    if (!players[socket.id]) {
      socket.emit("error", "Please join the casino first");
      return;
    }

    if (rouletteState.spinning) {
      socket.emit("error", "Cannot place bets while wheel is spinning");
      return;
    }

    // Check if player already has a bet
    if (rouletteState.currentBets[socket.id]) {
      socket.emit("error", "You can only place one bet per round. Please clear your current bet first.");
      return;
    }

    if (color !== 'red' && color !== 'black' && color !== 'green') {
      socket.emit("error", "Invalid color. Choose red, black, or green");
      return;
    }

    const betAmount = parseInt(amount);
    if (isNaN(betAmount) || betAmount <= 0) {
      socket.emit("error", "Invalid bet amount");
      return;
    }

    if (betAmount > players[socket.id].credits) {
      socket.emit("error", "Insufficient credits");
      return;
    }

    // Deduct credits
    players[socket.id].credits -= betAmount;
    
    // Save balance to file
    const userId = players[socket.id].userId;
    if (userId) {
      saveUserBalance(userId, players[socket.id].credits).catch(err => {
        console.error("Error saving balance:", err);
      });
    }

    // Place bet
    rouletteState.currentBets[socket.id] = { color, amount: betAmount };

    // Update player data
    socket.emit("playerData", {
      username: players[socket.id].username,
      credits: players[socket.id].credits
    });

    // Broadcast updated bets to all players
    io.emit('rouletteBetsUpdate', {
      bets: getBetsSnapshot()
    });
  });

  socket.on("clearRouletteBet", () => {
    if (!players[socket.id]) {
      return;
    }

    if (rouletteState.spinning) {
      socket.emit("error", "Cannot clear bets while wheel is spinning");
      return;
    }

    if (rouletteState.currentBets[socket.id]) {
      const bet = rouletteState.currentBets[socket.id];
      // Refund credits
      players[socket.id].credits += bet.amount;
      
      // Save balance to file
      const userId = players[socket.id].userId;
      if (userId) {
        saveUserBalance(userId, players[socket.id].credits).catch(err => {
          console.error("Error saving balance:", err);
        });
      }
      
      delete rouletteState.currentBets[socket.id];

      // Update player data
      socket.emit("playerData", {
        username: players[socket.id].username,
        credits: players[socket.id].credits
      });

      // Broadcast updated bets
      io.emit('rouletteBetsUpdate', {
        bets: getBetsSnapshot()
      });
    }
  });

  // ========== COINFLIP GAME HANDLERS ==========
  
  socket.on("joinGame", (playerName, initialCredits) => {
    if (!playerName || playerName.trim() === "") {
      socket.emit("error", "Please enter a valid name");
      return;
    }

    // Check if player already exists in our players object
    const existingPlayer = Object.values(players).find(p => p.username === playerName.trim());
    let playerCredits = INITIAL_CREDITS;
    
    if (existingPlayer) {
      // Player already exists - use their credits
      playerCredits = existingPlayer.credits;
    } else if (initialCredits !== undefined && initialCredits !== null) {
      // Use provided initial credits (from casino)
      playerCredits = parseInt(initialCredits) || INITIAL_CREDITS;
    }

    // Initialize or update player data if not already set
    if (!players[socket.id]) {
      players[socket.id] = {
        username: playerName.trim(),
        credits: playerCredits,
        roomId: null,
        userId: playerName.trim() // Use username as userId for coinflip
      };
      socketToUser[socket.id] = playerName.trim();
    } else {
      // Update credits if different
      players[socket.id].credits = playerCredits;
    }

    socket.emit("playerData", {
      name: players[socket.id].username,
      credits: players[socket.id].credits
    });

    // Send available rooms
    emitAvailableCoinflipRooms(socket);
  });

  socket.on("createRoom", ({ betAmount, choice }) => {
    if (!players[socket.id]) {
      socket.emit("error", "Please join the game first");
      return;
    }

    const betAmountNum = parseInt(betAmount);
    if (isNaN(betAmountNum) || betAmountNum <= 0) {
      socket.emit("error", "Invalid bet amount");
      return;
    }

    if (betAmountNum > players[socket.id].credits) {
      socket.emit("error", "Insufficient credits");
      return;
    }

    if (choice !== 'Heads' && choice !== 'Tails') {
      socket.emit("error", "Invalid choice");
      return;
    }

    // Deduct credits from creator
    players[socket.id].credits -= betAmountNum;
    
    // Save balance
    const userId = players[socket.id].userId;
    if (userId && users[userId]) {
      saveUserBalance(userId, players[socket.id].credits).catch(err => {
        console.error("Error saving balance:", err);
      });
    }

    const roomId = `room-${String(coinflipRoomCounter).padStart(3, '0')}`;
    coinflipRoomCounter++;
    
    socket.join(roomId);
    players[socket.id].roomId = roomId;
    
    coinflipRooms[roomId] = {
      creatorId: socket.id,
      betAmount: betAmountNum,
      creatorChoice: choice,
      players: [socket.id],
      confirmed: false,
      gameState: 'waiting',
      coinResult: null
    };

    socket.emit("roomCreated", { 
      roomId,
      betAmount: betAmountNum,
      choice: choice,
      credits: players[socket.id].credits
    });

    socket.emit("gameState", {
      state: 'waiting',
      message: "Room created! Waiting for opponent to join..."
    });

    emitAvailableCoinflipRooms();
  });

  socket.on("joinRoom", ({ roomId }) => {
    if (!players[socket.id]) {
      socket.emit("error", "Please join the game first");
      return;
    }

    const room = coinflipRooms[roomId];
    if (!room) {
      socket.emit("error", "Room not found");
      return;
    }

    if (room.players.length >= 2) {
      socket.emit("error", "Room is full");
      return;
    }

    socket.join(roomId);
    players[socket.id].roomId = roomId;
    room.players.push(socket.id);

    // Notify both players (without sharing credits)
    io.to(roomId).emit("playersUpdate", {
      player1: {
        name: players[room.players[0]].username
      },
      player2: {
        name: players[room.players[1]].username
      },
      betAmount: room.betAmount,
      creatorChoice: room.creatorChoice
    });

    // Notify the joiner about the room details
    socket.emit("joinedRoom", {
      roomId,
      betAmount: room.betAmount,
      creatorChoice: room.creatorChoice,
      creatorName: players[room.creatorId].username
    });

    // Notify the creator that someone joined
    io.to(room.creatorId).emit("opponentJoined", {
      opponentName: players[socket.id].username
    });

    emitAvailableCoinflipRooms();
  });

  socket.on("confirmParticipation", ({ roomId }) => {
    const room = coinflipRooms[roomId];
    if (!room || !room.players.includes(socket.id)) {
      socket.emit("error", "You are not in this room");
      return;
    }

    if (room.gameState !== 'waiting') {
      socket.emit("error", "Game already started");
      return;
    }

    // Deduct credits from the joiner (they match the creator's bet)
    if (socket.id !== room.creatorId) {
      if (players[socket.id].credits < room.betAmount) {
        socket.emit("error", "Insufficient credits");
        return;
      }
      players[socket.id].credits -= room.betAmount;
      
      // Save balance
      const userId = players[socket.id].userId;
      if (userId && users[userId]) {
        saveUserBalance(userId, players[socket.id].credits).catch(err => {
          console.error("Error saving balance:", err);
        });
      }
    }

    room.confirmed = true;
    room.gameState = 'flipping';

    // Perform coin flip
    const coinResult = Math.random() > 0.5 ? 'Heads' : 'Tails';
    room.coinResult = coinResult;

    // Calculate winnings
    // Joiner automatically gets the opposite choice of creator
    const joinerChoice = room.creatorChoice === 'Heads' ? 'Tails' : 'Heads';
    
    const results = {};
    const creatorId = room.creatorId;
    const joinerId = room.players.find(id => id !== creatorId);

    if (room.creatorChoice === coinResult) {
      // Creator wins - gets both bets
      const winnings = room.betAmount * 2;
      players[creatorId].credits += winnings;
      
      // Save creator balance
      const creatorUserId = players[creatorId].userId;
      if (creatorUserId && users[creatorUserId]) {
        saveUserBalance(creatorUserId, players[creatorId].credits).catch(err => {
          console.error("Error saving balance:", err);
        });
      }
      
      results[creatorId] = {
        won: true,
        winnings: winnings,
        newCredits: players[creatorId].credits,
        choice: room.creatorChoice
      };
      results[joinerId] = {
        won: false,
        winnings: 0,
        newCredits: players[joinerId].credits,
        choice: joinerChoice
      };
    } else {
      // Joiner wins - gets both bets
      const winnings = room.betAmount * 2;
      players[joinerId].credits += winnings;
      
      // Save joiner balance
      const joinerUserId = players[joinerId].userId;
      if (joinerUserId && users[joinerUserId]) {
        saveUserBalance(joinerUserId, players[joinerId].credits).catch(err => {
          console.error("Error saving balance:", err);
        });
      }
      
      results[joinerId] = {
        won: true,
        winnings: winnings,
        newCredits: players[joinerId].credits,
        choice: joinerChoice
      };
      results[creatorId] = {
        won: false,
        winnings: 0,
        newCredits: players[creatorId].credits,
        choice: room.creatorChoice
      };
    }
    
    // Store choices for display
    room.choices = {
      [creatorId]: room.creatorChoice,
      [joinerId]: joinerChoice
    };

    // Emit results
    io.to(roomId).emit("coinFlipResult", {
      coinResult: coinResult,
      results: results,
      betAmount: room.betAmount,
      creatorChoice: room.creatorChoice,
      choices: room.choices
    });

    room.gameState = 'finished';
  });

  socket.on("leaveRoom", () => {
    if (players[socket.id] && players[socket.id].roomId) {
      const roomId = players[socket.id].roomId;
      const room = coinflipRooms[roomId];
      
      if (room) {
        const isCreator = socket.id === room.creatorId;
        socket.leave(roomId);
        room.players = room.players.filter(id => id !== socket.id);
        
        if (isCreator) {
          // Creator is leaving - refund their bet and delete room
          if (!room.confirmed) {
            players[socket.id].credits += room.betAmount;
            
            // Save balance
            const userId = players[socket.id].userId;
            if (userId && users[userId]) {
              saveUserBalance(userId, players[socket.id].credits).catch(err => {
                console.error("Error saving balance:", err);
              });
            }
          }
          delete coinflipRooms[roomId];
        } else {
          // Joiner is leaving
          if (room.gameState === 'finished') {
            // Game already finished - don't reset
          } else {
            // Game hasn't finished - reset room state back to waiting
            room.gameState = 'waiting';
            room.confirmed = false;
          }
          
          // Notify creator that opponent left
          io.to(room.creatorId).emit("opponentLeft");
        }

        if (room.players.length === 0) {
          delete coinflipRooms[roomId];
        }

        players[socket.id].roomId = null;
        emitAvailableCoinflipRooms();
      }
    }

    socket.emit("leftRoom");
    emitAvailableCoinflipRooms(socket);
  });

  socket.on("playWithBot", ({ roomId }, callback) => {
    const room = coinflipRooms[roomId];
    if (!room) {
      socket.emit("error", "Room not found");
      if (callback) callback({ error: "Room not found" });
      return;
    }

    if (socket.id !== room.creatorId) {
      socket.emit("error", "Only the room creator can add a bot");
      if (callback) callback({ error: "Only the room creator can add a bot" });
      return;
    }

    if (room.players.length >= 2) {
      socket.emit("error", "Room is already full");
      if (callback) callback({ error: "Room is already full" });
      return;
    }
    if (callback) callback({ success: true });

    // Create a bot player ID (using a special prefix)
    const botId = `bot_${roomId}_${Date.now()}`;
    
    // Add bot to players list
    players[botId] = {
      username: "Bot",
      credits: room.betAmount * 10, // Give bot enough credits
      roomId: roomId,
      userId: null,
      isBot: true
    };

    // Add bot to room
    room.players.push(botId);
    room.botId = botId; // Track bot ID for cleanup

    // Bot automatically chooses opposite of creator
    const botChoice = room.creatorChoice === 'Heads' ? 'Tails' : 'Heads';

    // Deduct credits from bot (they match the creator's bet)
    players[botId].credits -= room.betAmount;

    // Mark room as confirmed (bot auto-confirms)
    room.confirmed = true;
    room.gameState = 'confirmed';

    // Notify creator about bot joining
    io.to(roomId).emit("playersUpdate", {
      player1: {
        name: players[room.creatorId].username
      },
      player2: {
        name: "Bot"
      },
      betAmount: room.betAmount,
      creatorChoice: room.creatorChoice
    });

    // Start the coin flip immediately
    setTimeout(() => {
      const coinResult = Math.random() < 0.5 ? 'Heads' : 'Tails';
      room.coinResult = coinResult;
      room.gameState = 'finished';

      const results = {};
      const creatorId = room.creatorId;
      const botId = room.botId;

      if (coinResult === room.creatorChoice) {
        // Creator wins - gets both bets
        const winnings = room.betAmount * 2;
        players[creatorId].credits += winnings;
        
        const creatorUserId = players[creatorId].userId;
        if (creatorUserId && users[creatorUserId]) {
          saveUserBalance(creatorUserId, players[creatorId].credits).catch(err => {
            console.error("Error saving balance:", err);
          });
        }
        
        results[creatorId] = {
          won: true,
          winnings: winnings,
          newCredits: players[creatorId].credits,
          bet: { color: room.creatorChoice, amount: room.betAmount }
        };
        results[botId] = {
          won: false,
          winnings: 0,
          newCredits: players[botId].credits,
          bet: { color: botChoice, amount: room.betAmount }
        };
      } else {
        // Bot wins - creator loses their bet (bot doesn't receive credits, it's just a virtual opponent)
        results[creatorId] = {
          won: false,
          winnings: 0,
          newCredits: players[creatorId].credits,
          bet: { color: room.creatorChoice, amount: room.betAmount }
        };
        results[botId] = {
          won: true,
          winnings: 0, // Bot doesn't actually receive credits
          newCredits: players[botId].credits,
          bet: { color: botChoice, amount: room.betAmount }
        };
      }

      // Emit results - use socket.id for creator, botId for bot
      const resultsForClient = {
        [creatorId]: results[creatorId],
        [botId]: results[botId]
      };
      
      io.to(roomId).emit("coinFlipResult", {
        coinResult,
        results: resultsForClient,
        betAmount: room.betAmount,
        creatorChoice: room.creatorChoice,
        choices: {
          [creatorId]: room.creatorChoice,
          [botId]: botChoice
        }
      });

      // Clean up bot after a delay
      setTimeout(() => {
        if (players[botId]) {
          delete players[botId];
        }
      }, 5000);
    }, 1000); // Small delay before flipping

    emitAvailableCoinflipRooms();
  });

  socket.on("disconnect", async () => {
    console.log(`Player disconnected: ${socket.id}`);
    
    // Save balance before disconnecting
    if (players[socket.id] && players[socket.id].userId) {
      await saveUserBalance(players[socket.id].userId, players[socket.id].credits);
    }
    
    // Handle coinflip room cleanup
    if (players[socket.id] && players[socket.id].roomId) {
      const roomId = players[socket.id].roomId;
      const room = coinflipRooms[roomId];
      
      if (room) {
        socket.leave(roomId);
        room.players = room.players.filter(id => id !== socket.id);
        
        // Refund creator's bet if they disconnect before confirmation
        if (socket.id === room.creatorId && !room.confirmed) {
          players[socket.id].credits += room.betAmount;
        }

        const isCreator = socket.id === room.creatorId;
        
        if (room.players.length === 0) {
          delete coinflipRooms[roomId];
        } else if (!isCreator) {
          // Joiner disconnected
          if (room.gameState === 'finished') {
            // Game already finished - don't reset
          } else {
            // Game hasn't finished - reset room state
            room.gameState = 'waiting';
            room.confirmed = false;
          }
          const remainingPlayerId = room.players[0];
          io.to(remainingPlayerId).emit("opponentLeft");
        } else {
          // Creator disconnected - refund bet if not confirmed
          if (!room.confirmed) {
            players[socket.id].credits += room.betAmount;
          }
          delete coinflipRooms[roomId];
        }
      }
    }
    
    // Remove player's bet if they disconnect
    if (rouletteState.currentBets[socket.id]) {
      delete rouletteState.currentBets[socket.id];
      io.emit('rouletteBetsUpdate', {
        bets: getBetsSnapshot()
      });
    }

    delete socketToUser[socket.id];
    delete players[socket.id];
    emitAvailableCoinflipRooms();
  });
});

// Helper function to emit available coinflip rooms
function emitAvailableCoinflipRooms(targetSocket = null) {
  const availableRooms = Object.keys(coinflipRooms)
    .filter(roomId => {
      const room = coinflipRooms[roomId];
      // Only show rooms that are waiting, not full, not confirmed, and not finished
      return room.players.length < 2 && 
             !room.confirmed && 
             room.gameState !== 'finished' &&
             room.gameState === 'waiting';
    })
    .map(roomId => ({
      roomId,
      playerCount: coinflipRooms[roomId].players.length,
      creatorName: players[coinflipRooms[roomId].creatorId]?.username || 'Unknown',
      betAmount: coinflipRooms[roomId].betAmount,
      creatorChoice: coinflipRooms[roomId].creatorChoice
    }));

  if (targetSocket) {
    targetSocket.emit("availableRooms", availableRooms);
  } else {
    io.emit("availableRooms", availableRooms);
  }
}

// Start roulette timer
startRouletteTimer();

// ========== CS2 BETTING REST API ENDPOINTS ==========

// GET /api/cs2/events - Get all CS2 events/matches
app.get("/api/cs2/events", async (req, res) => {
  try {
    // Return events from in-memory state
    const allEvents = Object.values(cs2BettingState.events);
    console.log(`[CS2 API] Total events in state: ${allEvents.length}`);
    
    // Deduplicate by fixtureId (safety check)
    const seenIds = new Set();
    const uniqueEvents = allEvents.filter(event => {
      const id = event.fixtureId || event.id;
      if (seenIds.has(id)) {
        return false;
      }
      seenIds.add(id);
      return true;
    });
    
    const eventsArray = uniqueEvents.filter(event => {
      // Only return upcoming or live matches (not finished)
      const status = event.status || 'scheduled';
      const isActive = status === 'scheduled' || status === 'live';
      
      if (!isActive) {
        console.log(`[CS2 API] Filtering out event ${event.id} with status: ${status}`);
        return false;
      }
      
      // IMPORTANT: For matches with both teams in top 250, only show if odds are available
      const team1Name = event.homeTeam || event.participant1Name || 'Team 1';
      const team2Name = event.awayTeam || event.participant2Name || 'Team 2';
      const bothInTop250 = areBothTeamsInTop250(team1Name, team2Name);
      
      if (bothInTop250) {
        const hasValidOdds = event.odds && event.odds.team1 && event.odds.team2;
        if (!hasValidOdds) {
          console.log(`[CS2 API] Filtering out event ${event.id} (${team1Name} vs ${team2Name}) - both in top 250 but no odds available`);
          return false; // Filter out top 250 matches without odds
        }
      }
      
      return true;
    });
    
    // Sort chronologically (next upcoming match first - earliest scheduled time)
    eventsArray.sort((a, b) => {
      const timeA = new Date(a.commenceTime || a.startTime || 0).getTime();
      const timeB = new Date(b.commenceTime || b.startTime || 0).getTime();
      return timeA - timeB; // Ascending: earliest first (next match to happen at the top)
    });
    
    console.log(`[CS2 API] Returning ${eventsArray.length} active events (${allEvents.length - uniqueEvents.length} duplicates removed)`);
    
    // Log first event structure for debugging
    if (eventsArray.length > 0) {
      const firstEvent = eventsArray[0];
      console.log(`[CS2 API] Sample event structure:`, JSON.stringify({
        id: firstEvent.id,
        homeTeam: firstEvent.homeTeam,
        awayTeam: firstEvent.awayTeam,
        commenceTime: firstEvent.commenceTime,
        status: firstEvent.status,
        hasOdds: !!firstEvent.odds,
        odds: firstEvent.odds
      }, null, 2));
    }
    
    res.json({
      success: true,
      events: eventsArray,
      count: eventsArray.length,
      lastSync: cs2BettingState.lastApiSync
    });
  } catch (error) {
    console.error("Error fetching CS2 events:", error);
    res.status(500).json({ success: false, error: "Failed to fetch events" });
  }
});

// GET /api/cs2/events/:eventId - Get specific event details
app.get("/api/cs2/events/:eventId", async (req, res) => {
  try {
    const eventId = req.params.eventId;
    let event = cs2BettingState.events[eventId];
    
    if (!event) {
      return res.status(404).json({ success: false, error: "Event not found" });
    }
    
    // NOTE: Do NOT fetch odds from API here
    // API calls are restricted to: server start, refresh button, and daily updates
    // Just return the cached event data
    
    res.json({ success: true, event });
  } catch (error) {
    console.error("Error fetching CS2 event:", error);
    res.status(500).json({ success: false, error: "Failed to fetch event" });
  }
});

// GET /api/cs2/events/:eventId/odds - Fetch odds for a specific event (on-demand)
// NOTE: This endpoint does NOT call the API - it only returns cached odds
// API calls are restricted to: server start, refresh button, and daily updates
app.get("/api/cs2/events/:eventId/odds", async (req, res) => {
  try {
    const eventId = req.params.eventId;
    let event = cs2BettingState.events[eventId];
    
    if (!event) {
      return res.status(404).json({ success: false, error: "Event not found" });
    }
    
    // Return cached odds only - do NOT fetch from API
    // API calls are restricted to: server start, refresh button, and daily updates
    if (event.odds && (event.odds.team1 || event.odds.team2)) {
      res.json({
        success: true,
        event: {
          id: event.id,
          fixtureId: event.fixtureId,
          odds: event.odds,
          hasOdds: true
        }
      });
    } else {
      // No odds available - return what we have
      res.json({
        success: true,
        event: {
          id: event.id,
          fixtureId: event.fixtureId,
          odds: event.odds || { team1: null, team2: null, draw: null },
          hasOdds: false,
          message: "Odds not available. Use refresh button to update."
        }
      });
    }
  } catch (error) {
    console.error("Error fetching CS2 event odds:", error);
    res.status(500).json({ success: false, error: "Failed to fetch event odds" });
  }
});

// GET /api/cs2/bets - Get bets for a session/user
app.get("/api/cs2/bets", async (req, res) => {
  try {
    const userId = req.query.userId || req.query.sessionId;
    
    if (!userId) {
      return res.status(400).json({ success: false, error: "userId or sessionId required" });
    }
    
    // Filter bets by userId
    const userBets = Object.values(cs2BettingState.bets).filter(bet => bet.userId === userId);
    
    res.json({
      success: true,
      bets: userBets,
      count: userBets.length
    });
  } catch (error) {
    console.error("Error fetching CS2 bets:", error);
    res.status(500).json({ success: false, error: "Failed to fetch bets" });
  }
});

// GET /api/cs2/balance - Get credit balance for a session/user
app.get("/api/cs2/balance", async (req, res) => {
  try {
    const userId = req.query.userId || req.query.sessionId;
    
    if (!userId) {
      return res.status(400).json({ success: false, error: "userId or sessionId required" });
    }
    
    await acquireUserBalanceLock(userId);
    const user = users[userId];
    if (user) {
      res.json({ success: true, balance: user.credits ?? 0 });
    } else {
      res.json({ success: true, balance: INITIAL_CREDITS });
    }
  } catch (error) {
    console.error("Error fetching CS2 balance:", error);
    res.status(500).json({ success: false, error: "Failed to fetch balance" });
  }
});

// POST /api/cs2/bets - Place a new bet
app.post("/api/cs2/bets", async (req, res) => {
  try {
    const { userId, eventId, selection, amount } = req.body;
    
    // Validation
    if (!userId || !eventId || !selection || !amount) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing required fields: userId, eventId, selection, amount" 
      });
    }
    
    if (typeof amount !== 'number' || amount < 1) {
      return res.status(400).json({ 
        success: false, 
        error: "Invalid bet amount. Must be a number >= 1" 
      });
    }
    
    // Check if event exists and is open for betting
    const event = cs2BettingState.events[eventId];
    if (!event) {
      return res.status(404).json({ success: false, error: "Event not found" });
    }
    
    if (event.status !== 'scheduled') {
      return res.status(400).json({ 
        success: false, 
        error: `Cannot place bet on event with status: ${event.status}` 
      });
    }
    
    // Validate selection (must be team1, team2, or draw)
    if (!['team1', 'team2', 'draw'].includes(selection)) {
      return res.status(400).json({ 
        success: false, 
        error: "Invalid selection. Must be 'team1', 'team2', or 'draw'" 
      });
    }
    
    // Get user balance (use existing casino user system)
    let user = users[userId];
    if (!user) {
      // Create new user with initial credits
      user = {
        username: userId,
        credits: INITIAL_CREDITS,
        created: new Date().toISOString()
      };
      users[userId] = user;
      await saveUsers(users);
    }
    
    // Check sufficient credits
    if (user.credits < amount) {
      return res.status(400).json({ 
        success: false, 
        error: "Insufficient credits", 
        balance: user.credits 
      });
    }
    
    // Get odds for the selection
    const odds = event.odds && event.odds[selection];
    if (!odds || odds <= 0) {
      return res.status(400).json({ 
        success: false, 
        error: `Odds not available for selection: ${selection}` 
      });
    }
    
    await runWithUserBalanceLock(userId, async () => {
      user.credits -= amount;
      await saveUserBalance(userId, user.credits);
    });

    // Create bet record
    const betId = `bet_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const bet = {
      id: betId,
      userId: userId,
      eventId: eventId,
      selection: selection,
      amount: amount,
      odds: odds,
      potentialPayout: amount * odds,
      status: 'pending',
      placedAt: new Date().toISOString(),
      settledAt: null
    };

    cs2BettingState.bets[betId] = bet;
    await saveCS2BettingData();

    res.json({
      success: true,
      bet: bet,
      newBalance: users[userId].credits
    });
  } catch (error) {
    console.error("Error placing CS2 bet:", error);
    res.status(500).json({ success: false, error: "Failed to place bet" });
  }
});

// Sync CS2 events/odds from API (used by scheduled tasks and manual sync)
async function syncCS2Events() {
  // Use odds provider for fetching matches (it re-exports from cs2ApiClient)
  // Fallback to cs2ApiClient if provider not available
  const matchClient = (cs2OddsProvider && cs2OddsProvider.fetchUpcomingMatches) 
    ? cs2OddsProvider 
    : cs2ApiClient;
  
  if (!matchClient) {
    console.warn("CS2 API client not available, skipping sync");
    return;
  }
  
  try {
    // Check cache first
    let matches = getCachedMatches();
    
    if (matches) {
      console.log(`[CS2 Sync] Using cached matches (${matches.length} matches)`);
    } else {
      console.log("Syncing CS2 events from API...");
      
      // Fetch upcoming matches from API
      matches = await matchClient.fetchUpcomingMatches({ limit: 50 });
      
      // Cache the matches
      await cacheMatches(matches);
    }
    
    // Deduplicate matches by fixtureId (in case API returns duplicates)
    const uniqueMatches = [];
    const seenIds = new Set();
    
    for (const match of matches) {
      const eventId = match.fixtureId || match.id;
      if (!eventId || seenIds.has(eventId)) {
        if (seenIds.has(eventId)) {
          console.log(`[CS2 Sync] Skipping duplicate match: ${eventId}`);
        }
        continue;
      }
      seenIds.add(eventId);
      uniqueMatches.push(match);
    }
    
    console.log(`[CS2 Sync] Processing ${uniqueMatches.length} unique matches (${matches.length - uniqueMatches.length} duplicates removed)`);
    
    // Update events in state
    let updatedCount = 0;
    let newCount = 0;
    const oddsFetchPromises = []; // Batch odds fetching
    let filteredCount = 0;
    let oddsFetchCount = 0; // Track how many odds we fetch during sync
    
    for (const match of uniqueMatches) {
      // Filter: Only include matches where both teams are in top 250
      const matchTeam1 = match.homeTeam || match.participant1Name;
      const matchTeam2 = match.awayTeam || match.participant2Name;
      
      if (!areBothTeamsInTop250(matchTeam1, matchTeam2)) {
        filteredCount++;
        const team1Ranking = getTeamRanking(matchTeam1);
        const team2Ranking = getTeamRanking(matchTeam2);
        console.log(`[CS2 Sync] Filtering out match: ${matchTeam1} vs ${matchTeam2} (team1 in top 250: ${team1Ranking !== null}, team2 in top 250: ${team2Ranking !== null})`);
        continue;
      }
      // Use fixtureId as the key since that's what OddsPapi uses
      const eventId = match.fixtureId || match.id;
      if (!eventId) {
        console.warn(`[CS2 Sync] Skipping match without ID:`, match);
        continue;
      }
      
      const existingEvent = cs2BettingState.events[eventId];
      
      // Determine status based on start time and API status
      const commenceTime = match.commenceTime || match.startTime;
      const startTimeObj = commenceTime ? new Date(commenceTime) : null;
      const now = new Date();
      
      let finalStatus = match.status;
      let finalCompleted = match.completed;
      
      // Override status if event is in the future (should be scheduled)
      if (startTimeObj && startTimeObj > now) {
        finalStatus = 'scheduled';
        finalCompleted = false;
      } else if (finalStatus === 'finished' || finalCompleted === true) {
        // Keep finished status if explicitly set
        finalStatus = 'finished';
        finalCompleted = true;
      } else if (match.statusId === 1 || finalStatus === 'live') {
        finalStatus = 'live';
        finalCompleted = false;
      } else if (!finalStatus) {
        // Default to scheduled if no status provided
        finalStatus = 'scheduled';
        finalCompleted = false;
      }
      
      // Use existing odds if available, otherwise initialize as null
      let existingOdds = existingEvent?.odds || match.odds || { team1: null, team2: null, draw: null };
      
      // Check if existing event should be removed (both teams in top 250 but no odds)
      if (existingEvent && (finalStatus === 'scheduled' || finalStatus === 'live')) {
        const team1Name = match.homeTeam || match.participant1Name || 'Team 1';
        const team2Name = match.awayTeam || match.participant2Name || 'Team 2';
        const bothInTop250 = areBothTeamsInTop250(team1Name, team2Name);
        const hasValidOdds = existingOdds.team1 && existingOdds.team2;
        
        if (bothInTop250 && !hasValidOdds) {
          // Existing event lost odds - will be handled below when we try to fetch
          console.log(`[CS2 Sync] Existing event ${eventId} (${team1Name} vs ${team2Name}) has no odds - will attempt to fetch`);
        }
      }
      
      // Validate and correct odds based on team rankings
      const team1Name = match.homeTeam || match.participant1Name || 'Team 1';
      const team2Name = match.awayTeam || match.participant2Name || 'Team 2';
      if (existingOdds.team1 && existingOdds.team2) {
        existingOdds = validateAndCorrectOdds(existingOdds, team1Name, team2Name);
      }
      
      const needsOdds = (!existingOdds.team1 || !existingOdds.team2) && 
                        (finalStatus === 'scheduled' || finalStatus === 'live') &&
                        match.hasOdds !== false;
      
      // IMPORTANT: For matches with both teams in top 250, we require REAL odds to be available
      // Check if existing odds are real (not placeholder 2.0)
      const hasRealOdds = existingOdds.team1 && existingOdds.team2 && 
                         existingOdds.team1 !== 2.0 && existingOdds.team2 !== 2.0;
      
      if (!hasRealOdds && (finalStatus === 'scheduled' || finalStatus === 'live')) {
        // Try to fetch odds immediately (if not already cached)
        // Check cache first
        let oddsData = getCachedOdds(eventId);
        
        if (!oddsData) {
          // Cache miss - try to fetch from API (with rate limiting)
          // Respect rate limits - 600ms delay between requests
          if (oddsFetchCount > 0) {
            await new Promise(resolve => setTimeout(resolve, 600));
          }
          
          try {
            console.log(`[CS2 Sync] Fetching odds for ${team1Name} vs ${team2Name} (required for top 250 match)...`);
            oddsData = await cs2ApiClient.fetchMatchOdds(eventId);
            oddsFetchCount++;
            
            // Only cache if odds are real (not placeholder)
            if (oddsData && oddsData.odds && areOddsReal(oddsData)) {
              await cacheOdds(eventId, oddsData);
            } else if (oddsData && oddsData.odds) {
              console.log(`[CS2 Sync] ⚠ Fetched odds for ${eventId} are placeholder/fake, NOT caching`);
            }
          } catch (error) {
            console.error(`[CS2 Sync] Error fetching odds for ${eventId}:`, error.message);
            oddsData = null;
          }
        } else {
          // Validate cached odds are real
          if (!areOddsReal(oddsData)) {
            console.log(`[CS2 Sync] ⚠ Cached odds for ${eventId} are placeholder, fetching fresh...`);
            delete cs2ApiCache.odds[eventId];
            await saveCS2ApiCache();
            oddsData = await cs2ApiClient.fetchMatchOdds(eventId);
            if (oddsData && oddsData.odds && areOddsReal(oddsData)) {
              await cacheOdds(eventId, oddsData);
            } else {
              oddsData = null;
            }
          }
        }
        
        // Check if we got valid REAL odds (not placeholder)
        if (oddsData && oddsData.odds && areOddsReal(oddsData)) {
          // Validate and correct odds
          let validatedOdds = {
            team1: oddsData.odds.team1,
            team2: oddsData.odds.team2,
            draw: oddsData.odds.draw || null
          };
          
          if (validatedOdds.team1 && validatedOdds.team2) {
            validatedOdds = validateAndCorrectOdds(validatedOdds, team1Name, team2Name);
          }
          
          existingOdds = validatedOdds;
          console.log(`[CS2 Sync] ✓ Got odds for ${team1Name} vs ${team2Name}: ${validatedOdds.team1}/${validatedOdds.team2}`);
        } else {
          // No odds available - skip this match (don't add to events)
          console.log(`[CS2 Sync] ⚠ Skipping match ${team1Name} vs ${team2Name} - both teams in top 250 but no odds available`);
          filteredCount++;
          continue; // Skip adding this match to events
        }
      }
      
      // Queue for odds aggregation (will be processed by scheduled aggregation task)
      // No limit here since aggregation handles rate limiting
      if (needsOdds && (match.homeTeam || match.participant1Name) && (match.awayTeam || match.participant2Name)) {
        oddsFetchPromises.push({ eventId, status: finalStatus });
      }
      
      // Map to internal event format (handles both old and new API formats)
      cs2BettingState.events[eventId] = {
        id: eventId, // Use fixtureId as the primary ID
        fixtureId: eventId,
        sportId: match.sportId,
        sportName: match.sportName || match.sportTitle || match.sportKey,
        sportKey: match.sportKey || match.sportName,
        sportTitle: match.sportTitle || match.sportName,
        tournamentId: match.tournamentId,
        tournamentName: match.tournamentName,
        commenceTime: commenceTime,
        startTime: match.startTime || commenceTime,
        homeTeam: match.homeTeam || match.participant1Name || 'Team 1',
        awayTeam: match.awayTeam || match.participant2Name || 'Team 2',
        participant1Name: match.participant1Name || match.homeTeam || 'Team 1',
        participant2Name: match.participant2Name || match.awayTeam || 'Team 2',
        odds: existingOdds,
        status: finalStatus,
        statusId: match.statusId || (finalStatus === 'live' ? 1 : (finalStatus === 'finished' ? 2 : 0)),
        completed: finalCompleted,
        hasOdds: match.hasOdds !== false,
        lastUpdate: match.lastUpdate || match.updatedAt || new Date().toISOString()
      };
      
      // Debug: Log first new event structure
      if (!existingEvent && newCount === 0) {
        console.log(`[CS2 Sync] First new event structure:`, JSON.stringify(cs2BettingState.events[eventId], null, 2));
      }
      
      if (existingEvent) {
        updatedCount++;
      } else {
        newCount++;
      }
    }
    
    // NOTE: Odds fetching is now handled separately:
    // - On server start (initial sync)
    // - When refresh button is clicked
    // - Once per day (daily check)
    // We don't fetch odds automatically during sync to avoid excessive API calls
    
    cs2BettingState.lastApiSync = new Date().toISOString();
    // Update lastApiQuery timestamp when syncing events (this counts as an API query)
    if (!cs2BettingState.lastApiQuery) {
      cs2BettingState.lastApiQuery = new Date().toISOString();
    }
    await saveCS2BettingData();
    
    console.log(`CS2 sync complete: ${newCount} new, ${updatedCount} updated, ${filteredCount} filtered out (not in top 250)`);
    return { newCount, updatedCount, filteredCount, total: matches.length };
  } catch (error) {
    console.error("Error syncing CS2 events:", error);
    return null;
  }
}

// Settle CS2 bets based on match results
async function settleCS2Bets() {
  if (!cs2ApiClient) {
    console.warn("CS2 API client not available, skipping settlement");
    return;
  }
  
  try {
    console.log("[CS2 Settlement] Starting settlement check...");
    
    // Get all pending bets
    const pendingBets = Object.values(cs2BettingState.bets).filter(bet => bet.status === 'pending');
    
    if (pendingBets.length === 0) {
      console.log("[CS2 Settlement] No pending bets to settle");
      // Still update timestamp even if no bets to settle
      cs2BettingState.lastSettlementCheck = new Date().toISOString();
      await saveCS2BettingData();
      return { settled: 0, won: 0, lost: 0 };
    }
    
    let settledCount = 0;
    let wonCount = 0;
    let lostCount = 0;
    
    // Group bets by eventId to minimize API calls
    const betsByEvent = {};
    for (const bet of pendingBets) {
      if (!betsByEvent[bet.eventId]) {
        betsByEvent[bet.eventId] = [];
      }
      betsByEvent[bet.eventId].push(bet);
    }
    
    // Check each event for results
    for (const eventId of Object.keys(betsByEvent)) {
      const event = cs2BettingState.events[eventId];
      
      if (!event) {
        console.warn(`Event ${eventId} not found in state, skipping bets`);
        continue;
      }
      
      // If event is not finished, check API for results
      if (event.status !== 'finished') {
        try {
          // Use cs2ApiClient or cs2OddsProvider for fetching results
          const resultClient = cs2OddsProvider || cs2ApiClient;
          if (!resultClient) {
            console.warn(`No API client available to fetch results for event ${eventId}`);
            continue;
          }
          const result = await resultClient.fetchMatchResults(eventId);
          if (result && result.completed) {
            // Update event status
            event.status = 'finished';
            event.statusId = result.statusId;
            event.completed = true;
            event.result = {
              winner: result.winner,
              participant1Score: result.participant1Score || result.homeScore,
              participant2Score: result.participant2Score || result.awayScore,
              homeScore: result.homeScore || result.participant1Score,
              awayScore: result.awayScore || result.participant2Score
            };
            cs2BettingState.events[eventId] = event;
          } else {
            // Event not finished yet, skip
            continue;
          }
        } catch (error) {
          console.error(`Error fetching results for event ${eventId}:`, error.message);
          // Continue with next event
          continue;
        }
      }
      
      // Settle bets for this event
      const eventBets = betsByEvent[eventId];
      for (const bet of eventBets) {
        if (bet.status !== 'pending') {
          continue;
        }
        
        const winner = event.result?.winner;
        
        if (!winner) {
          // No result available, check if event was cancelled
          if (event.status === 'cancelled') {
            // Void bet - return stake
            bet.status = 'void';
            bet.result = 'void';
            
            // Return credits to user
            const user = users[bet.userId];
            if (user) {
              user.credits += bet.amount;
              await saveUserBalance(bet.userId, user.credits);
            }
          }
          // Otherwise, keep as pending (event might be in progress)
          continue;
        }
        
        // Determine if bet won
        const betWon = (bet.selection === 'team1' && winner === 'team1') ||
                       (bet.selection === 'team2' && winner === 'team2') ||
                       (bet.selection === 'draw' && winner === 'draw');
        
        if (betWon) {
          // Bet won - pay out
          bet.status = 'won';
          bet.result = 'win';
          const payout = bet.potentialPayout;
          
          const user = users[bet.userId];
          if (user) {
            user.credits += payout;
            await saveUserBalance(bet.userId, user.credits);
          }
          
          wonCount++;
        } else {
          // Bet lost
          bet.status = 'lost';
          bet.result = 'loss';
          lostCount++;
        }
        
        bet.settledAt = new Date().toISOString();
        cs2BettingState.bets[bet.id] = bet;
        settledCount++;
      }
    }
    
    if (settledCount > 0) {
      await saveCS2BettingData();
      console.log(`[CS2 Settlement] Settled ${settledCount} bets: ${wonCount} won, ${lostCount} lost`);
    } else {
      console.log(`[CS2 Settlement] No bets to settle`);
    }
    
    // Update last settlement check timestamp (even if no bets were settled)
    cs2BettingState.lastSettlementCheck = new Date().toISOString();
    await saveCS2BettingData();
    
    return { settled: settledCount, won: wonCount, lost: lostCount };
  } catch (error) {
    console.error("Error settling CS2 bets:", error);
    return null;
  }
}

// Aggregate odds for all active CS2 events from HLTV and gambling scrapers
/**
 * Check if it's been 24 hours since last API query
 * @returns {boolean} True if 24 hours have passed or no previous query
 */
function shouldRunDailyUpdate() {
  if (!cs2BettingState.lastApiQuery) {
    return true; // No previous query, allow it
  }
  
  const lastQuery = new Date(cs2BettingState.lastApiQuery);
  const now = new Date();
  const hoursSinceLastQuery = (now - lastQuery) / (1000 * 60 * 60);
  
  return hoursSinceLastQuery >= 24;
}

/**
 * Update odds for all active matches using OddsPapi with common range approach
 * This function fetches odds from OddsPapi and uses the common range logic
 * @param {boolean} updateAll - If true, update all matches; if false, only update those missing odds
 * @param {boolean} force - If true, bypass daily check (for manual refresh)
 * @returns {Promise<Object>} Result with processed, updated, and failed counts
 */
async function updateAllMatchOdds(updateAll = false, force = false) {
  if (!cs2ApiClient) {
    console.warn("[CS2 Odds] CS2 API client not available, skipping odds update");
    return null;
  }
  
  // Check daily limit unless forced (for manual refresh)
  if (!force && !shouldRunDailyUpdate()) {
    const lastQuery = new Date(cs2BettingState.lastApiQuery);
    const now = new Date();
    const hoursSinceLastQuery = (now - lastQuery) / (1000 * 60 * 60);
    const hoursRemaining = 24 - hoursSinceLastQuery;
    console.log(`[CS2 Odds] Daily API limit: ${hoursRemaining.toFixed(1)} hours remaining until next update`);
    return { 
      processed: 0, 
      updated: 0, 
      failed: 0,
      message: `Daily API limit reached. Next update in ${hoursRemaining.toFixed(1)} hours. Use refresh button to force update.`
    };
  }
  
  try {
    console.log(`[CS2 Odds] Starting odds update for ${updateAll ? 'all' : 'missing'} active events...`);
    
    // Get all active events (scheduled or live)
    const activeEvents = Object.values(cs2BettingState.events).filter(event => {
      const isActive = event.status === 'scheduled' || event.status === 'live';
      const hasFixtureId = event.fixtureId || event.id;
      return isActive && hasFixtureId;
    });
    
    // Filter to only those needing odds if updateAll is false
    // An event needs odds if:
    // 1. It has no odds at all, OR
    // 2. It has placeholder/fake odds (2.0 default), OR
    // 3. It's missing odds for one or both teams, OR
    // 4. hasOdds is false (meaning it previously didn't have real odds)
    const eventsToUpdate = updateAll 
      ? activeEvents 
      : activeEvents.filter(event => {
          // Always update if hasOdds is explicitly false (match without odds that might now have them)
          if (event.hasOdds === false) {
            return true;
          }
          
          if (!event.odds || !event.odds.team1 || !event.odds.team2) {
            return true; // Missing odds
          }
          
          // Check if existing odds are placeholder (2.0 default)
          const hasPlaceholderOdds = (event.odds.team1 === 2.0 && event.odds.team2 === 2.0) ||
                                     (event.odds.team1 === null || event.odds.team1 === undefined) ||
                                     (event.odds.team2 === null || event.odds.team2 === undefined);
          return hasPlaceholderOdds;
        });
    
    if (eventsToUpdate.length === 0) {
      console.log(`[CS2 Odds] No events need odds update`);
      return { processed: 0, updated: 0, failed: 0 };
    }
    
    console.log(`[CS2 Odds] Processing ${eventsToUpdate.length} events for odds update...`);
    
    let updatedCount = 0;
    let failedCount = 0;
    
    // Process events sequentially with delays to respect rate limits (500ms cooldown per OddsPapi)
    for (let i = 0; i < eventsToUpdate.length; i++) {
      const event = eventsToUpdate[i];
      const eventId = event.fixtureId || event.id;
      
      try {
        // Respect rate limits - 600ms delay between requests (500ms cooldown + buffer)
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 600));
        }
        
        console.log(`[CS2 Odds] Processing event ${eventId} (${i + 1}/${eventsToUpdate.length}): ${event.homeTeam || event.participant1Name} vs ${event.awayTeam || event.participant2Name}`);
        
        // ALWAYS check cache first - this prevents duplicate API calls
        let oddsData = getCachedOdds(eventId);
        
        if (!oddsData) {
          // Cache miss - fetch from API
          console.log(`[CS2 Odds] Cache miss for event ${eventId}, fetching from API...`);
          oddsData = await cs2ApiClient.fetchMatchOdds(eventId);
          
          // Cache the odds ONLY if they are real (not placeholder)
          if (oddsData && oddsData.odds) {
            if (areOddsReal(oddsData)) {
              await cacheOdds(eventId, oddsData);
              console.log(`[CS2 Odds] ✓ Fetched and cached REAL odds for event ${eventId}`);
            } else {
              console.log(`[CS2 Odds] ⚠ Fetched odds for event ${eventId} are placeholder/fake, NOT caching`);
            }
          } else {
            console.log(`[CS2 Odds] ⚠ No odds data returned for event ${eventId}`);
          }
        } else {
          // Validate cached odds are real before using
          if (areOddsReal(oddsData)) {
            console.log(`[CS2 Odds] ✓ Using cached REAL odds for event ${eventId} (no API call needed)`);
          } else {
            // Cached odds are placeholder - clear cache and fetch fresh
            console.log(`[CS2 Odds] ⚠ Cached odds for event ${eventId} are placeholder, fetching fresh...`);
            delete cs2ApiCache.odds[eventId];
            await saveCS2ApiCache();
            oddsData = await cs2ApiClient.fetchMatchOdds(eventId);
            if (oddsData && oddsData.odds && areOddsReal(oddsData)) {
              await cacheOdds(eventId, oddsData);
              console.log(`[CS2 Odds] ✓ Fetched and cached REAL odds for event ${eventId}`);
            }
          }
        }
        
        // Only process if we have real odds (not placeholder)
        if (oddsData && oddsData.odds && areOddsReal(oddsData)) {
          // Validate and correct odds based on team rankings
          const team1Name = event.homeTeam || event.participant1Name || 'Team 1';
          const team2Name = event.awayTeam || event.participant2Name || 'Team 2';
          let validatedOdds = {
            team1: oddsData.odds.team1,
            team2: oddsData.odds.team2,
            draw: oddsData.odds.draw || null
          };
          
          // Validate and correct odds if both teams have rankings
          if (validatedOdds.team1 && validatedOdds.team2) {
            validatedOdds = validateAndCorrectOdds(validatedOdds, team1Name, team2Name);
          }
          
          // Update event with validated odds
          event.odds = validatedOdds;
          event.hasOdds = true;
          event.lastOddsUpdate = new Date().toISOString();
          
          cs2BettingState.events[eventId] = event;
          updatedCount++;
          
          console.log(`[CS2 Odds] ✓ Updated odds for event ${eventId} (common range): team1=${validatedOdds.team1}, team2=${validatedOdds.team2}`);
        } else {
          console.log(`[CS2 Odds] ⚠ No odds available for event ${eventId}`);
          
          // For matches with both teams in top 250, remove from events if no odds available
          const team1Name = event.homeTeam || event.participant1Name || 'Team 1';
          const team2Name = event.awayTeam || event.participant2Name || 'Team 2';
          const bothInTop250 = areBothTeamsInTop250(team1Name, team2Name);
          
          if (bothInTop250 && (event.status === 'scheduled' || event.status === 'live')) {
            // Remove match from events since it doesn't have odds
            console.log(`[CS2 Odds] Removing match ${team1Name} vs ${team2Name} from events - both in top 250 but no odds available`);
            delete cs2BettingState.events[eventId];
            await saveCS2BettingData();
          } else {
            // Keep the match but mark as no odds (for non-top-250 matches or finished matches)
            if (event.hasOdds !== false) {
              event.hasOdds = false;
              cs2BettingState.events[eventId] = event;
            }
          }
          failedCount++;
        }
      } catch (error) {
        console.error(`[CS2 Odds] Error updating odds for event ${eventId}:`, error.message);
        if (event.hasOdds !== false) {
          event.hasOdds = false;
          cs2BettingState.events[eventId] = event;
        }
        failedCount++;
        // Continue with next event
      }
    }
    
    // Update last API query timestamp (only if we actually made API calls)
    if (eventsToUpdate.length > 0) {
      cs2BettingState.lastApiQuery = new Date().toISOString();
    }
    
    // Save updated events
    if (updatedCount > 0 || failedCount > 0) {
      await saveCS2BettingData();
    }
    
    console.log(`[CS2 Odds] Update complete: ${updatedCount} updated, ${failedCount} failed out of ${eventsToUpdate.length} events`);
    return { processed: eventsToUpdate.length, updated: updatedCount, failed: failedCount };
    
  } catch (error) {
    console.error("[CS2 Odds] Error during odds update:", error);
    return null;
  }
}

async function aggregateCS2Odds() {
  // This function is deprecated - odds are now updated via:
  // 1. Server start (initial sync)
  // 2. Refresh button (manual sync)
  // 3. Daily check (once per 24 hours)
  // Do NOT call API here automatically
  console.log("[CS2 Odds] aggregateCS2Odds called but API calls are restricted. Use refresh button or wait for daily update.");
  return { processed: 0, updated: 0, failed: 0, message: "API calls restricted. Use refresh button to update." };
}

// GET /api/cs2/admin/sports - List available sports (for debugging)
app.get("/api/cs2/admin/sports", async (req, res) => {
  try {
    // Use cs2ApiClient directly for admin endpoints (not available in provider)
    if (!cs2ApiClient) {
      return res.status(503).json({
        success: false,
        error: "CS2 API client not available" 
      });
    }

    const relatedSports = await cs2ApiClient.listRelatedSports();
    
    res.json({
      success: true,
      sports: relatedSports,
      count: relatedSports.length,
      currentSportId: cs2ApiClient.findCS2SportId ? await cs2ApiClient.findCS2SportId() : null,
      oddsProviderEnabled: !!cs2OddsProvider,
      availableOddsSources: cs2OddsProvider ? cs2OddsProvider.getAvailableSources() : []
    });
  } catch (error) {
    console.error("Error listing sports:", error);
    res.status(500).json({ success: false, error: "Failed to list sports" });
  }
});

// POST /api/cs2/admin/sync - Force refresh of events/odds from API
// This is called when refresh button is clicked on CS2 betting page
app.post("/api/cs2/admin/sync", async (req, res) => {
  try {
    console.log("[CS2 Sync] Manual refresh triggered via API");
    const result = await syncCS2Events();
    
    // Also trigger odds update after syncing events (force=true to bypass daily limit for manual refresh)
    const oddsResult = await updateAllMatchOdds(true, true); // Force update on manual refresh
    
    if (result) {
      res.json({
        success: true,
        message: `Synced ${result.total} matches and updated odds`,
        ...result,
        oddsResult: oddsResult,
        lastSync: cs2BettingState.lastApiSync,
        lastApiQuery: cs2BettingState.lastApiQuery
      });
    } else {
      res.status(503).json({ 
        success: false, 
        error: "Failed to sync or API client not available",
        oddsResult: oddsResult
      });
    }
  } catch (error) {
    console.error("Error in sync endpoint:", error);
    res.status(500).json({ success: false, error: "Failed to sync data" });
  }
});

// GET /api/cs2/sync - Same as POST but for GET requests (for refresh button)
app.get("/api/cs2/sync", async (req, res) => {
  try {
    console.log("[CS2 Sync] Manual refresh triggered via GET API");
    const result = await syncCS2Events();
    
    // Also trigger odds update after syncing events (force=true to bypass daily limit for manual refresh)
    const oddsResult = await updateAllMatchOdds(true, true); // Force update on manual refresh
    
    if (result) {
      res.json({
        success: true,
        message: `Synced ${result.total} matches and updated odds`,
        ...result,
        oddsResult: oddsResult,
        lastSync: cs2BettingState.lastApiSync,
        lastApiQuery: cs2BettingState.lastApiQuery
      });
    } else {
      res.status(503).json({ 
        success: false, 
        error: "Failed to sync or API client not available",
        oddsResult: oddsResult
      });
    }
  } catch (error) {
    console.error("Error in sync endpoint:", error);
    res.status(500).json({ success: false, error: "Failed to sync data" });
  }
});

// POST /api/cs2/admin/aggregate - Manually trigger odds aggregation
app.post("/api/cs2/admin/aggregate", async (req, res) => {
  try {
    const result = await aggregateCS2Odds();
    
    if (result !== null) {
      res.json({
        success: true,
        message: "CS2 odds aggregation completed",
        result: result
      });
    } else {
      res.status(503).json({ 
        success: false, 
        error: "Failed to aggregate odds or odds provider not available" 
      });
    }
  } catch (error) {
    console.error("Error in aggregate endpoint:", error);
    res.status(500).json({ success: false, error: "Failed to aggregate odds" });
  }
});

// POST /api/cs2/admin/settle - Manually trigger bet settlement (bypasses daily limit)
app.post("/api/cs2/admin/settle", async (req, res) => {
  try {
    console.log("[CS2 Settlement] Manual settlement triggered via API");
    const result = await settleCS2Bets();
    if (result) {
      res.json({
        success: true,
        message: `Settled ${result.settled} bets`,
        ...result
      });
    } else {
      res.status(503).json({ 
        success: false, 
        error: "Failed to settle bets or API client not available" 
      });
    }
  } catch (error) {
    console.error("Error in settle endpoint:", error);
    res.status(500).json({ success: false, error: "Failed to settle bets" });
  }
});

// ========== END CS2 BETTING REST API ENDPOINTS ==========

// ========== CS2 BETTING SCHEDULED TASKS ==========

// Configuration for scheduled tasks
const CS2_SYNC_INTERVAL_MS = parseInt(process.env.CS2_SYNC_INTERVAL_MS || "1800000", 10); // 30 minutes default
const CS2_SETTLEMENT_INTERVAL_MS = parseInt(process.env.CS2_SETTLEMENT_INTERVAL_MS || "300000", 10); // 5 minutes default
const CS2_ODDS_AGGREGATION_INTERVAL_MS = parseInt(process.env.CS2_ODDS_AGGREGATION_INTERVAL_MS || "600000", 10); // 10 minutes default for odds aggregation

let cs2SyncInterval = null;
let cs2SettlementInterval = null;
let cs2OddsAggregationInterval = null;
let cs2DailyOddsUpdateInterval = null;

// Start scheduled tasks for CS2 betting
function startCS2ScheduledTasks() {
  if (!cs2ApiClient) {
    console.log("CS2 API client not available, skipping scheduled tasks");
    return;
  }
  
  // Use node-cron if available, otherwise use setInterval
  if (cron) {
    // NOTE: Event sync is DISABLED - API calls are restricted to:
    // 1. Server start (initial sync)
    // 2. Refresh button (manual sync)
    // 3. Daily check (once per 24 hours)
    // cs2SyncInterval is no longer used
    cs2SyncInterval = null;
    
    // Schedule daily settlement check (runs once per day at midnight UTC, or checks if 24 hours passed)
    // This ensures bets are settled once per day
    cs2SettlementInterval = cron.schedule("0 0 * * *", async () => {
      // Check if 24 hours have passed since last settlement check
      if (shouldRunSettlementCheck()) {
        console.log("[CS2 Settlement] Daily check: 24 hours passed, starting settlement check...");
        await settleCS2Bets(); // Function will update lastSettlementCheck timestamp
      } else {
        const lastCheck = new Date(cs2BettingState.lastSettlementCheck);
        const now = new Date();
        const hoursSinceLastCheck = (now - lastCheck) / (1000 * 60 * 60);
        const hoursRemaining = 24 - hoursSinceLastCheck;
        console.log(`[CS2 Settlement] Daily check: ${hoursRemaining.toFixed(1)} hours remaining until next settlement check`);
      }
    }, {
      scheduled: true,
      timezone: "UTC"
    });
    
    // Schedule daily odds update (runs once per day at 1 AM UTC, or checks if 24 hours passed)
    // This ensures all matches get fresh odds once per day using common range approach
    cs2DailyOddsUpdateInterval = cron.schedule("0 1 * * *", async () => {
      // Check if 24 hours have passed since last API query
      if (shouldRunDailyUpdate()) {
        console.log("[CS2 Odds] Daily check: 24 hours passed, starting odds update for all matches...");
        await updateAllMatchOdds(true, false); // Update all matches, respect daily limit
      } else {
        const lastQuery = new Date(cs2BettingState.lastApiQuery);
        const now = new Date();
        const hoursSinceLastQuery = (now - lastQuery) / (1000 * 60 * 60);
        const hoursRemaining = 24 - hoursSinceLastQuery;
        console.log(`[CS2 Odds] Daily check: ${hoursRemaining.toFixed(1)} hours remaining until next update`);
      }
    }, {
      scheduled: true,
      timezone: "UTC"
    });
    
    console.log("CS2 scheduled tasks started using node-cron:");
    console.log(`  - Event sync: DISABLED (API calls restricted)`);
    console.log(`  - Settlement check: once per day at midnight UTC (or if 24 hours passed)`);
    console.log(`  - Odds aggregation: DISABLED (API calls restricted)`);
    console.log(`  - Daily odds update: once per day at 1 AM UTC (or if 24 hours passed)`);
  } else {
    // Fallback to setInterval
    // NOTE: Event sync is DISABLED - API calls are restricted
    // cs2SyncInterval is no longer used
    cs2SyncInterval = null;
    
    // Schedule daily settlement check (runs once per day, checks if 24 hours passed)
    // Check every hour to see if 24 hours have passed since last settlement
    cs2SettlementInterval = setInterval(async () => {
      if (shouldRunSettlementCheck()) {
        console.log("[CS2 Settlement] Daily check: 24 hours passed, starting settlement check...");
        await settleCS2Bets(); // Function will update lastSettlementCheck timestamp
      } else {
        const lastCheck = new Date(cs2BettingState.lastSettlementCheck);
        const now = new Date();
        const hoursSinceLastCheck = (now - lastCheck) / (1000 * 60 * 60);
        const hoursRemaining = 24 - hoursSinceLastCheck;
        console.log(`[CS2 Settlement] Daily check: ${hoursRemaining.toFixed(1)} hours remaining until next settlement check`);
      }
    }, 60 * 60 * 1000); // Check every hour
    
    // Schedule daily odds update (runs once per day, checks if 24 hours passed)
    cs2DailyOddsUpdateInterval = setInterval(async () => {
      // Check if 24 hours have passed since last API query
      if (shouldRunDailyUpdate()) {
        console.log("[CS2 Odds] Daily check: 24 hours passed, starting odds update for all matches...");
        await updateAllMatchOdds(true, false); // Update all matches, respect daily limit
      } else {
        const lastQuery = new Date(cs2BettingState.lastApiQuery);
        const now = new Date();
        const hoursSinceLastQuery = (now - lastQuery) / (1000 * 60 * 60);
        const hoursRemaining = 24 - hoursSinceLastQuery;
        console.log(`[CS2 Odds] Daily check: ${hoursRemaining.toFixed(1)} hours remaining until next update`);
      }
    }, 60 * 60 * 1000); // Check every hour
    
    console.log("CS2 scheduled tasks started using setInterval:");
    console.log(`  - Event sync: DISABLED (API calls restricted)`);
    console.log(`  - Settlement check: once per day (checks hourly if 24 hours passed)`);
    console.log(`  - Odds aggregation: DISABLED (API calls restricted)`);
    console.log(`  - Daily odds update: once per day (checks hourly if 24 hours passed)`);
  }
  
  // NOTE: Initial sync is now handled separately after startCS2ScheduledTasks()
  // to ensure it only runs once on server start
}

// Stop scheduled tasks (for graceful shutdown)
function stopCS2ScheduledTasks() {
  if (cs2SyncInterval) {
    if (cron && cs2SyncInterval.stop) {
      cs2SyncInterval.stop();
    } else if (typeof cs2SyncInterval === 'number') {
      clearInterval(cs2SyncInterval);
    }
    cs2SyncInterval = null;
  }
  
  if (cs2SettlementInterval) {
    if (cron && cs2SettlementInterval.stop) {
      cs2SettlementInterval.stop();
    } else if (typeof cs2SettlementInterval === 'number') {
      clearInterval(cs2SettlementInterval);
    }
    cs2SettlementInterval = null;
  }
  
  if (cs2OddsAggregationInterval) {
    if (cron && cs2OddsAggregationInterval.stop) {
      cs2OddsAggregationInterval.stop();
    } else if (typeof cs2OddsAggregationInterval === 'number') {
      clearInterval(cs2OddsAggregationInterval);
    }
    cs2OddsAggregationInterval = null;
  }
  
  if (cs2DailyOddsUpdateInterval) {
    if (cron && cs2DailyOddsUpdateInterval.stop) {
      cs2DailyOddsUpdateInterval.stop();
    } else if (typeof cs2DailyOddsUpdateInterval === 'number') {
      clearInterval(cs2DailyOddsUpdateInterval);
    }
    cs2DailyOddsUpdateInterval = null;
  }
  
  console.log("CS2 scheduled tasks stopped");
}

// Start CS2 scheduled tasks if API client is available
if (cs2ApiClient) {
  startCS2ScheduledTasks();
  
  // Perform initial sync on server start (only time API is called automatically)
  // Ensure cache is loaded before syncing
  setTimeout(async () => {
    // Wait for cache to be loaded (if not already)
    if (!cs2ApiCache || Object.keys(cs2ApiCache.odds || {}).length === 0 && !cs2ApiCache.matches?.data) {
      console.log("[CS2 Sync] Waiting for cache to load...");
      await loadCS2ApiCache();
    }
    
    console.log("[CS2 Sync] Performing initial sync on server start...");
    await syncCS2Events();
    // Also update odds on initial sync
    console.log("[CS2 Odds] Performing initial odds update on server start...");
    await updateAllMatchOdds(true, true); // Force update on server start
  }, 10000); // Wait 10 seconds for server to fully initialize
}

// ========== END CS2 BETTING SCHEDULED TASKS ==========

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Casino Server running on http://localhost:${PORT}`);
  console.log(`  - Roulette game available`);
  console.log(`  - Coinflip game available`);
  if (cs2ApiClient) {
    console.log(`  - CS2 Betting available (REST API: /api/cs2/*)`);
  }
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  stopCS2ScheduledTasks();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  stopCS2ScheduledTasks();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

