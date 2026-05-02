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

// CS2 bo3.gg API Client - Free alternative data source for matches
let cs2Bo3ggClient = null;
try {
  cs2Bo3ggClient = require("./cs2-bo3gg-client");
  console.log("CS2 bo3.gg client loaded (free match data source)");
} catch (error) {
  console.warn("CS2 bo3.gg client not available:", error.message);
}

// CS2 Free Result Sources - HLTV/Liquipedia scraping for settlement fallback
let cs2ResultFetcher = null;
try {
  const freeResultSources = require("./cs2-free-result-sources");
  cs2ResultFetcher = freeResultSources.resultFetcher;
  console.log("CS2 Free Result Sources loaded (HLTV + Liquipedia scrapers)");
} catch (error) {
  console.warn("CS2 Free Result Sources not available:", error.message);
  console.warn("Settlement will rely solely on OddsPapi for results");
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

// Bet history file path
const BET_HISTORY_FILE = path.join(__dirname, "data", "bet-history.json");

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
  
  // Migrate existing users to include new stats and achievements structure
  let migrationNeeded = false;
  for (const [userId, userData] of Object.entries(users)) {
    if (!userData.stats) {
      migrationNeeded = true;
      userData.stats = {
        totalWagered: 0,
        totalWon: 0,
        gamesPlayed: 0,
        gamesWon: 0,
        biggestWin: 0,
        currentStreak: 0,
        bestStreak: 0,
        gameStats: {
          blackjack: { played: 0, won: 0, bestStreak: 0 },
          roulette: { played: 0, won: 0, hitNumber7: 0 },
          coinflip: { played: 0, won: 0 },
          crash: { played: 0, won: 0, bestMultiplier: 0 },
          poker: { played: 0, won: 0, royalFlushes: 0, biggestPot: 0 },
          cs2betting: { played: 0, won: 0 },
          pachinko: { played: 0, won: 0 }
        }
      };
    }
    
    if (!userData.achievements) {
      migrationNeeded = true;
      userData.achievements = [];
    }
    
    if (!userData.weeklyStats) {
      migrationNeeded = true;
      userData.weeklyStats = {
        startDate: new Date().toISOString(),
        totalWagered: 0,
        totalWon: 0,
        gamesPlayed: 0
      };
    }
  }
  
  if (migrationNeeded) {
    console.log('Migrating users to include stats and achievements...');
    saveUsers(users).then(() => {
      console.log('User migration completed successfully');
    }).catch(err => {
      console.error('Error saving migrated users:', err);
    });
  }
  
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

// ========== BET HISTORY ==========
let betHistory = {}; // { username: [ { game, bet, result, payout, multiplier, timestamp }, ... ] }

async function loadBetHistory() {
  try {
    const dataDir = path.join(__dirname, "data");
    await fs.mkdir(dataDir, { recursive: true }).catch(() => {});
    const data = await fs.readFile(BET_HISTORY_FILE, "utf8");
    betHistory = JSON.parse(data);
    console.log(`Loaded bet history: ${Object.keys(betHistory).length} users`);
  } catch (error) {
    if (error.code === "ENOENT") betHistory = {};
    else console.error("Error loading bet history:", error);
  }
}

async function saveBetHistory() {
  try {
    const dataDir = path.join(__dirname, "data");
    await fs.mkdir(dataDir, { recursive: true }).catch(() => {});
    const tempFile = BET_HISTORY_FILE + '.tmp';
    await fs.writeFile(tempFile, JSON.stringify(betHistory, null, 2), "utf8");
    await fs.rename(tempFile, BET_HISTORY_FILE);
  } catch (error) {
    console.error("Error saving bet history:", error);
  }
}

function addBetRecord(username, record) {
  if (!betHistory[username]) betHistory[username] = [];
  betHistory[username].unshift({
    ...record,
    timestamp: new Date().toISOString()
  });
  // Keep last 200 bets per user
  if (betHistory[username].length > 200) betHistory[username] = betHistory[username].slice(0, 200);
  saveBetHistory().catch(err => console.error("Error saving bet history:", err));
}

loadBetHistory().catch(err => console.error("Error loading bet history:", err));

// ========== ACHIEVEMENT SYSTEM ==========
const ACHIEVEMENTS = {
  'first_timer': { id: 'first_timer', name: 'First Timer', icon: '🎰', description: 'Play your first game' },
  'high_roller': { id: 'high_roller', name: 'High Roller', icon: '💰', description: 'Wager 10,000+ credits in a single bet' },
  'hot_streak': { id: 'hot_streak', name: 'Hot Streak', icon: '🔥', description: 'Win 5 games in a row' },
  'diamond_hands': { id: 'diamond_hands', name: 'Diamond Hands', icon: '💎', description: 'Survive past 10x in Crash' },
  'royal_flush': { id: 'royal_flush', name: 'Royal Flush', icon: '🃏', description: 'Get a Royal Flush in Poker' },
  'card_sharp': { id: 'card_sharp', name: 'Card Sharp', icon: '♠️', description: 'Win 10 Blackjack hands' },
  'lucky_seven': { id: 'lucky_seven', name: 'Lucky 7', icon: '🎯', description: 'Hit number 7 in Roulette' },
  'to_the_moon': { id: 'to_the_moon', name: 'To the Moon', icon: '📈', description: 'Cash out at 50x+ in Crash' },
  'degenerate': { id: 'degenerate', name: 'Degenerate', icon: '💀', description: 'Play 100 total games' },
  'casino_king': { id: 'casino_king', name: 'Casino King', icon: '👑', description: 'Reach 100,000 credits' }
};

function checkAchievements(userId, gameType, betAmount, won, result = {}) {
  if (!users[userId]) return [];
  
  const user = users[userId];
  const newAchievements = [];
  const stats = user.stats;
  
  // Check each achievement
  if (!user.achievements.includes('first_timer') && stats.gamesPlayed >= 1) {
    newAchievements.push('first_timer');
  }
  
  if (!user.achievements.includes('high_roller') && betAmount >= 10000) {
    newAchievements.push('high_roller');
  }
  
  if (!user.achievements.includes('hot_streak') && stats.currentStreak >= 5) {
    newAchievements.push('hot_streak');
  }
  
  if (!user.achievements.includes('diamond_hands') && gameType === 'crash' && result.multiplier > 10) {
    newAchievements.push('diamond_hands');
  }
  
  if (!user.achievements.includes('royal_flush') && gameType === 'poker' && result.hand === 'Royal Flush') {
    newAchievements.push('royal_flush');
  }
  
  if (!user.achievements.includes('card_sharp') && stats.gameStats.blackjack.won >= 10) {
    newAchievements.push('card_sharp');
  }
  
  if (!user.achievements.includes('lucky_seven') && gameType === 'roulette' && result.number === 7) {
    newAchievements.push('lucky_seven');
  }
  
  if (!user.achievements.includes('to_the_moon') && gameType === 'crash' && result.multiplier >= 50) {
    newAchievements.push('to_the_moon');
  }
  
  if (!user.achievements.includes('degenerate') && stats.gamesPlayed >= 100) {
    newAchievements.push('degenerate');
  }
  
  if (!user.achievements.includes('casino_king') && user.credits >= 100000) {
    newAchievements.push('casino_king');
  }
  
  // Add new achievements to user
  user.achievements.push(...newAchievements);
  
  return newAchievements;
}

function updateUserStats(userId, gameType, betAmount, won, payout = 0, result = {}) {
  if (!users[userId]) return;
  
  const user = users[userId];
  const stats = user.stats;
  const netProfit = payout - betAmount;
  
  // Update general stats
  stats.totalWagered += betAmount;
  stats.totalWon += payout;
  stats.gamesPlayed++;
  
  if (won) {
    stats.gamesWon++;
    stats.currentStreak++;
    if (stats.currentStreak > stats.bestStreak) {
      stats.bestStreak = stats.currentStreak;
    }
    if (netProfit > stats.biggestWin) {
      stats.biggestWin = netProfit;
    }
  } else {
    stats.currentStreak = 0;
  }
  
  // Update weekly stats (reset if week has passed)
  const weekStart = new Date(user.weeklyStats.startDate);
  const now = new Date();
  const daysSinceStart = (now - weekStart) / (1000 * 60 * 60 * 24);
  
  if (daysSinceStart > 7) {
    user.weeklyStats = {
      startDate: now.toISOString(),
      totalWagered: betAmount,
      totalWon: payout,
      gamesPlayed: 1
    };
  } else {
    user.weeklyStats.totalWagered += betAmount;
    user.weeklyStats.totalWon += payout;
    user.weeklyStats.gamesPlayed++;
  }
  
  // Update game-specific stats
  const gameStats = stats.gameStats[gameType] || { played: 0, won: 0 };
  gameStats.played++;
  if (won) gameStats.won++;
  
  // Game-specific stat updates
  if (gameType === 'roulette' && result.number === 7) {
    gameStats.hitNumber7 = (gameStats.hitNumber7 || 0) + 1;
  }
  if (gameType === 'crash' && result.multiplier > (gameStats.bestMultiplier || 0)) {
    gameStats.bestMultiplier = result.multiplier;
  }
  if (gameType === 'poker' && result.hand === 'Royal Flush') {
    gameStats.royalFlushes = (gameStats.royalFlushes || 0) + 1;
  }
  if (gameType === 'poker' && result.potSize && result.potSize > (gameStats.biggestPot || 0)) {
    gameStats.biggestPot = result.potSize;
  }
  if (gameType === 'blackjack' && won) {
    stats.gameStats.blackjack.bestStreak = Math.max(
      stats.gameStats.blackjack.bestStreak || 0,
      stats.currentStreak
    );
  }
  
  stats.gameStats[gameType] = gameStats;
}

// CS2 CREDIT BALANCE FIX - Helper functions for syncing real-time and persistent credit state

// Helper function: Find socket ID for a given user ID
function findSocketByUserId(targetUserId) {
  for (const [socketId, userId] of Object.entries(socketToUser)) {
    if (userId === targetUserId) {
      return socketId;
    }
  }
  return null;
}

// Helper function: Sync credit balance between users and players objects
async function syncUserCredits(userId, newCredits) {
  try {
    // Update persistent storage
    if (users[userId]) {
      users[userId].credits = newCredits;
      await saveUserBalance(userId, newCredits);
    }
    
    // Update real-time state if user is connected via WebSocket
    const socketId = findSocketByUserId(userId);
    if (socketId && players[socketId]) {
      players[socketId].credits = newCredits;
      
      // Emit real-time update to the connected user
      io.to(socketId).emit("playerData", {
        username: players[socketId].username,
        credits: players[socketId].credits
      });
      
      console.log(`[CS2 Balance] Synced credits for user ${userId}: ${newCredits} (socket: ${socketId})`);
    } else {
      console.log(`[CS2 Balance] Updated credits for user ${userId}: ${newCredits} (offline)`);
    }
    
    return true;
  } catch (error) {
    console.error(`[CS2 Balance] Error syncing credits for user ${userId}:`, error);
    return false;
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

// ========== CRASH GAME STATE ==========
let crashState = {
  phase: 'waiting', // waiting, betting, running, crashed
  multiplier: 1.00,
  crashPoint: null,
  bets: {}, // { socketId: { username, amount, cashedOut, cashoutMultiplier } }
  history: [], // last 30 crash points
  startTime: null,
  bettingTimer: null,
  gameTimer: null,
  tickInterval: null
};

function generateCrashPoint() {
  // House edge ~1%. Formula: max(1.0, floor(100 * 0.99 / (1 - r)) / 100)
  const r = Math.random();
  if (r >= 0.99) return 1.00; // instant crash 1% of the time
  return Math.max(1.00, Math.floor(100 * 0.99 / (1 - r)) / 100);
}

function startCrashBetting() {
  crashState.phase = 'betting';
  crashState.multiplier = 1.00;
  crashState.crashPoint = null;
  crashState.bets = {};
  crashState.startTime = null;

  io.emit('crashBettingStart', { timeLeft: 10 });

  let timeLeft = 10;
  if (crashState.bettingTimer) clearInterval(crashState.bettingTimer);
  crashState.bettingTimer = setInterval(() => {
    timeLeft -= 1;
    io.emit('crashBettingTick', { timeLeft });
    if (timeLeft <= 0) {
      clearInterval(crashState.bettingTimer);
      crashState.bettingTimer = null;
      startCrashRound();
    }
  }, 1000);
}

function startCrashRound() {
  crashState.phase = 'running';
  crashState.multiplier = 1.00;
  crashState.crashPoint = generateCrashPoint();
  crashState.startTime = Date.now();

  console.log(`[Crash] Round starting, crash point: ${crashState.crashPoint}x`);

  io.emit('crashState', {
    phase: 'running',
    multiplier: 1.00,
    history: crashState.history,
    startTime: crashState.startTime,
    bets: {}
  });

  // Tick every 50ms
  if (crashState.tickInterval) clearInterval(crashState.tickInterval);
  crashState.tickInterval = setInterval(() => {
    const elapsed = (Date.now() - crashState.startTime) / 1000;
    crashState.multiplier = Math.max(1.00, parseFloat((Math.exp(0.06 * elapsed)).toFixed(2)));

    // Check auto-cashouts
    for (const [sid, bet] of Object.entries(crashState.bets)) {
      if (!bet.cashedOut && bet.autoCashout > 0 && crashState.multiplier >= bet.autoCashout) {
        processCrashCashout(sid);
      }
    }

    if (crashState.multiplier >= crashState.crashPoint) {
      // CRASH!
      clearInterval(crashState.tickInterval);
      crashState.tickInterval = null;
      crashState.phase = 'crashed';
      crashState.multiplier = crashState.crashPoint;

      crashState.history.unshift({ crashPoint: crashState.crashPoint, time: new Date().toISOString() });
      if (crashState.history.length > 30) crashState.history.pop();

      console.log(`[Crash] Crashed at ${crashState.crashPoint}x`);

      io.emit('crashResult', {
        crashPoint: crashState.crashPoint,
        history: crashState.history
      });

      // Next round after 5 seconds
      if (crashState.gameTimer) clearTimeout(crashState.gameTimer);
      crashState.gameTimer = setTimeout(() => startCrashBetting(), 5000);
    } else {
      io.emit('crashTick', { multiplier: crashState.multiplier });
    }
  }, 50);
}

function processCrashCashout(socketId) {
  const bet = crashState.bets[socketId];
  if (!bet || bet.cashedOut) return;
  
  bet.cashedOut = true;
  bet.cashoutMultiplier = crashState.multiplier;
  const winnings = Math.floor(bet.amount * crashState.multiplier);

  // Credit the player
  if (players[socketId]) {
    players[socketId].credits += winnings;
    const userId = players[socketId].userId;
    if (userId) {
      saveUserBalance(userId, players[socketId].credits).catch(err => {
        console.error("[Crash] Error saving balance:", err);
      });
    }
    io.to(socketId).emit("playerData", {
      username: players[socketId].username,
      credits: players[socketId].credits
    });
  }

  io.emit('crashCashedOut', {
    socketId,
    username: bet.username,
    multiplier: crashState.multiplier,
    amount: bet.amount,
    winnings
  });

  console.log(`[Crash] ${bet.username} cashed out at ${crashState.multiplier}x, won ${winnings}`);
}

// Start crash game loop
setTimeout(() => startCrashBetting(), 5000);

// ========== POKER STATE ==========
const pokerEngine = require('./poker-engine');
const pokerTables = {}; // { tableId: PokerTableState }
let pokerTableCounter = 1;

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
    .replace(/\s*(esports?|gaming|team)$/i, '') // Remove common suffixes: eSports, Gaming, Team
    .replace(/[^\w\s.]/g, '') // Remove special characters but keep dots (for BC.Game)
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
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
  
  // Special cases for common team name variations
  const specialMappings = {
    'aurora gaming': ['aurora'],
    'bcgame esports': ['bcgame', 'bc.game', 'bc game'],
    'fut esports': ['fut', 'futbolist'],
    'pain gaming': ['pain'],
    'ninjas in pyjamas': ['nip', 'ninjas in pyjamas'],
    'team liquid': ['liquid', 'tl']
  };
  
  const lowerName = teamName.toLowerCase();
  for (const [key, mappings] of Object.entries(specialMappings)) {
    if (lowerName.includes(key.replace(/\s+/g, '')) || key.includes(lowerName.replace(/\s+/g, ''))) {
      variations.push(...mappings);
    }
  }
  
  // Remove duplicates and empty strings
  return [...new Set(variations)].filter(v => v && v.length > 0);
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
      const won = bet.color === winningColor;
      
      if (won) {
        // Different payout multipliers based on color
        let multiplier = 2; // Default for red/black
        if (winningColor === 'green') {
          multiplier = 14; // 14x payout for green
        }
        const winnings = bet.amount * multiplier;
        if (players[socketId]) {
          players[socketId].credits += winnings;
          
          // Save balance and update stats
          const userId = players[socketId].userId;
          if (userId) {
            saveUserBalance(userId, players[socketId].credits).catch(err => {
              console.error("Error saving balance:", err);
            });
            
            // Update stats and check achievements (winner)
            updateUserStats(userId, 'roulette', bet.amount, true, winnings, { number: winningNumber, color: winningColor });
            const newAchievements = checkAchievements(userId, 'roulette', bet.amount, true, { number: winningNumber, color: winningColor });
            
            // Emit achievement notifications
            if (newAchievements.length > 0) {
              io.to(socketId).emit('achievementUnlocked', newAchievements.map(id => ACHIEVEMENTS[id]));
            }
            
            // Add bet record
            addBetRecord(players[socketId].username, {
              game: 'roulette',
              bet: bet.amount,
              result: `Won: ${winningNumber} ${winningColor}`,
              payout: winnings,
              multiplier: multiplier
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
          const userId = players[socketId].userId;
          if (userId) {
            // Update stats and check achievements (loser)
            updateUserStats(userId, 'roulette', bet.amount, false, 0, { number: winningNumber, color: winningColor });
            const newAchievements = checkAchievements(userId, 'roulette', bet.amount, false, { number: winningNumber, color: winningColor });
            
            // Emit achievement notifications
            if (newAchievements.length > 0) {
              io.to(socketId).emit('achievementUnlocked', newAchievements.map(id => ACHIEVEMENTS[id]));
            }
            
            // Add bet record
            addBetRecord(players[socketId].username, {
              game: 'roulette',
              bet: bet.amount,
              result: `Lost: ${winningNumber} ${winningColor}`,
              payout: 0,
              multiplier: 0
            });
          }
          
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
      lastPlayed: new Date().toISOString(),
      // Lifetime stats for leaderboard
      stats: {
        totalWagered: 0,
        totalWon: 0,
        gamesPlayed: 0,
        gamesWon: 0,
        biggestWin: 0,
        currentStreak: 0,
        bestStreak: 0,
        gameStats: {
          blackjack: { played: 0, won: 0, bestStreak: 0 },
          roulette: { played: 0, won: 0, hitNumber7: 0 },
          coinflip: { played: 0, won: 0 },
          crash: { played: 0, won: 0, bestMultiplier: 0 },
          poker: { played: 0, won: 0, royalFlushes: 0, biggestPot: 0 },
          cs2betting: { played: 0, won: 0 },
          pachinko: { played: 0, won: 0 }
        }
      },
      // Achievement system
      achievements: [],
      weeklyStats: {
        startDate: new Date().toISOString(),
        totalWagered: 0,
        totalWon: 0,
        gamesPlayed: 0
      }
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
      
      // Save creator balance and update stats
      const creatorUserId = players[creatorId].userId;
      if (creatorUserId && users[creatorUserId]) {
        saveUserBalance(creatorUserId, players[creatorId].credits).catch(err => {
          console.error("Error saving balance:", err);
        });
        
        // Update stats and check achievements for creator (winner)
        updateUserStats(creatorUserId, 'coinflip', room.betAmount, true, winnings, { result: coinResult });
        const newAchievements = checkAchievements(creatorUserId, 'coinflip', room.betAmount, true, { result: coinResult });
        
        // Emit achievement notifications to creator
        if (newAchievements.length > 0) {
          io.to(creatorId).emit('achievementUnlocked', newAchievements.map(id => ACHIEVEMENTS[id]));
        }
        
        // Add bet record for creator
        addBetRecord(players[creatorId].username, {
          game: 'coinflip',
          bet: room.betAmount,
          result: `Won: ${coinResult}`,
          payout: winnings,
          multiplier: 2.0
        });
      }
      
      // Update stats for joiner (loser)
      const joinerUserId = players[joinerId].userId;
      if (joinerUserId && users[joinerUserId]) {
        updateUserStats(joinerUserId, 'coinflip', room.betAmount, false, 0, { result: coinResult });
        const newAchievements = checkAchievements(joinerUserId, 'coinflip', room.betAmount, false, { result: coinResult });
        
        // Emit achievement notifications to joiner
        if (newAchievements.length > 0) {
          io.to(joinerId).emit('achievementUnlocked', newAchievements.map(id => ACHIEVEMENTS[id]));
        }
        
        // Add bet record for joiner
        addBetRecord(players[joinerId].username, {
          game: 'coinflip',
          bet: room.betAmount,
          result: `Lost: ${coinResult}`,
          payout: 0,
          multiplier: 0
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
      
      // Save joiner balance and update stats
      const joinerUserId = players[joinerId].userId;
      if (joinerUserId && users[joinerUserId]) {
        saveUserBalance(joinerUserId, players[joinerId].credits).catch(err => {
          console.error("Error saving balance:", err);
        });
        
        // Update stats and check achievements for joiner (winner)
        updateUserStats(joinerUserId, 'coinflip', room.betAmount, true, winnings, { result: coinResult });
        const newAchievements = checkAchievements(joinerUserId, 'coinflip', room.betAmount, true, { result: coinResult });
        
        // Emit achievement notifications to joiner
        if (newAchievements.length > 0) {
          io.to(joinerId).emit('achievementUnlocked', newAchievements.map(id => ACHIEVEMENTS[id]));
        }
        
        // Add bet record for joiner
        addBetRecord(players[joinerId].username, {
          game: 'coinflip',
          bet: room.betAmount,
          result: `Won: ${coinResult}`,
          payout: winnings,
          multiplier: 2.0
        });
      }
      
      // Update stats for creator (loser)
      const creatorUserId = players[creatorId].userId;
      if (creatorUserId && users[creatorUserId]) {
        updateUserStats(creatorUserId, 'coinflip', room.betAmount, false, 0, { result: coinResult });
        const newAchievements = checkAchievements(creatorUserId, 'coinflip', room.betAmount, false, { result: coinResult });
        
        // Emit achievement notifications to creator
        if (newAchievements.length > 0) {
          io.to(creatorId).emit('achievementUnlocked', newAchievements.map(id => ACHIEVEMENTS[id]));
        }
        
        // Add bet record for creator
        addBetRecord(players[creatorId].username, {
          game: 'coinflip',
          bet: room.betAmount,
          result: `Lost: ${coinResult}`,
          payout: 0,
          multiplier: 0
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
          
          // Update stats and check achievements for creator (winner)
          updateUserStats(creatorUserId, 'coinflip', room.betAmount, true, winnings, { result: coinResult });
          const newAchievements = checkAchievements(creatorUserId, 'coinflip', room.betAmount, true, { result: coinResult });
          
          // Emit achievement notifications to creator
          if (newAchievements.length > 0) {
            io.to(creatorId).emit('achievementUnlocked', newAchievements.map(id => ACHIEVEMENTS[id]));
          }
          
          // Add bet record for creator
          addBetRecord(players[creatorId].username, {
            game: 'coinflip',
            bet: room.betAmount,
            result: `Won vs Bot: ${coinResult}`,
            payout: winnings,
            multiplier: 2.0
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
        // Bot wins - creator loses their bet
        const creatorUserId = players[creatorId].userId;
        if (creatorUserId && users[creatorUserId]) {
          // Update stats and check achievements for creator (loser)
          updateUserStats(creatorUserId, 'coinflip', room.betAmount, false, 0, { result: coinResult });
          const newAchievements = checkAchievements(creatorUserId, 'coinflip', room.betAmount, false, { result: coinResult });
          
          // Emit achievement notifications to creator
          if (newAchievements.length > 0) {
            io.to(creatorId).emit('achievementUnlocked', newAchievements.map(id => ACHIEVEMENTS[id]));
          }
          
          // Add bet record for creator
          addBetRecord(players[creatorId].username, {
            game: 'coinflip',
            bet: room.betAmount,
            result: `Lost vs Bot: ${coinResult}`,
            payout: 0,
            multiplier: 0
          });
        }
        
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

  // ========== POKER SOCKET HANDLERS ==========

  socket.on("joinPokerLobby", () => {
    socket.emit("pokerTablesUpdate", getPokerTablesListForLobby());
  });

  socket.on("createPokerTable", ({ tableName, smallBlind, bigBlind, minBuyIn, maxBuyIn, isPrivate }) => {
    if (!players[socket.id]) {
      socket.emit("error", "Please join the casino first");
      return;
    }

    const sb = parseInt(smallBlind) || 10;
    const bb = parseInt(bigBlind) || sb * 2;
    const minBI = parseInt(minBuyIn) || bb * 20;
    const maxBI = parseInt(maxBuyIn) || bb * 100;

    if (bb !== sb * 2) {
      socket.emit("error", "Big blind must be exactly 2x the small blind");
      return;
    }

    const tableId = `poker_${pokerTableCounter++}`;
    pokerTables[tableId] = {
      tableId,
      tableName: (tableName || 'Poker Table').slice(0, 30),
      smallBlind: sb,
      bigBlind: bb,
      minBuyIn: minBI,
      maxBuyIn: maxBI,
      maxPlayers: 6,
      isPrivate: !!isPrivate,
      seats: [null, null, null, null, null, null], // 6 seats
      players: [], // { socketId, username, seat, chips, isActive, isSittingOut }
      gameState: 'waiting', // waiting, dealing, betting, showdown
      currentHand: null,
      dealerPosition: 0,
      handNumber: 0,
      createdAt: Date.now(),
      createdBy: socket.id
    };

    console.log(`[Poker] Table ${tableId} created by ${players[socket.id].username}: ${tableName} (${sb}/${bb})`);
    socket.emit("pokerTableCreated", { tableId });
    io.emit("pokerTablesUpdate", getPokerTablesListForLobby());
  });

  socket.on("joinPokerTable", ({ tableId, buyIn, seat }) => {
    if (!players[socket.id]) {
      socket.emit("error", "Please join the casino first");
      return;
    }

    const table = pokerTables[tableId];
    if (!table) {
      socket.emit("error", "Table not found");
      return;
    }

    // Check if already at this table
    if (table.players.find(p => p.socketId === socket.id)) {
      // Already seated, just send state
      socket.join(tableId);
      socket.emit("pokerTableState", getPokerTableStateForClient(tableId, socket.id));
      return;
    }

    const buyInAmount = parseInt(buyIn);
    if (isNaN(buyInAmount) || buyInAmount < table.minBuyIn || buyInAmount > table.maxBuyIn) {
      socket.emit("error", `Buy-in must be between ${table.minBuyIn} and ${table.maxBuyIn}`);
      return;
    }

    if (players[socket.id].credits < buyInAmount) {
      socket.emit("error", "Insufficient credits for buy-in");
      return;
    }

    // Find seat
    let seatIndex = seat !== null && seat !== undefined ? parseInt(seat) : -1;
    if (seatIndex < 0 || seatIndex >= 6 || table.seats[seatIndex] !== null) {
      // Auto-assign seat
      seatIndex = table.seats.findIndex(s => s === null);
    }

    if (seatIndex === -1) {
      socket.emit("error", "Table is full");
      return;
    }

    // Deduct buy-in from casino credits
    players[socket.id].credits -= buyInAmount;
    const userId = players[socket.id].userId;
    if (userId) {
      saveUserBalance(userId, players[socket.id].credits).catch(err => {
        console.error("[Poker] Error saving balance:", err);
      });
    }
    socket.emit("playerData", {
      username: players[socket.id].username,
      credits: players[socket.id].credits
    });

    const playerEntry = {
      socketId: socket.id,
      username: players[socket.id].username,
      seat: seatIndex,
      chips: buyInAmount,
      isActive: true,
      isSittingOut: false
    };

    table.seats[seatIndex] = playerEntry;
    table.players.push(playerEntry);

    socket.join(tableId);
    console.log(`[Poker] ${players[socket.id].username} joined ${tableId} seat ${seatIndex} with ${buyInAmount} chips`);

    // Broadcast state to all at table
    broadcastPokerTableState(tableId);
    io.emit("pokerTablesUpdate", getPokerTablesListForLobby());
  });

  socket.on("leavePokerTable", ({ tableId }) => {
    handlePokerPlayerLeave(socket.id, tableId);
  });

  socket.on("startPokerHand", ({ tableId }) => {
    if (!players[socket.id]) return;
    const table = pokerTables[tableId];
    if (!table) return;

    if (table.gameState !== 'waiting') {
      socket.emit("error", "A hand is already in progress");
      return;
    }

    const activePlayers = table.players.filter(p => p.isActive && !p.isSittingOut && p.chips > 0);
    if (activePlayers.length < 2) {
      socket.emit("error", "Need at least 2 players to start");
      return;
    }

    startPokerHand(tableId);
  });

  socket.on("pokerAction", ({ tableId, action, amount }) => {
    if (!players[socket.id]) return;
    const table = pokerTables[tableId];
    if (!table || !table.currentHand) return;

    const hand = table.currentHand;
    const playerIndex = hand.players.findIndex(p => p.socketId === socket.id);
    if (playerIndex === -1) return;

    if (hand.currentPlayerIndex !== playerIndex) {
      socket.emit("error", "It's not your turn");
      return;
    }

    processPokerAction(tableId, playerIndex, action, parseInt(amount) || 0);
  });

  socket.on("pokerChat", ({ tableId, message }) => {
    if (!players[socket.id] || !tableId || !message) return;
    const table = pokerTables[tableId];
    if (!table) return;

    const msg = message.trim().slice(0, 200);
    if (!msg) return;

    io.to(tableId).emit("pokerChatMessage", {
      username: players[socket.id].username,
      message: msg,
      timestamp: Date.now()
    });
  });

  // ========== END POKER SOCKET HANDLERS ==========

  // ========== CRASH SOCKET HANDLERS ==========

  // ========== BALANCE SYNC (client-side games: blackjack, pachinko) ==========
  socket.on("syncBalance", async ({ credits }) => {
    if (!players[socket.id]) return;
    const creditAmount = Math.max(0, credits);
    players[socket.id].credits = creditAmount;
    const userId = players[socket.id].userId;
    if (userId) {
      // Use balance lock to prevent joinCasino from reading stale data mid-sync
      await runWithUserBalanceLock(userId, async () => {
        await saveUserBalance(userId, creditAmount);
      });
    }
  });

  // ========== GAME RESULT (for client-side games stats tracking) ==========
  socket.on("gameResult", ({ gameType, betAmount, won, payout, result = {} }) => {
    if (!players[socket.id]) return;
    
    const userId = players[socket.id].userId;
    if (!userId || !users[userId]) return;

    try {
      // Update stats and check achievements
      updateUserStats(userId, gameType, betAmount, won, payout, result);
      const newAchievements = checkAchievements(userId, gameType, betAmount, won, result);
      
      // Emit achievement notifications
      if (newAchievements.length > 0) {
        socket.emit('achievementUnlocked', newAchievements.map(id => ACHIEVEMENTS[id]));
      }
    } catch (error) {
      console.error(`Error tracking stats for ${gameType}:`, error);
    }
  });

  // ========== BET HISTORY ==========
  socket.on("recordBet", ({ game, bet, result, payout, multiplier, details }) => {
    if (!players[socket.id]) return;
    const username = players[socket.id].username;
    addBetRecord(username, { game, bet: bet || 0, result, payout: payout || 0, multiplier: multiplier || null, details: details || null });
  });

  socket.on("getBetHistory", ({ limit }, callback) => {
    if (!players[socket.id]) {
      if (callback) callback([]);
      return;
    }
    const username = players[socket.id].username;
    const history = (betHistory[username] || []).slice(0, limit || 50);
    if (callback) callback(history);
  });

  // Leaderboard socket events
  socket.on("getLeaderboard", ({ type = 'allTime' }, callback) => {
    if (!callback) return;
    
    try {
      const leaderboard = [];
      
      for (const [userId, userData] of Object.entries(users)) {
        if (!userData.stats) continue;
        
        let stats = userData.stats;
        
        // For weekly leaderboard, use weekly stats
        if (type === 'thisWeek') {
          stats = userData.weeklyStats;
        }
        
        const netPL = stats.totalWon - stats.totalWagered;
        
        leaderboard.push({
          username: userData.username,
          netPL,
          totalWagered: stats.totalWagered,
          totalWon: stats.totalWon,
          gamesPlayed: stats.gamesPlayed,
          biggestWin: userData.stats.biggestWin,
          winRate: stats.gamesPlayed > 0 ? ((userData.stats.gamesWon / stats.gamesPlayed) * 100).toFixed(1) : 0
        });
      }
      
      // Sort by net P/L descending
      leaderboard.sort((a, b) => b.netPL - a.netPL);
      
      callback(leaderboard.slice(0, 20)); // Top 20
    } catch (error) {
      console.error('Error generating leaderboard:', error);
      callback([]);
    }
  });

  socket.on("getGameLeaderboard", ({ game }, callback) => {
    if (!callback) return;
    
    try {
      const leaderboard = [];
      
      for (const [userId, userData] of Object.entries(users)) {
        if (!userData.stats?.gameStats?.[game]) continue;
        
        const gameStats = userData.stats.gameStats[game];
        const generalStats = userData.stats;
        
        let score = 0;
        let metric = 'Games Won';
        
        // Different scoring for different games
        switch (game) {
          case 'blackjack':
            score = gameStats.bestStreak || 0;
            metric = 'Best Streak';
            break;
          case 'crash':
            score = gameStats.bestMultiplier || 0;
            metric = 'Best Multiplier';
            break;
          case 'poker':
            score = gameStats.biggestPot || 0;
            metric = 'Biggest Pot';
            break;
          default:
            score = gameStats.won;
            metric = 'Games Won';
        }
        
        leaderboard.push({
          username: userData.username,
          score,
          metric,
          played: gameStats.played,
          won: gameStats.won,
          winRate: gameStats.played > 0 ? ((gameStats.won / gameStats.played) * 100).toFixed(1) : 0
        });
      }
      
      // Sort by score descending
      leaderboard.sort((a, b) => b.score - a.score);
      
      callback(leaderboard.slice(0, 20)); // Top 20
    } catch (error) {
      console.error('Error generating game leaderboard:', error);
      callback([]);
    }
  });

  // Achievement socket events
  socket.on("getAchievements", (callback) => {
    if (!players[socket.id]) {
      if (callback) callback({ achievements: [], available: [] });
      return;
    }
    
    const userId = players[socket.id].userId;
    if (!users[userId]) {
      if (callback) callback({ achievements: [], available: [] });
      return;
    }
    
    const userAchievements = users[userId].achievements || [];
    const available = Object.keys(ACHIEVEMENTS).map(id => ({
      ...ACHIEVEMENTS[id],
      earned: userAchievements.includes(id)
    }));
    
    if (callback) {
      callback({
        achievements: userAchievements,
        available
      });
    }
  });

  // Stats socket events
  socket.on("getUserStats", (callback) => {
    if (!players[socket.id]) {
      if (callback) callback(null);
      return;
    }
    
    const userId = players[socket.id].userId;
    if (!users[userId] || !users[userId].stats) {
      if (callback) callback(null);
      return;
    }
    
    const userData = users[userId];
    const stats = userData.stats;
    const netPL = stats.totalWon - stats.totalWagered;
    
    // Find user rank
    let rank = 1;
    for (const [otherUserId, otherUserData] of Object.entries(users)) {
      if (otherUserId === userId) continue;
      if (!otherUserData.stats) continue;
      
      const otherNetPL = otherUserData.stats.totalWon - otherUserData.stats.totalWagered;
      if (otherNetPL > netPL) rank++;
    }
    
    // Calculate favorite game
    let favoriteGame = 'None';
    let mostPlayed = 0;
    for (const [game, gameStats] of Object.entries(stats.gameStats)) {
      if (gameStats.played > mostPlayed) {
        mostPlayed = gameStats.played;
        favoriteGame = game.charAt(0).toUpperCase() + game.slice(1);
      }
    }
    
    if (callback) {
      callback({
        totalGames: stats.gamesPlayed,
        winRate: stats.gamesPlayed > 0 ? ((stats.gamesWon / stats.gamesPlayed) * 100).toFixed(1) : 0,
        netPL,
        rank,
        favoriteGame,
        biggestWin: stats.biggestWin,
        currentStreak: stats.currentStreak,
        bestStreak: stats.bestStreak,
        gameBreakdown: stats.gameStats,
        weeklyStats: userData.weeklyStats
      });
    }
  });

  socket.on("joinCrash", () => {
    // Send current crash state
    socket.emit("crashState", {
      phase: crashState.phase,
      multiplier: crashState.multiplier,
      history: crashState.history,
      startTime: crashState.startTime,
      bettingTimeLeft: 0,
      bets: crashState.bets
    });
  });

  socket.on("placeCrashBet", ({ amount, autoCashout }) => {
    if (!players[socket.id]) {
      socket.emit("crashBetPlaced", { success: false, error: "Not logged in" });
      return;
    }
    if (crashState.phase !== 'betting') {
      socket.emit("crashBetPlaced", { success: false, error: "Betting is closed" });
      return;
    }
    if (crashState.bets[socket.id]) {
      socket.emit("crashBetPlaced", { success: false, error: "Already placed a bet" });
      return;
    }
    if (!amount || amount <= 0 || amount > players[socket.id].credits) {
      socket.emit("crashBetPlaced", { success: false, error: "Invalid bet amount" });
      return;
    }

    // Deduct credits
    players[socket.id].credits -= amount;
    const userId = players[socket.id].userId;
    if (userId) {
      saveUserBalance(userId, players[socket.id].credits).catch(err => {
        console.error("[Crash] Error saving balance after bet:", err);
      });
    }

    crashState.bets[socket.id] = {
      username: players[socket.id].username,
      amount,
      autoCashout: autoCashout || 0,
      cashedOut: false,
      cashoutMultiplier: null
    };

    socket.emit("crashBetPlaced", { success: true, amount });
    socket.emit("playerData", {
      username: players[socket.id].username,
      credits: players[socket.id].credits
    });

    console.log(`[Crash] ${players[socket.id].username} bet ${amount} (auto-cashout: ${autoCashout || 'off'})`);
  });

  socket.on("crashCashOut", () => {
    if (crashState.phase !== 'running') return;
    processCrashCashout(socket.id);
  });

  // ========== END CRASH SOCKET HANDLERS ==========

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
    
    // Handle poker table cleanup on disconnect
    for (const tableId of Object.keys(pokerTables)) {
      const table = pokerTables[tableId];
      if (table.players.find(p => p.socketId === socket.id)) {
        handlePokerPlayerLeave(socket.id, tableId);
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
    
    // Filter bets by userId and enrich with team names from events
    const userBets = Object.values(cs2BettingState.bets)
      .filter(bet => bet.userId === userId)
      .map(bet => {
        // Backfill team names from events if missing (legacy bets)
        if (!bet.homeTeam || !bet.awayTeam) {
          const event = cs2BettingState.events[bet.eventId];
          if (event) {
            bet.homeTeam = bet.homeTeam || event.homeTeam || event.participant1Name || 'Unknown';
            bet.awayTeam = bet.awayTeam || event.awayTeam || event.participant2Name || 'Unknown';
            bet.selectionName = bet.selectionName || 
              (bet.selection === 'team1' ? bet.homeTeam :
               bet.selection === 'team2' ? bet.awayTeam : 'Draw');
          }
        }
        return bet;
      });
    
    // Compute summary stats
    const player = players[userId];
    const currentBalance = player ? player.credits : 0;
    let totalWagered = 0;
    let totalWon = 0;
    let wins = 0;
    let settled = 0;

    // Convert bets to transaction-style items for the history
    const transactions = userBets.map(bet => {
      totalWagered += bet.amount || 0;
      if (bet.status === 'won') {
        const payout = Math.round((bet.amount || 0) * (bet.odds || 1));
        totalWon += payout;
        wins++;
        settled++;
        return { type: 'bet_won', amount: payout, description: `Won: ${bet.selectionName || bet.selection}`, timestamp: bet.settledAt || bet.placedAt, bet };
      } else if (bet.status === 'lost') {
        settled++;
        return { type: 'bet_lost', amount: -(bet.amount || 0), description: `Lost: ${bet.selectionName || bet.selection}`, timestamp: bet.settledAt || bet.placedAt, bet };
      } else if (bet.status === 'void') {
        return { type: 'bet_void', amount: 0, description: `Void: ${bet.selectionName || bet.selection}`, timestamp: bet.settledAt || bet.placedAt, bet };
      } else {
        return { type: 'bet_placed', amount: -(bet.amount || 0), description: `Pending: ${bet.selectionName || bet.selection}`, timestamp: bet.placedAt, bet };
      }
    });

    const netProfit = totalWon - totalWagered;
    const winRate = settled > 0 ? Math.round((wins / settled) * 100) : 0;

    res.json({
      success: true,
      bets: transactions,
      count: transactions.length,
      currentBalance,
      totalWagered,
      totalWon,
      netProfit,
      winRate
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
    
    // Deduct credits (CS2 BALANCE FIX - sync both users and players objects)
    const newCredits = user.credits - amount;
    const syncSuccess = await syncUserCredits(userId, newCredits);
    if (!syncSuccess) {
      return res.status(500).json({ success: false, error: "Failed to update balance" });
    }
    
    // Create bet record with team names stored for display even after event ends
    const betId = `bet_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const homeTeam = event.homeTeam || event.participant1Name || 'Team 1';
    const awayTeam = event.awayTeam || event.participant2Name || 'Team 2';
    const selectionName = selection === 'team1' ? homeTeam :
                          selection === 'team2' ? awayTeam : 'Draw';
    
    const bet = {
      id: betId,
      userId: userId,
      eventId: eventId,
      selection: selection,
      selectionName: selectionName,  // Store selection name for display
      homeTeam: homeTeam,            // Store team names for display
      awayTeam: awayTeam,
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
      try {
        matches = await matchClient.fetchUpcomingMatches({ limit: 50 });
      } catch (apiError) {
        console.warn(`[CS2 Sync] OddsPapi API failed: ${apiError.message}`);
        matches = [];
      }
      
      // If OddsPapi returned no matches (API keys exhausted), try fallback sources
      if (!matches || matches.length === 0) {
        // Fallback 1: bo3.gg API (free, no API key required, works from cloud servers)
        if (cs2Bo3ggClient) {
          console.log("[CS2 Sync] OddsPapi returned no matches, trying bo3.gg API...");
          try {
            matches = await cs2Bo3ggClient.fetchUpcomingMatches({ limit: 50 });
            if (matches && matches.length > 0) {
              console.log(`[CS2 Sync] bo3.gg returned ${matches.length} upcoming matches`);
            }
          } catch (bo3Error) {
            console.warn(`[CS2 Sync] bo3.gg API failed: ${bo3Error.message}`);
          }
        }
        
        // Fallback 2: HLTV scraper (may be blocked from cloud servers)
        if ((!matches || matches.length === 0) && cs2ResultFetcher) {
          console.log("[CS2 Sync] Trying HLTV scraper...");
          try {
            const hltvMatches = await cs2ResultFetcher.getUpcomingMatches();
            if (hltvMatches && hltvMatches.length > 0) {
              console.log(`[CS2 Sync] HLTV returned ${hltvMatches.length} upcoming matches`);
              matches = hltvMatches.map(m => ({
                id: `hltv_${m.hltvId || Date.now()}_${Math.random().toString(36).substr(2,6)}`,
                fixtureId: `hltv_${m.hltvId || Date.now()}_${Math.random().toString(36).substr(2,6)}`,
                homeTeam: m.team1,
                awayTeam: m.team2,
                participant1Name: m.team1,
                participant2Name: m.team2,
                tournamentName: m.event || 'CS2 Tournament',
                commenceTime: m.time ? new Date(m.time).toISOString() : new Date(Date.now() + 3600000).toISOString(),
                startTime: m.time ? new Date(m.time).toISOString() : new Date(Date.now() + 3600000).toISOString(),
                status: 'scheduled',
                statusId: 0,
                completed: false,
                hasOdds: false,
                odds: { team1: null, team2: null, draw: null },
                source: 'hltv'
              }));
            }
          } catch (hltvError) {
            console.warn(`[CS2 Sync] HLTV scraper also failed: ${hltvError.message}`);
          }
        }
      }
      
      if (!matches) matches = [];
      
      // Cache the matches (even if from HLTV)
      if (matches.length > 0) {
        await cacheMatches(matches);
      }
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
      const matchTeam1 = match.homeTeam || match.participant1Name;
      const matchTeam2 = match.awayTeam || match.participant2Name;
      const isFromFallbackSource = match.source === 'bo3gg' || match.source === 'hltv';
      
      // Filter: For OddsPapi matches, require both teams in top 250
      // For fallback sources (bo3.gg, HLTV) with real bookmaker odds, accept all matches
      // For fallback sources without odds, require at least one team in top 250
      const team1Ranking = getTeamRanking(matchTeam1);
      const team2Ranking = getTeamRanking(matchTeam2);
      const bothInTop250 = team1Ranking !== null && team2Ranking !== null;
      const atLeastOneInTop250 = team1Ranking !== null || team2Ranking !== null;
      const matchHasOdds = match.hasOdds && match.odds && match.odds.team1 && match.odds.team2;
      
      if (!bothInTop250 && !(isFromFallbackSource && (matchHasOdds || atLeastOneInTop250))) {
        filteredCount++;
        console.log(`[CS2 Sync] Filtering out match: ${matchTeam1} vs ${matchTeam2} (team1 rank: ${team1Ranking?.rank || 'N/A'}, team2 rank: ${team2Ranking?.rank || 'N/A'}, hasOdds: ${matchHasOdds})`);
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
      
      // Prefer fresh odds from the match source (e.g. bo3.gg bet_updates with real bookmaker odds)
      // over stale existing event odds (which may be ranking-based estimates)
      const matchHasBookmakerOdds = match.hasOdds && match.odds && match.odds.team1 && match.odds.team2;
      let existingOdds;
      if (matchHasBookmakerOdds) {
        existingOdds = match.odds; // Use fresh bookmaker odds from bo3.gg
      } else {
        existingOdds = existingEvent?.odds || match.odds || { team1: null, team2: null, draw: null };
      }
      
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
      // Also skip OddsPapi fetch entirely if we already have bookmaker odds from bo3.gg
      const hasRealOdds = (existingOdds.team1 && existingOdds.team2 && 
                         existingOdds.team1 !== 2.0 && existingOdds.team2 !== 2.0) ||
                         matchHasBookmakerOdds;
      
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
          // No real odds available from API - try ranking-based odds as fallback
          if (team1Ranking !== null && team2Ranking !== null) {
            // Both teams in rankings - calculate odds from rankings
            const rank1 = team1Ranking ? team1Ranking.rank : 999;
            const rank2 = team2Ranking ? team2Ranking.rank : 999;
            const rankDiff = Math.abs(rank1 - rank2);
            
            // Simple ranking-based odds: favorite gets lower odds
            let favoriteOdds, underdogOdds;
            if (rankDiff <= 5) {
              favoriteOdds = 1.85; underdogOdds = 1.95;
            } else if (rankDiff <= 20) {
              favoriteOdds = 1.55; underdogOdds = 2.35;
            } else if (rankDiff <= 50) {
              favoriteOdds = 1.35; underdogOdds = 3.00;
            } else if (rankDiff <= 100) {
              favoriteOdds = 1.20; underdogOdds = 4.00;
            } else {
              favoriteOdds = 1.10; underdogOdds = 6.00;
            }
            
            existingOdds = {
              team1: rank1 <= rank2 ? favoriteOdds : underdogOdds,
              team2: rank1 <= rank2 ? underdogOdds : favoriteOdds,
              draw: null
            };
            console.log(`[CS2 Sync] ✓ Using ranking-based odds for ${team1Name} (rank ${rank1}) vs ${team2Name} (rank ${rank2}): ${existingOdds.team1}/${existingOdds.team2}`);
          } else if (isFromFallbackSource) {
            // Fallback source, at least one team is ranked - use lenient odds
            const rank1 = team1Ranking ? team1Ranking.rank : 999;
            const rank2 = team2Ranking ? team2Ranking.rank : 999;
            existingOdds = {
              team1: rank1 < rank2 ? 1.40 : 2.75,
              team2: rank1 < rank2 ? 2.75 : 1.40,
              draw: null
            };
            console.log(`[CS2 Sync] ✓ Using fallback odds for ${team1Name} vs ${team2Name}: ${existingOdds.team1}/${existingOdds.team2}`);
          } else {
            // No odds available - skip this match (don't add to events)
            console.log(`[CS2 Sync] ⚠ Skipping match ${team1Name} vs ${team2Name} - no odds available`);
            filteredCount++;
            continue; // Skip adding this match to events
          }
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
        team1Logo: match.team1Logo || existingEvent?.team1Logo || null,
        team2Logo: match.team2Logo || existingEvent?.team2Logo || null,
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
    
    // CLEANUP: Remove old/completed matches (CS2 MATCH REFRESH FIX)
    let removedCount = 0;
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - (3 * 24 * 60 * 60 * 1000)); // 3 days ago
    
    const eventIds = Object.keys(cs2BettingState.events);
    for (const eventId of eventIds) {
      const event = cs2BettingState.events[eventId];
      const eventTime = event.startTime ? new Date(event.startTime) : null;
      
      // Remove if:
      // 1. Event is completed/finished AND older than 1 day
      // 2. Event is older than 3 days (regardless of status) 
      // 3. Event has no start time and is marked as finished
      const shouldRemove = 
        (event.status === 'finished' && eventTime && eventTime < new Date(now.getTime() - (24 * 60 * 60 * 1000))) ||
        (eventTime && eventTime < threeDaysAgo) ||
        (event.status === 'finished' && !eventTime);
        
      if (shouldRemove) {
        // Check if there are pending bets for this event
        const eventHasPendingBets = Object.values(cs2BettingState.bets || {}).some(
          bet => bet.eventId === eventId && bet.status === 'pending'
        );
        
        if (eventHasPendingBets) {
          console.log(`[CS2 Cleanup] Keeping old event ${eventId} - has pending bets`);
        } else {
          console.log(`[CS2 Cleanup] Removing old event: ${eventId} (${event.status}, ${eventTime ? eventTime.toISOString() : 'no time'})`);
          delete cs2BettingState.events[eventId];
          removedCount++;
        }
      }
    }
    
    cs2BettingState.lastApiSync = new Date().toISOString();
    // Update lastApiQuery timestamp when syncing events (this counts as an API query)
    if (!cs2BettingState.lastApiQuery) {
      cs2BettingState.lastApiQuery = new Date().toISOString();
    }
    await saveCS2BettingData();
    
    console.log(`CS2 sync complete: ${newCount} new, ${updatedCount} updated, ${filteredCount} filtered out, ${removedCount} old matches removed`);
    return { newCount, updatedCount, filteredCount, removedCount, total: matches.length };
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
      
      // If event is not finished, check for results from multiple sources
      if (event.status !== 'finished') {
        let resultFound = false;
        
        // Source 1: Try OddsPapi first (if available)
        try {
          const resultClient = cs2OddsProvider || cs2ApiClient;
          if (resultClient && resultClient.fetchMatchResults) {
            const result = await resultClient.fetchMatchResults(eventId);
            if (result && result.completed && result.winner) {
              event.status = 'finished';
              event.statusId = result.statusId || 3;
              event.completed = true;
              event.result = {
                winner: result.winner,
                participant1Score: result.participant1Score || result.homeScore,
                participant2Score: result.participant2Score || result.awayScore,
                homeScore: result.homeScore || result.participant1Score,
                awayScore: result.awayScore || result.participant2Score
              };
              cs2BettingState.events[eventId] = event;
              resultFound = true;
              console.log(`[CS2 Settlement] Got result from OddsPapi for ${eventId}: winner=${result.winner}`);
            }
          }
        } catch (error) {
          console.warn(`[CS2 Settlement] OddsPapi results failed for ${eventId}: ${error.message}`);
        }
        
        // Source 2: Fallback to HLTV/Liquipedia scrapers
        if (!resultFound && cs2ResultFetcher) {
          try {
            const team1 = event.homeTeam || event.participant1Name;
            const team2 = event.awayTeam || event.participant2Name;
            
            if (team1 && team2) {
              console.log(`[CS2 Settlement] Trying HLTV/Liquipedia for ${team1} vs ${team2}...`);
              const scraperResult = await cs2ResultFetcher.findMatchResult(team1, team2);
              
              if (scraperResult && scraperResult.winner) {
                // Map scraped winner name back to team1/team2
                const { teamsMatch } = require('./cs2-free-result-sources');
                let winner = null;
                if (teamsMatch(scraperResult.winner, team1)) {
                  winner = 'team1';
                } else if (teamsMatch(scraperResult.winner, team2)) {
                  winner = 'team2';
                }
                
                if (winner) {
                  event.status = 'finished';
                  event.statusId = 3;
                  event.completed = true;
                  event.result = {
                    winner: winner,
                    participant1Score: null,
                    participant2Score: null,
                    source: scraperResult.source,
                    confidence: scraperResult.confidence
                  };
                  cs2BettingState.events[eventId] = event;
                  resultFound = true;
                  console.log(`[CS2 Settlement] Got result from ${scraperResult.source} for ${team1} vs ${team2}: winner=${winner} (${scraperResult.winner})`);
                }
              }
            }
          } catch (error) {
            console.warn(`[CS2 Settlement] HLTV/Liquipedia fallback failed for ${eventId}: ${error.message}`);
          }
        }
        
        if (!resultFound) {
          // Event not finished yet or results unavailable, skip
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
            
            // Return credits to user (CS2 BALANCE FIX)
            const user = users[bet.userId];
            if (user) {
              const newCredits = user.credits + bet.amount;
              await syncUserCredits(bet.userId, newCredits);
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
            // CS2 BALANCE FIX - sync payout to both users and players objects
            const newCredits = user.credits + payout;
            await syncUserCredits(bet.userId, newCredits);
            
            // Track stats and achievements
            updateUserStats(bet.userId, 'cs2betting', bet.amount, true, payout, { 
              selection: bet.selection,
              odds: bet.odds,
              eventName: bet.eventName,
              teams: bet.teams
            });
            const newAchievements = checkAchievements(bet.userId, 'cs2betting', bet.amount, true, { 
              selection: bet.selection,
              odds: bet.odds,
              payout: payout
            });
            
            // Emit achievement notifications (if player is online)
            if (newAchievements.length > 0) {
              const playerSocketId = Object.keys(players).find(sid => players[sid].userId === bet.userId);
              if (playerSocketId) {
                io.to(playerSocketId).emit('achievementUnlocked', newAchievements.map(id => ACHIEVEMENTS[id]));
              }
            }
          }
          
          wonCount++;
        } else {
          // Bet lost
          bet.status = 'lost';
          bet.result = 'loss';
          
          // Track stats for losing bet too
          updateUserStats(bet.userId, 'cs2betting', bet.amount, false, 0, { 
            selection: bet.selection,
            odds: bet.odds,
            eventName: bet.eventName,
            teams: bet.teams
          });
          const newAchievements = checkAchievements(bet.userId, 'cs2betting', bet.amount, false, { 
            selection: bet.selection,
            odds: bet.odds
          });
          
          // Emit achievement notifications (if player is online)
          if (newAchievements.length > 0) {
            const playerSocketId = Object.keys(players).find(sid => players[sid].userId === bet.userId);
            if (playerSocketId) {
              io.to(playerSocketId).emit('achievementUnlocked', newAchievements.map(id => ACHIEVEMENTS[id]));
            }
          }
          
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
 * Check if it's been enough time since last settlement check
 * Settlement runs every 2 hours to catch completed matches promptly
 * @returns {boolean} True if enough time has passed or no previous check
 */
function shouldRunSettlementCheck() {
  if (!cs2BettingState.lastSettlementCheck) {
    return true; // No previous check, allow it
  }
  
  const lastCheck = new Date(cs2BettingState.lastSettlementCheck);
  const now = new Date();
  const hoursSinceLastCheck = (now - lastCheck) / (1000 * 60 * 60);
  
  // Run settlement every 2 hours instead of 24 to catch completed matches faster
  return hoursSinceLastCheck >= 2;
}

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
          
          // Check if event already has valid odds from another source (e.g. bo3.gg bet_updates)
          const hasExistingOdds = event.odds && event.odds.team1 && event.odds.team2 &&
                                  event.odds.team1 !== 2.0 && event.odds.team2 !== 2.0;
          
          if (bothInTop250 && !hasExistingOdds && (event.status === 'scheduled' || event.status === 'live')) {
            // Remove match from events since it doesn't have odds from any source
            console.log(`[CS2 Odds] Removing match ${team1Name} vs ${team2Name} from events - both in top 250 but no odds from any source`);
            delete cs2BettingState.events[eventId];
            await saveCS2BettingData();
          } else if (bothInTop250 && hasExistingOdds) {
            console.log(`[CS2 Odds] Keeping match ${team1Name} vs ${team2Name} - OddsPapi failed but has odds from another source (${event.odds.team1}/${event.odds.team2})`);
            // Keep existing odds, don't overwrite
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

// ========== HEALTH CHECK ENDPOINT ==========

app.get("/health", (req, res) => {
  res.json({ 
    success: true, 
    status: "OK", 
    timestamp: new Date().toISOString(),
    server: "casino-server",
    cs2: !!cs2ApiClient ? "available" : "unavailable"
  });
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
    
    // Schedule settlement check every 2 hours to catch completed matches promptly
    cs2SettlementInterval = cron.schedule("0 */2 * * *", async () => {
      if (shouldRunSettlementCheck()) {
        console.log("[CS2 Settlement] Periodic check: starting settlement...");
        await settleCS2Bets(); // Function will update lastSettlementCheck timestamp
      } else {
        const lastCheck = new Date(cs2BettingState.lastSettlementCheck);
        const now = new Date();
        const hoursSinceLastCheck = (now - lastCheck) / (1000 * 60 * 60);
        const hoursRemaining = Math.max(0, 2 - hoursSinceLastCheck);
        console.log(`[CS2 Settlement] ${hoursRemaining.toFixed(1)} hours until next settlement check`);
      }
    }, {
      scheduled: true,
      timezone: "UTC"
    });
    
    // Schedule daily event sync (runs once per day at 2 AM UTC)
    // This fetches new matches and cleans up old ones
    cs2EventSyncInterval = cron.schedule("0 2 * * *", async () => {
      console.log("[CS2 Events] Daily event sync starting...");
      const result = await syncCS2Events();
      if (result) {
        console.log(`[CS2 Events] Daily sync complete: ${result.newCount} new, ${result.updatedCount} updated, ${result.filteredCount} filtered`);
      } else {
        console.log("[CS2 Events] Daily sync failed");
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
    console.log(`  - Event sync: ✅ ENABLED - Daily at 2 AM UTC (fetch new matches, clean up old ones)`);
    console.log(`  - Settlement check: every 2 hours (cron schedule)`);
    console.log(`  - Daily odds update: once per day at 1 AM UTC (or if 24 hours passed)`);
  } else {
    // Fallback to setInterval
    
    // Schedule daily event sync (check every 4 hours if it's time for daily sync)
    cs2SyncInterval = setInterval(async () => {
      const now = new Date();
      const lastSync = cs2BettingState.lastApiSync ? new Date(cs2BettingState.lastApiSync) : new Date(0);
      const hoursSinceLastSync = (now - lastSync) / (1000 * 60 * 60);
      
      // Run event sync once every 24 hours (if 24 hours passed)
      if (hoursSinceLastSync >= 24) {
        console.log("[CS2 Events] Daily event sync starting (setInterval fallback)...");
        const result = await syncCS2Events();
        if (result) {
          console.log(`[CS2 Events] Daily sync complete: ${result.newCount} new, ${result.updatedCount} updated, ${result.filteredCount} filtered`);
        } else {
          console.log("[CS2 Events] Daily sync failed");
        }
      }
    }, 4 * 60 * 60 * 1000); // Check every 4 hours
    
    // Schedule settlement check every 30 minutes to catch completed matches promptly
    cs2SettlementInterval = setInterval(async () => {
      if (shouldRunSettlementCheck()) {
        console.log("[CS2 Settlement] Periodic check: starting settlement...");
        await settleCS2Bets(); // Function will update lastSettlementCheck timestamp
      } else {
        const lastCheck = new Date(cs2BettingState.lastSettlementCheck);
        const now = new Date();
        const hoursSinceLastCheck = (now - lastCheck) / (1000 * 60 * 60);
        const hoursRemaining = Math.max(0, 2 - hoursSinceLastCheck);
        console.log(`[CS2 Settlement] ${hoursRemaining.toFixed(1)} hours until next settlement check`);
      }
    }, 30 * 60 * 1000); // Check every 30 minutes
    
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
    console.log(`  - Event sync: ✅ ENABLED - Daily (checks every 4 hours if 24h passed)`);
    console.log(`  - Settlement check: every 2 hours (checks every 30 minutes)`);
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
    // Run initial settlement check to catch any completed matches
    console.log("[CS2 Settlement] Performing initial settlement check on server start...");
    await settleCS2Bets();
  }, 10000); // Wait 10 seconds for server to fully initialize
}

// ========== END CS2 BETTING SCHEDULED TASKS ==========

// ========== POKER HELPER FUNCTIONS ==========

function getPokerTablesListForLobby() {
  return Object.values(pokerTables)
    .filter(t => !t.isPrivate)
    .map(t => ({
      tableId: t.tableId,
      tableName: t.tableName,
      smallBlind: t.smallBlind,
      bigBlind: t.bigBlind,
      minBuyIn: t.minBuyIn,
      maxBuyIn: t.maxBuyIn,
      playerCount: t.players.filter(p => p.isActive).length,
      maxPlayers: t.maxPlayers,
      gameState: t.gameState
    }));
}

function getPokerTableStateForClient(tableId, viewerSocketId) {
  const table = pokerTables[tableId];
  if (!table) return null;

  const hand = table.currentHand;
  let clientHand = null;

  if (hand) {
    clientHand = {
      pot: hand.pot,
      communityCards: hand.communityCards,
      currentBet: hand.currentBet,
      dealerPosition: hand.dealerPosition,
      smallBlindPosition: hand.smallBlindPosition,
      bigBlindPosition: hand.bigBlindPosition,
      currentPlayerIndex: hand.currentPlayerIndex,
      phase: hand.phase,
      pots: hand.pots || [],
      winners: hand.winners || null,
      players: hand.players.map((p, idx) => {
        const isViewer = p.socketId === viewerSocketId;
        const isShowdown = table.gameState === 'showdown';
        return {
          socketId: p.socketId,
          username: p.username,
          seat: p.seat,
          chips: p.chips,
          isFolded: p.isFolded,
          isAllIn: p.isAllIn,
          betAmount: p.betThisRound || 0,
          totalBetThisRound: p.totalBetThisRound || 0,
          cards: (isViewer || isShowdown) ? p.cards : (p.isFolded ? [] : ['??', '??']),
          handResult: isShowdown ? p.handResult : null
        };
      })
    };
  }

  return {
    tableId: table.tableId,
    tableName: table.tableName,
    smallBlind: table.smallBlind,
    bigBlind: table.bigBlind,
    gameState: table.gameState,
    seats: table.seats.map(s => s ? {
      username: s.username,
      chips: s.chips,
      isActive: s.isActive,
      betAmount: hand ? (hand.players.find(p => p.seat === s.seat)?.betThisRound || 0) : 0
    } : null),
    players: table.players.filter(p => p.isActive).map(p => ({
      socketId: p.socketId,
      username: p.username,
      seat: p.seat,
      chips: p.chips,
      isActive: p.isActive
    })),
    currentHand: clientHand
  };
}

function broadcastPokerTableState(tableId) {
  const table = pokerTables[tableId];
  if (!table) return;

  for (const p of table.players) {
    if (p.isActive) {
      const state = getPokerTableStateForClient(tableId, p.socketId);
      io.to(p.socketId).emit("pokerTableState", state);
    }
  }
}

function handlePokerPlayerLeave(socketId, tableId) {
  const table = pokerTables[tableId];
  if (!table) return;

  const playerIndex = table.players.findIndex(p => p.socketId === socketId);
  if (playerIndex === -1) return;

  const player = table.players[playerIndex];
  
  // Return remaining chips to casino credits
  if (player.chips > 0 && players[socketId]) {
    players[socketId].credits += player.chips;
    const userId = players[socketId].userId;
    if (userId) {
      saveUserBalance(userId, players[socketId].credits).catch(err => {
        console.error("[Poker] Error saving balance on leave:", err);
      });
    }
    io.to(socketId).emit("playerData", {
      username: players[socketId].username,
      credits: players[socketId].credits
    });
    console.log(`[Poker] ${player.username} left ${tableId}, returned ${player.chips} chips`);
  }

  // Remove from seat
  const seatIdx = player.seat;
  if (seatIdx >= 0 && seatIdx < 6) {
    table.seats[seatIdx] = null;
  }

  // If hand in progress, fold them
  if (table.currentHand) {
    const handPlayer = table.currentHand.players.find(p => p.socketId === socketId);
    if (handPlayer && !handPlayer.isFolded) {
      handPlayer.isFolded = true;
      // If it was their turn, advance
      if (table.currentHand.currentPlayerIndex !== undefined) {
        const idx = table.currentHand.players.indexOf(handPlayer);
        if (idx === table.currentHand.currentPlayerIndex) {
          clearPokerActionTimer(tableId);
          advancePokerAction(tableId);
        }
      }
    }
  }

  // Remove from players array
  table.players.splice(playerIndex, 1);
  player.isActive = false;

  // Leave socket room
  const socketObj = io.sockets.sockets.get(socketId);
  if (socketObj) socketObj.leave(tableId);

  // Clean up empty table
  if (table.players.filter(p => p.isActive).length === 0) {
    // Clear any timers
    clearPokerActionTimer(tableId);
    if (table.nextHandTimer) clearTimeout(table.nextHandTimer);
    delete pokerTables[tableId];
    console.log(`[Poker] Table ${tableId} removed (empty)`);
  } else {
    broadcastPokerTableState(tableId);
  }

  io.emit("pokerTablesUpdate", getPokerTablesListForLobby());
}

function startPokerHand(tableId) {
  const table = pokerTables[tableId];
  if (!table) return;

  const activePlayers = table.players.filter(p => p.isActive && !p.isSittingOut && p.chips > 0);
  if (activePlayers.length < 2) return;

  // Sort by seat position
  activePlayers.sort((a, b) => a.seat - b.seat);

  table.handNumber++;
  table.gameState = 'dealing';

  // Move dealer button
  if (table.handNumber === 1) {
    table.dealerPosition = 0;
  } else {
    table.dealerPosition = (table.dealerPosition + 1) % activePlayers.length;
  }

  // Determine blind positions
  let sbPos, bbPos;
  if (activePlayers.length === 2) {
    // Heads-up: dealer is SB, other is BB
    sbPos = table.dealerPosition;
    bbPos = (table.dealerPosition + 1) % activePlayers.length;
  } else {
    sbPos = (table.dealerPosition + 1) % activePlayers.length;
    bbPos = (table.dealerPosition + 2) % activePlayers.length;
  }

  // Create and shuffle deck
  const deck = pokerEngine.shuffleDeck(pokerEngine.createDeck());
  let deckIndex = 0;

  // Build hand players
  const handPlayers = activePlayers.map(p => ({
    socketId: p.socketId,
    username: p.username,
    seat: p.seat,
    chips: p.chips,
    cards: [],
    isFolded: false,
    isAllIn: false,
    betThisRound: 0,
    totalBetThisRound: 0,
    totalBetThisHand: 0,
    hasActed: false,
    handResult: null
  }));

  // Post blinds
  const sbPlayer = handPlayers[sbPos];
  const bbPlayer = handPlayers[bbPos];

  const sbAmount = Math.min(table.smallBlind, sbPlayer.chips);
  sbPlayer.chips -= sbAmount;
  sbPlayer.betThisRound = sbAmount;
  sbPlayer.totalBetThisRound = sbAmount;
  sbPlayer.totalBetThisHand = sbAmount;
  if (sbPlayer.chips === 0) sbPlayer.isAllIn = true;

  // Update the seat reference too
  const sbSeatPlayer = table.players.find(p => p.socketId === sbPlayer.socketId);
  if (sbSeatPlayer) sbSeatPlayer.chips = sbPlayer.chips;

  const bbAmount = Math.min(table.bigBlind, bbPlayer.chips);
  bbPlayer.chips -= bbAmount;
  bbPlayer.betThisRound = bbAmount;
  bbPlayer.totalBetThisRound = bbAmount;
  bbPlayer.totalBetThisHand = bbAmount;
  if (bbPlayer.chips === 0) bbPlayer.isAllIn = true;

  const bbSeatPlayer = table.players.find(p => p.socketId === bbPlayer.socketId);
  if (bbSeatPlayer) bbSeatPlayer.chips = bbPlayer.chips;

  // Deal hole cards
  for (let round = 0; round < 2; round++) {
    for (const hp of handPlayers) {
      hp.cards.push(deck[deckIndex++]);
    }
  }

  const pot = sbAmount + bbAmount;

  table.currentHand = {
    deck,
    deckIndex,
    players: handPlayers,
    communityCards: [],
    pot,
    currentBet: bbAmount,
    lastRaiseAmount: bbAmount,
    dealerPosition: table.dealerPosition,
    smallBlindPosition: sbPos,
    bigBlindPosition: bbPos,
    currentPlayerIndex: null,
    phase: 'preflop',
    pots: [],
    winners: null,
    actionTimer: null
  };

  // Determine first to act preflop (left of BB)
  const firstToAct = (bbPos + 1) % handPlayers.length;
  table.currentHand.currentPlayerIndex = firstToAct;

  table.gameState = 'betting';

  console.log(`[Poker] Hand #${table.handNumber} started at ${tableId}: ${handPlayers.length} players, blinds ${sbAmount}/${bbAmount}`);

  broadcastPokerTableState(tableId);
  startPokerActionTimer(tableId);
}

function processPokerAction(tableId, playerIndex, action, amount) {
  const table = pokerTables[tableId];
  if (!table || !table.currentHand) return;

  const hand = table.currentHand;
  const player = hand.players[playerIndex];
  if (!player || player.isFolded || player.isAllIn) return;

  clearPokerActionTimer(tableId);

  const toCall = hand.currentBet - player.totalBetThisRound;

  switch (action) {
    case 'fold':
      player.isFolded = true;
      console.log(`[Poker] ${player.username} folds at ${tableId}`);
      break;

    case 'check':
      if (toCall > 0) {
        io.to(player.socketId).emit("error", "Cannot check, there's a bet to call");
        startPokerActionTimer(tableId);
        return;
      }
      player.hasActed = true;
      console.log(`[Poker] ${player.username} checks at ${tableId}`);
      break;

    case 'call': {
      const callAmount = Math.min(toCall, player.chips);
      player.chips -= callAmount;
      player.betThisRound += callAmount;
      player.totalBetThisRound += callAmount;
      player.totalBetThisHand += callAmount;
      hand.pot += callAmount;
      if (player.chips === 0) player.isAllIn = true;
      player.hasActed = true;

      // Update seat
      const seatP = table.players.find(p => p.socketId === player.socketId);
      if (seatP) seatP.chips = player.chips;

      console.log(`[Poker] ${player.username} calls ${callAmount} at ${tableId}`);
      break;
    }

    case 'bet': {
      if (hand.currentBet > 0) {
        io.to(player.socketId).emit("error", "Cannot bet, there's already a bet. Use raise.");
        startPokerActionTimer(tableId);
        return;
      }
      let betAmount = amount;
      if (betAmount < table.bigBlind) betAmount = table.bigBlind;
      if (betAmount >= player.chips) {
        // All-in
        betAmount = player.chips;
      }
      player.chips -= betAmount;
      player.betThisRound += betAmount;
      player.totalBetThisRound += betAmount;
      player.totalBetThisHand += betAmount;
      hand.pot += betAmount;
      hand.currentBet = player.totalBetThisRound;
      hand.lastRaiseAmount = betAmount;
      if (player.chips === 0) player.isAllIn = true;
      player.hasActed = true;

      // Reset hasActed for others (they need to respond to the bet)
      for (const p of hand.players) {
        if (p !== player && !p.isFolded && !p.isAllIn) {
          p.hasActed = false;
        }
      }

      const seatP = table.players.find(p => p.socketId === player.socketId);
      if (seatP) seatP.chips = player.chips;

      console.log(`[Poker] ${player.username} bets ${betAmount} at ${tableId}`);
      break;
    }

    case 'raise': {
      if (hand.currentBet === 0) {
        // Treat as bet
        return processPokerAction(tableId, playerIndex, 'bet', amount);
      }
      const minRaise = hand.currentBet + hand.lastRaiseAmount;
      let raiseTotal = amount; // This is the total bet amount (not the raise increment)
      
      // Ensure it's at least the minimum raise or all-in
      if (raiseTotal < minRaise && raiseTotal < player.chips + player.totalBetThisRound) {
        raiseTotal = minRaise;
      }
      
      const additionalChips = raiseTotal - player.totalBetThisRound;
      if (additionalChips >= player.chips) {
        // All-in
        const allInAmount = player.chips;
        player.chips = 0;
        player.betThisRound += allInAmount;
        player.totalBetThisRound += allInAmount;
        player.totalBetThisHand += allInAmount;
        hand.pot += allInAmount;
        if (player.totalBetThisRound > hand.currentBet) {
          hand.lastRaiseAmount = player.totalBetThisRound - hand.currentBet;
          hand.currentBet = player.totalBetThisRound;
        }
        player.isAllIn = true;
      } else {
        player.chips -= additionalChips;
        player.betThisRound += additionalChips;
        player.totalBetThisRound += additionalChips;
        player.totalBetThisHand += additionalChips;
        hand.pot += additionalChips;
        hand.lastRaiseAmount = player.totalBetThisRound - hand.currentBet;
        hand.currentBet = player.totalBetThisRound;
      }

      player.hasActed = true;

      // Reset hasActed for others
      for (const p of hand.players) {
        if (p !== player && !p.isFolded && !p.isAllIn) {
          p.hasActed = false;
        }
      }

      const seatP = table.players.find(p => p.socketId === player.socketId);
      if (seatP) seatP.chips = player.chips;

      console.log(`[Poker] ${player.username} raises to ${player.totalBetThisRound} at ${tableId}`);
      break;
    }

    case 'allin': {
      const allInAmount = player.chips;
      if (allInAmount === 0) return;

      player.chips = 0;
      player.betThisRound += allInAmount;
      player.totalBetThisRound += allInAmount;
      player.totalBetThisHand += allInAmount;
      hand.pot += allInAmount;

      if (player.totalBetThisRound > hand.currentBet) {
        hand.lastRaiseAmount = Math.max(hand.lastRaiseAmount, player.totalBetThisRound - hand.currentBet);
        hand.currentBet = player.totalBetThisRound;
        // Reset hasActed for others
        for (const p of hand.players) {
          if (p !== player && !p.isFolded && !p.isAllIn) {
            p.hasActed = false;
          }
        }
      }

      player.isAllIn = true;
      player.hasActed = true;

      const seatP = table.players.find(p => p.socketId === player.socketId);
      if (seatP) seatP.chips = player.chips;

      console.log(`[Poker] ${player.username} goes all-in for ${allInAmount} at ${tableId}`);
      break;
    }

    default:
      io.to(player.socketId).emit("error", "Invalid action");
      startPokerActionTimer(tableId);
      return;
  }

  advancePokerAction(tableId);
}

function advancePokerAction(tableId) {
  const table = pokerTables[tableId];
  if (!table || !table.currentHand) return;

  const hand = table.currentHand;
  const activePlayers = hand.players.filter(p => !p.isFolded);

  // Check if only one player remaining (everyone else folded)
  if (activePlayers.length === 1) {
    // Winner by fold
    resolvePokerHand(tableId);
    return;
  }

  // Check if betting round is complete
  const playersWhoCanAct = hand.players.filter(p => !p.isFolded && !p.isAllIn);
  const allActed = playersWhoCanAct.every(p => p.hasActed && p.totalBetThisRound >= hand.currentBet);

  if (allActed || playersWhoCanAct.length === 0) {
    // Betting round complete, advance to next phase
    advancePokerPhase(tableId);
    return;
  }

  // Find next player to act
  let nextIdx = (hand.currentPlayerIndex + 1) % hand.players.length;
  let attempts = 0;
  while (attempts < hand.players.length) {
    const nextPlayer = hand.players[nextIdx];
    if (!nextPlayer.isFolded && !nextPlayer.isAllIn && 
        (!nextPlayer.hasActed || nextPlayer.totalBetThisRound < hand.currentBet)) {
      hand.currentPlayerIndex = nextIdx;
      broadcastPokerTableState(tableId);
      startPokerActionTimer(tableId);
      return;
    }
    nextIdx = (nextIdx + 1) % hand.players.length;
    attempts++;
  }

  // If we get here, no one can act — advance phase
  advancePokerPhase(tableId);
}

function advancePokerPhase(tableId) {
  const table = pokerTables[tableId];
  if (!table || !table.currentHand) return;

  const hand = table.currentHand;

  // Reset betting for new round
  for (const p of hand.players) {
    p.betThisRound = 0;
    p.totalBetThisRound = 0;
    p.hasActed = false;
  }
  hand.currentBet = 0;
  hand.lastRaiseAmount = table.bigBlind;

  const activePlayers = hand.players.filter(p => !p.isFolded);
  const playersWhoCanAct = activePlayers.filter(p => !p.isAllIn);

  // If only one or fewer players can act, deal remaining community cards and go to showdown
  if (playersWhoCanAct.length <= 1 && activePlayers.length > 1) {
    // Deal remaining community cards
    while (hand.communityCards.length < 5) {
      if (hand.communityCards.length === 0) {
        // Deal flop
        hand.deckIndex++; // burn
        hand.communityCards.push(hand.deck[hand.deckIndex++]);
        hand.communityCards.push(hand.deck[hand.deckIndex++]);
        hand.communityCards.push(hand.deck[hand.deckIndex++]);
      } else {
        // Deal turn or river
        hand.deckIndex++; // burn
        hand.communityCards.push(hand.deck[hand.deckIndex++]);
      }
    }
    hand.phase = 'showdown';
    resolvePokerHand(tableId);
    return;
  }

  switch (hand.phase) {
    case 'preflop':
      // Deal flop (burn + 3)
      hand.deckIndex++; // burn
      hand.communityCards.push(hand.deck[hand.deckIndex++]);
      hand.communityCards.push(hand.deck[hand.deckIndex++]);
      hand.communityCards.push(hand.deck[hand.deckIndex++]);
      hand.phase = 'flop';
      break;

    case 'flop':
      // Deal turn (burn + 1)
      hand.deckIndex++; // burn
      hand.communityCards.push(hand.deck[hand.deckIndex++]);
      hand.phase = 'turn';
      break;

    case 'turn':
      // Deal river (burn + 1)
      hand.deckIndex++; // burn
      hand.communityCards.push(hand.deck[hand.deckIndex++]);
      hand.phase = 'river';
      break;

    case 'river':
      // Showdown
      hand.phase = 'showdown';
      resolvePokerHand(tableId);
      return;
  }

  // Set first to act (left of dealer)
  let firstToAct = (hand.dealerPosition + 1) % hand.players.length;
  let attempts = 0;
  while (attempts < hand.players.length) {
    const p = hand.players[firstToAct];
    if (!p.isFolded && !p.isAllIn) {
      hand.currentPlayerIndex = firstToAct;
      break;
    }
    firstToAct = (firstToAct + 1) % hand.players.length;
    attempts++;
  }

  broadcastPokerTableState(tableId);
  startPokerActionTimer(tableId);
}

function resolvePokerHand(tableId) {
  const table = pokerTables[tableId];
  if (!table || !table.currentHand) return;

  const hand = table.currentHand;
  hand.currentPlayerIndex = undefined;
  clearPokerActionTimer(tableId);

  const activePlayers = hand.players.filter(p => !p.isFolded);

  if (activePlayers.length === 1) {
    // Winner by fold — award entire pot
    const winner = activePlayers[0];
    winner.chips += hand.pot;
    hand.winners = [{ username: winner.username, amount: hand.pot, handName: 'Everyone folded', seat: winner.seat }];

    // Update seat
    const seatP = table.players.find(p => p.socketId === winner.socketId);
    if (seatP) seatP.chips = winner.chips;

    console.log(`[Poker] ${winner.username} wins ${hand.pot} (everyone folded) at ${tableId}`);
  } else {
    // Evaluate hands
    for (const p of activePlayers) {
      const allCards = [...p.cards, ...hand.communityCards];
      p.handResult = pokerEngine.evaluateHand(allCards);
    }

    // Calculate side pots
    const contributions = hand.players.map(p => ({
      playerId: p.socketId,
      totalBet: p.totalBetThisHand,
      folded: p.isFolded
    }));

    const pots = pokerEngine.calculateSidePots(contributions);
    hand.pots = pots;

    const winners = [];

    for (const pot of pots) {
      // Find eligible players with best hand
      const eligibleActive = activePlayers.filter(p => pot.eligiblePlayerIds.includes(p.socketId));
      if (eligibleActive.length === 0) continue;

      // Sort by hand strength (best first)
      eligibleActive.sort((a, b) => pokerEngine.compareHands(b.handResult, a.handResult));

      // Find all winners (could be a tie)
      const bestHand = eligibleActive[0].handResult;
      const potWinners = eligibleActive.filter(p => pokerEngine.compareHands(p.handResult, bestHand) === 0);

      const share = Math.floor(pot.amount / potWinners.length);
      const remainder = pot.amount - share * potWinners.length;

      potWinners.forEach((w, idx) => {
        const winAmount = share + (idx === 0 ? remainder : 0);
        w.chips += winAmount;

        // Update seat
        const seatP = table.players.find(p => p.socketId === w.socketId);
        if (seatP) seatP.chips = w.chips;

        winners.push({
          username: w.username,
          amount: winAmount,
          handName: w.handResult.name,
          seat: w.seat
        });
      });
    }

    hand.winners = winners;
    console.log(`[Poker] Hand resolved at ${tableId}:`, winners.map(w => `${w.username} wins ${w.amount} (${w.handName})`).join(', '));
  }

  table.gameState = 'showdown';
  
  // Track stats and achievements for all players
  for (const p of hand.players) {
    const player = players[p.socketId];
    if (!player || !player.userId) continue;
    
    const won = hand.winners.some(w => w.username === p.username);
    const wonAmount = hand.winners.filter(w => w.username === p.username).reduce((sum, w) => sum + w.amount, 0);
    const betAmount = p.totalBetThisHand || 0;
    
    if (betAmount > 0) {
      // Only track stats if player actually bet something
      const resultData = {
        hand: p.handResult ? p.handResult.name : 'Unknown',
        potSize: hand.pot,
        players: hand.players.length,
        totalBet: betAmount
      };
      
      updateUserStats(player.userId, 'poker', betAmount, won, wonAmount, resultData);
      const newAchievements = checkAchievements(player.userId, 'poker', betAmount, won, resultData);
      
      // Emit achievement notifications
      if (newAchievements.length > 0) {
        io.to(p.socketId).emit('achievementUnlocked', newAchievements.map(id => ACHIEVEMENTS[id]));
      }
    }
  }
  
  broadcastPokerTableState(tableId);

  // Save balances
  for (const p of hand.players) {
    const seatP = table.players.find(tp => tp.socketId === p.socketId);
    if (seatP) seatP.chips = p.chips;
    
    // Sync credits back (we'll do this when they leave, not every hand)
  }

  // Schedule next hand
  table.nextHandTimer = setTimeout(() => {
    // Remove players with 0 chips
    for (let i = table.players.length - 1; i >= 0; i--) {
      const p = table.players[i];
      if (p.chips <= 0 && p.isActive) {
        console.log(`[Poker] ${p.username} eliminated (0 chips) at ${tableId}`);
        // Return 0 chips, essentially just clean up
        handlePokerPlayerLeave(p.socketId, tableId);
      }
    }

    table.currentHand = null;
    table.gameState = 'waiting';

    const activePlayers = table.players.filter(p => p.isActive && p.chips > 0);
    if (activePlayers.length >= 2) {
      startPokerHand(tableId);
    } else {
      broadcastPokerTableState(tableId);
    }
  }, 5000); // 5 second delay between hands
}

function startPokerActionTimer(tableId) {
  const table = pokerTables[tableId];
  if (!table || !table.currentHand) return;

  clearPokerActionTimer(tableId);

  table.currentHand.actionTimer = setTimeout(() => {
    // Auto-fold on timeout
    const hand = table.currentHand;
    if (!hand || hand.currentPlayerIndex === undefined) return;

    const player = hand.players[hand.currentPlayerIndex];
    if (!player || player.isFolded || player.isAllIn) return;

    console.log(`[Poker] ${player.username} timed out, auto-folding at ${tableId}`);
    player.isFolded = true;
    advancePokerAction(tableId);
  }, 30000); // 30 seconds
}

function clearPokerActionTimer(tableId) {
  const table = pokerTables[tableId];
  if (!table || !table.currentHand) return;

  if (table.currentHand.actionTimer) {
    clearTimeout(table.currentHand.actionTimer);
    table.currentHand.actionTimer = null;
  }
}

// ========== END POKER HELPER FUNCTIONS ==========

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Casino Server running on http://0.0.0.0:${PORT}`);
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

