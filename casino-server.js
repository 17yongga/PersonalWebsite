const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs").promises;
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const {
  SessionStore,
  createCorsMiddleware,
  createRateLimiter,
  createRequireAdmin,
  createRequireAuth,
  getRequestSession,
  parseAllowedOrigins,
  parseCookies,
  sanitizeText,
  secureRandomInt,
  serializeExpiredSessionCookie,
  serializeSessionCookie,
  setSecurityHeaders,
  validateUsername
} = require("./casino-security");
const { AtomicJsonStore, KeyedLock } = require("./casino-persistence");
const { BlackjackService, calculatePachinkoSettlement, generatePachinkoResult } = require("./casino-games-authoritative");
const { CasinoLedger, IdempotencyConflictError, assertCasinoDatabaseIdentity } = require("./casino-ledger");
const { FairRng, FAIR_GAMES } = require('./casino-fairness');
const { createCasinoMailer } = require('./casino-email');
const { CaseGameService } = require('./casino-cases');
const { getCS2BettingAvailability } = require('./cs2-market-availability');
const {
  validateParlayLegs,
  potentialPayout: calculateCS2PotentialPayout,
  evaluateWager,
  CS2_PARLAY_MIN_LEGS,
  CS2_PARLAY_MAX_LEGS
} = require('./cs2-wager-rules');

// CS2 bo3.gg API Client - Primary data source for matches and odds
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
app.set("trust proxy", 1);
const allowedOrigins = parseAllowedOrigins();
const sessionStore = new SessionStore();
const requireAuth = createRequireAuth(sessionStore);
const requireAdmin = createRequireAdmin();
const authRateLimit = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
const apiMutationRateLimit = createRateLimiter({ windowMs: 60 * 1000, max: 60 });
const socketActionBuckets = new Map();

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      callback(null, !origin || allowedOrigins.has(origin));
    },
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.disable('x-powered-by');
app.use(setSecurityHeaders);
app.use(createCorsMiddleware(allowedOrigins));
app.use(express.json({ limit: "32kb", strict: true, type: "application/json" }));

const sessionPruneTimer = setInterval(() => sessionStore.prune(), 15 * 60 * 1000);
sessionPruneTimer.unref?.();

// Initial credits for new players
const INITIAL_CREDITS = 10000;

// User data file path
const DATA_DIR = process.env.CASINO_DATA_DIR ? path.resolve(process.env.CASINO_DATA_DIR) : __dirname;
const USERS_FILE = path.join(DATA_DIR, "casino-users.json");

// Bet history file path
const BET_HISTORY_FILE = path.join(DATA_DIR, "data", "bet-history.json");
const BALANCE_LEDGER_FILE = path.join(DATA_DIR, "data", "balance-ledger.json");
const CASINO_DB_FILE = process.env.CASINO_DB_PATH
  ? path.resolve(process.env.CASINO_DB_PATH)
  : path.join(DATA_DIR, "data", "casino.sqlite");
if (process.env.NODE_ENV === 'production') {
  if (!process.env.CASINO_DB_PATH || !process.env.CASINO_EXPECTED_DB_PATH) {
    throw new Error('Production requires explicit CASINO_DB_PATH and CASINO_EXPECTED_DB_PATH');
  }
  const expectedDbPath = path.resolve(process.env.CASINO_EXPECTED_DB_PATH);
  if (CASINO_DB_FILE !== expectedDbPath) {
    throw new Error(`Casino database path mismatch: configured ${CASINO_DB_FILE}, expected ${expectedDbPath}`);
  }
  assertCasinoDatabaseIdentity(CASINO_DB_FILE);
}
const usersStore = new AtomicJsonStore(USERS_FILE);
const betHistoryStore = new AtomicJsonStore(BET_HISTORY_FILE);
const balanceLedgerStore = new AtomicJsonStore(BALANCE_LEDGER_FILE);
const userMutationLocks = new KeyedLock();
const usersWriteLock = new KeyedLock();
const casinoLedger = new CasinoLedger({ dbPath: CASINO_DB_FILE });
const fairRng = new FairRng({ db: casinoLedger.db });
const caseGameService = new CaseGameService({ ledger: casinoLedger, fairRng });
const casinoMailer = createCasinoMailer();

// Player data: { socketId: { username, credits, roomId, userId } }
const players = {};

// Socket to user mapping: { socketId: userId }
const socketToUser = {};

function parsePositiveInteger(value) {
  const num = Number(value);
  if (!Number.isSafeInteger(num) || num < 1) return null;
  return num;
}

function parseNonNegativeNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return num;
}

// Load users from file
async function loadUsers() {
  try {
    return await usersStore.read({});
  } catch (error) {
    throw error;
  }
}

// Save users to file
async function saveUsers(users) {
  await usersWriteLock.run('users-file', () => usersStore.write(users));
}

// Get users object
let users = {};
const projectionRepairState = { pending: false, lastErrorAt: null };

async function saveUsersProjection() {
  try {
    await saveUsers(users);
    projectionRepairState.pending = false;
    projectionRepairState.lastErrorAt = null;
    return true;
  } catch (error) {
    projectionRepairState.pending = true;
    projectionRepairState.lastErrorAt = new Date().toISOString();
    console.error('[Casino Ledger] JSON projection write failed; SQLite remains canonical and repair is pending:', error);
    return false;
  }
}

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
  console.error("Error loading users; refusing to start with empty state:", err);
  throw err;
});

const ledgerReadyPromise = usersLoadedPromise.then(async () => {
  // Legacy JSON occasionally contains IEEE-754 residue around an exact
  // milli-credit. Normalize only that bounded residue before strict ledger
  // reconciliation; genuine excess precision still fails closed in toMilli().
  for (const user of Object.values(users)) {
    const value = Number(user?.credits);
    const normalized = Math.round(value * 1000) / 1000;
    if (Number.isFinite(value) && Math.abs(value - normalized) <= 1e-7) user.credits = normalized;
  }
  casinoLedger.importAccounts(users);
  const recovered = casinoLedger.recoverActiveEscrows({ reason: 'startup_recovery', preserveGames: ['cs2betting', 'case_battle'] });
  const recoveredBattles = caseGameService.recoverPendingBattles();
  const balances = casinoLedger.listBalances();
  let projectionChanged = recovered.length > 0 || recoveredBattles.length > 0;
  for (const [userId, balance] of Object.entries(balances)) {
    if (!users[userId]) continue;
    if (users[userId].credits !== balance) projectionChanged = true;
    users[userId].credits = balance;
  }
  if (projectionChanged) await saveUsersProjection();
  if (recovered.length) console.warn(`[Casino Ledger] Refunded ${recovered.length} active escrow(s) during startup recovery`);
  if (recoveredBattles.length) console.warn(`[Casino Cases] Settled ${recoveredBattles.length} occupied battle(s) during startup recovery`);
  if (casinoLedger.integrityCheck() !== 'ok') throw new Error('Casino SQLite integrity check failed');
  console.log(`[Casino Ledger] Ready at ${CASINO_DB_FILE} with ${Object.keys(balances).length} account(s)`);
});

// Per-user balance lock: ensures joinCasino reads after in-flight REST (CS2 bet) updates
// Fixes race where user places CS2 bet -> navigates -> joinCasino sends stale balance
function acquireUserBalanceLock(userId) {
  return userMutationLocks.wait(userId);
}

function runWithUserBalanceLock(userId, fn) {
  return userMutationLocks.run(userId, fn);
}

function disconnectUserSockets(username, reason) {
  for (const connectedSocket of io.sockets.sockets.values()) {
    if (connectedSocket.auth?.username !== username) continue;
    connectedSocket.emit('sessionRevoked', { reason });
    connectedSocket.disconnect(true);
  }
}

async function projectCommittedBalance(userId, credits) {
  if (!users[userId]) throw new Error('User projection not found');
  await usersWriteLock.run('users-file', async () => {
    users[userId].credits = credits;
    users[userId].lastPlayed = new Date().toISOString();
    try {
      await usersStore.write(users);
      projectionRepairState.pending = false;
      projectionRepairState.lastErrorAt = null;
    } catch (error) {
      projectionRepairState.pending = true;
      projectionRepairState.lastErrorAt = new Date().toISOString();
      console.error('[Casino Ledger] JSON projection write failed; committed SQLite balance remains authoritative:', error);
    }
  });
  for (const [connectedSocketId, connectedPlayer] of Object.entries(players)) {
    if (connectedPlayer.userId !== userId) continue;
    connectedPlayer.credits = credits;
    io.to(connectedSocketId).emit('playerData', { username: connectedPlayer.username, credits });
  }
}

async function commitCreditChange(userId, delta, context) {
  if (!context?.idempotencyKey || !context?.game || !context?.action) {
    throw new Error('Durable credit mutation context is required');
  }
  const committed = casinoLedger.change({
    userId,
    delta,
    idempotencyKey: context.idempotencyKey,
    game: context.game,
    action: context.action,
    referenceId: context.referenceId || null,
    response: context.response || null,
    metadata: context.metadata || null
  });
  await projectCommittedBalance(userId, committed.balance);
  return committed;
}

async function reserveCredits(userId, { game, referenceId, stake, metadata = null }) {
  const result = casinoLedger.reserve({
    userId,
    game,
    referenceId,
    stake,
    idempotencyKey: `${game}:${referenceId}:${userId}:reserve`,
    metadata
  });
  await projectCommittedBalance(userId, result.balance);
  return result;
}

async function finishEscrows(items) {
  const results = casinoLedger.settleMany(items.map(item => ({
    escrowId: item.escrowId,
    payout: item.payout,
    idempotencyKey: item.idempotencyKey,
    action: item.action || 'settle',
    response: item.response || null,
    metadata: item.metadata || null
  })));
  const balances = new Map();
  for (const result of results) balances.set(result.escrow.userId, result.balance);
  for (const [userId, balance] of balances) await projectCommittedBalance(userId, balance);
  return results;
}

async function finishEscrow(item) {
  const [result] = await finishEscrows([item]);
  return result;
}

// ========== BET HISTORY ==========
let betHistory = {}; // { username: [ { game, bet, result, payout, multiplier, timestamp }, ... ] }

async function loadBetHistory() {
  try {
    betHistory = await betHistoryStore.read({});
    console.log(`Loaded bet history: ${Object.keys(betHistory).length} users`);
  } catch (error) {
    if (error.code === "ENOENT") betHistory = {};
    else {
      console.error("Error loading bet history:", error);
      throw error;
    }
  }
}

async function saveBetHistory() {
  try {
    await betHistoryStore.write(betHistory);
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

const betHistoryLoadedPromise = loadBetHistory();

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

// Roulette game state
let rouletteState = {
  currentBets: Object.create(null), // { socketId: { color: 'red'|'black'|'green', amount: number } }
  spinning: false,
  lastResult: null,
  spinTimer: null,
  nextSpinTime: null,
  roundId: null,
  commitment: null,
  history: [] // Array of last 50 results: { number, color, timestamp }
};

// Coinflip game state
// NOTE: All coinflip server logic is consolidated here in casino-server.js
// The separate coinflip/server.js file is not used - this is the single source of truth
// Room data: { roomId: { creatorId, betAmount, creatorChoice, players: [socketId1, socketId2], confirmed: false, gameState: 'waiting'|'confirmed'|'flipping'|'finished', coinResult: null, botId: string } }
const coinflipRooms = Object.create(null);

// ========== CRASH GAME STATE ==========
let crashState = {
  phase: 'waiting', // waiting, betting, running, crashed
  multiplier: 1.00,
  crashPoint: null,
  bets: Object.create(null), // { socketId: { username, amount, cashedOut, cashoutMultiplier } }
  history: [], // last 30 crash points
  startTime: null,
  bettingTimer: null,
  gameTimer: null,
  tickInterval: null,
  roundId: null,
  commitment: null,
  fairContext: null
};

function generateCrashPoint(randomFraction = crypto.randomBytes(6).readUIntBE(0, 6) / 0x1000000000000) {
  // House edge ~1%. Formula: max(1.0, floor(100 * 0.99 / (1 - r)) / 100)
  const r = randomFraction;
  if (r >= 0.99) return 1.00; // instant crash 1% of the time
  return Math.max(1.00, Math.floor(100 * 0.99 / (1 - r)) / 100);
}

function startCrashBetting() {
  crashState.phase = 'betting';
  crashState.multiplier = 1.00;
  crashState.crashPoint = null;
  crashState.bets = Object.create(null);
  crashState.startTime = null;
  crashState.roundId = `crash_${crypto.randomUUID()}`;
  crashState.commitment = fairRng.current('crash').commitment;
  crashState.fairContext = null;

  io.emit('crashBettingStart', { timeLeft: 10, roundId: crashState.roundId, commitment: crashState.commitment });

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
  crashState.fairContext = fairRng.consume('crash', crashState.roundId, 'neon777-public');
  crashState.crashPoint = generateCrashPoint(fairRng.int(crashState.fairContext, 1_000_000) / 1_000_000);
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
  crashState.tickInterval = setInterval(async () => {
    const elapsed = (Date.now() - crashState.startTime) / 1000;
    crashState.multiplier = Math.max(1.00, parseFloat((Math.exp(0.06 * elapsed)).toFixed(2)));

    // Check auto-cashouts
    for (const [sid, bet] of Object.entries(crashState.bets)) {
      if (!bet.cashedOut && bet.autoCashout > 0 && crashState.multiplier >= bet.autoCashout) {
        await processCrashCashout(sid);
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

      for (const [sid, bet] of Object.entries(crashState.bets)) {
        if (bet.cashedOut) continue;
        try {
          await finishEscrow({ escrowId: bet.escrowId, payout: 0,
            idempotencyKey: `crash:${crashState.roundId}:${bet.userId}:settle`,
            metadata: { crashPoint: crashState.crashPoint } });
          bet.cashedOut = true;
        } catch (error) {
          console.error('[Crash] Failed to settle losing wager:', error);
          io.to(sid).emit('error', 'Settlement persistence failed; contact support');
        }
      }
      const proof = fairRng.reveal(crashState.roundId, { crashPoint: crashState.crashPoint });
      io.emit('crashResult', {
        crashPoint: crashState.crashPoint,
        history: crashState.history,
        fairness: proof
      });

      // Next round after 5 seconds
      if (crashState.gameTimer) clearTimeout(crashState.gameTimer);
      crashState.gameTimer = setTimeout(() => startCrashBetting(), 5000);
    } else {
      io.emit('crashTick', { multiplier: crashState.multiplier });
    }
  }, 50);
}

async function processCrashCashout(socketId) {
  const bet = crashState.bets[socketId];
  if (!bet || bet.cashedOut) return;

  bet.cashedOut = true;
  bet.cashoutMultiplier = crashState.multiplier;
  const winnings = Math.floor(bet.amount * crashState.multiplier);

  if (players[socketId]) {
    try {
      await finishEscrow({ escrowId: bet.escrowId, payout: winnings,
        idempotencyKey: `crash:${crashState.roundId}:${bet.userId}:settle`,
        metadata: { multiplier: crashState.multiplier } });
    } catch (error) {
      bet.cashedOut = false;
      bet.cashoutMultiplier = null;
      console.error("[Crash] Failed to persist cashout:", error);
      io.to(socketId).emit("error", "Unable to persist cashout; retry before the round ends");
      return;
    }
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
const pokerTables = Object.create(null); // { tableId: PokerTableState }

// ========== CS2 BETTING STATE ==========
// CS2 betting data file path - moved to data/ subdirectory to reduce Live Server file watching
const CS2_BETTING_FILE = path.join(DATA_DIR, "data", "cs2-betting-data.json");
const cs2BettingStore = new AtomicJsonStore(CS2_BETTING_FILE);
// CS2 team rankings file path
const CS2_TEAM_RANKINGS_FILE = path.join(__dirname, "cs2-team-rankings.json");
// CS2 API cache file path
const CS2_API_CACHE_FILE = path.join(DATA_DIR, "data", "cs2-api-cache.json");

// CS2 betting state
let cs2BettingState = {
  events: {},  // { eventId: { id, teams, startTime, status, odds, ... } }
  bets: {},    // { betId: { id, userId, matchId, selection, amount, odds, status, ... } }
  lastApiSync: null,
  lastSettlementCheck: null
};

// CS2 team rankings: { teams: [], lastUpdated: null }
let cs2TeamRankings = {
  teams: [],
  lastUpdated: null
};

// Load CS2 betting data from file
async function loadCS2BettingData() {
  try {
    cs2BettingState = await cs2BettingStore.read();
    console.log(`Loaded CS2 betting data: ${Object.keys(cs2BettingState.events).length} events, ${Object.keys(cs2BettingState.bets).length} bets`);
  } catch (error) {
    if (error.code === "ENOENT") {
      // File doesn't exist, create empty state
      await saveCS2BettingData();
      console.log("Created new CS2 betting data file");
    } else {
      console.error("Error loading CS2 betting data:", error);
      throw error;
    }
  }
}

// Save CS2 betting data to file
// Uses atomic writes (write to temp file, then rename) to reduce file watcher triggers
async function saveCS2BettingData() {
  await cs2BettingStore.write(cs2BettingState);
}

// Initialize CS2 betting data on startup
const cs2StateLoadedPromise = loadCS2BettingData().catch(err => {
  console.error("Error initializing CS2 betting data:", err);
  throw err;
});

// CS2 API Cache: { matches: { data: [], timestamp: "ISO" }, odds: { [eventId]: { data: {}, timestamp: "ISO" } } }
let cs2ApiCache = {
  matches: { data: null, timestamp: null },
  odds: {}
};

// Cache TTL: 24 hours in milliseconds
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours — refresh match data frequently

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
  rouletteState.roundId = `roulette_${crypto.randomUUID()}`;
  rouletteState.commitment = fairRng.current('roulette').commitment;
  rouletteState.nextSpinTime = Date.now() + 15000; // 15 seconds - time for players to place bets
  io.emit('nextSpinTime', { time: rouletteState.nextSpinTime, roundId: rouletteState.roundId, commitment: rouletteState.commitment });
}

function spinRoulette() {
  if (rouletteState.spinning) return;

  rouletteState.spinning = true;
  
  const roundId = rouletteState.roundId || `roulette_${crypto.randomUUID()}`;
  const fair = fairRng.consume('roulette', roundId, 'neon777-public');
  const winningNumber = fairRng.int(fair, 15);
  const winningColor = rouletteNumbers[winningNumber].color;

  // Emit spin start
  io.emit('rouletteSpinStart', {
    winningNumber,
    winningColor,
    bets: getBetsSnapshot()
  });

  // After 2 seconds (animation), calculate results
  setTimeout(async () => {
    const results = {};
    const totalPayout = 0;

    // Calculate winnings for each player
    for (const socketId of Object.keys(rouletteState.currentBets)) {
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
          const userId = players[socketId].userId;
          if (userId) {
            try {
              await finishEscrow({
                escrowId: bet.escrowId,
                payout: winnings,
                idempotencyKey: `roulette:${roundId}:${userId}:settle`,
                metadata: { winningNumber, winningColor }
              });
            } catch (error) {
              console.error("[Roulette] Failed to persist payout:", error);
              io.to(socketId).emit("error", "Payout persistence failed; contact support");
              continue;
            }

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
            try {
              await finishEscrow({
                escrowId: bet.escrowId,
                payout: 0,
                idempotencyKey: `roulette:${roundId}:${userId}:settle`,
                metadata: { winningNumber, winningColor }
              });
            } catch (error) {
              console.error('[Roulette] Failed to persist losing settlement:', error);
              io.to(socketId).emit('error', 'Settlement persistence failed; contact support');
              continue;
            }
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
    }

    // Commit the authoritative result to history before publishing it. Clients
    // must receive a self-consistent settlement payload whose first history
    // entry is the spin being announced.
    rouletteState.history.unshift({
      number: winningNumber,
      color: winningColor,
      timestamp: Date.now()
    });
    if (rouletteState.history.length > 50) {
      rouletteState.history.pop();
    }

    const proof = fairRng.reveal(roundId, { winningNumber, winningColor });
    io.emit('rouletteSpinResult', {
      winningNumber,
      winningColor,
      results,
      bets: getBetsSnapshot(),
      history: rouletteState.history,
      fairness: proof
    });

    // Clear bets and reset
    rouletteState.currentBets = Object.create(null);
    rouletteState.lastResult = { number: winningNumber, color: winningColor };
    rouletteState.spinning = false;
    // Wait for animation to complete and result to be displayed before starting timer
    // Animation takes ~4-6 seconds, then we show the result
    // So we wait ~6 seconds before starting the countdown
    setTimeout(() => {
      updateNextSpinTime();
      // Schedule next spin
      startRouletteTimer();
    }, 6000); // Wait 6 seconds for animation + result display
    }, 2000);
}

function getBetsSnapshot() {
  const snapshot = {};
  Object.keys(rouletteState.currentBets).forEach(socketId => {
    const bet = rouletteState.currentBets[socketId];
    const playerName = bet.username || players[socketId]?.username;
    if (playerName) {
      snapshot[socketId] = {
        playerName,
        color: bet.color,
        amount: bet.amount
      };
    }
  });
  return snapshot;
}

function getRouletteStatePayload() {
  return {
    spinning: rouletteState.spinning,
    lastResult: rouletteState.lastResult,
    currentBets: getBetsSnapshot(),
    nextSpinTime: rouletteState.nextSpinTime,
    roundId: rouletteState.roundId,
    commitment: rouletteState.commitment,
    history: rouletteState.history
  };
}

function findRouletteBetByUser(userId) {
  for (const [socketId, bet] of Object.entries(rouletteState.currentBets)) {
    if (bet.userId === userId) return { socketId, bet };
  }
  return null;
}

function validateRouletteRequestId(value) {
  const requestId = sanitizeText(value, 80);
  return /^[A-Za-z0-9_-]{8,80}$/.test(requestId) ? requestId : null;
}

// Authentication endpoints
app.post("/api/register", authRateLimit, async (req, res) => {
  let pendingUsername = null;
  let ledgerAccountCreated = false;
  let userPersisted = false;
  try {
    // Ensure users are loaded before processing registration
    await usersLoadedPromise;
    
    const { username, password, email } = req.body || {};

    if (!username || !password || !email) {
      return res.status(400).json({ error: "Username, email, and password are required" });
    }

    const usernameValidation = validateUsername(username);
    if (!usernameValidation.valid) {
      return res.status(400).json({ error: usernameValidation.error });
    }
    const normalizedUsername = usernameValidation.normalized;
    pendingUsername = normalizedUsername;

    if (typeof password !== "string" || password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: "Password must be between 8 and 128 characters" });
    }
    const normalizedEmail = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
      return res.status(400).json({ error: 'Enter a valid email address' });
    }
    // Check if user already exists
    if (users[normalizedUsername]) {
      return res.status(400).json({ error: "Username already exists" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user
    const newUser = {
      username: normalizedUsername,
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

    casinoLedger.importAccounts({ [normalizedUsername]: newUser });
    ledgerAccountCreated = true;
    if (casinoMailer.configured) {
      const verificationToken = casinoLedger.createVerificationToken(normalizedUsername, normalizedEmail);
      await casinoMailer.sendVerification(normalizedEmail, verificationToken);
    }
    users[normalizedUsername] = newUser;
    await saveUsers(users);
    userPersisted = true;

    res.json({ 
      success: true, 
      message: casinoMailer.configured
        ? "Account created. Check your email to verify it."
        : "Account created. Email verification and password recovery are currently unavailable.",
      credits: INITIAL_CREDITS,
      emailVerificationRequired: casinoMailer.configured,
      emailDeliveryAvailable: casinoMailer.configured
    });
  } catch (error) {
    console.error("Registration error:", error);
    if (pendingUsername && !userPersisted) {
      delete users[pendingUsername];
      if (ledgerAccountCreated) {
        try { casinoLedger.rollbackEmptyAccount(pendingUsername); } catch (rollbackError) { console.error('[Registration] Ledger rollback failed:', rollbackError); }
      }
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/login", authRateLimit, async (req, res) => {
  try {
    // Ensure users are loaded before processing login
    await usersLoadedPromise;
    
    const { username, password } = req.body || {};

    if (typeof username !== "string" || typeof password !== "string" || !username.trim() || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }
    const normalizedUsername = username.trim().slice(0, 64);

    // Existing accounts remain login-compatible; new registrations use the stricter allowlist.
    const user = users[normalizedUsername];
    if (!user) {
      console.warn("Login attempt failed for an unknown username");
      return res.status(401).json({ error: "Invalid username or password" });
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      console.warn("Login attempt failed due to invalid credentials");
      return res.status(401).json({ error: "Invalid username or password" });
    }

    console.log(`Login successful for user '${sanitizeText(user.username, 20)}'`);

    // Update last played
    user.lastPlayed = new Date().toISOString();
    await saveUsers(users);

    const session = sessionStore.create(user.username);
    const secureCookie = process.env.NODE_ENV === "production" || req.secure || req.headers["x-forwarded-proto"] === "https";
    res.setHeader("Set-Cookie", serializeSessionCookie(session.sessionId, { secure: secureCookie, ttlMs: sessionStore.ttlMs }));
    const account = casinoLedger.account(user.username);
    res.json({ 
      success: true, 
      username: user.username,
      credits: user.credits,
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
      email: account?.email || null,
      emailVerified: Boolean(account?.emailVerified)
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get('/api/fairness/current/:game', (req, res) => {
  const game = sanitizeText(req.params.game, 40);
  if (!FAIR_GAMES.has(game)) return res.status(404).json({ error: 'Unsupported fair game' });
  res.json({ success: true, ...fairRng.current(game) });
});

app.get('/api/fairness/proof/:roundId', (req, res) => {
  const roundId = sanitizeText(req.params.roundId, 160);
  if (!roundId) return res.status(400).json({ error: 'Invalid round ID' });
  const proof = fairRng.getProof(roundId);
  if (!proof) return res.status(404).json({ error: 'Fairness proof not found' });
  res.json({ success: true, proof });
});

function sendCaseApiError(res, error) {
  const status = error?.statusCode || (error instanceof RangeError || error instanceof TypeError ? 400 : (/insufficient|already|cannot|not open|not found|no longer/i.test(error?.message || '') ? 400 : 500));
  if (status >= 500) console.error('[Cases] Request failed:', error);
  return res.status(status).json({ success: false, error: status >= 500 ? 'Case service request failed' : error.message, code: error?.code });
}

app.get('/api/cases/catalog', (_req, res) => {
  res.json({ success: true, cases: caseGameService.catalog(), disclosure: { currency: 'virtual credits', expectedReturn: 0.95, realSkins: false } });
});

app.post('/api/cases/prepare', requireAuth, apiMutationRateLimit, (req, res) => {
  try {
    const prepared = caseGameService.prepare({
      userId: req.auth.username,
      game: sanitizeText(req.body?.game, 40),
      requestId: sanitizeText(req.body?.requestId, 80),
      clientSeed: sanitizeText(req.body?.clientSeed || 'neon777', 128)
    });
    res.json({ success: true, prepared });
  } catch (error) { sendCaseApiError(res, error); }
});

app.post('/api/cases/open', requireAuth, apiMutationRateLimit, async (req, res) => {
  try {
    const userId = req.auth.username;
    const opened = caseGameService.open({
      userId,
      caseId: sanitizeText(req.body?.caseId, 80),
      count: Number(req.body?.count),
      requestId: sanitizeText(req.body?.requestId, 80),
      fairRoundId: sanitizeText(req.body?.fairRoundId, 160),
      clientSeed: sanitizeText(req.body?.clientSeed || 'neon777', 128)
    });
    await projectCommittedBalance(userId, opened.balance);
    res.json({ success: true, ...opened });
  } catch (error) { sendCaseApiError(res, error); }
});

app.get('/api/cases/inventory', requireAuth, (req, res) => {
  try { res.json({ success: true, items: caseGameService.inventory(req.auth.username, { includeSold: req.query.includeSold === '1' }) }); }
  catch (error) { sendCaseApiError(res, error); }
});

app.post('/api/cases/inventory/sell-all', requireAuth, apiMutationRateLimit, async (req, res) => {
  try {
    const userId = req.auth.username;
    const sold = await runWithUserBalanceLock(userId, async () => {
      const result = caseGameService.sellAll({
        userId,
        inventoryIds: req.body?.inventoryIds,
        requestId: sanitizeText(req.body?.requestId, 80)
      });
      const balance = casinoLedger.balance(userId);
      await projectCommittedBalance(userId, balance);
      return { ...result, balance, inventory: caseGameService.inventory(userId) };
    });
    res.json({ success: true, ...sold });
  } catch (error) { sendCaseApiError(res, error); }
});

app.post('/api/cases/inventory/:inventoryId/sell', requireAuth, apiMutationRateLimit, async (req, res) => {
  try {
    const userId = req.auth.username;
    const sold = await runWithUserBalanceLock(userId, async () => {
      const result = caseGameService.sell({
        userId,
        inventoryId: sanitizeText(req.params.inventoryId, 160),
        requestId: sanitizeText(req.body?.requestId, 80)
      });
      const balance = casinoLedger.balance(userId);
      await projectCommittedBalance(userId, balance);
      return { ...result, balance };
    });
    res.json({ success: true, ...sold });
  } catch (error) { sendCaseApiError(res, error); }
});

app.get('/api/cases/battles', requireAuth, (_req, res) => {
  try { res.json({ success: true, battles: caseGameService.listBattles() }); }
  catch (error) { sendCaseApiError(res, error); }
});

app.get('/api/cases/battles/:battleId', requireAuth, (req, res) => {
  try { res.json({ success: true, battle: caseGameService.getBattle(sanitizeText(req.params.battleId, 160)) }); }
  catch (error) { sendCaseApiError(res, error); }
});

app.post('/api/cases/battles', requireAuth, apiMutationRateLimit, async (req, res) => {
  try {
    const userId = req.auth.username;
    const battle = caseGameService.createBattle({
      userId,
      opponent: sanitizeText(req.body?.opponent || 'human', 20),
      caseIds: req.body?.caseIds,
      requestId: sanitizeText(req.body?.requestId, 80),
      fairRoundId: sanitizeText(req.body?.fairRoundId, 160),
      clientSeed: sanitizeText(req.body?.clientSeed || 'neon777', 128)
    });
    await projectCommittedBalance(userId, casinoLedger.balance(userId));
    io.emit('caseBattlesUpdated', { battleId: battle.battleId, status: battle.status });
    res.json({ success: true, battle, balance: casinoLedger.balance(userId) });
  } catch (error) { sendCaseApiError(res, error); }
});

app.post('/api/cases/battles/:battleId/join', requireAuth, apiMutationRateLimit, async (req, res) => {
  try {
    const userId = req.auth.username;
    const battle = caseGameService.joinBattle({
      userId,
      battleId: sanitizeText(req.params.battleId, 160),
      requestId: sanitizeText(req.body?.requestId, 80),
      clientSeed: sanitizeText(req.body?.clientSeed || 'neon777', 128)
    });
    await projectCommittedBalance(userId, casinoLedger.balance(userId));
    io.emit('caseBattlesUpdated', { battleId: battle.battleId, status: battle.status });
    res.json({ success: true, battle, balance: casinoLedger.balance(userId) });
  } catch (error) { sendCaseApiError(res, error); }
});

app.post('/api/cases/battles/:battleId/cancel', requireAuth, apiMutationRateLimit, async (req, res) => {
  try {
    const userId = req.auth.username;
    const battle = caseGameService.cancelBattle({
      userId,
      battleId: sanitizeText(req.params.battleId, 160),
      requestId: sanitizeText(req.body?.requestId, 80)
    });
    await projectCommittedBalance(userId, casinoLedger.balance(userId));
    io.emit('caseBattlesUpdated', { battleId: battle.battleId, status: battle.status });
    res.json({ success: true, battle, balance: casinoLedger.balance(userId) });
  } catch (error) { sendCaseApiError(res, error); }
});

app.post('/api/account/email', requireAuth, apiMutationRateLimit, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: 'Enter a valid email address' });
  if (!casinoMailer.configured) return res.status(503).json({ error: 'Email delivery is temporarily unavailable' });
  try {
    const token = casinoLedger.createVerificationToken(req.auth.username, email);
    await casinoMailer.sendVerification(email, token);
    res.status(202).json({ success: true, message: 'Verification email sent' });
  } catch (error) {
    console.error('[Account] Unable to send verification email:', error);
    res.status(503).json({ error: 'Unable to send verification email' });
  }
});

app.post('/api/account/verify-email', authRateLimit, (req, res) => {
  try {
    const verified = casinoLedger.consumeVerificationToken(req.body?.token);
    if (!verified) return res.status(400).json({ error: 'Verification link is invalid or expired' });
    res.json({ success: true, email: verified.email });
  } catch (error) {
    console.error('[Account] Email verification failed:', error);
    res.status(409).json({ error: 'That email is already assigned to another account' });
  }
});

app.post('/api/account/password-recovery', authRateLimit, async (req, res) => {
  const generic = { success: true, message: 'If that verified email exists, a reset link has been sent' };
  const account = casinoLedger.accountByEmail(req.body?.email);
  if (!account || !casinoMailer.configured) return res.status(202).json(generic);
  try {
    const token = casinoLedger.createRecoveryToken(account.user_id);
    await casinoMailer.sendRecovery(account.email, token);
  } catch (error) {
    console.error('[Account] Password recovery delivery failed:', error);
  }
  res.status(202).json(generic);
});

app.post('/api/account/reset-password', authRateLimit, async (req, res) => {
  const password = req.body?.password;
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Password must be between 8 and 128 characters' });
  const token = req.body?.token;
  const userId = casinoLedger.consumeRecoveryToken(token);
  if (!userId || !users[userId]) return res.status(400).json({ error: 'Reset link is invalid or expired' });
  const previousPassword = users[userId].password;
  try {
    users[userId].password = await bcrypt.hash(password, 10);
    await saveUsers(users);
  } catch (error) {
    users[userId].password = previousPassword;
    casinoLedger.restoreRecoveryToken(token, userId);
    console.error('[Account] Password reset persistence failed:', error);
    return res.status(503).json({ error: 'Unable to reset password right now' });
  }
  sessionStore.revokeUser(userId);
  disconnectUserSockets(userId, 'password_reset');
  res.json({ success: true, message: 'Password reset successfully' });
});

app.get("/api/session", requireAuth, async (req, res) => {
  await usersLoadedPromise;
  const user = users[req.auth.username];
  if (!user) {
    sessionStore.revoke(req.auth.sessionId);
    return res.status(401).json({ error: "Session user no longer exists" });
  }
  const account = casinoLedger.account(user.username);
  res.json({
    success: true,
    username: user.username,
    credits: user.credits,
    csrfToken: req.auth.session.csrfToken,
    expiresAt: req.auth.session.expiresAt,
    email: account?.email || null,
    emailVerified: Boolean(account?.emailVerified)
  });
});

app.post("/api/logout", requireAuth, (req, res) => {
  const sessionId = req.auth.sessionId;
  sessionStore.revoke(sessionId);
  for (const connectedSocket of io.sockets.sockets.values()) {
    if (connectedSocket.auth?.sessionId === sessionId) {
      connectedSocket.emit("sessionRevoked", { reason: "logout" });
      connectedSocket.disconnect(true);
    }
  }
  const secureCookie = process.env.NODE_ENV === "production" || req.secure || req.headers["x-forwarded-proto"] === "https";
  res.setHeader("Set-Cookie", serializeExpiredSessionCookie({ secure: secureCookie }));
  res.json({ success: true });
});

const blackjackService = new BlackjackService();
const processedBlackjackRounds = new Set();
const pachinkoRequests = new Map();
const DAILY_BONUS_PRIZES = [100, 250, 50, 500, 100, 300, 250, 2500];

function notifyAuthenticatedUser(username, event, payload) {
  const socketId = findSocketByUserId(username);
  if (socketId) io.to(socketId).emit(event, payload);
}

function publicUsername(username) {
  const safe = sanitizeText(username, 20).replace(/[<>&"'`]/g, '');
  return safe || 'Player';
}

function sanitizePublicData(value, depth = 0) {
  if (depth > 8) return null;
  if (typeof value === 'string') return sanitizeText(value, 300).replace(/[<>&"'`]/g, '');
  if (Array.isArray(value)) return value.slice(0, 500).map(item => sanitizePublicData(item, depth + 1));
  if (value && typeof value === 'object') {
    const safe = {};
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) continue;
      safe[key] = sanitizePublicData(item, depth + 1);
    }
    return safe;
  }
  return value;
}

async function finalizeBlackjackState(username, state) {
  if (!state.settled || processedBlackjackRounds.has(state.roundId)) return;
  processedBlackjackRounds.add(state.roundId);
  const totalStake = state.bet + (state.insuranceBet || 0);
  const won = state.payout > totalStake;
  const resultLabel = state.payout === totalStake ? 'Push' : won ? 'Win' : 'Loss';
  addBetRecord(username, {
    game: 'blackjack', bet: state.bet, result: resultLabel, payout: state.payout,
    details: {
      result: sanitizeText(state.result, 40),
      hands: Array.isArray(state.playerHands) ? state.playerHands.map(hand => ({
        score: hand.score, bet: hand.bet, payout: hand.payout, result: sanitizeText(hand.result, 40)
      })) : []
    }
  });
  updateUserStats(username, 'blackjack', state.bet, won, state.payout, {
    playerScore: state.playerScore, playerScores: state.playerHands?.map(hand => hand.score), dealerScore: state.dealerScore,
    isBlackjack: state.result === 'blackjack', reason: state.result
  });
  const achievements = checkAchievements(username, 'blackjack', state.bet, won, {
    isBlackjack: state.result === 'blackjack'
  });
  if (achievements.length) notifyAuthenticatedUser(username, 'achievementUnlocked', achievements.map(id => ACHIEVEMENTS[id]));
}

async function settleBlackjackLedger(username, round, state) {
  const escrowIds = Array.isArray(round.escrowIds) ? round.escrowIds : [];
  if (!escrowIds.length) throw new Error('Blackjack escrow is missing');
  await finishEscrows(escrowIds.map((escrowId, index) => ({
    escrowId,
    payout: index === 0 ? state.payout : 0,
    idempotencyKey: `blackjack:${state.roundId}:${escrowId}:settle`,
    metadata: { result: state.result, payout: state.payout, handResults: state.handResults }
  })));
  const proof = fairRng.reveal(state.roundId, {
    result: state.result,
    payout: state.payout,
    playerHand: state.playerHand,
    playerHands: state.playerHands,
    dealerHand: state.dealerHand
  });
  casinoLedger.saveRound({ roundId: state.roundId, game: 'blackjack', state, status: 'settled',
    commitment: proof.commitment, seedId: proof.commitment, nonce: proof.nonce });
  await finalizeBlackjackState(username, state);
  return proof;
}

app.post("/api/games/blackjack/start", requireAuth, apiMutationRateLimit, async (req, res) => {
  const username = req.auth.username;
  const bet = Number(req.body?.bet);
  const clientSeed = sanitizeText(req.body?.clientSeed || username, 80).replace(/[^A-Za-z0-9:_.-]/g, '') || username;
  if (!Number.isSafeInteger(bet) || bet < 1) return res.status(400).json({ error: "Invalid bet" });
  try {
    const response = await runWithUserBalanceLock(username, async () => {
      if (!users[username]) return { status: 404, error: "User not found" };
      if (casinoLedger.balance(username) < bet) return { status: 400, error: "Insufficient credits" };
      const roundId = `blackjack_${crypto.randomUUID()}`;
      const fair = fairRng.consume('blackjack', roundId, clientSeed);
      let randomCounter = 0;
      const state = blackjackService.start(username, bet, {
        roundId,
        randomInt: max => fairRng.int(fair, max, randomCounter++)
      });
      const round = blackjackService.rounds.get(username);
      try {
        const reserved = await reserveCredits(username, { game: 'blackjack', referenceId: roundId, stake: bet,
          metadata: { commitment: fair.commitment, clientSeed, nonce: fair.nonce } });
        round.escrowIds = [reserved.escrow.escrowId];
        round.fairContext = fair;
      } catch (error) {
        blackjackService.rounds.delete(username);
        throw error;
      }
      let proof = { commitment: fair.commitment, clientSeed, nonce: fair.nonce, nextCommitment: fair.nextCommitment };
      if (state.settled) proof = await settleBlackjackLedger(username, round, state);
      else casinoLedger.saveRound({ roundId, game: 'blackjack', state, commitment: fair.commitment, seedId: fair.commitment, nonce: fair.nonce });
      return { status: 200, state, balance: casinoLedger.balance(username), fairness: proof };
    });
    if (response.error) return res.status(response.status).json({ error: response.error });
    res.json({ success: true, ...response });
  } catch (error) {
    const status = /already active/.test(error.message) ? 409 : 400;
    res.status(status).json({ error: error.message });
  }
});

app.post("/api/games/blackjack/action", requireAuth, apiMutationRateLimit, async (req, res) => {
  const username = req.auth.username;
  const roundId = sanitizeText(req.body?.roundId, 80);
  const action = sanitizeText(req.body?.action, 30);
  const requestId = sanitizeText(req.body?.requestId, 80);
  const expectedRevision = Number(req.body?.expectedRevision);
  const requestedHandIndex = Number(req.body?.activeHandIndex);
  const modernRequest = Boolean(requestId);
  if (!roundId || !['hit', 'stand', 'double', 'split', 'insurance', 'declineInsurance'].includes(action) ||
      (modernRequest && (!/^[A-Za-z0-9_-]{8,80}$/.test(requestId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
        !Number.isSafeInteger(requestedHandIndex) || requestedHandIndex < 0))) {
    return res.status(400).json({ error: "Invalid blackjack action" });
  }
  try {
    const response = await runWithUserBalanceLock(username, async () => {
      if (!users[username]) return { status: 404, error: "User not found" };
      const current = blackjackService.rounds.get(username);
      if (!current || current.id !== roundId) return { status: 404, error: "Blackjack round not found" };
      const signature = JSON.stringify({ roundId, expectedRevision, activeHandIndex: requestedHandIndex, action });
      const actionRequests = current.actionRequests instanceof Map ? current.actionRequests : (current.actionRequests = new Map());
      if (modernRequest && actionRequests.has(requestId)) {
        const prior = actionRequests.get(requestId);
        if (prior.signature !== signature) return { status: 409, error: "Blackjack request identifier was already used for different inputs" };
        return prior.response;
      }
      if (modernRequest && (current.revision !== expectedRevision || current.activeHandIndex !== requestedHandIndex)) {
        return { status: 409, error: "Blackjack round state changed before this action was accepted" };
      }
      if (current.settled) {
        return { status: 200, state: blackjackService.publicState(current), balance: casinoLedger.balance(username), fairness: fairRng.getProof(roundId) };
      }
      const activeHand = current.playerHands?.[current.activeHandIndex];
      const extraDebit = action === 'double' ? activeHand?.bet || 0
        : action === 'split' ? current.baseBet
          : action === 'insurance' ? current.baseBet / 2 : 0;
      if (extraDebit > casinoLedger.balance(username)) return { status: 400, error: "Insufficient credits" };
      let extraEscrow = null;
      const handIndex = Number.isSafeInteger(current.activeHandIndex) ? current.activeHandIndex : 0;
      if (extraDebit > 0) {
        const referenceId = `${roundId}:${action}:hand-${handIndex}`;
        extraEscrow = await reserveCredits(username, {
          game: 'blackjack', referenceId, stake: extraDebit, metadata: { roundId, action, handIndex, requestId: requestId || null }
        });
        current.escrowIds.push(extraEscrow.escrow.escrowId);
      }
      try {
        const state = blackjackService.action(username, roundId, action);
        let proof = { commitment: current.fairContext.commitment, clientSeed: current.fairContext.clientSeed,
          nonce: current.fairContext.nonce, nextCommitment: current.fairContext.nextCommitment };
        if (state.settled) proof = await settleBlackjackLedger(username, current, state);
        else casinoLedger.saveRound({ roundId, game: 'blackjack', state, commitment: proof.commitment, seedId: proof.commitment, nonce: proof.nonce });
        const accepted = { status: 200, state, balance: casinoLedger.balance(username), fairness: proof };
        if (modernRequest) {
          actionRequests.set(requestId, { signature, response: accepted });
          while (actionRequests.size > 32) actionRequests.delete(actionRequests.keys().next().value);
        }
        return accepted;
      } catch (error) {
        if (extraEscrow) {
          await finishEscrow({ escrowId: extraEscrow.escrow.escrowId, payout: extraDebit,
            idempotencyKey: `blackjack:${roundId}:${action}:hand-${handIndex}:${requestId || 'legacy'}:rollback`, action: 'refund', metadata: { reason: 'action_failed' } });
          current.escrowIds = current.escrowIds.filter(id => id !== extraEscrow.escrow.escrowId);
        }
        throw error;
      }
    });
    if (response.error) return res.status(response.status).json({ error: response.error });
    res.json({ success: true, ...response });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/games/pachinko/drop", requireAuth, apiMutationRateLimit, async (req, res) => {
  const username = req.auth.username;
  const risk = sanitizeText(req.body?.risk, 10);
  const bet = Number(req.body?.bet);
  const count = Number(req.body?.count);
  const requestId = sanitizeText(req.body?.requestId, 80);
  const clientSeed = sanitizeText(req.body?.clientSeed || username, 80).replace(/[^A-Za-z0-9:_.-]/g, '') || username;
  if (!['low', 'medium', 'high'].includes(risk) || !Number.isSafeInteger(bet) || bet < 1 ||
      !Number.isSafeInteger(count) || count < 1 || count > 10 || !/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) {
    return res.status(400).json({ error: "Invalid pachinko request" });
  }
  const idempotencyKey = `pachinko:${username}:${requestId}`;
  const totalBet = bet * count;
  if (!Number.isSafeInteger(totalBet)) return res.status(400).json({ error: "Invalid total bet" });
  try {
    const response = await runWithUserBalanceLock(username, async () => {
      const prior = casinoLedger.lookup(idempotencyKey);
      if (prior) {
        await projectCommittedBalance(username, prior.balance);
        return prior.response;
      }
      if (!users[username]) return { status: 404, error: "User not found" };
      if (casinoLedger.balance(username) < totalBet) return { status: 400, error: "Insufficient credits" };
      const fairRoundId = `pachinko_${username}_${requestId}`;
      const fair = fairRng.consume('pachinko', fairRoundId, clientSeed);
      let counter = 0;
      const rawResults = Array.from({ length: count }, () => generatePachinkoResult(risk, max => fairRng.int(fair, max, counter++)));
      const { results, payout } = calculatePachinkoSettlement(bet, risk, rawResults);
      const proof = fairRng.reveal(fairRoundId, { risk, count, results, totalBet, payout });
      const committed = casinoLedger.change({
        userId: username, delta: payout - totalBet, idempotencyKey, game: 'pachinko', action: 'settle', referenceId: requestId,
        response: ({ balanceAfter }) => ({ success: true, results, totalBet, payout, balance: balanceAfter, fairness: proof }),
        metadata: { risk, count, commitment: proof.commitment }
      });
      await projectCommittedBalance(username, committed.balance);
      const won = payout >= totalBet;
      addBetRecord(username, { game: 'pachinko', bet: totalBet, result: won ? 'Win' : 'Loss', payout, details: { risk, count } });
      updateUserStats(username, 'pachinko', totalBet, won, payout, { risk, count });
      const achievements = checkAchievements(username, 'pachinko', totalBet, won, { risk });
      if (achievements.length) notifyAuthenticatedUser(username, 'achievementUnlocked', achievements.map(id => ACHIEVEMENTS[id]));
      return committed.response;
    });
    if (response.error) return res.status(response.status).json({ error: response.error });
    res.json(response);
  } catch (error) {
    console.error('[Pachinko] Settlement failed:', error);
    res.status(500).json({ error: "Pachinko settlement failed" });
  }
});

app.post("/api/daily-bonus", requireAuth, apiMutationRateLimit, async (req, res) => {
  const username = req.auth.username;
  const DAY_MS = 20 * 60 * 60 * 1000;
  const response = await runWithUserBalanceLock(username, async () => {
    const user = users[username];
    if (!user) return { status: 404, error: "User not found" };
    const now = Date.now();
    const last = Date.parse(user.lastDailyBonusAt || 0) || 0;
    if (last && now - last < DAY_MS) {
      return { status: 429, error: "Daily bonus is not ready", retryAt: last + DAY_MS };
    }
    const roundId = `daily_bonus_${username}_${now}`;
    const fair = fairRng.consume('daily_bonus', roundId, username);
    const prizeIndex = fairRng.int(fair, DAILY_BONUS_PRIZES.length);
    const prize = DAILY_BONUS_PRIZES[prizeIndex];
    const streak = last && now - last < 48 * 60 * 60 * 1000 ? Math.min(365, Number(user.dailyBonusStreak || 0) + 1) : 1;
    const proof = fairRng.reveal(roundId, { prizeIndex, prize, streak });
    const committed = casinoLedger.change({
      userId: username, delta: prize, idempotencyKey: `daily_bonus:${username}:${last || 'first'}`,
      game: 'daily_bonus', action: 'award', referenceId: roundId,
      response: ({ balanceAfter }) => ({ success: true, prizeIndex, prize, streak, balance: balanceAfter, nextAt: now + DAY_MS, fairness: proof })
    });
    user.dailyBonusStreak = streak;
    user.lastDailyBonusAt = new Date(now).toISOString();
    await projectCommittedBalance(username, committed.balance);
    addBetRecord(username, { game: 'daily_bonus', bet: 0, result: 'Bonus', payout: prize, details: { prizeIndex, streak } });
    return committed.response;
  });
  if (response.error) return res.status(response.status).json(response);
  res.json(response);
});

io.use((socket, next) => {
  const auth = getRequestSession(socket.request, sessionStore);
  const csrfToken = socket.handshake.auth?.csrfToken;
  if (!auth || !sessionStore.verifyCsrf(auth.session, csrfToken)) {
    return next(new Error("Authentication required"));
  }
  socket.auth = {
    sessionId: auth.sessionId,
    username: auth.session.username
  };
  next();
});

io.on("connection", (socket) => {
  socket.use(([eventName], next) => {
    const currentSession = sessionStore.get(socket.auth?.sessionId);
    if (!currentSession || currentSession.username !== socket.auth?.username) {
      const error = new Error("Session expired or revoked");
      next(error);
      socket.emit("sessionRevoked", { reason: "expired" });
      socket.disconnect(true);
      return;
    }
    const now = Date.now();
    const key = `${socket.id}:${eventName}`;
    const bucket = socketActionBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      socketActionBuckets.set(key, { count: 1, resetAt: now + 60_000 });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > 60) return next(new Error("Action rate limit exceeded"));
    next();
  });
  console.log(`Player connected: ${socket.id}`);

  // Test connection handler (for debugging)
  socket.on("testConnection", (data, callback) => {
    if (callback) callback({ success: true, socketId: socket.id });
  });

  // Send current roulette state
  socket.emit('rouletteState', getRouletteStatePayload());

  socket.on("joinCasino", async (_payload = {}, callback) => {
    await usersLoadedPromise;
    const uname = socket.auth.username;
    const user = users[uname];
    if (!user) {
      socket.emit("error", "Authenticated user not found.");
      if (callback) callback({ success: false, error: "User not found" });
      return;
    }

    // Wait for any in-flight balance updates before reading.
    await acquireUserBalanceLock(uname);
    const credits = users[uname].credits;

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
    if (callback) callback({ success: true });

    // Send current roulette state
    socket.emit('rouletteState', getRouletteStatePayload());
  });

  const handleSetRouletteBet = async (payload = {}, callback) => {
    const respond = result => {
      if (typeof callback === 'function') callback(result);
      else if (!result.success) socket.emit('error', result.error);
    };
    const player = players[socket.id];
    if (!player) return respond({ success: false, error: 'Please join the casino first' });
    const color = sanitizeText(payload.color, 12);
    const amount = parsePositiveInteger(payload.amount);
    const requestId = validateRouletteRequestId(payload.requestId);
    const requestedRoundId = sanitizeText(payload.roundId, 160);
    if (!['red', 'black', 'green'].includes(color)) return respond({ success: false, error: 'Invalid color. Choose red, black, or green' });
    if (amount === null) return respond({ success: false, error: 'Invalid bet amount' });
    if (!requestId) return respond({ success: false, error: 'Invalid request ID' });
    if (!requestedRoundId || requestedRoundId !== rouletteState.roundId) return respond({ success: false, error: 'Roulette round changed. Please try again.' });

    const userId = player.userId;
    try {
      const result = await runWithUserBalanceLock(userId, async () => {
        if (rouletteState.spinning || requestedRoundId !== rouletteState.roundId) {
          return { success: false, error: 'Betting is closed for this round' };
        }
        const mutationKey = `roulette:${requestedRoundId}:${userId}:${requestId}:set`;
        const replay = casinoLedger.lookup(mutationKey);
        if (replay?.response) {
          if (replay.response.bet?.color !== color || replay.response.bet?.amount !== amount) {
            return { success: false, error: 'Request ID was already used for a different bet' };
          }
          return { ...replay.response, replayed: true };
        }

        const existing = findRouletteBetByUser(userId);
        const action = existing ? (existing.bet.color === color && existing.bet.amount === amount ? 'unchanged' : 'replaced') : 'placed';
        const publicBet = { color, amount };
        const responseFactory = ({ balanceAfter }) => ({ success: true, action, bet: publicBet, balance: balanceAfter, roundId: requestedRoundId, requestId });
        let committed;
        let escrow;

        if (action === 'unchanged') {
          committed = casinoLedger.change({
            userId, delta: 0, idempotencyKey: mutationKey, game: 'roulette', action: 'set_noop',
            referenceId: existing.bet.referenceId, response: responseFactory,
            metadata: { roundId: requestedRoundId, color, amount, requestId }
          });
          escrow = { escrowId: existing.bet.escrowId };
        } else {
          const referenceId = `${requestedRoundId}:${userId}:${requestId}`;
          const reservation = {
            userId, game: 'roulette', referenceId, stake: amount, idempotencyKey: mutationKey,
            metadata: { roundId: requestedRoundId, color, amount, requestId }, response: responseFactory
          };
          if (existing) {
            committed = casinoLedger.replaceEscrow({
              oldEscrowId: existing.bet.escrowId,
              refundIdempotencyKey: `${mutationKey}:refund`,
              refundMetadata: { reason: 'replace', roundId: requestedRoundId, requestId, nextColor: color },
              reservation
            });
            escrow = committed.reservation.escrow;
          } else {
            committed = casinoLedger.reserve(reservation);
            escrow = committed.escrow;
          }
          if (existing) delete rouletteState.currentBets[existing.socketId];
          rouletteState.currentBets[socket.id] = {
            color, amount, userId, username: player.username, requestId,
            referenceId, escrowId: escrow.escrowId
          };
        }

        const balance = committed.balance;
        await projectCommittedBalance(userId, balance);
        const response = action === 'unchanged' ? committed.response
          : (existing ? committed.reservation.response : committed.response);
        return { ...response, replayed: Boolean(committed.replayed) };
      });
      respond(result);
      if (result.success && !result.replayed) io.emit('rouletteBetsUpdate', { bets: getBetsSnapshot(), roundId: rouletteState.roundId });
    } catch (error) {
      console.error('[Roulette] Failed to set bet:', error);
      respond({ success: false, error: /resulting balance|Insufficient/i.test(error.message) ? 'Insufficient credits' : 'Unable to set bet' });
    }
  };

  socket.on('setRouletteBet', handleSetRouletteBet);
  socket.on('placeRouletteBet', (payload = {}, callback) => handleSetRouletteBet({
    ...payload,
    roundId: rouletteState.roundId,
    requestId: validateRouletteRequestId(payload.requestId) || `legacy_${crypto.randomUUID().replaceAll('-', '')}`
  }, callback));

  socket.on('clearRouletteBet', async (payload = {}, callback) => {
    if (typeof payload === 'function') { callback = payload; payload = {}; }
    const respond = result => {
      if (typeof callback === 'function') callback(result);
      else if (!result.success) socket.emit('error', result.error);
    };
    const player = players[socket.id];
    if (!player) return respond({ success: false, error: 'Please join the casino first' });
    const requestId = validateRouletteRequestId(payload.requestId) || `legacy_${crypto.randomUUID().replaceAll('-', '')}`;
    const requestedRoundId = sanitizeText(payload.roundId || rouletteState.roundId, 160);
    const userId = player.userId;
    try {
      const result = await runWithUserBalanceLock(userId, async () => {
        if (rouletteState.spinning || requestedRoundId !== rouletteState.roundId) {
          return { success: false, error: 'Betting is closed for this round' };
        }
        const mutationKey = `roulette:${requestedRoundId}:${userId}:${requestId}:clear`;
        const replay = casinoLedger.lookup(mutationKey);
        if (replay?.response) return { ...replay.response, replayed: true };
        const existing = findRouletteBetByUser(userId);
        const responseFactory = ({ balanceAfter }) => ({ success: true, action: existing ? 'cleared' : 'unchanged', bet: null, balance: balanceAfter, roundId: requestedRoundId, requestId });
        let committed;
        if (existing) {
          committed = casinoLedger.refund({
            escrowId: existing.bet.escrowId,
            idempotencyKey: mutationKey,
            response: responseFactory,
            metadata: { reason: 'player_clear', roundId: requestedRoundId, requestId }
          });
          delete rouletteState.currentBets[existing.socketId];
        } else {
          committed = casinoLedger.change({
            userId, delta: 0, idempotencyKey: mutationKey, game: 'roulette', action: 'clear_noop',
            referenceId: requestedRoundId, response: responseFactory,
            metadata: { roundId: requestedRoundId, requestId }
          });
        }
        await projectCommittedBalance(userId, committed.balance);
        return { ...committed.response, replayed: Boolean(committed.replayed) };
      });
      respond(result);
      if (result.success && !result.replayed) io.emit('rouletteBetsUpdate', { bets: getBetsSnapshot(), roundId: rouletteState.roundId });
    } catch (error) {
      console.error('[Roulette] Failed to clear bet:', error);
      respond({ success: false, error: 'Unable to clear bet' });
    }
  });

  // ========== COINFLIP GAME HANDLERS ==========
  
  socket.on("joinGame", async () => {
    const playerName = socket.auth.username;
    await acquireUserBalanceLock(playerName);
    const user = users[playerName];
    if (!user) {
      socket.emit("error", "Authenticated user not found");
      return;
    }

    if (!players[socket.id]) {
      players[socket.id] = {
        username: playerName,
        credits: user.credits,
        roomId: null,
        userId: playerName
      };
      socketToUser[socket.id] = playerName;
    }

    socket.emit("playerData", {
      name: players[socket.id].username,
      credits: players[socket.id].credits
    });

    // Send available rooms
    emitAvailableCoinflipRooms(socket);
  });

  socket.on("createRoom", async ({ betAmount, choice }) => {
    if (!players[socket.id]) {
      socket.emit("error", "Please join the game first");
      return;
    }
    if (players[socket.id].roomId) {
      socket.emit("error", "Leave your current room before creating another");
      return;
    }

    const betAmountNum = parsePositiveInteger(betAmount);
    if (betAmountNum === null) {
      socket.emit("error", "Invalid bet amount");
      return;
    }

    if (betAmountNum > users[players[socket.id].userId].credits) {
      socket.emit("error", "Insufficient credits");
      return;
    }

    if (choice !== 'Heads' && choice !== 'Tails') {
      socket.emit("error", "Invalid choice");
      return;
    }

    const roomId = `room-${crypto.randomUUID()}`;
    const creatorUserId = players[socket.id].userId;
    const creatorReference = `${roomId}:creator:${creatorUserId}`;
    players[socket.id].roomId = 'pending';
    let creatorEscrow;
    try {
      creatorEscrow = await reserveCredits(creatorUserId, { game: 'coinflip', referenceId: creatorReference,
        stake: betAmountNum, metadata: { roomId, choice, role: 'creator' } });
    } catch (error) {
      players[socket.id].roomId = null;
      console.error("[Coinflip] Failed to persist creator bet:", error);
      socket.emit("error", "Unable to create room");
      return;
    }

    socket.join(roomId);
    players[socket.id].roomId = roomId;
    const fairRoundId = `coinflip_${crypto.randomUUID()}`;
    const fairContext = fairRng.consume('coinflip', fairRoundId, creatorUserId);
    coinflipRooms[roomId] = {
      creatorId: socket.id,
      betAmount: betAmountNum,
      creatorChoice: choice,
      players: [socket.id],
      confirmed: false,
      gameState: 'waiting',
      coinResult: null,
      fairRoundId,
      fairContext,
      commitment: fairContext.commitment,
      escrows: { [socket.id]: creatorEscrow.escrow.escrowId },
      references: { [socket.id]: creatorReference }
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

    const safeRoomId = typeof roomId === 'string' && /^room-\d{3,}$/.test(roomId) ? roomId : null;
    const room = safeRoomId && Object.prototype.hasOwnProperty.call(coinflipRooms, safeRoomId)
      ? coinflipRooms[safeRoomId]
      : null;
    if (!room) {
      socket.emit("error", "Room not found");
      return;
    }
    if (room.players.includes(socket.id)) {
      socket.emit("error", "You are already in this room");
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

  socket.on("confirmParticipation", async ({ roomId }) => {
    const room = coinflipRooms[roomId];
    if (!room || !room.players.includes(socket.id)) {
      socket.emit("error", "You are not in this room");
      return;
    }

    if (room.gameState !== 'waiting' || room.confirmed) {
      socket.emit("error", "Game already started");
      return;
    }
    if (socket.id === room.creatorId || room.players.length !== 2) {
      socket.emit("error", "Only the joined opponent can confirm participation");
      return;
    }

    room.gameState = 'settling';
    const userId = players[socket.id].userId;
    if (users[userId].credits < room.betAmount) {
      room.gameState = 'waiting';
      socket.emit("error", "Insufficient credits");
      return;
    }
    try {
      const joinerReference = `${roomId}:joiner:${userId}`;
      const reserved = await reserveCredits(userId, { game: 'coinflip', referenceId: joinerReference,
        stake: room.betAmount, metadata: { roomId, role: 'joiner' } });
      room.escrows[socket.id] = reserved.escrow.escrowId;
      room.references[socket.id] = joinerReference;
    } catch (error) {
      room.gameState = 'waiting';
      console.error("[Coinflip] Failed to persist opponent bet:", error);
      socket.emit("error", "Unable to confirm participation");
      return;
    }

    room.confirmed = true;
    room.gameState = 'flipping';
    socket.emit('coinflipWagerAccepted', { roomId });

    // Perform coin flip
    const coinResult = fairRng.int(room.fairContext, 2) === 1 ? 'Heads' : 'Tails';
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
      try {
        await finishEscrows([
          { escrowId: room.escrows[creatorId], payout: winnings, idempotencyKey: `coinflip:${room.fairRoundId}:${players[creatorId].userId}:settle`, metadata: { coinResult } },
          { escrowId: room.escrows[joinerId], payout: 0, idempotencyKey: `coinflip:${room.fairRoundId}:${players[joinerId].userId}:settle`, metadata: { coinResult } }
        ]);
      } catch (error) {
        console.error("[Coinflip] Failed to persist creator payout:", error);
        io.to(roomId).emit("error", "Settlement persistence failed; contact support");
        return;
      }

      // Update creator stats
      const creatorUserId = players[creatorId].userId;
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
      try {
        await finishEscrows([
          { escrowId: room.escrows[joinerId], payout: winnings, idempotencyKey: `coinflip:${room.fairRoundId}:${players[joinerId].userId}:settle`, metadata: { coinResult } },
          { escrowId: room.escrows[creatorId], payout: 0, idempotencyKey: `coinflip:${room.fairRoundId}:${players[creatorId].userId}:settle`, metadata: { coinResult } }
        ]);
      } catch (error) {
        console.error("[Coinflip] Failed to persist opponent payout:", error);
        io.to(roomId).emit("error", "Settlement persistence failed; contact support");
        return;
      }

      // Update stats and check achievements for joiner (winner)
      const joinerUserId = players[joinerId].userId;
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

    const proof = fairRng.reveal(room.fairRoundId, { coinResult, creatorChoice: room.creatorChoice });
    io.to(roomId).emit("coinFlipResult", {
      coinResult: coinResult,
      results: results,
      betAmount: room.betAmount,
      creatorChoice: room.creatorChoice,
      choices: room.choices,
      fairness: proof
    });

    room.gameState = 'finished';
  });

  socket.on("leaveRoom", async () => {
    if (players[socket.id] && players[socket.id].roomId) {
      const roomId = players[socket.id].roomId;
      const room = coinflipRooms[roomId];
      
      if (room) {
        if (room.confirmed && room.gameState !== 'finished') {
          socket.emit("error", "Cannot leave while a coinflip is settling");
          return;
        }
        const isCreator = socket.id === room.creatorId;
        socket.leave(roomId);
        room.players = room.players.filter(id => id !== socket.id);
        
        if (isCreator) {
          // Creator is leaving - refund their bet and delete room
          if (!room.confirmed) {
            try {
              await finishEscrow({ escrowId: room.escrows[socket.id], payout: room.betAmount,
                idempotencyKey: `coinflip:${room.references[socket.id]}:refund`, action: 'refund', metadata: { reason: 'leave_room' } });
            } catch (error) {
              console.error("[Coinflip] Failed to persist room refund:", error);
              socket.emit("error", "Unable to leave room; refund was not persisted");
              return;
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
    setTimeout(async () => {
      const coinResult = fairRng.int(room.fairContext, 2) === 0 ? 'Heads' : 'Tails';
      room.coinResult = coinResult;
      room.gameState = 'finished';

      const results = {};
      const creatorId = room.creatorId;
      const botId = room.botId;

      if (coinResult === room.creatorChoice) {
        // Creator wins - gets both bets
        const winnings = room.betAmount * 2;
        try {
          await finishEscrow({ escrowId: room.escrows[creatorId], payout: winnings,
            idempotencyKey: `coinflip:${room.fairRoundId}:${players[creatorId].userId}:settle`, metadata: { coinResult, opponent: 'bot' } });
        } catch (error) {
          console.error("[Coinflip] Failed to persist bot-game payout:", error);
          io.to(creatorId).emit("error", "Settlement persistence failed; contact support");
          return;
        }

        const creatorUserId = players[creatorId].userId;
        if (creatorUserId && users[creatorUserId]) {

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
        try {
          await finishEscrow({ escrowId: room.escrows[creatorId], payout: 0,
            idempotencyKey: `coinflip:${room.fairRoundId}:${creatorUserId}:settle`, metadata: { coinResult, opponent: 'bot' } });
        } catch (error) {
          console.error('[Coinflip] Failed to persist bot-game loss:', error);
          io.to(creatorId).emit('error', 'Settlement persistence failed; contact support');
          return;
        }
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
      
      const proof = fairRng.reveal(room.fairRoundId, { coinResult, creatorChoice: room.creatorChoice, opponent: 'bot' });
      io.to(roomId).emit("coinFlipResult", {
        coinResult,
        results: resultsForClient,
        betAmount: room.betAmount,
        creatorChoice: room.creatorChoice,
        choices: {
          [creatorId]: room.creatorChoice,
          [botId]: botChoice
        },
        fairness: proof
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

    const sb = parsePositiveInteger(smallBlind) || 10;
    const bb = parsePositiveInteger(bigBlind) || sb * 2;
    const minBI = parsePositiveInteger(minBuyIn) || bb * 20;
    const maxBI = parsePositiveInteger(maxBuyIn) || bb * 100;

    if (bb !== sb * 2) {
      socket.emit("error", "Big blind must be exactly 2x the small blind");
      return;
    }

    if (minBI < bb * 20 || maxBI < minBI) {
      socket.emit("error", "Invalid buy-in range");
      return;
    }

    const tableId = `poker_${crypto.randomUUID()}`;
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
      pendingJoinSockets: new Set(),
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

  socket.on("joinPokerTable", async ({ tableId, buyIn, seat }) => {
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
    if (table.pendingJoinSockets.has(socket.id)) {
      socket.emit("error", "Table join is already in progress");
      return;
    }

    const buyInAmount = parsePositiveInteger(buyIn);
    if (buyInAmount === null || buyInAmount < table.minBuyIn || buyInAmount > table.maxBuyIn) {
      socket.emit("error", `Buy-in must be between ${table.minBuyIn} and ${table.maxBuyIn}`);
      return;
    }

    if (users[players[socket.id].userId].credits < buyInAmount) {
      socket.emit("error", "Insufficient credits for buy-in");
      return;
    }

    // Find seat
    let seatIndex = seat !== null && seat !== undefined ? Number(seat) : -1;
    if (!Number.isSafeInteger(seatIndex)) seatIndex = -1;
    if (seatIndex < 0 || seatIndex >= 6 || table.seats[seatIndex] !== null) {
      // Auto-assign seat
      seatIndex = table.seats.findIndex(s => s === null);
    }

    if (seatIndex === -1) {
      socket.emit("error", "Table is full");
      return;
    }

    const seatReservation = { pending: true, socketId: socket.id };
    table.seats[seatIndex] = seatReservation;
    table.pendingJoinSockets.add(socket.id);
    const userId = players[socket.id].userId;
    const pokerReference = `${tableId}:${userId}:${crypto.randomUUID()}`;
    let pokerEscrow;
    try {
      pokerEscrow = await reserveCredits(userId, { game: 'poker', referenceId: pokerReference,
        stake: buyInAmount, metadata: { tableId, seat: seatIndex } });
    } catch (error) {
      table.pendingJoinSockets.delete(socket.id);
      if (table.seats[seatIndex] === seatReservation) table.seats[seatIndex] = null;
      console.error("[Poker] Failed to persist buy-in:", error);
      socket.emit("error", "Unable to join table");
      return;
    }
    table.pendingJoinSockets.delete(socket.id);

    const playerEntry = {
      socketId: socket.id,
      username: players[socket.id].username,
      seat: seatIndex,
      chips: buyInAmount,
      escrowId: pokerEscrow.escrow.escrowId,
      escrowReference: pokerReference,
      userId,
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

  socket.on("leavePokerTable", async ({ tableId }) => {
    await handlePokerPlayerLeave(socket.id, tableId);
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

    const actionAmount = amount === undefined || amount === null ? 0 : Number(amount);
    if (!Number.isSafeInteger(actionAmount) || actionAmount < 0) {
      socket.emit("error", "Invalid action amount");
      return;
    }

    processPokerAction(tableId, playerIndex, action, actionAmount);
  });

  socket.on("pokerChat", ({ tableId, message }) => {
    if (!players[socket.id] || !tableId || !message) return;
    const table = pokerTables[tableId];
    if (!table) return;

    const msg = sanitizeText(message, 200);
    if (!msg) return;

    io.to(tableId).emit("pokerChatMessage", {
      username: publicUsername(players[socket.id].username),
      message: msg,
      timestamp: Date.now()
    });
  });

  // ========== END POKER SOCKET HANDLERS ==========

  // ========== CRASH SOCKET HANDLERS ==========

  // Legacy client-authoritative mutation events are intentionally rejected.
  socket.on("syncBalance", () => {
    const player = players[socket.id];
    if (player) socket.emit("playerData", { username: player.username, credits: users[player.userId]?.credits ?? player.credits });
    socket.emit("mutationRejected", { event: "syncBalance", reason: "Balance is server-authoritative" });
  });

  socket.on("gameResult", () => {
    socket.emit("mutationRejected", { event: "gameResult", reason: "Game results are server-authoritative" });
  });

  socket.on("recordBet", () => {
    socket.emit("mutationRejected", { event: "recordBet", reason: "Bet history is server-authoritative" });
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
    if (!['allTime', 'thisWeek'].includes(type)) type = 'allTime';
    
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
          username: publicUsername(userData.username),
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
    if (!['blackjack', 'crash', 'poker', 'roulette', 'coinflip', 'pachinko', 'cs2betting'].includes(game)) {
      return callback([]);
    }
    
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
          username: publicUsername(userData.username),
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

  socket.on("placeCrashBet", async ({ amount, autoCashout }) => {
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
    const betAmount = parsePositiveInteger(amount);
    const safeAutoCashout = parseNonNegativeNumber(autoCashout);
    if (betAmount === null || betAmount > users[players[socket.id].userId].credits) {
      socket.emit("crashBetPlaced", { success: false, error: "Invalid bet amount" });
      return;
    }

    const userId = players[socket.id].userId;
    const referenceId = `${crashState.roundId}:${userId}`;
    crashState.bets[socket.id] = {
      username: players[socket.id].username,
      userId,
      referenceId,
      amount: betAmount,
      autoCashout: safeAutoCashout,
      cashedOut: false,
      cashoutMultiplier: null
    };
    try {
      const reserved = await reserveCredits(userId, { game: 'crash', referenceId, stake: betAmount,
        metadata: { roundId: crashState.roundId, autoCashout: safeAutoCashout } });
      if (reserved.replayed) throw new IdempotencyConflictError('This account already placed a Crash wager for the round');
      crashState.bets[socket.id].escrowId = reserved.escrow.escrowId;
    } catch (error) {
      delete crashState.bets[socket.id];
      console.error("[Crash] Failed to persist bet:", error);
      socket.emit("crashBetPlaced", { success: false, error: "Unable to place bet" });
      return;
    }

    socket.emit("crashBetPlaced", { success: true, amount: betAmount });
    socket.emit("playerData", {
      username: players[socket.id].username,
      credits: players[socket.id].credits
    });

    console.log(`[Crash] ${players[socket.id].username} bet ${betAmount} (auto-cashout: ${safeAutoCashout || 'off'})`);
  });

  socket.on("crashCashOut", () => {
    if (crashState.phase !== 'running') return;
    processCrashCashout(socket.id);
  });

  // ========== END CRASH SOCKET HANDLERS ==========

  socket.on("disconnect", async () => {
    console.log(`Player disconnected: ${socket.id}`);
    const player = players[socket.id];
    let retainForSettlement = false;

    if (player?.roomId) {
      const roomId = player.roomId;
      const room = coinflipRooms[roomId];
      if (room?.confirmed && room.gameState !== 'finished') {
        retainForSettlement = true;
      } else if (room) {
        const isCreator = socket.id === room.creatorId;
        if (isCreator && !room.confirmed) {
          try {
            await finishEscrow({ escrowId: room.escrows[socket.id], payout: room.betAmount,
              idempotencyKey: `coinflip:${room.references[socket.id]}:refund`, action: 'refund', metadata: { reason: 'disconnect' } });
          } catch (error) {
            console.error("[Coinflip] Failed to persist disconnect refund:", error);
            retainForSettlement = true;
          }
        }
        if (!retainForSettlement) {
          socket.leave(roomId);
          room.players = room.players.filter(id => id !== socket.id);
          if (isCreator || room.players.length === 0) {
            delete coinflipRooms[roomId];
          } else {
            io.to(room.players[0]).emit("opponentLeft");
          }
          player.roomId = null;
        }
      }
    }

    for (const tableId of Object.keys(pokerTables)) {
      const table = pokerTables[tableId];
      if (table.players.find(p => p.socketId === socket.id)) {
        await handlePokerPlayerLeave(socket.id, tableId);
      }
    }

    const rouletteBet = rouletteState.currentBets[socket.id];
    if (rouletteBet) {
      const alternateSocketId = Object.keys(players).find(socketId =>
        socketId !== socket.id && players[socketId]?.userId === player?.userId && io.sockets.sockets.get(socketId)?.connected
      );
      if (alternateSocketId) {
        delete rouletteState.currentBets[socket.id];
        rouletteBet.socketId = alternateSocketId;
        rouletteState.currentBets[alternateSocketId] = rouletteBet;
        io.emit('rouletteBetsUpdate', { bets: getBetsSnapshot(), roundId: rouletteState.roundId });
      } else if (rouletteState.spinning) {
        retainForSettlement = true;
      } else {
        delete rouletteState.currentBets[socket.id];
        try {
          await finishEscrow({ escrowId: rouletteBet.escrowId, payout: rouletteBet.amount,
            idempotencyKey: `roulette:${rouletteBet.referenceId}:refund`, action: 'refund', metadata: { reason: 'disconnect' } });
        } catch (error) {
          rouletteState.currentBets[socket.id] = rouletteBet;
          retainForSettlement = true;
          console.error("[Roulette] Failed to persist disconnect refund:", error);
        }
        io.emit('rouletteBetsUpdate', { bets: getBetsSnapshot(), roundId: rouletteState.roundId });
      }
    }

    if (crashState.bets[socket.id] && !crashState.bets[socket.id].cashedOut) {
      retainForSettlement = true;
    }

    if (retainForSettlement) {
      setTimeout(() => {
        delete socketToUser[socket.id];
        delete players[socket.id];
        delete crashState.bets[socket.id];
        delete rouletteState.currentBets[socket.id];
      }, 120000).unref?.();
    } else {
      delete socketToUser[socket.id];
      delete players[socket.id];
    }
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
    
    const publicEvents = eventsArray.map(event => ({ ...event, ...getCS2BettingAvailability(event) }));
    // Live markets first, then upcoming chronologically. Suspended live cards stay
    // visible so the user understands the match exists while odds refresh.
    publicEvents.sort((a, b) => {
      const liveDiff = Number(b.status === 'live') - Number(a.status === 'live');
      if (liveDiff) return liveDiff;
      const timeA = new Date(a.commenceTime || a.startTime || 0).getTime();
      const timeB = new Date(b.commenceTime || b.startTime || 0).getTime();
      return timeA - timeB;
    });
    
    console.log(`[CS2 API] Returning ${publicEvents.length} active events (${allEvents.length - uniqueEvents.length} duplicates removed)`);
    
    // Log first event structure for debugging
    if (publicEvents.length > 0) {
      const firstEvent = publicEvents[0];
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
      events: sanitizePublicData(publicEvents),
      count: publicEvents.length,
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
    const eventId = sanitizeText(req.params.eventId, 128);
    const event = Object.prototype.hasOwnProperty.call(cs2BettingState.events, eventId)
      ? cs2BettingState.events[eventId]
      : null;
    
    if (!event) {
      return res.status(404).json({ success: false, error: "Event not found" });
    }
    
    // NOTE: Do NOT fetch odds from API here
    // API calls are restricted to: server start, refresh button, and daily updates
    // Just return the cached event data
    
    res.json({ success: true, event: sanitizePublicData(event) });
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
    const eventId = sanitizeText(req.params.eventId, 128);
    const event = Object.prototype.hasOwnProperty.call(cs2BettingState.events, eventId)
      ? cs2BettingState.events[eventId]
      : null;
    
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
app.get("/api/cs2/bets", requireAuth, async (req, res) => {
  try {
    const userId = req.auth.username;
    
    // Filter bets by userId and enrich with team names from events
    const userBets = Object.values(cs2BettingState.bets)
      .filter(bet => bet.userId === userId)
      .map(bet => {
        const enriched = { ...bet };
        // Backfill display names from cached events without mutating canonical wager state.
        if (!enriched.homeTeam || !enriched.awayTeam) {
          const event = cs2BettingState.events[enriched.eventId];
          if (event) {
            enriched.homeTeam = enriched.homeTeam || event.homeTeam || event.participant1Name || 'Unknown';
            enriched.awayTeam = enriched.awayTeam || event.awayTeam || event.participant2Name || 'Unknown';
            enriched.selectionName = enriched.selectionName ||
              (enriched.selection === 'team1' ? enriched.homeTeam :
               enriched.selection === 'team2' ? enriched.awayTeam : 'Draw');
          }
        }
        return enriched;
      });
    
    // Compute summary stats
    const user = users[userId];
    const currentBalance = user?.credits ?? 0;
    let totalWagered = 0;
    let totalWon = 0;
    let wins = 0;
    let settled = 0;

    // Convert bets to transaction-style items for the history
    const transactions = userBets.map(bet => {
      totalWagered += bet.amount || 0;
      if (bet.status === 'won') {
        const payout = bet.potentialPayout ?? Math.round((bet.amount || 0) * (bet.odds || 1));
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
      bets: sanitizePublicData(transactions),
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
app.get("/api/cs2/balance", requireAuth, async (req, res) => {
  try {
    const userId = req.auth.username;
    
    await acquireUserBalanceLock(userId);
    const user = users[userId];
    if (user) {
      res.json({ success: true, balance: user.credits ?? 0 });
    } else {
      res.status(404).json({ success: false, error: "User not found" });
    }
  } catch (error) {
    console.error("Error fetching CS2 balance:", error);
    res.status(500).json({ success: false, error: "Failed to fetch balance" });
  }
});

function cs2WagerSignature(type, amount, legs) {
  return JSON.stringify({
    type,
    amount,
    legs: legs.map(leg => ({ eventId: leg.eventId, selection: leg.selection }))
  });
}

function storedCS2WagerSignature(bet) {
  if (bet.requestSignature) return bet.requestSignature;
  const legs = Array.isArray(bet.legs) && bet.legs.length
    ? bet.legs
    : [{ eventId: bet.eventId, selection: bet.selection }];
  return cs2WagerSignature(bet.type === 'parlay' ? 'parlay' : 'single', bet.amount, legs);
}

// POST /api/cs2/bets - Place a new single or parlay wager
app.post("/api/cs2/bets", requireAuth, apiMutationRateLimit, async (req, res) => {
  try {
    const userId = req.auth.username;
    const amount = req.body?.amount;
    const requestId = sanitizeText(req.body?.requestId, 80);
    const suppliedLegs = Array.isArray(req.body?.legs) ? req.body.legs : null;
    const wagerType = suppliedLegs ? 'parlay' : 'single';
    const rawLegs = suppliedLegs || [{ eventId: req.body?.eventId, selection: req.body?.selection }];
    const requestedLegs = rawLegs.map(leg => ({
      eventId: sanitizeText(leg?.eventId, 160),
      selection: sanitizeText(leg?.selection, 16)
    }));

    if (!/^[A-Za-z0-9_-]{8,80}$/.test(requestId) || requestedLegs.some(leg => !leg.eventId || !leg.selection)) {
      return res.status(400).json({ success: false, error: "Missing required wager fields" });
    }
    if (wagerType === 'parlay' && (requestedLegs.length < CS2_PARLAY_MIN_LEGS || requestedLegs.length > CS2_PARLAY_MAX_LEGS)) {
      return res.status(400).json({ success: false, error: `Parlays require ${CS2_PARLAY_MIN_LEGS}-${CS2_PARLAY_MAX_LEGS} legs` });
    }
    if (!Number.isSafeInteger(amount) || amount < 1) {
      return res.status(400).json({ 
        success: false, 
        error: "Invalid bet amount. Must be a whole number >= 1"
      });
    }

    // Resolve an idempotent replay before re-validating mutable market state or
    // current balance. The first accepted payload is permanently bound to the
    // request identifier.
    const betId = `bet_${crypto.createHash('sha256').update(`${userId}:${requestId}`).digest('hex').slice(0, 24)}`;
    const requestSignature = cs2WagerSignature(wagerType, amount, requestedLegs);
    const priorBet = cs2BettingState.bets[betId];
    if (priorBet) {
      if (priorBet.userId !== userId || storedCS2WagerSignature(priorBet) !== requestSignature) {
        return res.status(409).json({ success: false, error: 'Wager request identifier was already used for different inputs' });
      }
      return res.json({ success: true, bet: priorBet, newBalance: casinoLedger.balance(userId) });
    }

    const lockedLegs = [];
    for (const requested of requestedLegs) {
      const event = cs2BettingState.events[requested.eventId];
      if (!event) return res.status(404).json({ success: false, error: `Event not found: ${requested.eventId}` });
      const availability = getCS2BettingAvailability(event);
      if (availability.bettingStatus !== 'open') {
        return res.status(400).json({ success: false, error: availability.reason || `Cannot bet on ${requested.eventId}`, bettingStatus: availability.bettingStatus });
      }
      if (!['team1', 'team2', 'draw'].includes(requested.selection)) {
        return res.status(400).json({ success: false, error: "Invalid selection" });
      }
      const odds = Number(event.odds?.[requested.selection]);
      if (!Number.isFinite(odds) || odds <= 1 || odds > 100) {
        return res.status(400).json({ success: false, error: `Odds unavailable for ${requested.eventId}` });
      }
      const homeTeam = sanitizeText(event.homeTeam || event.participant1Name || 'Team 1', 80);
      const awayTeam = sanitizeText(event.awayTeam || event.participant2Name || 'Team 2', 80);
      lockedLegs.push({
        eventId: requested.eventId,
        selection: requested.selection,
        selectionName: requested.selection === 'team1' ? homeTeam : requested.selection === 'team2' ? awayTeam : 'Draw',
        homeTeam,
        awayTeam,
        odds,
        oddsSource: event.oddsSource || null,
        oddsUpdatedAt: event.oddsUpdatedAt || event.lastUpdate || null,
        eventStatusAtPlacement: event.status,
        status: 'pending',
        result: null
      });
    }
    let combinedWagerOdds;
    try {
      combinedWagerOdds = wagerType === 'parlay' ? validateParlayLegs(lockedLegs) : lockedLegs[0].odds;
      calculateCS2PotentialPayout(amount, combinedWagerOdds);
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }

    const placement = await runWithUserBalanceLock(userId, async () => {
      const existingBet = cs2BettingState.bets[betId];
      if (existingBet) {
        return existingBet.userId === userId && storedCS2WagerSignature(existingBet) === requestSignature
          ? { status: 200, bet: existingBet, newBalance: casinoLedger.balance(userId) }
          : { status: 409, error: 'Wager request identifier was already used for different inputs' };
      }
      const lockedUser = users[userId];
      if (!lockedUser) return { status: 404, error: "User not found" };
      const authoritativeBalance = casinoLedger.balance(userId);
      if (authoritativeBalance < amount) {
        return { status: 400, error: "Insufficient credits", balance: authoritativeBalance };
      }

      const firstLeg = lockedLegs[0];
      const bet = {
        id: betId,
        userId,
        type: wagerType,
        eventId: wagerType === 'single' ? firstLeg.eventId : null,
        selection: wagerType === 'single' ? firstLeg.selection : null,
        selectionName: wagerType === 'single' ? firstLeg.selectionName : `${lockedLegs.length}-leg parlay`,
        homeTeam: wagerType === 'single' ? firstLeg.homeTeam : null,
        awayTeam: wagerType === 'single' ? firstLeg.awayTeam : null,
        legs: wagerType === 'parlay' ? lockedLegs : undefined,
        amount,
        odds: combinedWagerOdds,
        oddsSource: wagerType === 'single' ? firstLeg.oddsSource : 'combined-bookmaker',
        oddsUpdatedAt: wagerType === 'single' ? firstLeg.oddsUpdatedAt : new Date().toISOString(),
        eventStatusAtPlacement: wagerType === 'single' ? firstLeg.eventStatusAtPlacement : 'multiple',
        potentialPayout: calculateCS2PotentialPayout(amount, combinedWagerOdds),
        requestSignature,
        status: 'pending',
        placedAt: new Date().toISOString(),
        settledAt: null
      };

      const reserveMetadata = {
        wagerType,
        requestId,
        odds: combinedWagerOdds,
        legs: lockedLegs.map(leg => ({ eventId: leg.eventId, selection: leg.selection, odds: leg.odds, oddsSource: leg.oddsSource, oddsUpdatedAt: leg.oddsUpdatedAt }))
      };
      const reserved = await reserveCredits(userId, { game: 'cs2betting', referenceId: betId, stake: amount,
        metadata: reserveMetadata });
      bet.escrowId = reserved.escrow.escrowId;
      cs2BettingState.bets[betId] = bet;
      try {
        await saveCS2BettingData();
      } catch (error) {
        delete cs2BettingState.bets[betId];
        await finishEscrow({ escrowId: bet.escrowId, payout: amount,
          idempotencyKey: `cs2:${betId}:save-failure-refund`, action: 'refund', metadata: { reason: 'state_save_failed' } });
        throw error;
      }
      return { status: 200, bet, newBalance: reserved.balance };
    });

    if (placement.error) {
      return res.status(placement.status).json({ success: false, error: placement.error, balance: placement.balance });
    }

    res.json({ success: true, bet: placement.bet, newBalance: placement.newBalance });
  } catch (error) {
    console.error("Error placing CS2 bet:", error);
    res.status(500).json({ success: false, error: "Failed to place bet" });
  }
});

// Sync CS2 events/odds from API (used by scheduled tasks and manual sync)
async function syncCS2Events(options = {}) {
  const { forceRefresh = false } = options;
  if (!cs2Bo3ggClient) {
    console.warn("[CS2 Sync] bo3.gg client not available, skipping sync");
    return;
  }

  try {
    // Check cache first
    let matches = forceRefresh ? null : getCachedMatches();

    if (matches) {
      console.log(`[CS2 Sync] Using cached matches (${matches.length} matches)`);
    } else {
      console.log(forceRefresh ? "[CS2 Sync] Force refresh requested — fetching fresh bo3.gg matches" : "Syncing CS2 events from bo3.gg...");

      // Fetch upcoming and currently running matches. Current matches are
      // queried separately because bo3.gg excludes them from the upcoming feed.
      try {
        const upcomingMatches = await cs2Bo3ggClient.fetchUpcomingMatches({ limit: 50 });
        const currentMatches = typeof cs2Bo3ggClient.fetchCurrentMatches === 'function'
          ? await cs2Bo3ggClient.fetchCurrentMatches({ limit: 25 })
          : [];
        matches = [...(currentMatches || []), ...(upcomingMatches || [])];
        if (matches.length > 0) {
          console.log(`[CS2 Sync] bo3.gg returned ${currentMatches.length} live and ${upcomingMatches.length} upcoming matches`);
        }
      } catch (bo3Error) {
        console.warn(`[CS2 Sync] bo3.gg fetch failed: ${bo3Error.message}`);
        matches = [];
      }

      // If still empty, try HLTV scraper as last resort
      if (!matches || matches.length === 0) {
        
        // Fallback 2: HLTV scraper (may be blocked from cloud servers)
        if ((!matches || matches.length === 0) && cs2ResultFetcher) {
          console.log("[CS2 Sync] Trying HLTV scraper...");
          try {
            const hltvMatches = await cs2ResultFetcher.getUpcomingMatches();
            if (hltvMatches && hltvMatches.length > 0) {
              console.log(`[CS2 Sync] HLTV returned ${hltvMatches.length} upcoming matches`);
              matches = hltvMatches.map(m => {
                const generatedId = `hltv_${m.hltvId || Date.now()}_${crypto.randomUUID().slice(0, 6)}`;
                return {
                  id: generatedId,
                  fixtureId: generatedId,
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
                };
              });
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
    
    // Deduplicate by fixtureId AND by team matchup+date (catches cross-source duplicates)
    const uniqueMatches = [];
    const seenIds = new Set();
    const seenMatchups = new Set(); // "team1_vs_team2_YYYY-MM-DD"

    function normalizeTeamName(name) {
      if (!name) return '';
      return name.toLowerCase()
        .replace(/\s+(esports?|gaming|team|cs2|cs)$/i, '')
        .replace(/[^a-z0-9]/g, '')
        .trim();
    }

    for (const match of matches) {
      const eventId = match.fixtureId || match.id;
      if (!eventId || seenIds.has(eventId)) {
        if (seenIds.has(eventId)) {
          console.log(`[CS2 Sync] Skipping duplicate match (same ID): ${eventId}`);
        }
        continue;
      }

      // Cross-source dedup by team names + date
      const t1 = normalizeTeamName(match.homeTeam || match.participant1Name);
      const t2 = normalizeTeamName(match.awayTeam || match.participant2Name);
      const matchDate = (match.commenceTime || match.startTime || '').substring(0, 10);
      const matchupKey = `${[t1, t2].sort().join('_vs_')}_${matchDate}`;

      if (t1 && t2 && seenMatchups.has(matchupKey)) {
        console.log(`[CS2 Sync] Skipping cross-source duplicate: ${match.homeTeam} vs ${match.awayTeam} (${match.source})`);
        continue;
      }

      seenIds.add(eventId);
      if (t1 && t2) seenMatchups.add(matchupKey);
      uniqueMatches.push(match);
    }
    
    console.log(`[CS2 Sync] Processing ${uniqueMatches.length} unique matches (${matches.length - uniqueMatches.length} duplicates removed)`);
    
    // Update events in state
    let updatedCount = 0;
    let newCount = 0;
    let filteredCount = 0;
    
    for (const match of uniqueMatches) {
      const matchTeam1 = match.homeTeam || match.participant1Name;
      const matchTeam2 = match.awayTeam || match.participant2Name;
      // Filter: matches with real bookmaker odds are always accepted
      // Otherwise require at least one team in top 250
      const team1Ranking = getTeamRanking(matchTeam1);
      const team2Ranking = getTeamRanking(matchTeam2);
      const bothInTop250 = team1Ranking !== null && team2Ranking !== null;
      const atLeastOneInTop250 = team1Ranking !== null || team2Ranking !== null;
      const matchHasOdds = match.hasOdds && match.odds && match.odds.team1 && match.odds.team2;

      if (!bothInTop250 && !(matchHasOdds || atLeastOneInTop250) && match.source !== 'bo3gg-current') {
        filteredCount++;
        console.log(`[CS2 Sync] Filtering out match: ${matchTeam1} vs ${matchTeam2} (team1 rank: ${team1Ranking?.rank || 'N/A'}, team2 rank: ${team2Ranking?.rank || 'N/A'}, hasOdds: ${matchHasOdds})`);
        continue;
      }
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
      } else if (startTimeObj && startTimeObj <= now) {
        // bo3.gg often keeps in-progress matches as "upcoming" while betting lines remain active.
        // Treat recently-started matches as live so the frontend exposes them as live bettable cards.
        const hoursSinceStart = (now - startTimeObj) / (1000 * 60 * 60);
        if (hoursSinceStart <= 4) {
          finalStatus = 'live';
          finalCompleted = false;
        } else {
          finalStatus = 'finished';
          finalCompleted = true;
        }
      } else if (!finalStatus) {
        // Default to scheduled if no status provided
        finalStatus = 'scheduled';
        finalCompleted = false;
      }
      
      // Prefer fresh odds from the match source (e.g. bo3.gg bet_updates with real bookmaker odds)
      // over stale existing event odds (which may be ranking-based estimates)
      const matchHasBookmakerOdds = match.hasOdds && Number(match.odds?.team1) > 1 && Number(match.odds?.team2) > 1;
      const existingOdds = matchHasBookmakerOdds
        ? { team1: Number(match.odds.team1), team2: Number(match.odds.team2), draw: null }
        : { team1: null, team2: null, draw: null };
      
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
      
      // Bookmaker odds remain attached to the provider's team ordering. Never
      // swap or synthesize them from rankings; unavailable markets stay visible
      // but suspended.
      
      const previousOdds = existingEvent?.odds || null;
      const getOddsMovement = (previous, current) => {
        if (!previous || !current || typeof previous !== 'number' || typeof current !== 'number') {
          return 'same';
        }
        if (current > previous) return 'up';
        if (current < previous) return 'down';
        return 'same';
      };
      const oddsMovement = {
        team1: getOddsMovement(previousOdds?.team1, existingOdds?.team1),
        team2: getOddsMovement(previousOdds?.team2, existingOdds?.team2),
        previousTeam1: previousOdds?.team1 || null,
        previousTeam2: previousOdds?.team2 || null,
        changedAt: previousOdds && (
          previousOdds.team1 !== existingOdds?.team1 || previousOdds.team2 !== existingOdds?.team2
        ) ? new Date().toISOString() : (existingEvent?.oddsMovement?.changedAt || null)
      };

      if (!matchHasBookmakerOdds && (finalStatus === 'scheduled' || finalStatus === 'live')) {
        console.log(`[CS2 Sync] Keeping ${matchTeam1} vs ${matchTeam2} visible with betting suspended: bookmaker odds unavailable`);
      }

      // Map to internal event format
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
        oddsMovement,
        oddsSource: matchHasBookmakerOdds
          ? (match.source === 'bo3gg-current' ? 'bo3gg-live' : 'bo3gg-prematch')
          : null,
        oddsUpdatedAt: matchHasBookmakerOdds ? (match.oddsUpdatedAt || new Date().toISOString()) : null,
        status: finalStatus,
        statusId: match.statusId || (finalStatus === 'live' ? 1 : (finalStatus === 'finished' ? 2 : 0)),
        completed: finalCompleted,
        result: match.result || existingEvent?.result || null,
        hasOdds: matchHasBookmakerOdds,
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
    // - Recurring live monitor syncs
    // We don't fetch per-event odds automatically during user clicks to avoid excessive API calls.

    // Mark existing cached events as live/finished based on time even when bo3.gg no longer
    // returns them in the upcoming feed. This prevents stale "scheduled" cards for matches
    // that already started, and makes currently active matches visible as LIVE.
    const now = new Date();
    let statusAdjustedCount = 0;
    for (const event of Object.values(cs2BettingState.events)) {
      const eventTime = event.startTime ? new Date(event.startTime) :
                        (event.commenceTime ? new Date(event.commenceTime) : null);
      if (!eventTime || Number.isNaN(eventTime.getTime()) || event.status === 'finished') continue;
      if (eventTime <= now) {
        const hoursSinceStart = (now - eventTime) / (1000 * 60 * 60);
        const nextStatus = hoursSinceStart <= 4 ? 'live' : 'finished';
        if (event.status !== nextStatus) {
          event.status = nextStatus;
          event.statusId = nextStatus === 'live' ? 1 : 2;
          event.completed = nextStatus === 'finished';
          statusAdjustedCount++;
        }
      }
    }
    if (statusAdjustedCount > 0) {
      console.log(`[CS2 Sync] Time-adjusted ${statusAdjustedCount} cached event statuses`);
    }
    
    // CLEANUP: Remove old/completed matches
    let removedCount = 0;
    const sixHoursAgo = new Date(now.getTime() - (6 * 60 * 60 * 1000)); // 6 hours ago
    
    const eventIds = Object.keys(cs2BettingState.events);
    for (const eventId of eventIds) {
      const event = cs2BettingState.events[eventId];
      const eventTime = event.startTime ? new Date(event.startTime) : 
                        (event.commenceTime ? new Date(event.commenceTime) : null);
      
      // Remove if:
      // 1. Event started 6+ hours ago (match is definitely over by now)
      // 2. Event is explicitly finished
      // 3. Event has no start time and is marked as finished
      const shouldRemove = 
        (eventTime && eventTime < sixHoursAgo) ||
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
    await saveCS2BettingData();
    
    console.log(`CS2 sync complete: ${newCount} new, ${updatedCount} updated, ${filteredCount} filtered out, ${removedCount} old matches removed`);
    return { newCount, updatedCount, filteredCount, removedCount, total: matches.length };
  } catch (error) {
    console.error("Error syncing CS2 events:", error);
    return null;
  }
}

// Settle CS2 singles and parlays from authoritative match results.
const CS2_RESULT_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

async function resolveCS2EventOutcome(eventId, recentResults) {
  const event = cs2BettingState.events[eventId];
  if (event?.status === 'cancelled') return { status: 'cancelled', winner: null, source: 'event_state' };
  if (event?.result?.winner) return { status: 'finished', ...event.result };

  let matchResult = recentResults.get(eventId) || null;
  if (!matchResult && cs2Bo3ggClient?.fetchResultById) matchResult = await cs2Bo3ggClient.fetchResultById(eventId);
  if (matchResult?.winner) {
    const result = {
      winner: matchResult.winner,
      participant1Score: matchResult.team1Score,
      participant2Score: matchResult.team2Score,
      homeScore: matchResult.team1Score,
      awayScore: matchResult.team2Score,
      source: matchResult.source || 'bo3gg'
    };
    if (event) {
      event.status = 'finished';
      event.statusId = 3;
      event.completed = true;
      event.result = result;
      cs2BettingState.events[eventId] = event;
    }
    return { status: 'finished', ...result };
  }

  if (event && cs2ResultFetcher) {
    try {
      const team1 = event.homeTeam || event.participant1Name;
      const team2 = event.awayTeam || event.participant2Name;
      if (team1 && team2) {
        const scraperResult = await cs2ResultFetcher.findMatchResult(team1, team2);
        if (scraperResult?.winner) {
          const { teamsMatch } = require('./cs2-free-result-sources');
          const winner = teamsMatch(scraperResult.winner, team1) ? 'team1'
            : teamsMatch(scraperResult.winner, team2) ? 'team2' : null;
          if (winner) {
            const result = { winner, participant1Score: null, participant2Score: null, source: scraperResult.source, confidence: scraperResult.confidence };
            event.status = 'finished';
            event.statusId = 3;
            event.completed = true;
            event.result = result;
            cs2BettingState.events[eventId] = event;
            return { status: 'finished', ...result };
          }
        }
      }
    } catch (error) {
      console.warn(`[CS2 Settlement] Result fallback failed for ${eventId}: ${error.message}`);
    }
  }
  return null;
}

async function settleCS2Bets() {
  if (!cs2Bo3ggClient && !cs2ResultFetcher) {
    console.warn('[CS2 Settlement] No result sources available, skipping');
    return null;
  }
  try {
    console.log('[CS2 Settlement] Starting settlement check...');
    const pendingBets = Object.values(cs2BettingState.bets).filter(bet => bet.status === 'pending');
    if (!pendingBets.length) {
      cs2BettingState.lastSettlementCheck = new Date().toISOString();
      await saveCS2BettingData();
      console.log('[CS2 Settlement] No pending bets to settle');
      return { settled: 0, won: 0, lost: 0, void: 0 };
    }

    const eventIds = new Set();
    for (const bet of pendingBets) {
      const legs = Array.isArray(bet.legs) && bet.legs.length ? bet.legs : [{ eventId: bet.eventId }];
      for (const leg of legs) if (leg.eventId) eventIds.add(leg.eventId);
    }

    const recentResults = new Map();
    if (cs2Bo3ggClient?.fetchRecentResults) {
      try {
        const results = await cs2Bo3ggClient.fetchRecentResults({ limit: 50 });
        for (const result of results || []) recentResults.set(result.id, result);
      } catch (error) {
        console.warn(`[CS2 Settlement] Recent-result batch failed: ${error.message}`);
      }
    }

    const outcomes = {};
    for (const eventId of eventIds) {
      const outcome = await resolveCS2EventOutcome(eventId, recentResults);
      if (outcome) outcomes[eventId] = outcome;
    }

    const now = Date.now();
    for (const bet of pendingBets) {
      const legs = Array.isArray(bet.legs) && bet.legs.length ? bet.legs : [{ eventId: bet.eventId }];
      for (const leg of legs) {
        if (outcomes[leg.eventId]) continue;
        const event = cs2BettingState.events[leg.eventId];
        const referenceTime = Date.parse(event?.startTime || event?.commenceTime || bet.placedAt || '');
        if (Number.isFinite(referenceTime) && now - referenceTime >= CS2_RESULT_GRACE_MS) {
          outcomes[leg.eventId] = { status: 'cancelled', winner: null, source: 'result_unavailable_after_grace' };
          console.warn(`[CS2 Settlement] Voiding unresolved event ${leg.eventId} after seven-day result grace`);
        }
      }
    }

    const stats = { settled: 0, won: 0, lost: 0, void: 0 };
    for (const bet of pendingBets) {
      const decision = evaluateWager(bet, outcomes);
      if (Array.isArray(bet.legs)) bet.legs = decision.legs;
      if (decision.status === 'pending') continue;

      await runWithUserBalanceLock(bet.userId, async () => {
        if (bet.status !== 'pending') return;
        await finishEscrow({
          escrowId: bet.escrowId,
          payout: decision.payout,
          idempotencyKey: `cs2:${bet.id}:settle`,
          action: decision.status === 'void' ? 'refund' : 'settle',
          metadata: { wagerType: bet.type || 'single', eventId: bet.eventId || null, legCount: decision.legs.length, result: decision.status }
        });
        bet.status = decision.status;
        bet.result = decision.result;
        bet.settledAt = new Date().toISOString();
        bet.settledOdds = decision.effectiveOdds;
        if (decision.payout !== null) bet.potentialPayout = decision.payout;
        if (Array.isArray(bet.legs)) bet.legs = decision.legs;
        cs2BettingState.bets[bet.id] = bet;
      });
      if (bet.status === 'pending') continue;

      const won = bet.status === 'won';
      const payout = decision.payout || 0;
      const details = bet.type === 'parlay' ? `${decision.legs.length}-leg parlay` : (bet.eventName || `${bet.homeTeam || ''} vs ${bet.awayTeam || ''}`.trim());
      if (users[bet.userId]) {
        updateUserStats(bet.userId, 'cs2betting', bet.amount, won, payout, { selection: bet.selectionName, odds: decision.effectiveOdds || bet.odds, eventName: details, teams: bet.teams });
        const newAchievements = checkAchievements(bet.userId, 'cs2betting', bet.amount, won, { selection: bet.selectionName, odds: decision.effectiveOdds || bet.odds, payout });
        if (newAchievements.length) {
          const playerSocketId = Object.keys(players).find(socketId => players[socketId].userId === bet.userId);
          if (playerSocketId) io.to(playerSocketId).emit('achievementUnlocked', newAchievements.map(id => ACHIEVEMENTS[id]));
        }
        addBetRecord(users[bet.userId].username, {
          game: 'cs2betting', bet: bet.amount,
          result: bet.status === 'won' ? 'Win' : bet.status === 'lost' ? 'Loss' : 'Void',
          payout, multiplier: decision.effectiveOdds || null, details
        });
      }
      stats[bet.status]++;
      stats.settled++;
    }

    cs2BettingState.lastSettlementCheck = new Date().toISOString();
    await saveCS2BettingData();
    console.log(`[CS2 Settlement] Settled ${stats.settled}: ${stats.won} won, ${stats.lost} lost, ${stats.void} void`);
    return stats;
  } catch (error) {
    console.error('[CS2 Settlement] Failed:', error);
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
// POST /api/cs2/admin/sync - Force refresh of events from bo3.gg
// This is called when refresh button is clicked on CS2 betting page
app.post("/api/cs2/admin/sync", requireAdmin, apiMutationRateLimit, async (req, res) => {
  try {
    console.log("[CS2 Sync] Manual refresh triggered via API");
    const result = await syncCS2Events({ forceRefresh: true });

    if (result) {
      res.json({
        success: true,
        message: `Synced ${result.total} matches`,
        ...result,
        lastSync: cs2BettingState.lastApiSync
      });
    } else {
      res.status(503).json({
        success: false,
        error: "Failed to sync or bo3.gg client not available"
      });
    }
  } catch (error) {
    console.error("Error in sync endpoint:", error);
    res.status(500).json({ success: false, error: "Failed to sync data" });
  }
});

// GET /api/cs2/sync - Same as POST but for GET requests (for refresh button)
app.get("/api/cs2/sync", requireAdmin, apiMutationRateLimit, async (req, res) => {
  try {
    console.log("[CS2 Sync] Manual refresh triggered via GET API");
    const result = await syncCS2Events({ forceRefresh: true });

    if (result) {
      res.json({
        success: true,
        message: `Synced ${result.total} matches`,
        ...result,
        lastSync: cs2BettingState.lastApiSync
      });
    } else {
      res.status(503).json({
        success: false,
        error: "Failed to sync or bo3.gg client not available"
      });
    }
  } catch (error) {
    console.error("Error in sync endpoint:", error);
    res.status(500).json({ success: false, error: "Failed to sync data" });
  }
});

// POST /api/cs2/admin/settle - Manually trigger bet settlement (bypasses daily limit)
app.post("/api/cs2/admin/settle", requireAdmin, apiMutationRateLimit, async (req, res) => {
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
    cs2: cs2Bo3ggClient ? "bo3gg:ok" : "bo3gg:missing",
    projection: projectionRepairState.pending
      ? { status: 'repair-pending', lastErrorAt: projectionRepairState.lastErrorAt }
      : { status: 'ok' }
  });
});

// ========== END CS2 BETTING REST API ENDPOINTS ==========

// ========== CS2 BETTING SCHEDULED TASKS ==========

// Configuration for scheduled tasks
const CS2_SYNC_INTERVAL_MS = parseInt(process.env.CS2_SYNC_INTERVAL_MS || "1800000", 10); // 30 minutes default
const CS2_SETTLEMENT_INTERVAL_MS = parseInt(process.env.CS2_SETTLEMENT_INTERVAL_MS || "300000", 10); // 5 minutes default

let cs2SyncInterval = null;
let cs2SettlementInterval = null;

// Start scheduled tasks for CS2 betting
function startCS2ScheduledTasks() {
  if (!cs2Bo3ggClient) {
    console.log("[CS2 Tasks] bo3.gg client not available, skipping scheduled tasks");
    return;
  }

  if (cron) {
    // Schedule settlement check every 2 hours
    cs2SettlementInterval = cron.schedule("0 */2 * * *", async () => {
      if (shouldRunSettlementCheck()) {
        console.log("[CS2 Settlement] Periodic check: starting settlement...");
        await settleCS2Bets();
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

    // Keep live CS2 lines fresh. bo3.gg is free/no-key, so a 15-minute monitor is safe
    // and avoids stale match lists during active tournament windows.
    cs2SyncInterval = cron.schedule("*/15 * * * *", async () => {
      console.log("[CS2 Events] 15-minute live odds sync starting...");
      const result = await syncCS2Events({ forceRefresh: true });
      if (result) {
        console.log(`[CS2 Events] Live odds sync complete: ${result.newCount} new, ${result.updatedCount} updated, ${result.filteredCount} filtered`);
      } else {
        console.log("[CS2 Events] Live odds sync failed");
      }
    }, {
      scheduled: true,
      timezone: "UTC"
    });

    console.log("CS2 scheduled tasks started using node-cron:");
    console.log(`  - Event/live odds sync: every 15 minutes (bo3.gg)`);
    console.log(`  - Settlement check: every 2 hours`);
  } else {
    // Fallback to setInterval

    // Sync match/live odds data every 15 minutes
    cs2SyncInterval = setInterval(async () => {
      console.log("[CS2 Events] Scheduled 15-minute live odds sync starting...");
      const result = await syncCS2Events({ forceRefresh: true });
      if (result) {
        console.log(`[CS2 Events] Sync complete: ${result.newCount} new, ${result.updatedCount} updated, ${result.removedCount} removed`);
      }
    }, 15 * 60 * 1000);

    // Health watchdog: check every 30 minutes if there are enough upcoming matches
    setInterval(async () => {
      const upcomingCount = Object.values(cs2BettingState.events).filter(e => {
        const t = e.commenceTime || e.startTime;
        if (!t) return false;
        try { return new Date(t) > new Date() && e.status !== 'finished'; }
        catch { return false; }
      }).length;
      if (upcomingCount < 3) {
        console.log(`[CS2 Watchdog] Only ${upcomingCount} upcoming matches — forcing re-sync`);
        await syncCS2Events({ forceRefresh: true });
      }
    }, 30 * 60 * 1000);

    // Schedule settlement check every 30 minutes
    cs2SettlementInterval = setInterval(async () => {
      if (shouldRunSettlementCheck()) {
        console.log("[CS2 Settlement] Periodic check: starting settlement...");
        await settleCS2Bets();
      } else {
        const lastCheck = new Date(cs2BettingState.lastSettlementCheck);
        const now = new Date();
        const hoursSinceLastCheck = (now - lastCheck) / (1000 * 60 * 60);
        const hoursRemaining = Math.max(0, 2 - hoursSinceLastCheck);
        console.log(`[CS2 Settlement] ${hoursRemaining.toFixed(1)} hours until next settlement check`);
      }
    }, 30 * 60 * 1000);

    console.log("CS2 scheduled tasks started using setInterval:");
    console.log(`  - Event/live odds sync: every 15 minutes (bo3.gg)`);
    console.log(`  - Settlement check: every 30 minutes`);
  }
}

// Stop scheduled tasks (for graceful shutdown)
function stopCS2ScheduledTasks() {
  if (cs2StartupTimer) {
    clearTimeout(cs2StartupTimer);
    cs2StartupTimer = null;
  }
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

  console.log("CS2 scheduled tasks stopped");
}

let cs2StartupTimer = null;
const cs2TasksDisabled = process.env.CS2_SYNC_DISABLED === '1';

if (cs2TasksDisabled) {
  console.log('[CS2 Tasks] Scheduled sync and settlement disabled by environment');
} else {
  startCS2ScheduledTasks();

  // On-startup tasks (10s delay to allow full initialization)
  cs2StartupTimer = setTimeout(async () => {
    console.log("[CS2 Settlement] Performing initial settlement check on server start...");
    await settleCS2Bets();

    if (cs2Bo3ggClient) {
      if (!cs2ApiCache || Object.keys(cs2ApiCache.odds || {}).length === 0 && !cs2ApiCache.matches?.data) {
        console.log("[CS2 Sync] Waiting for cache to load...");
        await loadCS2ApiCache();
      }
      console.log("[CS2 Sync] Performing initial sync on server start...");
      await syncCS2Events();
    }
  }, 10000);
  cs2StartupTimer.unref?.();
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

async function handlePokerPlayerLeave(socketId, tableId) {
  const table = pokerTables[tableId];
  if (!table) return;

  const playerIndex = table.players.findIndex(p => p.socketId === socketId);
  if (playerIndex === -1) return;

  const player = table.players[playerIndex];
  
  // Return remaining chips to casino credits
  if (players[socketId] && player.escrowId) {
    try {
      await finishEscrow({ escrowId: player.escrowId, payout: player.chips,
        idempotencyKey: `poker:${player.escrowReference}:settle`, metadata: { tableId, reason: 'player_leave' } });
    } catch (error) {
      console.error("[Poker] Failed to persist returned chips:", error);
      io.to(socketId).emit("error", "Unable to leave table; chips were not transferred");
      return;
    }
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

  const fairRoundId = `poker_${crypto.randomUUID()}`;
  const fairContext = fairRng.consume('poker', fairRoundId, `${tableId}:${table.handNumber}`);
  let shuffleCounter = 0;
  const deck = pokerEngine.shuffleDeck(pokerEngine.createDeck(), max => fairRng.int(fairContext, max, shuffleCounter++));
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
    fairRoundId,
    fairnessCommitment: fairContext.commitment,
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
      // Record in bet history
      const handName = p.handResult ? p.handResult.name : 'Unknown';
      addBetRecord(p.username, { game: 'poker', bet: betAmount, result: won ? 'Win' : 'Loss', payout: won ? wonAmount : 0, multiplier: null, details: handName });
      
      // Emit achievement notifications
      if (newAchievements.length > 0) {
        io.to(p.socketId).emit('achievementUnlocked', newAchievements.map(id => ACHIEVEMENTS[id]));
      }
    }
  }
  
  broadcastPokerTableState(tableId);

  // Persist each player's current chip claim for deterministic restart recovery.
  const recoveryClaims = [];
  for (const p of hand.players) {
    const seatP = table.players.find(tp => tp.socketId === p.socketId);
    if (seatP) {
      seatP.chips = p.chips;
      if (seatP.escrowId) recoveryClaims.push({ escrowId: seatP.escrowId, payout: p.chips });
    }
  }
  if (recoveryClaims.length) casinoLedger.updateRecoveryPayouts(recoveryClaims);
  const pokerProof = fairRng.reveal(hand.fairRoundId, {
    tableId,
    handNumber: table.handNumber,
    deck: hand.deck,
    communityCards: hand.communityCards,
    winners: hand.winners
  });
  io.to(tableId).emit('pokerFairnessProof', pokerProof);

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

async function startServer() {
  await Promise.all([ledgerReadyPromise, betHistoryLoadedPromise, cs2StateLoadedPromise]);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Casino Server running on http://0.0.0.0:${PORT}`);
    console.log(`  - Roulette game available`);
    console.log(`  - Coinflip game available`);
    if (cs2Bo3ggClient) {
      console.log(`  - CS2 Betting available (REST API: /api/cs2/*, data: bo3.gg)`);
    }
  });
}

startServer().catch(error => {
  console.error('Casino server failed to start:', error);
  process.exit(1);
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  stopCS2ScheduledTasks();
  server.close(() => {
    casinoLedger.close();
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  stopCS2ScheduledTasks();
  server.close(() => {
    casinoLedger.close();
    console.log('Server closed');
    process.exit(0);
  });
});

