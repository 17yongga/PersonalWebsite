#!/usr/bin/env node

/**
 * CS2 Performance Caching System
 * Implements intelligent caching for API responses to improve performance
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class CS2PerformanceCache {
  constructor() {
    this.cacheDir = './cache/';
    this.config = {
      // Cache TTL settings (in milliseconds)
      ttl: {
        matches: 2 * 60 * 1000,        // 2 minutes for live matches
        odds: 1 * 60 * 1000,           // 1 minute for odds
        results: 60 * 60 * 1000,       // 1 hour for match results
        teams: 24 * 60 * 60 * 1000,    // 24 hours for team data
        static: 7 * 24 * 60 * 60 * 1000 // 7 days for static data
      },
      
      // Cache size limits
      maxCacheSize: 50 * 1024 * 1024, // 50 MB max cache size
      maxEntries: 1000,                // Max 1000 cache entries
      
      // Cache cleanup settings
      cleanupInterval: 30 * 60 * 1000, // Cleanup every 30 minutes
      cleanupThreshold: 0.8             // Clean when 80% full
    };
    
    this.stats = {
      hits: 0,
      misses: 0,
      stores: 0,
      evictions: 0,
      totalSize: 0
    };
    
    this.memoryCache = new Map(); // In-memory cache for fastest access
    this.init();
  }

  async init() {
    // Create cache directory
    await fs.mkdir(this.cacheDir, { recursive: true });
    
    // Load existing cache stats
    await this.loadCacheStats();
    
    // Start periodic cleanup
    setInterval(() => this.cleanup(), this.config.cleanupInterval);
    
    console.log('📦 CS2 Performance Cache initialized');
  }

  // Generate cache key from URL and parameters
  generateCacheKey(url, params = {}) {
    const keyData = { url, params: JSON.stringify(params) };
    return crypto.createHash('md5').update(JSON.stringify(keyData)).digest('hex');
  }

  // Get cached response
  async get(cacheKey, cacheType = 'matches') {
    try {
      // First check memory cache
      const memoryEntry = this.memoryCache.get(cacheKey);
      if (memoryEntry && !this.isExpired(memoryEntry, cacheType)) {
        this.stats.hits++;
        console.log(`🎯 Cache HIT (memory): ${cacheKey.substring(0, 8)}...`);
        return memoryEntry.data;
      }

      // Check disk cache
      const diskPath = path.join(this.cacheDir, `${cacheKey}.json`);
      try {
        const diskData = await fs.readFile(diskPath, 'utf-8');
        const entry = JSON.parse(diskData);
        
        if (!this.isExpired(entry, cacheType)) {
          // Promote to memory cache
          this.memoryCache.set(cacheKey, entry);
          this.stats.hits++;
          console.log(`🎯 Cache HIT (disk): ${cacheKey.substring(0, 8)}...`);
          return entry.data;
        } else {
          // Clean up expired disk entry
          await fs.unlink(diskPath);
        }
      } catch (diskError) {
        // Disk cache miss is normal
      }

      this.stats.misses++;
      console.log(`❌ Cache MISS: ${cacheKey.substring(0, 8)}...`);
      return null;

    } catch (error) {
      console.error(`Cache get error for ${cacheKey}:`, error.message);
      this.stats.misses++;
      return null;
    }
  }

  // Store response in cache
  async set(cacheKey, data, cacheType = 'matches') {
    try {
      const entry = {
        data,
        timestamp: Date.now(),
        type: cacheType,
        size: JSON.stringify(data).length
      };

      // Store in memory cache
      this.memoryCache.set(cacheKey, entry);
      
      // Store on disk for persistence
      const diskPath = path.join(this.cacheDir, `${cacheKey}.json`);
      await fs.writeFile(diskPath, JSON.stringify(entry, null, 2));
      
      this.stats.stores++;
      this.stats.totalSize += entry.size;
      
      console.log(`💾 Cache STORE: ${cacheKey.substring(0, 8)}... (${entry.size} bytes)`);
      
      // Check if we need cleanup
      if (this.memoryCache.size > this.config.maxEntries * this.config.cleanupThreshold) {
        await this.cleanup();
      }

    } catch (error) {
      console.error(`Cache set error for ${cacheKey}:`, error.message);
    }
  }

  // Check if cache entry is expired
  isExpired(entry, cacheType) {
    if (!entry || !entry.timestamp) return true;
    
    const ttl = this.config.ttl[cacheType] || this.config.ttl.matches;
    const age = Date.now() - entry.timestamp;
    
    return age > ttl;
  }

  // Clean up expired cache entries
  async cleanup() {
    console.log('🧹 Running cache cleanup...');
    
    let cleaned = 0;
    let freedSize = 0;
    
    // Clean memory cache
    for (const [key, entry] of this.memoryCache.entries()) {
      if (this.isExpired(entry, entry.type)) {
        freedSize += entry.size || 0;
        this.memoryCache.delete(key);
        cleaned++;
      }
    }
    
    // Clean disk cache
    try {
      const files = await fs.readdir(this.cacheDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        try {
          const filePath = path.join(this.cacheDir, file);
          const data = await fs.readFile(filePath, 'utf-8');
          const entry = JSON.parse(data);
          
          if (this.isExpired(entry, entry.type)) {
            await fs.unlink(filePath);
            cleaned++;
          }
        } catch (fileError) {
          // Clean up corrupted files
          await fs.unlink(path.join(this.cacheDir, file));
          cleaned++;
        }
      }
    } catch (dirError) {
      console.error('Cache directory cleanup error:', dirError.message);
    }
    
    this.stats.evictions += cleaned;
    this.stats.totalSize -= freedSize;
    
    console.log(`🧹 Cleanup complete: ${cleaned} entries removed, ${(freedSize / 1024).toFixed(1)}KB freed`);
  }

  // Get cache statistics
  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0 
      ? ((this.stats.hits / (this.stats.hits + this.stats.misses)) * 100).toFixed(1)
      : '0.0';

    return {
      ...this.stats,
      hitRate: parseFloat(hitRate),
      memoryEntries: this.memoryCache.size,
      totalSizeMB: (this.stats.totalSize / (1024 * 1024)).toFixed(2)
    };
  }

  // Load cache statistics
  async loadCacheStats() {
    try {
      const statsPath = path.join(this.cacheDir, 'stats.json');
      const data = await fs.readFile(statsPath, 'utf-8');
      const savedStats = JSON.parse(data);
      this.stats = { ...this.stats, ...savedStats };
    } catch (error) {
      // No existing stats, start fresh
    }
  }

  // Save cache statistics
  async saveCacheStats() {
    try {
      const statsPath = path.join(this.cacheDir, 'stats.json');
      await fs.writeFile(statsPath, JSON.stringify(this.stats, null, 2));
    } catch (error) {
      console.error('Error saving cache stats:', error.message);
    }
  }

  // Clear all cache
  async clear() {
    console.log('🗑️ Clearing all cache...');
    
    // Clear memory
    this.memoryCache.clear();
    
    // Clear disk
    try {
      const files = await fs.readdir(this.cacheDir);
      for (const file of files) {
        if (file.endsWith('.json') && file !== 'stats.json') {
          await fs.unlink(path.join(this.cacheDir, file));
        }
      }
    } catch (error) {
      console.error('Error clearing disk cache:', error.message);
    }
    
    // Reset stats (except historical)
    this.stats.totalSize = 0;
    console.log('✅ Cache cleared successfully');
  }
}

// Enhanced API Client with Caching
class CachedAPIClient {
  constructor() {
    this.cache = new CS2PerformanceCache();
    this.axios = require('axios');
  }

  // Cached API request wrapper
  async request(url, options = {}, cacheType = 'matches') {
    const { useCache = true, ...axiosOptions } = options;
    
    if (!useCache) {
      return this.directRequest(url, axiosOptions);
    }

    const cacheKey = this.cache.generateCacheKey(url, axiosOptions);
    
    // Try cache first
    const cachedResponse = await this.cache.get(cacheKey, cacheType);
    if (cachedResponse) {
      return cachedResponse;
    }

    // Make API request
    const response = await this.directRequest(url, axiosOptions);
    
    // Cache the response
    if (response && !response.error) {
      await this.cache.set(cacheKey, response, cacheType);
    }

    return response;
  }

  // Direct API request without caching
  async directRequest(url, options = {}) {
    try {
      const response = await this.axios.request({ url, ...options });
      return response.data;
    } catch (error) {
      console.error(`API request failed for ${url}:`, error.message);
      return { error: error.message, status: error.response?.status };
    }
  }

  // Get cache statistics
  getCacheStats() {
    return this.cache.getStats();
  }

  // Clear cache
  async clearCache() {
    return this.cache.clear();
  }
}

// Performance monitoring middleware
function createPerformanceMiddleware(cache) {
  return {
    // Wrap existing API functions with caching
    wrapAPIFunction: (originalFunction, cacheType = 'matches') => {
      return async function(...args) {
        const startTime = Date.now();
        
        try {
          // Try to generate cache key from function name and args
          const functionName = originalFunction.name || 'unknown';
          const cacheKey = cache.generateCacheKey(functionName, args);
          
          // Check cache
          const cachedResult = await cache.get(cacheKey, cacheType);
          if (cachedResult) {
            const duration = Date.now() - startTime;
            console.log(`⚡ ${functionName} cached response in ${duration}ms`);
            return cachedResult;
          }

          // Execute original function
          const result = await originalFunction.apply(this, args);
          const duration = Date.now() - startTime;
          
          // Cache successful results
          if (result && !result.error) {
            await cache.set(cacheKey, result, cacheType);
          }

          console.log(`🐌 ${functionName} fresh response in ${duration}ms`);
          return result;

        } catch (error) {
          console.error(`Performance middleware error in ${originalFunction.name}:`, error.message);
          throw error;
        }
      };
    }
  };
}

// Export for use in other modules
module.exports = {
  CS2PerformanceCache,
  CachedAPIClient,
  createPerformanceMiddleware
};

// CLI testing
if (require.main === module) {
  async function testCache() {
    console.log('🧪 Testing CS2 Performance Cache\n');
    
    const cache = new CS2PerformanceCache();
    await cache.init();
    
    // Test cache operations
    const testKey = 'test-match-123';
    const testData = { match: 'Team1 vs Team2', score: '16-12', winner: 'Team1' };
    
    // Store
    await cache.set(testKey, testData, 'matches');
    
    // Retrieve
    const retrieved = await cache.get(testKey, 'matches');
    console.log('Retrieved:', retrieved);
    
    // Stats
    const stats = cache.getStats();
    console.log('\n📊 Cache Stats:', stats);
    
    console.log('\n✅ Cache test complete!');
  }
  
  testCache().catch(console.error);
}