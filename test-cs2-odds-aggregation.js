/**
 * Test script for CS2 Multi-Source Odds Aggregation
 * Verifies that odds can be retrieved and aggregated from multiple sources
 */

const cs2OddsProvider = require('./cs2-odds-provider');

async function testOddsAggregation() {
  console.log('='.repeat(80));
  console.log('CS2 Multi-Source Odds Aggregation Test');
  console.log('='.repeat(80));
  console.log('');

  try {
    // Test 1: Check available sources
    console.log('Test 1: Checking available sources...');
    const availableSources = cs2OddsProvider.getAvailableSources();
    console.log(`✓ Available sources: ${availableSources.length > 0 ? availableSources.join(", ") : "None"}`);
    console.log('');

    if (availableSources.length === 0) {
      console.warn('⚠ No sources available. Make sure cs2-api-client.js is available.');
      console.log('');
    }

    // Test 2: Test aggregation logic with mock data
    console.log('Test 2: Testing aggregation logic with mock data...');
    const mockOdds = [
      { team1: 2.5, team2: 1.8, draw: null, source: 'oddspapi' },
      { team1: 2.3, team2: 1.9, draw: null, source: 'hltv' },
      { team1: 2.4, team2: 1.85, draw: null, source: 'gambling' }
    ];

    const aggregated = cs2OddsProvider.aggregateOdds(mockOdds);
    if (aggregated) {
      console.log('✓ Aggregation successful:');
      console.log(`  Team1: ${aggregated.team1}`);
      console.log(`  Team2: ${aggregated.team2}`);
      console.log(`  Sources: ${aggregated.sources.join(", ")}`);
      console.log(`  Confidence: ${aggregated.confidence}`);
    } else {
      console.error('✗ Aggregation failed');
    }
    console.log('');

    // Test 3: Test with real fixture (if available)
    if (availableSources.length > 0) {
      console.log('Test 3: Testing with real fixture...');
      
      // Try to get a fixture ID from upcoming matches
      let testFixtureId = null;
      let testMatchInfo = null;
      
      try {
        if (cs2OddsProvider.fetchUpcomingMatches) {
          const matches = await cs2OddsProvider.fetchUpcomingMatches({ limit: 1 });
          if (matches && matches.length > 0) {
            testFixtureId = matches[0].fixtureId || matches[0].id;
            testMatchInfo = {
              fixtureId: testFixtureId,
              team1: matches[0].homeTeam || matches[0].participant1Name,
              team2: matches[0].awayTeam || matches[0].participant2Name,
              homeTeam: matches[0].homeTeam || matches[0].participant1Name,
              awayTeam: matches[0].awayTeam || matches[0].participant2Name
            };
            console.log(`  Found test fixture: ${testFixtureId}`);
            console.log(`  Match: ${testMatchInfo.team1} vs ${testMatchInfo.team2}`);
          }
        }
      } catch (error) {
        console.warn(`  Could not fetch test fixture: ${error.message}`);
      }

      if (testFixtureId && testMatchInfo) {
        console.log(`  Fetching aggregated odds for fixture ${testFixtureId}...`);
        console.log('  (This may take a while as it queries multiple sources...)');
        
        try {
          const odds = await cs2OddsProvider.fetchMatchOdds(testFixtureId, testMatchInfo);
          
          if (odds) {
            console.log('  ✓ Successfully retrieved aggregated odds:');
            console.log(`    Team1: ${odds.team1 || 'N/A'}`);
            console.log(`    Team2: ${odds.team2 || 'N/A'}`);
            console.log(`    Draw: ${odds.draw || 'N/A'}`);
            console.log(`    Sources: ${odds.sources ? odds.sources.join(", ") : "Unknown"}`);
            console.log(`    Confidence: ${odds.confidence || "Unknown"}`);
            console.log(`    Timestamp: ${odds.timestamp || "Unknown"}`);
          } else {
            console.log('  ⚠ No odds returned (may not be available yet)');
          }
        } catch (error) {
          console.error(`  ✗ Error fetching odds: ${error.message}`);
        }
      } else {
        console.log('  ⚠ No test fixture available');
      }
    } else {
      console.log('Test 3: Skipped (no sources available)');
    }
    console.log('');

    // Test 4: Test different aggregation strategies
    console.log('Test 4: Testing different aggregation strategies...');
    const config = require('./cs2-odds-config');
    const originalStrategy = config.aggregation.strategy;
    
    const strategies = ['weighted_average', 'average', 'median', 'best_available'];
    for (const strategy of strategies) {
      config.aggregation.strategy = strategy;
      const result = cs2OddsProvider.aggregateOdds(mockOdds);
      if (result) {
        console.log(`  ${strategy}: team1=${result.team1}, team2=${result.team2}`);
      }
    }
    
    // Restore original strategy
    config.aggregation.strategy = originalStrategy;
    console.log('');

    // Test 5: Test error handling
    console.log('Test 5: Testing error handling...');
    const emptyOdds = cs2OddsProvider.aggregateOdds([]);
    if (emptyOdds === null) {
      console.log('  ✓ Correctly handles empty odds array');
    } else {
      console.log('  ✗ Should return null for empty array');
    }
    
    const invalidOdds = cs2OddsProvider.aggregateOdds([
      { team1: null, team2: null, source: 'test' }
    ]);
    if (invalidOdds === null) {
      console.log('  ✓ Correctly handles invalid odds');
    } else {
      console.log('  ⚠ Invalid odds returned result (may be acceptable)');
    }
    console.log('');

    // Summary
    console.log('='.repeat(80));
    console.log('Test Summary');
    console.log('='.repeat(80));
    console.log(`Available sources: ${availableSources.length}`);
    console.log(`Aggregation logic: ${aggregated ? 'Working' : 'Failed'}`);
    console.log('');
    
    if (availableSources.length > 0 && aggregated) {
      console.log('✓ Multi-source odds aggregation system is functioning correctly!');
      console.log('');
      console.log('Next steps:');
      console.log('  1. Ensure all sources are properly configured in cs2-odds-config.js');
      console.log('  2. Test with real matches that have odds available');
      console.log('  3. Monitor logs to see which sources are providing odds');
    } else {
      console.log('⚠ Some components may need configuration or dependencies');
      if (availableSources.length === 0) {
        console.log('  - No sources available. Check cs2-api-client.js');
      }
      if (!aggregated) {
        console.log('  - Aggregation logic failed. Check implementation.');
      }
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error);
    console.error(error.stack);
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('Test Complete');
  console.log('='.repeat(80));
}

// Run the test
testOddsAggregation().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
