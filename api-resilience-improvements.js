// CS2 Betting API Resilience & Backup System
// Created: January 31, 2026 - 2:00 AM EST (Overnight Proactive Work)

class OddsApiResilience {
  constructor() {
    this.primaryKey = process.env.ODDS_API_KEY;
    this.backupKeys = [
      process.env.ODDS_API_BACKUP_1,
      process.env.ODDS_API_BACKUP_2,
      process.env.ODDS_API_BACKUP_3
    ].filter(key => key && key.trim() !== '');
    
    this.currentKeyIndex = 0;
    this.requestCounts = new Map();
    this.failureCounts = new Map();
    this.lastResetTime = Date.now();
    this.rateLimitWindow = 60000; // 1 minute
    this.maxRequestsPerKey = 500; // OddsPapi limit
    this.maxFailuresBeforeRotation = 3;
    
    this.initializeMonitoring();
  }

  // RESILIENCE FEATURE 1: Smart API Key Rotation
  getCurrentApiKey() {
    const allKeys = [this.primaryKey, ...this.backupKeys];
    
    // Check if current key has hit rate limit or failure threshold
    const currentKey = allKeys[this.currentKeyIndex];
    const requestCount = this.requestCounts.get(currentKey) || 0;
    const failureCount = this.failureCounts.get(currentKey) || 0;
    
    // Reset counters every window
    if (Date.now() - this.lastResetTime > this.rateLimitWindow) {
      this.resetCounters();
    }
    
    // Rotate to next key if current one is problematic
    if (requestCount >= this.maxRequestsPerKey || 
        failureCount >= this.maxFailuresBeforeRotation) {
      this.rotateToNextKey();
      return allKeys[this.currentKeyIndex];
    }
    
    return currentKey;
  }

  rotateToNextKey() {
    const allKeys = [this.primaryKey, ...this.backupKeys];
    this.currentKeyIndex = (this.currentKeyIndex + 1) % allKeys.length;
    
    console.log(`[API Resilience] Rotating to backup key #${this.currentKeyIndex}`);
    
    // Log to monitoring system
    this.logKeyRotation(this.currentKeyIndex);
  }

  resetCounters() {
    this.requestCounts.clear();
    this.failureCounts.clear();
    this.lastResetTime = Date.now();
  }

  // RESILIENCE FEATURE 2: Request Monitoring & Analytics
  recordRequest(apiKey, success = true, responseTime = null) {
    // Update request count
    const currentCount = this.requestCounts.get(apiKey) || 0;
    this.requestCounts.set(apiKey, currentCount + 1);
    
    if (!success) {
      const failureCount = this.failureCounts.get(apiKey) || 0;
      this.failureCounts.set(apiKey, failureCount + 1);
    }
    
    // Store metrics for monitoring
    this.storeMetrics(apiKey, success, responseTime);
  }

  storeMetrics(apiKey, success, responseTime) {
    const timestamp = Date.now();
    const metrics = {
      timestamp,
      keyIndex: this.getKeyIndex(apiKey),
      success,
      responseTime,
      totalRequests: this.getTotalRequests(),
      errorRate: this.getErrorRate()
    };
    
    // Store in persistent storage for analysis
    this.persistMetrics(metrics);
  }

  // RESILIENCE FEATURE 3: Circuit Breaker Pattern
  async makeResilientRequest(url, options = {}) {
    const maxRetries = 3;
    let lastError = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const apiKey = this.getCurrentApiKey();
      const startTime = Date.now();
      
      try {
        // Add API key to request
        const requestOptions = {
          ...options,
          headers: {
            ...options.headers,
            'x-rapidapi-key': apiKey,
            'x-rapidapi-host': 'odds-api-papi-1.p.rapidapi.com'
          }
        };
        
        const response = await fetch(url, requestOptions);
        const responseTime = Date.now() - startTime;
        
        // Handle rate limiting
        if (response.status === 429) {
          console.log(`[API Resilience] Rate limit hit for key, rotating...`);
          this.recordRequest(apiKey, false, responseTime);
          this.rotateToNextKey();
          
          if (attempt < maxRetries - 1) {
            await this.exponentialBackoff(attempt);
            continue;
          }
        }
        
        // Handle other errors
        if (!response.ok) {
          throw new Error(`API request failed: ${response.status} ${response.statusText}`);
        }
        
        this.recordRequest(apiKey, true, responseTime);
        return response;
        
      } catch (error) {
        lastError = error;
        const responseTime = Date.now() - startTime;
        
        console.error(`[API Resilience] Attempt ${attempt + 1} failed:`, error.message);
        this.recordRequest(apiKey, false, responseTime);
        
        if (attempt < maxRetries - 1) {
          await this.exponentialBackoff(attempt);
        }
      }
    }
    
    throw new Error(`All API requests failed after ${maxRetries} attempts. Last error: ${lastError?.message}`);
  }

  async exponentialBackoff(attempt) {
    const delay = Math.min(1000 * Math.pow(2, attempt), 10000); // Max 10 seconds
    console.log(`[API Resilience] Waiting ${delay}ms before retry...`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  // RESILIENCE FEATURE 4: Cached Fallback Data
  async getWithFallback(cacheKey, fetchFunction, maxAge = 300000) { // 5 minutes
    try {
      // Try to get fresh data
      const freshData = await fetchFunction();
      
      // Cache the successful response
      this.setCachedData(cacheKey, freshData);
      return freshData;
      
    } catch (error) {
      console.warn(`[API Resilience] Fresh data failed, checking cache:`, error.message);
      
      // Try to get cached data
      const cachedData = this.getCachedData(cacheKey, maxAge);
      if (cachedData) {
        console.log(`[API Resilience] Serving cached data for ${cacheKey}`);
        return cachedData;
      }
      
      // No cache available, throw original error
      throw error;
    }
  }

  setCachedData(key, data) {
    const cacheEntry = {
      data,
      timestamp: Date.now()
    };
    
    // Store in memory cache (in production, use Redis)
    this.cache = this.cache || new Map();
    this.cache.set(key, cacheEntry);
    
    // Also store in file system for persistence
    try {
      const fs = require('fs');
      const cacheDir = './cache';
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir);
      }
      fs.writeFileSync(`${cacheDir}/${key}.json`, JSON.stringify(cacheEntry));
    } catch (error) {
      console.error('[API Resilience] Failed to persist cache:', error);
    }
  }

  getCachedData(key, maxAge) {
    // Try memory cache first
    this.cache = this.cache || new Map();
    let cacheEntry = this.cache.get(key);
    
    // Try file system cache if not in memory
    if (!cacheEntry) {
      try {
        const fs = require('fs');
        const cacheFile = `./cache/${key}.json`;
        if (fs.existsSync(cacheFile)) {
          cacheEntry = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
          // Load back into memory
          this.cache.set(key, cacheEntry);
        }
      } catch (error) {
        console.error('[API Resilience] Failed to read cache:', error);
        return null;
      }
    }
    
    if (!cacheEntry) return null;
    
    // Check if cache is still valid
    const age = Date.now() - cacheEntry.timestamp;
    if (age > maxAge) {
      this.cache.delete(key);
      return null;
    }
    
    return cacheEntry.data;
  }

  // RESILIENCE FEATURE 5: Health Monitoring Dashboard
  getHealthStatus() {
    const allKeys = [this.primaryKey, ...this.backupKeys];
    const status = {
      timestamp: Date.now(),
      currentKeyIndex: this.currentKeyIndex,
      totalKeys: allKeys.length,
      windowStats: {
        totalRequests: this.getTotalRequests(),
        errorRate: this.getErrorRate(),
        averageResponseTime: this.getAverageResponseTime()
      },
      keyStats: allKeys.map((key, index) => ({
        index,
        isActive: index === this.currentKeyIndex,
        requests: this.requestCounts.get(key) || 0,
        failures: this.failureCounts.get(key) || 0,
        healthScore: this.calculateKeyHealthScore(key)
      }))
    };
    
    return status;
  }

  calculateKeyHealthScore(apiKey) {
    const requests = this.requestCounts.get(apiKey) || 0;
    const failures = this.failureCounts.get(apiKey) || 0;
    
    if (requests === 0) return 1.0; // Perfect score for unused keys
    
    const successRate = (requests - failures) / requests;
    const usageRate = requests / this.maxRequestsPerKey;
    
    // Health score considers both success rate and usage
    return Math.max(0, successRate * (1 - usageRate * 0.3));
  }

  // RESILIENCE FEATURE 6: Load Testing Simulation
  async runLoadTest(durationMs = 60000, requestsPerSecond = 10) {
    console.log(`[API Resilience] Starting load test: ${requestsPerSecond} req/sec for ${durationMs/1000}s`);
    
    const startTime = Date.now();
    const results = [];
    let requestCount = 0;
    
    const testInterval = setInterval(async () => {
      if (Date.now() - startTime > durationMs) {
        clearInterval(testInterval);
        this.analyzeLoadTestResults(results);
        return;
      }
      
      // Simulate multiple concurrent requests
      const promises = Array(requestsPerSecond).fill().map(async () => {
        const requestStart = Date.now();
        try {
          // Simulate API call
          await this.makeResilientRequest('https://httpbin.org/delay/0.1');
          results.push({
            requestId: ++requestCount,
            success: true,
            responseTime: Date.now() - requestStart,
            timestamp: Date.now()
          });
        } catch (error) {
          results.push({
            requestId: ++requestCount,
            success: false,
            error: error.message,
            responseTime: Date.now() - requestStart,
            timestamp: Date.now()
          });
        }
      });
      
      await Promise.allSettled(promises);
    }, 1000);
  }

  analyzeLoadTestResults(results) {
    const totalRequests = results.length;
    const successfulRequests = results.filter(r => r.success).length;
    const failedRequests = totalRequests - successfulRequests;
    const avgResponseTime = results.reduce((sum, r) => sum + r.responseTime, 0) / totalRequests;
    
    const report = {
      summary: {
        totalRequests,
        successfulRequests,
        failedRequests,
        successRate: (successfulRequests / totalRequests * 100).toFixed(2) + '%',
        avgResponseTime: Math.round(avgResponseTime) + 'ms'
      },
      keyRotations: this.getKeyRotationHistory(),
      recommendations: this.generateLoadTestRecommendations(results)
    };
    
    console.log('[API Resilience] Load Test Results:', JSON.stringify(report, null, 2));
    return report;
  }

  generateLoadTestRecommendations(results) {
    const recommendations = [];
    
    const avgResponseTime = results.reduce((sum, r) => sum + r.responseTime, 0) / results.length;
    if (avgResponseTime > 1000) {
      recommendations.push('Consider adding response time-based circuit breaker');
    }
    
    const errorRate = results.filter(r => !r.success).length / results.length;
    if (errorRate > 0.05) {
      recommendations.push('High error rate detected - review key rotation thresholds');
    }
    
    if (this.getKeyRotationHistory().length > 5) {
      recommendations.push('Frequent key rotations - consider increasing backup keys');
    }
    
    return recommendations;
  }

  // UTILITY METHODS
  getTotalRequests() {
    return Array.from(this.requestCounts.values()).reduce((sum, count) => sum + count, 0);
  }

  getErrorRate() {
    const totalRequests = this.getTotalRequests();
    const totalFailures = Array.from(this.failureCounts.values()).reduce((sum, count) => sum + count, 0);
    return totalRequests > 0 ? totalFailures / totalRequests : 0;
  }

  getAverageResponseTime() {
    // This would need to be calculated from stored response times
    return this.averageResponseTime || 0;
  }

  getKeyIndex(apiKey) {
    return [this.primaryKey, ...this.backupKeys].indexOf(apiKey);
  }

  getKeyRotationHistory() {
    return this.keyRotationHistory || [];
  }

  logKeyRotation(keyIndex) {
    this.keyRotationHistory = this.keyRotationHistory || [];
    this.keyRotationHistory.push({
      timestamp: Date.now(),
      fromKey: this.currentKeyIndex,
      toKey: keyIndex,
      reason: 'rate_limit_or_failures'
    });
    
    // Keep only last 100 rotations
    if (this.keyRotationHistory.length > 100) {
      this.keyRotationHistory = this.keyRotationHistory.slice(-100);
    }
  }

  persistMetrics(metrics) {
    // In production, send to monitoring service (CloudWatch, DataDog, etc.)
    console.log('[API Resilience] Metrics:', JSON.stringify(metrics));
  }

  initializeMonitoring() {
    // Set up periodic health checks
    setInterval(() => {
      const health = this.getHealthStatus();
      if (health.windowStats.errorRate > 0.1) {
        console.warn('[API Resilience] High error rate detected:', health.windowStats.errorRate);
      }
    }, 30000); // Every 30 seconds
  }
}

// Integration with existing CS2 system
class EnhancedCS2ApiClient {
  constructor(existingClient) {
    this.originalClient = existingClient;
    this.resilience = new OddsApiResilience();
  }

  async fetchMatchesWithResilience() {
    return this.resilience.getWithFallback(
      'cs2_matches',
      async () => {
        const response = await this.resilience.makeResilientRequest(
          'https://odds-api-papi-1.p.rapidapi.com/v1/odds',
          {
            method: 'GET'
          }
        );
        return response.json();
      },
      300000 // 5 minute cache
    );
  }

  async fetchOddsWithResilience(matchId) {
    return this.resilience.getWithFallback(
      `cs2_odds_${matchId}`,
      async () => {
        const response = await this.resilience.makeResilientRequest(
          `https://odds-api-papi-1.p.rapidapi.com/v1/odds/${matchId}`,
          {
            method: 'GET'
          }
        );
        return response.json();
      },
      120000 // 2 minute cache for odds (more time-sensitive)
    );
  }

  getResilienceStatus() {
    return this.resilience.getHealthStatus();
  }

  async runResilienceLoadTest() {
    return this.resilience.runLoadTest(60000, 5); // 5 req/sec for 1 minute
  }
}

// Export for integration
module.exports = {
  OddsApiResilience,
  EnhancedCS2ApiClient
};

// Add health endpoint for monitoring
if (typeof app !== 'undefined') {
  app.get('/api/cs2/resilience/status', (req, res) => {
    const status = global.cs2ResilienceSystem?.getHealthStatus() || { error: 'Not initialized' };
    res.json(status);
  });

  app.get('/api/cs2/resilience/test', async (req, res) => {
    try {
      const results = await global.cs2ResilienceSystem?.runResilienceLoadTest();
      res.json({ success: true, results });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
}