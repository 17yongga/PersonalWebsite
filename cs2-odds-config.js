/**
 * CS2 Odds Configuration
 * Configuration for multiple odds sources and aggregation strategies
 */

module.exports = {
  // Source configuration
  sources: {
    oddspapi: {
      enabled: false, // Disabled for odds - only used for match data (fixtures)
      priority: 999, // Lowest priority
      weight: 0.0, // No weight - not used for odds
      timeout: 5000,
      name: 'OddsPapi API',
      useForOdds: false // Explicitly mark as not for odds
    },
    multiSource: {
      enabled: true, // Primary source for odds - Multiple public APIs
      priority: 1, // Highest priority
      weight: 1.0, // Full weight
      timeout: 15000, // Allow time for multiple API calls
      name: 'Multi-Source Odds (HLTV + Betway + ESL + Pinnacle + Rankings)',
      sources: {
        hltv: { enabled: true, weight: 0.8, timeout: 8000 },
        betway: { enabled: true, weight: 0.9, timeout: 8000 },
        esl: { enabled: true, weight: 0.85, timeout: 8000 },
        pinnacle: { enabled: true, weight: 0.95, timeout: 8000 },
        rankings: { enabled: true, weight: 0.7, timeout: 1000 }
      }
    },
    gambling: {
      enabled: true, // Fallback source for odds - GG.bet
      priority: 2, // Lower priority (fallback)
      weight: 0.6, // Lower weight
      timeout: 8000, // Shorter timeout for fallback
      name: 'GG.bet (Fallback)',
      sites: {
        ggbet: {
          enabled: true,
          baseUrl: 'https://gg.bet',
          rateLimit: 3000
        }
      }
    }
  },

  // Aggregation strategy configuration
  aggregation: {
    strategy: 'best_available', // Since only one source, just use it directly
    minSources: 1, // Minimum number of sources required
    timeout: 15000, // Timeout for GG.bet scraping
    // Confidence calculation: based on number of sources
    confidenceThresholds: {
      high: 0.8, // 2+ sources (not applicable with single source)
      medium: 0.6, // 1 source (GG.bet)
      low: 0.4 // Fallback odds
    }
  },

  // Caching configuration
  cache: {
    enabled: true,
    ttl: 300000, // 5 minutes in milliseconds
    maxSize: 100 // Maximum number of cached odds entries
  },

  // User agent for web scraping (to appear as a browser)
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',

  // Retry configuration
  retry: {
    maxAttempts: 2,
    delay: 1000, // Initial delay in milliseconds
    backoffMultiplier: 2 // Exponential backoff multiplier
  }
};
