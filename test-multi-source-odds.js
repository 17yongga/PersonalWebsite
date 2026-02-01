/**
 * Test script for multi-source CS2 odds provider
 * Tests fetching odds for the missing IEM Krakow matches
 */

const multiSourceOdds = require('./cs2-multi-source-odds');

async function testMissingMatches() {
  console.log('='.repeat(80));
  console.log('Testing Multi-Source Odds Provider for Missing IEM Krakow Matches');
  console.log('='.repeat(80));

  const testMatches = [
    {
      team1: 'Pain Gaming',
      team2: 'Aurora Gaming',
      participant1Name: 'Pain Gaming',
      participant2Name: 'Aurora Gaming',
      tournamentName: 'Intel Extreme Masters Krakow',
      startTime: '2026-01-30T15:30:00.000Z'
    },
    {
      team1: 'BC.Game eSports',
      team2: 'Ninjas In Pyjamas',
      participant1Name: 'BC.Game eSports',
      participant2Name: 'Ninjas In Pyjamas',
      tournamentName: 'Intel Extreme Masters Krakow',
      startTime: '2026-01-30T15:30:00.000Z'
    },
    {
      team1: 'Fut eSports',
      team2: 'Team Liquid',
      participant1Name: 'Fut eSports',
      participant2Name: 'Team Liquid',
      tournamentName: 'Intel Extreme Masters Krakow',
      startTime: '2026-01-30T18:00:00.000Z'
    }
  ];

  for (const [index, match] of testMatches.entries()) {
    console.log(`\n${index + 1}. Testing: ${match.team1} vs ${match.team2}`);
    console.log('-'.repeat(60));
    
    try {
      const result = await multiSourceOdds.fetchMultiSourceOdds(match);
      
      if (result) {
        console.log(`✅ SUCCESS: Found odds from ${result.sourceCount} source(s)`);
        console.log(`   Sources: ${result.sources.join(', ')}`);
        console.log(`   Odds: ${match.team1} ${result.team1} | ${match.team2} ${result.team2}`);
        console.log(`   Confidence: ${result.confidence}`);
        
        if (result.fallback) {
          console.log(`   📊 Ranking-based calculation:`);
          console.log(`     - ${match.team1}: Rank ${result.rankData?.team1Rank || 'Unknown'}`);
          console.log(`     - ${match.team2}: Rank ${result.rankData?.team2Rank || 'Unknown'}`);
          console.log(`     - Rank difference: ${result.rankData?.rankDiff || 'Unknown'}`);
        }
        
        // Validate odds are reasonable
        if (result.team1 && result.team2) {
          const team1Odds = parseFloat(result.team1);
          const team2Odds = parseFloat(result.team2);
          
          if (team1Odds < 1.01 || team1Odds > 20 || team2Odds < 1.01 || team2Odds > 20) {
            console.log(`   ⚠️  WARNING: Odds seem unrealistic (${team1Odds}, ${team2Odds})`);
          } else if (Math.abs(team1Odds - team2Odds) < 0.1) {
            console.log(`   ℹ️  INFO: Very close match (odds difference: ${Math.abs(team1Odds - team2Odds).toFixed(2)})`);
          } else {
            const favorite = team1Odds < team2Odds ? match.team1 : match.team2;
            const favoriteOdds = Math.min(team1Odds, team2Odds);
            console.log(`   📈 Favorite: ${favorite} (${favoriteOdds})`);
          }
        }
      } else {
        console.log(`❌ FAILED: No odds found`);
      }
    } catch (error) {
      console.log(`❌ ERROR: ${error.message}`);
    }
    
    // Wait 2 seconds between requests to be respectful
    if (index < testMatches.length - 1) {
      console.log('   Waiting 2 seconds before next request...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('Testing individual sources for better debugging...');
  console.log('='.repeat(80));

  const sampleMatch = testMatches[0]; // Pain Gaming vs Aurora Gaming
  console.log(`\nTesting individual sources for: ${sampleMatch.team1} vs ${sampleMatch.team2}`);
  
  // Test ranking calculation
  console.log('\n1. Testing ranking-based calculation...');
  try {
    const rankingOdds = multiSourceOdds.calculateRankingBasedOdds(sampleMatch.team1, sampleMatch.team2);
    console.log(`   ✅ Ranking odds: ${rankingOdds.team1} / ${rankingOdds.team2}`);
    console.log(`   Team ranks: ${rankingOdds.team1Rank} vs ${rankingOdds.team2Rank} (diff: ${rankingOdds.rankDiff})`);
  } catch (error) {
    console.log(`   ❌ Ranking calculation failed: ${error.message}`);
  }

  // Test HLTV (if available)
  console.log('\n2. Testing HLTV API...');
  try {
    const hltvOdds = await multiSourceOdds.fetchHLTVOdds(sampleMatch);
    if (hltvOdds) {
      console.log(`   ✅ HLTV odds: ${hltvOdds.team1} / ${hltvOdds.team2} (confidence: ${hltvOdds.confidence})`);
    } else {
      console.log(`   ℹ️  HLTV: No odds found (may not have this match)`);
    }
  } catch (error) {
    console.log(`   ❌ HLTV failed: ${error.message}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('Multi-source odds test complete!');
  console.log('='.repeat(80));
}

// Run the test
testMissingMatches().catch(error => {
  console.error('Test failed:', error);
});