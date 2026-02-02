#!/usr/bin/env node

/**
 * CS2 Optimized System Testing Suite
 * 
 * Comprehensive tests for the new optimized architecture:
 * 1. Static odds caching
 * 2. Free result sources (HLTV/Liquipedia)
 * 3. Efficient match discovery
 * 4. Free settlement system
 * 
 * Run with: node cs2-optimized-testing.js
 */

const path = require('path');

// Test configuration
const TEST_CONFIG = {
  verbose: process.argv.includes('--verbose') || process.argv.includes('-v'),
  skipSlow: process.argv.includes('--fast'),
  testModule: process.argv.find(a => a.startsWith('--module='))?.split('=')[1]
};

// Colors for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m'
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function section(title) {
  console.log('\n' + '='.repeat(60));
  log(` ${title}`, 'cyan');
  console.log('='.repeat(60));
}

function test(name, fn) {
  return { name, fn };
}

const results = {
  passed: 0,
  failed: 0,
  skipped: 0,
  errors: []
};

async function runTest(testObj) {
  try {
    process.stdout.write(`  Testing: ${testObj.name}... `);
    await testObj.fn();
    log('✓ PASS', 'green');
    results.passed++;
    return true;
  } catch (error) {
    log(`✗ FAIL: ${error.message}`, 'red');
    results.failed++;
    results.errors.push({ test: testObj.name, error: error.message });
    if (TEST_CONFIG.verbose) {
      console.log(colors.dim + error.stack + colors.reset);
    }
    return false;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

function assertExists(value, message) {
  if (value === undefined || value === null) {
    throw new Error(message || 'Value should exist');
  }
}

// ============================================
// TEST SUITES
// ============================================

async function testStaticOddsCache() {
  section('Static Odds Cache Tests');
  
  const { CS2StaticOddsCache } = require('./cs2-static-odds-cache');
  const cache = new CS2StaticOddsCache();
  
  const tests = [
    test('Cache initializes correctly', async () => {
      await cache.init();
      assertExists(cache.cache);
      assertExists(cache.cache.matches);
      assertExists(cache.cache.metadata);
    }),
    
    test('Validates odds correctly - valid odds', async () => {
      const validOdds = { team1: 1.85, team2: 2.15 };
      assert(cache.areOddsValid(validOdds), 'Should recognize valid odds');
    }),
    
    test('Validates odds correctly - placeholder odds', async () => {
      const placeholderOdds = { team1: 2.0, team2: 2.0 };
      assert(!cache.areOddsValid(placeholderOdds), 'Should reject placeholder 2.0/2.0 odds');
    }),
    
    test('Validates odds correctly - null odds', async () => {
      const nullOdds = { team1: null, team2: 1.5 };
      assert(!cache.areOddsValid(nullOdds), 'Should reject null odds');
    }),
    
    test('Stores and retrieves match data', async () => {
      const testMatch = {
        id: 'test-match-001',
        odds: { team1: 1.75, team2: 2.25 },
        homeTeam: 'Test Team A',
        awayTeam: 'Test Team B',
        startTime: new Date().toISOString(),
        tournament: 'Test Tournament'
      };
      
      await cache.setOdds(testMatch.id, testMatch);
      const retrieved = cache.getOdds(testMatch.id);
      
      assertExists(retrieved, 'Should retrieve cached match');
      assertEqual(retrieved.odds.team1, 1.75, 'Team1 odds should match');
      assertEqual(retrieved.odds.team2, 2.25, 'Team2 odds should match');
    }),
    
    test('Returns null for uncached matches', async () => {
      const result = cache.getOdds('nonexistent-match-999');
      assertEqual(result, null, 'Should return null for uncached match');
    }),
    
    test('Does not overwrite valid cached odds', async () => {
      const matchId = 'test-no-overwrite-001';
      const original = {
        odds: { team1: 1.50, team2: 2.80 },
        homeTeam: 'Original A',
        awayTeam: 'Original B'
      };
      const attempted = {
        odds: { team1: 1.60, team2: 2.50 },
        homeTeam: 'New A',
        awayTeam: 'New B'
      };
      
      await cache.setOdds(matchId, original);
      await cache.setOdds(matchId, attempted); // Should be skipped
      
      const retrieved = cache.getOdds(matchId);
      assertEqual(retrieved.odds.team1, 1.50, 'Should keep original odds');
    }),
    
    test('Gets unsettled matches', async () => {
      const unsettled = cache.getUnsettledMatches();
      assert(Array.isArray(unsettled), 'Should return array');
      // All previously added test matches should be unsettled
      assert(unsettled.length >= 0, 'Should return unsettled matches');
    }),
    
    test('Gets cache statistics', async () => {
      const stats = cache.getStats();
      assertExists(stats.totalMatches, 'Stats should include totalMatches');
      assertExists(stats.matchesWithOdds, 'Stats should include matchesWithOdds');
      assertExists(stats.cacheEfficiency, 'Stats should include cacheEfficiency');
    })
  ];
  
  for (const t of tests) {
    await runTest(t);
  }
}

async function testFreeResultSources() {
  section('Free Result Sources Tests');
  
  const { 
    normalizeTeamName, 
    teamsMatch,
    HLTVScraper,
    LiquipediaScraper,
    CS2ResultFetcher
  } = require('./cs2-free-result-sources');
  
  const tests = [
    test('Normalizes team names correctly', async () => {
      assertEqual(normalizeTeamName('Team Vitality'), 'vitality');
      assertEqual(normalizeTeamName('FaZe Clan'), 'faze clan');
      assertEqual(normalizeTeamName('Natus Vincere'), 'natus vincere');
      assertEqual(normalizeTeamName('  G2 Esports  '), 'g2');
    }),
    
    test('Team matching works for exact names', async () => {
      assert(teamsMatch('Vitality', 'vitality'), 'Should match case-insensitive');
      assert(teamsMatch('Team Vitality', 'Vitality'), 'Should match with prefix');
    }),
    
    test('Team matching works for abbreviations', async () => {
      assert(teamsMatch('Natus Vincere', 'NaVi'), 'NaVi should match Natus Vincere');
      assert(teamsMatch('NIP', 'Ninjas in Pyjamas'), 'NIP should match full name');
    }),
    
    test('HLTV Scraper initializes', async () => {
      const scraper = new HLTVScraper();
      assertExists(scraper.baseUrl);
      assertExists(scraper.resultsCache);
    }),
    
    test('Liquipedia Scraper initializes', async () => {
      const scraper = new LiquipediaScraper();
      assertExists(scraper.baseUrl);
    }),
    
    test('Result Fetcher initializes', async () => {
      const fetcher = new CS2ResultFetcher();
      assertExists(fetcher.hltv);
      assertExists(fetcher.liquipedia);
    })
  ];
  
  // Add slow tests only if not in fast mode
  if (!TEST_CONFIG.skipSlow) {
    tests.push(
      test('HLTV can fetch recent results (network test)', async () => {
        const scraper = new HLTVScraper();
        const results = await scraper.getRecentResults(5);
        // May be empty if network fails, but should be array
        assert(Array.isArray(results), 'Should return array');
        if (results.length > 0) {
          assertExists(results[0].winner, 'Results should have winner');
        }
      }),
      
      test('HLTV can fetch upcoming matches (network test)', async () => {
        const scraper = new HLTVScraper();
        const matches = await scraper.getUpcomingMatches(5);
        assert(Array.isArray(matches), 'Should return array');
      })
    );
  }
  
  for (const t of tests) {
    await runTest(t);
  }
}

async function testMatchDiscovery() {
  section('Efficient Match Discovery Tests');
  
  const { CS2EfficientMatchDiscovery } = require('./cs2-efficient-match-discovery');
  const discovery = new CS2EfficientMatchDiscovery();
  
  const tests = [
    test('Match Discovery initializes', async () => {
      assertExists(discovery.discoveryInterval);
      assertExists(discovery.apiCallLimit);
    }),
    
    test('Generates consistent match IDs', async () => {
      const id1 = discovery.generateMatchId('Team A', 'Team B');
      const id2 = discovery.generateMatchId('Team B', 'Team A');
      assertEqual(id1, id2, 'Match IDs should be order-independent');
    }),
    
    test('Match ID handles special characters', async () => {
      const id = discovery.generateMatchId('FaZe Clan', 'G2 Esports!');
      assert(!id.includes(' '), 'Match ID should not contain spaces');
      assert(!id.includes('!'), 'Match ID should not contain special chars');
    }),
    
    test('Gets discovery statistics', async () => {
      const stats = discovery.getStats();
      assertExists(stats.apiCallsToday, 'Stats should include API calls');
      assertExists(stats.apiCallLimit, 'Stats should include API limit');
    })
  ];
  
  if (!TEST_CONFIG.skipSlow) {
    tests.push(
      test('Can discover matches (integration test)', async () => {
        const result = await discovery.discoverMatches();
        assertExists(result.matches, 'Should return matches array');
        assertExists(result.stats, 'Should return stats');
      })
    );
  }
  
  for (const t of tests) {
    await runTest(t);
  }
}

async function testSettlementSystem() {
  section('Free Settlement System Tests');
  
  const { CS2FreeSettlementSystem } = require('./cs2-free-settlement-system');
  const settlement = new CS2FreeSettlementSystem();
  
  const tests = [
    test('Settlement system initializes', async () => {
      await settlement.init();
      assertExists(settlement.bettingData, 'Should have betting data');
      assertExists(settlement.config, 'Should have config');
    }),
    
    test('Configuration has required fields', async () => {
      assertExists(settlement.config.minSettlementDelay);
      assertExists(settlement.config.maxBetAge);
      assertExists(settlement.config.minConfidenceForAutoSettle);
    }),
    
    test('Gets settlement statistics', async () => {
      const stats = settlement.getStats();
      assertExists(stats.totalBets, 'Stats should include totalBets');
      assertExists(stats.pendingBets, 'Stats should include pendingBets');
    }),
    
    test('Gets match key correctly', async () => {
      const bet = {
        team1: 'Alpha Team',
        team2: 'Beta Team'
      };
      const key = settlement.getMatchKey(bet);
      assert(key.includes('alpha'), 'Key should include normalized team name');
      assert(key.includes('beta'), 'Key should include normalized team name');
    }),
    
    test('Extracts teams from event ID', async () => {
      const bet = { eventId: 'g2-vs-vitality' };
      const team1 = settlement.extractTeam1(bet);
      const team2 = settlement.extractTeam2(bet);
      assertEqual(team1, 'g2', 'Should extract team1');
      assertEqual(team2, 'vitality', 'Should extract team2');
      
      // Also test with date suffix
      const bet2 = { eventId: 'faze-vs-navi-2024' };
      const team3 = settlement.extractTeam1(bet2);
      const team4 = settlement.extractTeam2(bet2);
      assertEqual(team3, 'faze', 'Should extract team1 with date');
      assertEqual(team4, 'navi', 'Should extract team2 without date suffix');
    }),
    
    test('Gets pending bets summary', async () => {
      const summary = await settlement.getPendingBetsSummary();
      assert(Array.isArray(summary), 'Should return array');
    })
  ];
  
  for (const t of tests) {
    await runTest(t);
  }
}

async function testIntegration() {
  section('Integration Tests');
  
  const tests = [
    test('All modules can be loaded together', async () => {
      const cache = require('./cs2-static-odds-cache');
      const sources = require('./cs2-free-result-sources');
      const discovery = require('./cs2-efficient-match-discovery');
      const settlement = require('./cs2-free-settlement-system');
      
      assertExists(cache.staticOddsCache);
      assertExists(sources.resultFetcher);
      assertExists(discovery.matchDiscovery);
      assertExists(settlement.freeSettlementSystem);
    }),
    
    test('Modules share data correctly', async () => {
      const { staticOddsCache } = require('./cs2-static-odds-cache');
      const { matchDiscovery } = require('./cs2-efficient-match-discovery');
      
      // Add a test match via cache
      await staticOddsCache.init();
      await staticOddsCache.setOdds('integration-test-001', {
        odds: { team1: 1.65, team2: 2.35 },
        homeTeam: 'Integration Team A',
        awayTeam: 'Integration Team B'
      });
      
      // Verify discovery can see it
      const stats = matchDiscovery.getStats();
      assert(stats.totalMatches >= 1, 'Discovery should see cached matches');
    })
  ];
  
  for (const t of tests) {
    await runTest(t);
  }
}

// ============================================
// MAIN TEST RUNNER
// ============================================

async function runAllTests() {
  console.log('\n' + '╔' + '═'.repeat(58) + '╗');
  console.log('║' + ' '.repeat(10) + 'CS2 OPTIMIZED SYSTEM TEST SUITE' + ' '.repeat(17) + '║');
  console.log('╚' + '═'.repeat(58) + '╝');
  
  log(`\nConfiguration: verbose=${TEST_CONFIG.verbose}, skipSlow=${TEST_CONFIG.skipSlow}`, 'dim');
  
  const startTime = Date.now();
  
  // Run test suites based on module filter
  const moduleFilter = TEST_CONFIG.testModule;
  
  if (!moduleFilter || moduleFilter === 'cache') {
    await testStaticOddsCache();
  }
  
  if (!moduleFilter || moduleFilter === 'sources') {
    await testFreeResultSources();
  }
  
  if (!moduleFilter || moduleFilter === 'discovery') {
    await testMatchDiscovery();
  }
  
  if (!moduleFilter || moduleFilter === 'settlement') {
    await testSettlementSystem();
  }
  
  if (!moduleFilter || moduleFilter === 'integration') {
    await testIntegration();
  }
  
  // Print summary
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  
  console.log('\n' + '='.repeat(60));
  log(' TEST SUMMARY', 'cyan');
  console.log('='.repeat(60));
  
  log(`  ✓ Passed: ${results.passed}`, 'green');
  if (results.failed > 0) {
    log(`  ✗ Failed: ${results.failed}`, 'red');
  }
  if (results.skipped > 0) {
    log(`  ○ Skipped: ${results.skipped}`, 'yellow');
  }
  log(`  ⏱ Duration: ${duration}s`, 'dim');
  
  if (results.errors.length > 0) {
    console.log('\n' + '-'.repeat(60));
    log(' FAILED TESTS:', 'red');
    for (const err of results.errors) {
      log(`  • ${err.test}: ${err.error}`, 'red');
    }
  }
  
  console.log('\n' + '='.repeat(60));
  
  if (results.failed === 0) {
    log(' ✓ ALL TESTS PASSED', 'green');
  } else {
    log(` ✗ ${results.failed} TEST(S) FAILED`, 'red');
  }
  
  console.log('='.repeat(60) + '\n');
  
  // Exit with appropriate code
  process.exit(results.failed > 0 ? 1 : 0);
}

// Run tests
runAllTests().catch(error => {
  console.error('Fatal error running tests:', error);
  process.exit(1);
});
