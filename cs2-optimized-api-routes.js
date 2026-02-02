/**
 * CS2 Optimized API Routes
 * 
 * Express router for the optimized CS2 betting system
 * Integrates all new modules:
 * - Static odds caching
 * - Free result sources
 * - Efficient match discovery
 * - Free settlement system
 * 
 * Use: const cs2Routes = require('./cs2-optimized-api-routes');
 *      app.use('/api/cs2', cs2Routes);
 */

const express = require('express');
const router = express.Router();

// Import optimized modules
const { staticOddsCache } = require('./cs2-static-odds-cache');
const { resultFetcher, hltvScraper } = require('./cs2-free-result-sources');
const { matchDiscovery } = require('./cs2-efficient-match-discovery');
const { freeSettlementSystem, startAutoSettlement } = require('./cs2-free-settlement-system');

// Initialize caches on load
let initialized = false;
async function ensureInitialized() {
  if (!initialized) {
    await staticOddsCache.init();
    initialized = true;
  }
}

// ============================================
// MATCH & ODDS ENDPOINTS
// ============================================

/**
 * GET /api/cs2/matches
 * Get all available matches with cached odds
 * NO API calls - uses only cached data
 */
router.get('/matches', async (req, res) => {
  try {
    await ensureInitialized();
    
    const matches = await matchDiscovery.getMatchesForDisplay({
      forceRefresh: req.query.refresh === 'true'
    });
    
    res.json({
      success: true,
      matches,
      count: matches.length,
      source: 'cache',
      cacheStats: staticOddsCache.getStats()
    });
  } catch (error) {
    console.error('[CS2 API] Error fetching matches:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      matches: []
    });
  }
});

/**
 * GET /api/cs2/events
 * Alias for /matches (backward compatibility)
 */
router.get('/events', async (req, res) => {
  return router.handle(
    Object.assign({}, req, { url: '/matches', query: req.query }),
    res
  );
});

/**
 * GET /api/cs2/odds/:matchId
 * Get odds for specific match
 * Uses cache - NO API call unless absolutely necessary
 */
router.get('/odds/:matchId', async (req, res) => {
  try {
    await ensureInitialized();
    
    const { matchId } = req.params;
    const cached = staticOddsCache.getOdds(matchId);
    
    if (cached && staticOddsCache.areOddsValid(cached.odds)) {
      return res.json({
        success: true,
        matchId,
        odds: cached.odds,
        teams: cached.teams,
        tournament: cached.tournament,
        startTime: cached.startTime,
        source: 'cache',
        cachedAt: cached.cachedAt
      });
    }
    
    // Return null odds if not in cache (don't make API call)
    res.json({
      success: true,
      matchId,
      odds: null,
      message: 'Odds not available in cache',
      source: 'cache_miss'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/cs2/discover
 * Trigger match discovery (admin/cron endpoint)
 * Makes minimal API calls for NEW matches only
 */
router.post('/discover', async (req, res) => {
  try {
    await ensureInitialized();
    
    const result = await matchDiscovery.discoverMatches();
    
    res.json({
      success: true,
      matches: result.matches.length,
      stats: result.stats,
      message: `Discovered ${result.stats.newMatchesDiscovered} new matches, ${result.stats.oddsFromCache} from cache`
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/cs2/sync
 * Light sync - uses cached data, minimal API calls
 */
router.get('/sync', async (req, res) => {
  try {
    await ensureInitialized();
    
    const stats = matchDiscovery.getStats();
    const shouldSync = !matchDiscovery.lastDiscoveryRun ||
      (Date.now() - matchDiscovery.lastDiscoveryRun > 15 * 60 * 1000);
    
    if (shouldSync) {
      await matchDiscovery.discoverMatches();
    }
    
    res.json({
      success: true,
      synced: shouldSync,
      stats: matchDiscovery.getStats()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// SETTLEMENT ENDPOINTS (FREE - No OddsPapi)
// ============================================

/**
 * POST /api/cs2/settle
 * Run settlement process (uses FREE sources)
 * NO API calls to OddsPapi
 */
router.post('/settle', async (req, res) => {
  try {
    const result = await freeSettlementSystem.runSettlement();
    
    res.json({
      success: true,
      ...result,
      message: `Settled ${result.settledBets} bets using FREE result sources`
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/cs2/settlement/status
 * Get settlement system status
 */
router.get('/settlement/status', async (req, res) => {
  try {
    const stats = freeSettlementSystem.getStats();
    const recentSettlements = freeSettlementSystem.getRecentSettlements(10);
    
    res.json({
      success: true,
      stats,
      recentSettlements
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/cs2/settlement/pending
 * Get summary of pending bets
 */
router.get('/settlement/pending', async (req, res) => {
  try {
    const summary = await freeSettlementSystem.getPendingBetsSummary();
    
    res.json({
      success: true,
      pendingMatches: summary,
      count: summary.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/cs2/settlement/manual
 * Manual settlement (admin endpoint)
 */
router.post('/settlement/manual', async (req, res) => {
  try {
    const { matchId, winner } = req.body;
    
    if (!matchId || !winner) {
      return res.status(400).json({
        success: false,
        error: 'matchId and winner are required'
      });
    }
    
    const result = await freeSettlementSystem.manualSettle(matchId, winner);
    
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// FREE RESULT SOURCES ENDPOINTS
// ============================================

/**
 * GET /api/cs2/results/recent
 * Get recent match results from HLTV (FREE)
 */
router.get('/results/recent', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const results = await resultFetcher.getRecentResults(limit);
    
    res.json({
      success: true,
      results,
      count: results.length,
      source: 'hltv_free'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/cs2/results/find
 * Find result for specific match (FREE)
 */
router.get('/results/find', async (req, res) => {
  try {
    const { team1, team2 } = req.query;
    
    if (!team1 || !team2) {
      return res.status(400).json({
        success: false,
        error: 'team1 and team2 query parameters required'
      });
    }
    
    const result = await resultFetcher.findMatchResult(team1, team2);
    
    res.json({
      success: true,
      found: !!result,
      result,
      source: result?.source || 'none'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/cs2/upcoming/hltv
 * Get upcoming matches from HLTV (FREE discovery)
 */
router.get('/upcoming/hltv', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const matches = await hltvScraper.getUpcomingMatches(limit);
    
    res.json({
      success: true,
      matches,
      count: matches.length,
      source: 'hltv_free'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// CACHE MANAGEMENT ENDPOINTS
// ============================================

/**
 * GET /api/cs2/cache/stats
 * Get cache statistics
 */
router.get('/cache/stats', async (req, res) => {
  try {
    await ensureInitialized();
    
    const cacheStats = staticOddsCache.getStats();
    const discoveryStats = matchDiscovery.getStats();
    const settlementStats = freeSettlementSystem.getStats();
    
    res.json({
      success: true,
      cache: cacheStats,
      discovery: discoveryStats,
      settlement: settlementStats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/cs2/cache/matches
 * Get all cached matches (admin view)
 */
router.get('/cache/matches', async (req, res) => {
  try {
    await ensureInitialized();
    
    const unsettled = staticOddsCache.getUnsettledMatches();
    const needsOdds = staticOddsCache.getMatchesNeedingOdds();
    
    res.json({
      success: true,
      unsettled: {
        count: unsettled.length,
        matches: unsettled
      },
      needsOdds: {
        count: needsOdds.length,
        matches: needsOdds
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// ADMIN ENDPOINTS
// ============================================

/**
 * POST /api/cs2/admin/start-auto-settlement
 * Start automatic settlement process
 */
router.post('/admin/start-auto-settlement', async (req, res) => {
  try {
    const intervalMinutes = parseInt(req.body.intervalMinutes) || 15;
    startAutoSettlement(intervalMinutes * 60 * 1000);
    
    res.json({
      success: true,
      message: `Auto-settlement started with ${intervalMinutes} minute interval`
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/cs2/admin/system-status
 * Get complete system status
 */
router.get('/admin/system-status', async (req, res) => {
  try {
    await ensureInitialized();
    
    res.json({
      success: true,
      status: 'operational',
      modules: {
        staticCache: {
          initialized: true,
          stats: staticOddsCache.getStats()
        },
        matchDiscovery: {
          initialized: true,
          lastRun: matchDiscovery.lastDiscoveryRun,
          apiCallsToday: matchDiscovery.apiCallsToday,
          apiCallLimit: matchDiscovery.apiCallLimit
        },
        settlement: {
          initialized: true,
          stats: freeSettlementSystem.getStats()
        },
        freeSources: {
          available: ['hltv', 'liquipedia']
        }
      },
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// BETTING ENDPOINTS (compatible with existing system)
// ============================================

const fs = require('fs').promises;
const path = require('path');
const BETTING_DATA_FILE = path.join(__dirname, 'cs2-betting-data.json');

async function loadBettingData() {
  try {
    const data = await fs.readFile(BETTING_DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return { events: {}, bets: {}, users: {} };
  }
}

async function saveBettingData(data) {
  await fs.writeFile(BETTING_DATA_FILE, JSON.stringify(data, null, 2));
}

/**
 * POST /api/cs2/bet
 * Place a new bet
 */
router.post('/bet', async (req, res) => {
  try {
    const { userId, eventId, selection, amount, odds } = req.body;
    
    if (!userId || !eventId || !selection || !amount || !odds) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userId, eventId, selection, amount, odds'
      });
    }
    
    const bettingData = await loadBettingData();
    
    // Initialize user if needed
    if (!bettingData.users) bettingData.users = {};
    if (!bettingData.users[userId]) {
      bettingData.users[userId] = {
        id: userId,
        balance: 10000,
        totalWagered: 0,
        betsPlaced: 0
      };
    }
    
    const user = bettingData.users[userId];
    const betAmount = parseFloat(amount);
    
    // Check balance
    if (user.balance < betAmount) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient balance'
      });
    }
    
    // Create bet
    const betId = `bet-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const bet = {
      id: betId,
      userId,
      eventId,
      selection,
      amount: betAmount,
      odds: parseFloat(odds),
      potentialPayout: betAmount * parseFloat(odds),
      status: 'pending',
      placedAt: new Date().toISOString()
    };
    
    // Update user balance
    user.balance -= betAmount;
    user.totalWagered = (user.totalWagered || 0) + betAmount;
    user.betsPlaced = (user.betsPlaced || 0) + 1;
    
    // Store bet
    if (!bettingData.bets) bettingData.bets = {};
    bettingData.bets[betId] = bet;
    
    await saveBettingData(bettingData);
    
    res.json({
      success: true,
      bet,
      newBalance: user.balance
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/cs2/bets
 * Get user's bets
 */
router.get('/bets', async (req, res) => {
  try {
    const { userId, status } = req.query;
    
    const bettingData = await loadBettingData();
    let userBets = Object.values(bettingData.bets || {});
    
    if (userId) {
      userBets = userBets.filter(b => b.userId === userId);
    }
    
    if (status) {
      userBets = userBets.filter(b => b.status === status);
    }
    
    // Sort by date, newest first
    userBets.sort((a, b) => new Date(b.placedAt) - new Date(a.placedAt));
    
    res.json({
      success: true,
      bets: userBets,
      count: userBets.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/cs2/balance
 * Get user's balance
 */
router.get('/balance', async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'userId is required'
      });
    }
    
    const bettingData = await loadBettingData();
    const user = bettingData.users?.[userId];
    
    if (!user) {
      // Return default balance for new users
      return res.json({
        success: true,
        balance: 10000,
        isNewUser: true
      });
    }
    
    res.json({
      success: true,
      balance: user.balance,
      totalWagered: user.totalWagered || 0,
      betsPlaced: user.betsPlaced || 0
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
