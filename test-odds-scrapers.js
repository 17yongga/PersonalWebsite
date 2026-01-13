/**
 * Test script for CS2 odds scrapers
 * Tests GG.bet and fallback mechanisms
 */

const cs2OddsProvider = require('./cs2-odds-provider');

async function testScrapers() {
  console.log('='.repeat(80));
  console.log('CS2 Odds Scrapers Test');
  console.log('='.repeat(80));
  console.log('');

  // Test with a sample match
  const testMatch = {
    fixtureId: 'test-match-001',
    team1: 'NAVI',
    team2: 'FaZe',
    homeTeam: 'NAVI',
    awayTeam: 'FaZe'
  };

  console.log('Test Match:');
  console.log(`  ${testMatch.team1} vs ${testMatch.team2}`);
  console.log('');

  try {
    console.log('Testing odds retrieval...');
    console.log('(This will test GG.bet and fallback mechanisms)');
    console.log('');

    const odds = await cs2OddsProvider.fetchMatchOdds(testMatch.fixtureId, testMatch);

    if (odds) {
      console.log('✓ Odds retrieved successfully:');
      console.log(`  Team 1 (${testMatch.team1}): ${odds.team1 || 'N/A'}`);
      console.log(`  Team 2 (${testMatch.team2}): ${odds.team2 || 'N/A'}`);
      console.log(`  Sources: ${odds.sources ? odds.sources.join(', ') : 'Unknown'}`);
      console.log(`  Confidence: ${odds.confidence || 'Unknown'}`);
      
      if (odds.sources && odds.sources.includes('fallback')) {
        console.log('');
        console.log('⚠ Using fallback odds (1.85x) - no scrapers returned valid odds');
        console.log('  This is expected if scrapers are blocked or match not found');
      } else {
        console.log('');
        console.log('✓ Successfully retrieved odds from scrapers!');
      }
    } else {
      console.log('✗ Failed to retrieve odds');
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error(error.stack);
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('Test Complete');
  console.log('='.repeat(80));
}

// Run the test
testScrapers().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
