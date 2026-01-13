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
    gambling: {
      enabled: true, // Only source for odds - GG.bet
      priority: 1, // Only priority
      weight: 1.0, // Full weight since it's the only source
      timeout: 12000, // Scraping may take longer
      name: 'GG.bet',
      sites: {
        ggbet: {
          enabled: true, // Only gambling source - GG.bet
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
