#!/usr/bin/env node

/**
 * CS2 Performance Monitoring & Optimization System
 * Real-time performance tracking, cache analysis, and optimization reporting
 * February 2, 2026
 */

const fs = require('fs').promises;
const path = require('path');

class CS2PerformanceMonitor {
  constructor() {
    this.metricsHistory = [];
    this.alerts = [];
    this.thresholds = {
      cacheHitRateMin: 80, // Minimum 80% cache hit rate
      responseTimeMax: 500, // Max 500ms response time
      errorRateMax: 5, // Max 5% error rate
      uptimeMin: 99.5 // Minimum 99.5% uptime
    };
    
    this.currentMetrics = {
      timestamp: Date.now(),
      cacheStats: {
        hits: 0,
        misses: 0,
        hitRate: 0,
        totalSize: 0,
        memoryEntries: 0
      },
      performance: {
        avgResponseTime: 0,
        p95ResponseTime: 0,
        requestCount: 0,
        errorCount: 0,
        errorRate: 0
      },
      system: {
        uptime: 0,
        memoryUsage: 0,
        cpuUsage: 0
      }
    };
    
    this.startTime = Date.now();
    this.responseTimes = [];
    
    console.log('📊 CS2 Performance Monitor initialized');
  }

  // Record API response time
  recordResponseTime(duration, success = true) {
    this.responseTimes.push({
      duration,
      success,
      timestamp: Date.now()
    });

    // Keep only last 1000 response times
    if (this.responseTimes.length > 1000) {
      this.responseTimes = this.responseTimes.slice(-1000);
    }

    this.currentMetrics.performance.requestCount++;
    if (!success) {
      this.currentMetrics.performance.errorCount++;
    }

    this.updatePerformanceMetrics();
  }

  // Update performance calculations
  updatePerformanceMetrics() {
    if (this.responseTimes.length === 0) return;

    const recentResponses = this.responseTimes.filter(r => 
      Date.now() - r.timestamp < 5 * 60 * 1000 // Last 5 minutes
    );

    if (recentResponses.length === 0) return;

    const durations = recentResponses.map(r => r.duration);
    const successful = recentResponses.filter(r => r.success);

    // Calculate metrics
    this.currentMetrics.performance.avgResponseTime = 
      durations.reduce((a, b) => a + b, 0) / durations.length;
    
    // Calculate 95th percentile
    const sortedDurations = durations.sort((a, b) => a - b);
    const p95Index = Math.floor(sortedDurations.length * 0.95);
    this.currentMetrics.performance.p95ResponseTime = sortedDurations[p95Index] || 0;

    // Error rate
    this.currentMetrics.performance.errorRate = 
      ((recentResponses.length - successful.length) / recentResponses.length) * 100;
  }

  // Update cache statistics
  updateCacheStats(cacheStats) {
    this.currentMetrics.cacheStats = {
      ...cacheStats,
      hitRate: parseFloat(cacheStats.hitRate) || 0
    };
  }

  // Update system metrics
  updateSystemMetrics() {
    this.currentMetrics.system.uptime = Date.now() - this.startTime;
    
    // Get memory usage
    if (typeof process !== 'undefined') {
      const memUsage = process.memoryUsage();
      this.currentMetrics.system.memoryUsage = memUsage.heapUsed / (1024 * 1024); // MB
    }
  }

  // Check performance against thresholds
  checkThresholds() {
    const alerts = [];
    const metrics = this.currentMetrics;

    // Cache hit rate
    if (metrics.cacheStats.hitRate < this.thresholds.cacheHitRateMin) {
      alerts.push({
        type: 'cache_hit_rate',
        severity: 'warning',
        message: `Cache hit rate ${metrics.cacheStats.hitRate.toFixed(1)}% below threshold ${this.thresholds.cacheHitRateMin}%`,
        value: metrics.cacheStats.hitRate,
        threshold: this.thresholds.cacheHitRateMin
      });
    }

    // Response time
    if (metrics.performance.avgResponseTime > this.thresholds.responseTimeMax) {
      alerts.push({
        type: 'response_time',
        severity: 'warning',
        message: `Average response time ${metrics.performance.avgResponseTime.toFixed(0)}ms above threshold ${this.thresholds.responseTimeMax}ms`,
        value: metrics.performance.avgResponseTime,
        threshold: this.thresholds.responseTimeMax
      });
    }

    // Error rate
    if (metrics.performance.errorRate > this.thresholds.errorRateMax) {
      alerts.push({
        type: 'error_rate',
        severity: 'critical',
        message: `Error rate ${metrics.performance.errorRate.toFixed(1)}% above threshold ${this.thresholds.errorRateMax}%`,
        value: metrics.performance.errorRate,
        threshold: this.thresholds.errorRateMax
      });
    }

    return alerts;
  }

  // Generate comprehensive performance report
  async generatePerformanceReport() {
    this.updateSystemMetrics();
    const alerts = this.checkThresholds();
    
    const report = {
      timestamp: new Date().toISOString(),
      status: alerts.length === 0 ? 'healthy' : alerts.some(a => a.severity === 'critical') ? 'critical' : 'warning',
      metrics: {
        ...this.currentMetrics,
        timestamp: new Date(this.currentMetrics.timestamp).toISOString()
      },
      alerts,
      thresholds: this.thresholds,
      recommendations: this.generateRecommendations(alerts)
    };

    // Save report
    const reportPath = `performance-report-${Date.now()}.json`;
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    
    return report;
  }

  // Generate optimization recommendations
  generateRecommendations(alerts) {
    const recommendations = [];

    alerts.forEach(alert => {
      switch (alert.type) {
        case 'cache_hit_rate':
          recommendations.push({
            action: 'increase_cache_ttl',
            description: 'Consider increasing cache TTL for popular matches',
            impact: 'High - will reduce API calls significantly'
          });
          recommendations.push({
            action: 'implement_prefetching',
            description: 'Enable cache prefetching for upcoming matches',
            impact: 'Medium - reduces cache misses for predictable requests'
          });
          break;

        case 'response_time':
          recommendations.push({
            action: 'optimize_database_queries',
            description: 'Review and optimize slow database queries',
            impact: 'High - direct response time improvement'
          });
          recommendations.push({
            action: 'increase_cache_memory',
            description: 'Allocate more memory for in-memory caching',
            impact: 'Medium - faster cache access'
          });
          break;

        case 'error_rate':
          recommendations.push({
            action: 'implement_circuit_breaker',
            description: 'Add circuit breaker pattern for failing APIs',
            impact: 'High - prevents cascade failures'
          });
          recommendations.push({
            action: 'add_retry_logic',
            description: 'Implement exponential backoff retry logic',
            impact: 'Medium - recovers from transient failures'
          });
          break;
      }
    });

    return [...new Set(recommendations)]; // Remove duplicates
  }

  // Real-time dashboard data
  getDashboardData() {
    const uptime = Date.now() - this.startTime;
    const uptimeHours = (uptime / (1000 * 60 * 60)).toFixed(1);
    
    return {
      summary: {
        status: this.alerts.length === 0 ? 'Healthy' : 'Issues Detected',
        uptime: `${uptimeHours}h`,
        cacheHitRate: `${this.currentMetrics.cacheStats.hitRate.toFixed(1)}%`,
        avgResponseTime: `${this.currentMetrics.performance.avgResponseTime.toFixed(0)}ms`
      },
      metrics: this.currentMetrics,
      alerts: this.alerts,
      chartData: {
        responseTimes: this.responseTimes.slice(-50), // Last 50 requests
        cacheHitRate: this.currentMetrics.cacheStats.hitRate
      }
    };
  }

  // Start continuous monitoring
  startMonitoring(intervalMs = 60000) {
    console.log(`🚀 Starting continuous monitoring (${intervalMs/1000}s intervals)`);
    
    setInterval(async () => {
      this.updateSystemMetrics();
      const alerts = this.checkThresholds();
      
      if (alerts.length > 0) {
        console.log(`⚠️  Performance alerts detected: ${alerts.length}`);
        alerts.forEach(alert => {
          console.log(`   ${alert.severity.toUpperCase()}: ${alert.message}`);
        });
      }

      // Save historical data
      this.metricsHistory.push({
        timestamp: Date.now(),
        metrics: { ...this.currentMetrics },
        alertCount: alerts.length
      });

      // Keep only last 24 hours of history
      const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
      this.metricsHistory = this.metricsHistory.filter(m => m.timestamp > oneDayAgo);

    }, intervalMs);
  }
}

// Performance testing utilities
class CS2PerformanceTestSuite {
  constructor(monitor) {
    this.monitor = monitor;
  }

  // Test cache hit rates with simulated load
  async testCachePerformance(requestCount = 100) {
    console.log(`🧪 Testing cache performance with ${requestCount} requests...`);
    
    const testUrls = [
      'https://api.example.com/cs2/matches/active',
      'https://api.example.com/cs2/matches/upcoming',
      'https://api.example.com/cs2/teams/rankings',
      'https://api.example.com/cs2/odds/latest'
    ];

    let cacheHits = 0;
    let cacheMisses = 0;
    const responseTimes = [];

    for (let i = 0; i < requestCount; i++) {
      const url = testUrls[i % testUrls.length];
      const startTime = Date.now();
      
      try {
        // Simulate API request (replace with actual cache check)
        const cacheKey = `test-${i % 20}`; // Simulate 20 unique requests
        const isHit = Math.random() > 0.3; // Simulate 70% hit rate
        
        if (isHit) {
          cacheHits++;
          // Simulate fast cache response
          await new Promise(resolve => setTimeout(resolve, 5 + Math.random() * 10));
        } else {
          cacheMisses++;
          // Simulate slower API response
          await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));
        }

        const duration = Date.now() - startTime;
        responseTimes.push(duration);
        this.monitor.recordResponseTime(duration, true);

      } catch (error) {
        const duration = Date.now() - startTime;
        this.monitor.recordResponseTime(duration, false);
      }
    }

    const hitRate = (cacheHits / (cacheHits + cacheMisses)) * 100;
    const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;

    console.log(`✅ Cache test complete:`);
    console.log(`   Cache hit rate: ${hitRate.toFixed(1)}%`);
    console.log(`   Average response time: ${avgResponseTime.toFixed(0)}ms`);
    console.log(`   Total requests: ${requestCount}`);

    return { hitRate, avgResponseTime, cacheHits, cacheMisses };
  }

  // Validate team logo loading performance
  async validateTeamLogos() {
    console.log('🏷️ Validating team logo performance...');
    
    const teamLogoDir = './img/teams/';
    const results = {
      totalLogos: 0,
      validLogos: 0,
      invalidLogos: 0,
      totalSizeKB: 0,
      avgSizeKB: 0,
      issues: []
    };

    try {
      const files = await fs.readdir(teamLogoDir);
      const logoFiles = files.filter(f => f.endsWith('.svg') || f.endsWith('.png') || f.endsWith('.jpg'));
      
      results.totalLogos = logoFiles.length;

      for (const file of logoFiles) {
        try {
          const filePath = path.join(teamLogoDir, file);
          const stats = await fs.stat(filePath);
          const sizeKB = stats.size / 1024;
          
          results.totalSizeKB += sizeKB;
          results.validLogos++;

          // Check for oversized logos
          if (sizeKB > 50) {
            results.issues.push({
              file,
              issue: 'large_file',
              size: `${sizeKB.toFixed(1)}KB`,
              recommendation: 'Consider optimizing this logo'
            });
          }

        } catch (error) {
          results.invalidLogos++;
          results.issues.push({
            file,
            issue: 'access_error',
            error: error.message,
            recommendation: 'Check file permissions or integrity'
          });
        }
      }

      results.avgSizeKB = results.validLogos > 0 ? results.totalSizeKB / results.validLogos : 0;

      console.log(`✅ Logo validation complete:`);
      console.log(`   Total logos: ${results.totalLogos}`);
      console.log(`   Valid logos: ${results.validLogos}`);
      console.log(`   Average size: ${results.avgSizeKB.toFixed(1)}KB`);
      console.log(`   Total size: ${results.totalSizeKB.toFixed(1)}KB`);
      
      if (results.issues.length > 0) {
        console.log(`⚠️  Found ${results.issues.length} issues:`);
        results.issues.forEach(issue => {
          console.log(`   ${issue.file}: ${issue.issue} - ${issue.recommendation}`);
        });
      }

    } catch (error) {
      console.error('❌ Error validating logos:', error.message);
      results.issues.push({
        issue: 'directory_access',
        error: error.message,
        recommendation: 'Check if logo directory exists and is accessible'
      });
    }

    return results;
  }
}

// Export classes
module.exports = {
  CS2PerformanceMonitor,
  CS2PerformanceTestSuite
};

// CLI interface
if (require.main === module) {
  async function runPerformanceTests() {
    console.log('📊 **CS2 PERFORMANCE MONITORING & TESTING**\n');
    
    const monitor = new CS2PerformanceMonitor();
    const testSuite = new CS2PerformanceTestSuite(monitor);
    
    try {
      // Test 1: Cache performance
      console.log('=== CACHE PERFORMANCE TEST ===');
      await testSuite.testCachePerformance(50);
      console.log('');

      // Test 2: Team logo validation
      console.log('=== TEAM LOGO VALIDATION ===');
      const logoResults = await testSuite.validateTeamLogos();
      console.log('');

      // Test 3: Generate performance report
      console.log('=== PERFORMANCE REPORT ===');
      const report = await monitor.generatePerformanceReport();
      console.log(`Report status: ${report.status.toUpperCase()}`);
      console.log(`Alerts: ${report.alerts.length}`);
      if (report.recommendations.length > 0) {
        console.log('Recommendations:');
        report.recommendations.forEach((rec, i) => {
          console.log(`  ${i + 1}. ${rec.description} (Impact: ${rec.impact})`);
        });
      }

      console.log('\n✅ Performance testing complete!');
      console.log(`📊 Performance report saved to: performance-report-${Date.now()}.json`);

    } catch (error) {
      console.error('❌ Performance testing failed:', error.message);
    }
  }

  runPerformanceTests();
}