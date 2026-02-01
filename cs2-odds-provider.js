/**
 * CS2 Odds Provider - Multi-Source Aggregator
 * Coordinates multiple odds sources and aggregates results
 * Provides unified interface matching cs2-api-client.js API
 */

const config = require('./cs2-odds-config');

// Import sources
let cs2ApiClient = null;
try {
  cs2ApiClient = require('./cs2-api-client');
} catch (error) {
  console.warn('[Odds Provider] cs2-api-client not available:', error.message);
}

let gamblingScraper = null;
try {
  gamblingScraper = require('./cs2-gambling-scraper');
} catch (error) {
  console.warn('[Odds Provider] Gambling scraper not available:', error.message);
  // This is OK - gambling scraper is optional
}

// Multi-source odds provider
let multiSourceOdds = null;
try {
  multiSourceOdds = require('./cs2-multi-source-odds');
  console.log('[Odds Provider] Multi-source odds provider loaded successfully');
} catch (error) {
  console.warn('[Odds Provider] Multi-source odds provider not available:', error.message);
}

// Simple in-memory cache
const oddsCache = new Map();
const CACHE_TTL = config.cache.ttl || 300000; // 5 minutes default

/**
 * Clear expired cache entries
 */
function cleanCache() {
  const now = Date.now();
  for (const [key, value] of oddsCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      oddsCache.delete(key);
    }
  }
  
  // Limit cache size
  if (oddsCache.size > config.cache.maxSize) {
    const entries = Array.from(oddsCache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toRemove = entries.slice(0, entries.length - config.cache.maxSize);
    toRemove.forEach(([key]) => oddsCache.delete(key));
  }
}

/**
 * Get cached odds
 * @param {string} key - Cache key (typically fixtureId)
 * @returns {Object|null} Cached odds or null
 */
function getCachedOdds(key) {
  if (!config.cache.enabled) {
    return null;
  }
  
  cleanCache();
  const cached = oddsCache.get(key);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return cached.data;
  }
  return null;
}

/**
 * Cache odds
 * @param {string} key - Cache key
 * @param {Object} data - Odds data to cache
 */
function setCachedOdds(key, data) {
  if (!config.cache.enabled) {
    return;
  }
  
  oddsCache.set(key, {
    data,
    timestamp: Date.now()
  });
}

/**
 * Fetch odds from OddsPapi
 * @param {string} fixtureId - Fixture ID
 * @returns {Promise<Object|null>} Odds object or null
 * 
 * Note: OddsPapi is disabled for odds retrieval - only used for match data
 */
async function fetchOddsPapiOdds(fixtureId) {
  // OddsPapi is disabled for odds - we only use it for match data
  // This function is kept for backwards compatibility but will not be called
  return null;
}

/**
 * Fetch odds from gambling sites (GG.bet only)
 * @param {Object} matchInfo - Match information
 * @returns {Promise<Object|null>} Odds object or null
 */
async function fetchGamblingOdds(matchInfo) {
  if (!gamblingScraper || !config.sources.gambling.enabled) {
    return null;
  }
  
  try {
    const odds = await Promise.race([
      gamblingScraper.getGamblingOdds(matchInfo),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), config.sources.gambling.timeout)
      )
    ]);
    
    return odds;
  } catch (error) {
    console.error(`[Odds Provider] Gambling sites error:`, error.message);
    return null;
  }
}

/**
 * Aggregate odds from multiple sources
 * @param {Array<Object>} oddsArray - Array of odds objects from different sources
 * @returns {Object|null} Aggregated odds or null
 */
function aggregateOdds(oddsArray) {
  // Filter out null/undefined entries
  const validOdds = oddsArray.filter(o => o && (o.team1 || o.team2));
  
  if (validOdds.length === 0) {
    return null;
  }
  
  const strategy = config.aggregation.strategy;
  const sources = validOdds.map(o => o.source);
  
  let team1Odds = null;
  let team2Odds = null;
  let drawOdds = null;
  
  switch (strategy) {
    case 'weighted_average':
      // Weighted average based on source weights
      let team1Sum = 0;
      let team1Weight = 0;
      let team2Sum = 0;
      let team2Weight = 0;
      let drawSum = 0;
      let drawWeight = 0;
      
      validOdds.forEach(odds => {
        const sourceConfig = config.sources[odds.source] || { weight: 0.33 };
        const weight = sourceConfig.weight || 0.33;
        
        if (odds.team1) {
          team1Sum += odds.team1 * weight;
          team1Weight += weight;
        }
        if (odds.team2) {
          team2Sum += odds.team2 * weight;
          team2Weight += weight;
        }
        if (odds.draw) {
          drawSum += odds.draw * weight;
          drawWeight += weight;
        }
      });
      
      team1Odds = team1Weight > 0 ? team1Sum / team1Weight : null;
      team2Odds = team2Weight > 0 ? team2Sum / team2Weight : null;
      drawOdds = drawWeight > 0 ? drawSum / drawWeight : null;
      break;
      
    case 'average':
      // Simple average
      const team1Values = validOdds.map(o => o.team1).filter(v => v !== null && v !== undefined);
      const team2Values = validOdds.map(o => o.team2).filter(v => v !== null && v !== undefined);
      const drawValues = validOdds.map(o => o.draw).filter(v => v !== null && v !== undefined);
      
      team1Odds = team1Values.length > 0 
        ? team1Values.reduce((a, b) => a + b, 0) / team1Values.length 
        : null;
      team2Odds = team2Values.length > 0 
        ? team2Values.reduce((a, b) => a + b, 0) / team2Values.length 
        : null;
      drawOdds = drawValues.length > 0 
        ? drawValues.reduce((a, b) => a + b, 0) / drawValues.length 
        : null;
      break;
      
    case 'median':
      // Median to reduce outlier impact
      const team1Sorted = validOdds.map(o => o.team1).filter(v => v !== null && v !== undefined).sort((a, b) => a - b);
      const team2Sorted = validOdds.map(o => o.team2).filter(v => v !== null && v !== undefined).sort((a, b) => a - b);
      const drawSorted = validOdds.map(o => o.draw).filter(v => v !== null && v !== undefined).sort((a, b) => a - b);
      
      team1Odds = team1Sorted.length > 0 
        ? team1Sorted[Math.floor(team1Sorted.length / 2)] 
        : null;
      team2Odds = team2Sorted.length > 0 
        ? team2Sorted[Math.floor(team2Sorted.length / 2)] 
        : null;
      drawOdds = drawSorted.length > 0 
        ? drawSorted[Math.floor(drawSorted.length / 2)] 
        : null;
      break;
      
    case 'best_available':
      // Use odds from highest priority source
      const sortedByPriority = validOdds.sort((a, b) => {
        const priorityA = config.sources[a.source]?.priority || 999;
        const priorityB = config.sources[b.source]?.priority || 999;
        return priorityA - priorityB;
      });
      
      const best = sortedByPriority[0];
      team1Odds = best.team1;
      team2Odds = best.team2;
      drawOdds = best.draw;
      break;
      
    default:
      // Default to weighted average
      return aggregateOdds(oddsArray); // Recursive call with weighted_average
  }
  
  // Calculate confidence based on number of sources
  const confidence = validOdds.length >= 2 
    ? config.aggregation.confidenceThresholds.high
    : config.aggregation.confidenceThresholds.medium;
  
  return {
    team1: team1Odds ? parseFloat(team1Odds.toFixed(2)) : null,
    team2: team2Odds ? parseFloat(team2Odds.toFixed(2)) : null,
    draw: drawOdds ? parseFloat(drawOdds.toFixed(2)) : null,
    sources: sources,
    confidence: confidence,
    timestamp: new Date().toISOString()
  };
}

/**
 * Fetch match odds from all sources and aggregate
 * @param {string} fixtureId - Fixture ID from OddsPapi
 * @param {Object} matchInfo - Additional match information (team names, etc.)
 * @returns {Promise<Object|null>} Aggregated odds or null
 */
async function fetchMatchOdds(fixtureId, matchInfo = {}) {
  // Check cache first
  const cached = getCachedOdds(fixtureId);
  if (cached) {
    console.log(`[Odds Provider] Using cached odds for ${fixtureId}`);
    return cached;
  }
  
  // Get match info if not provided
  let fullMatchInfo = { ...matchInfo, fixtureId };
  
  // Try multi-source odds provider first (HLTV, Betway, ESL, Pinnacle + ranking fallback)
  if (multiSourceOdds && (fullMatchInfo.team1 || fullMatchInfo.homeTeam)) {
    try {
      console.log(`[Odds Provider] Fetching odds from multiple sources...`);
      const odds = await Promise.race([
        multiSourceOdds.fetchMultiSourceOdds(fullMatchInfo),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Multi-source timeout')), config.aggregation.timeout)
        )
      ]);
      
      if (odds && (odds.team1 || odds.team2)) {
        // Cache the result
        setCachedOdds(fixtureId, odds);
        console.log(`[Odds Provider] ✓ Retrieved odds from ${odds.sourceCount} source(s): ${odds.sources.join(', ')}`);
        console.log(`[Odds Provider] Odds: ${odds.team1} / ${odds.team2} (confidence: ${odds.confidence})`);
        return odds;
      }
    } catch (error) {
      console.error(`[Odds Provider] Multi-source error:`, error.message);
    }
  }

  // Fallback to GG.bet scraper if multi-source fails
  if (config.sources.gambling.enabled && gamblingScraper && (fullMatchInfo.team1 || fullMatchInfo.homeTeam)) {
    try {
      console.log(`[Odds Provider] Trying GG.bet as fallback...`);
      const odds = await Promise.race([
        fetchGamblingOdds(fullMatchInfo),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('GG.bet timeout')), 8000)
        )
      ]);
      
      if (odds && (odds.team1 || odds.team2)) {
        // Format odds response (single source, no aggregation needed)
        const result = {
          team1: odds.team1 ? parseFloat(odds.team1.toFixed(2)) : null,
          team2: odds.team2 ? parseFloat(odds.team2.toFixed(2)) : null,
          draw: odds.draw ? parseFloat(odds.draw.toFixed(2)) : null,
          sources: ['ggbet'],
          confidence: config.aggregation.confidenceThresholds.medium,
          timestamp: new Date().toISOString()
        };
        
        // Cache the result
        setCachedOdds(fixtureId, result);
        console.log(`[Odds Provider] ✓ Retrieved fallback odds from GG.bet:`, result);
        return result;
      }
    } catch (error) {
      console.error(`[Odds Provider] GG.bet fallback error:`, error.message);
    }
  }
  
  // Final fallback - calculate based on team rankings
  if (multiSourceOdds) {
    try {
      const team1 = fullMatchInfo.team1 || fullMatchInfo.homeTeam || fullMatchInfo.participant1Name;
      const team2 = fullMatchInfo.team2 || fullMatchInfo.awayTeam || fullMatchInfo.participant2Name;
      
      if (team1 && team2) {
        console.log(`[Odds Provider] Using ranking-based fallback for ${team1} vs ${team2}...`);
        const rankingOdds = multiSourceOdds.calculateRankingBasedOdds(team1, team2);
        
        const fallbackOdds = {
          team1: rankingOdds.team1,
          team2: rankingOdds.team2,
          draw: null,
          sources: [rankingOdds.source],
          confidence: rankingOdds.confidence,
          fallback: true,
          rankData: {
            team1Rank: rankingOdds.team1Rank,
            team2Rank: rankingOdds.team2Rank,
            rankDiff: rankingOdds.rankDiff
          },
          timestamp: new Date().toISOString()
        };
        
        setCachedOdds(fixtureId, fallbackOdds);
        console.log(`[Odds Provider] ✓ Calculated ranking-based odds: ${fallbackOdds.team1} / ${fallbackOdds.team2} (ranks: ${rankingOdds.team1Rank} vs ${rankingOdds.team2Rank})`);
        return fallbackOdds;
      }
    } catch (error) {
      console.error(`[Odds Provider] Ranking fallback error:`, error.message);
    }
  }
  
  // Ultimate fallback - generic odds
  console.log(`[Odds Provider] All sources failed, using generic fallback odds`);
  const genericFallback = {
    team1: 1.85,
    team2: 1.85,
    draw: null,
    sources: ['generic_fallback'],
    confidence: 0.2,
    timestamp: new Date().toISOString()
  };
  setCachedOdds(fixtureId, genericFallback);
  return genericFallback;
}

/**
 * Get available sources
 * @returns {Array<string>} List of available source names
 */
function getAvailableSources() {
  const sources = [];
  // Only GG.bet is used for odds retrieval
  if (gamblingScraper && config.sources.gambling.enabled) sources.push('ggbet');
  return sources;
}

/**
 * Wrapper to match cs2-api-client.js interface
 * This allows drop-in replacement
 */
async function fetchMatchOddsWrapper(fixtureId) {
  // This is called from casino-server.js with just fixtureId
  // We need to get match info from the events state
  // For now, return the aggregated odds (will need match info for scraping)
  
  const odds = await fetchMatchOdds(fixtureId);
  
  if (!odds) {
    return null;
  }
  
  // Return in format matching cs2-api-client.js
  return {
    id: fixtureId,
    fixtureId: fixtureId,
    odds: {
      team1: odds.team1,
      team2: odds.team2,
      draw: odds.draw
    },
    hasOdds: !!(odds.team1 || odds.team2),
    sources: odds.sources,
    confidence: odds.confidence,
    lastUpdate: odds.timestamp
  };
}

module.exports = {
  fetchMatchOdds,
  fetchMatchOddsWrapper, // For compatibility with existing code
  aggregateOdds,
  getAvailableSources,
  // Re-export for compatibility
  fetchUpcomingMatches: cs2ApiClient ? cs2ApiClient.fetchUpcomingMatches : null,
  fetchMatchResults: cs2ApiClient ? cs2ApiClient.fetchMatchResults : null,
  findCS2SportId: cs2ApiClient ? cs2ApiClient.findCS2SportId : null
};
