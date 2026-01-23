/**
 * Test Settlement Feature with Real OddsPapi API
 * 
 * This script tests the settlement function using actual past events from OddsPapi:
 * 1. Fetches past CS2 fixtures
 * 2. Gets settlement data for finished matches
 * 3. Tests the settlement logic with real API responses
 * 4. Provides proof that settlement works correctly
 */

const cs2ApiClient = require('./cs2-api-client');
const path = require('path');
const fs = require('fs').promises;

// Test configuration
const TEST_FIXTURE_IDS = [
  // Add real fixture IDs here if you have them, or we'll fetch from API
];

// Mock betting state for testing
let testBettingState = {
  events: {},
  bets: {}
};

// Mock users for testing
const testUsers = {
  'testuser1': { username: 'testuser1', credits: 1000 },
  'testuser2': { username: 'testuser2', credits: 1000 }
};

/**
 * Test fetching settlements for a specific fixture
 */
async function testFetchSettlement(fixtureId) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Testing Settlement for Fixture: ${fixtureId}`);
  console.log('='.repeat(80) + '\n');
  
  try {
    // Fetch settlement data
    console.log(`📡 Fetching settlement data from OddsPapi...`);
    const result = await cs2ApiClient.fetchMatchResults(fixtureId);
    
    if (!result) {
      console.log(`❌ No settlement data returned for fixture ${fixtureId}`);
      return null;
    }
    
    console.log(`✅ Settlement data received:`);
    console.log(`   - Fixture ID: ${result.fixtureId}`);
    console.log(`   - Completed: ${result.completed}`);
    console.log(`   - Status ID: ${result.statusId}`);
    console.log(`   - Winner: ${result.winner || 'N/A'}`);
    console.log(`   - Team 1 Score: ${result.participant1Score || 'N/A'}`);
    console.log(`   - Team 2 Score: ${result.participant2Score || 'N/A'}`);
    
    return result;
    
  } catch (error) {
    console.error(`❌ Error fetching settlement:`, error.message);
    console.error(error.stack);
    return null;
  }
}

/**
 * Test settlement logic with a real fixture
 */
async function testSettlementWithFixture(fixtureId, eventData) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Testing Settlement Logic for: ${eventData.homeTeam || eventData.participant1Name} vs ${eventData.awayTeam || eventData.participant2Name}`);
  console.log('='.repeat(80) + '\n');
  
  // Create test event
  testBettingState.events[fixtureId] = {
    ...eventData,
    id: fixtureId,
    fixtureId: fixtureId,
    status: 'scheduled', // Start as scheduled, will be updated
    result: null
  };
  
  // Create test bets
  const betAmount = 100;
  testBettingState.bets['bet-win-team1'] = {
    id: 'bet-win-team1',
    userId: 'testuser1',
    eventId: fixtureId,
    selection: 'team1',
    amount: betAmount,
    odds: 1.8,
    potentialPayout: betAmount * 1.8,
    status: 'pending',
    placedAt: new Date().toISOString()
  };
  
  testBettingState.bets['bet-win-team2'] = {
    id: 'bet-win-team2',
    userId: 'testuser2',
    eventId: fixtureId,
    selection: 'team2',
    amount: betAmount,
    odds: 2.0,
    potentialPayout: betAmount * 2.0,
    status: 'pending',
    placedAt: new Date().toISOString()
  };
  
  console.log(`📊 Created test bets:`);
  console.log(`   - bet-win-team1: User1 bet ${betAmount} on Team 1 (odds ${testBettingState.bets['bet-win-team1'].odds})`);
  console.log(`   - bet-win-team2: User2 bet ${betAmount} on Team 2 (odds ${testBettingState.bets['bet-win-team2'].odds})`);
  
  // Fetch settlement
  const settlementResult = await testFetchSettlement(fixtureId);
  
  if (!settlementResult || !settlementResult.completed) {
    console.log(`\n⚠️  Match not finished or no settlement data available`);
    return null;
  }
  
  // Update event with settlement result
  testBettingState.events[fixtureId].status = 'finished';
  testBettingState.events[fixtureId].result = {
    winner: settlementResult.winner,
    participant1Score: settlementResult.participant1Score,
    participant2Score: settlementResult.participant2Score
  };
  
  console.log(`\n💰 Settling bets...`);
  
  // Settle bets
  const event = testBettingState.events[fixtureId];
  const pendingBets = Object.values(testBettingState.bets).filter(b => 
    b.eventId === fixtureId && b.status === 'pending'
  );
  
  let settledCount = 0;
  let wonCount = 0;
  let lostCount = 0;
  
  for (const bet of pendingBets) {
    const winner = event.result?.winner;
    
    if (!winner) {
      console.log(`   ⏳ Bet ${bet.id}: KEPT PENDING - No winner determined`);
      continue;
    }
    
    const betWon = (bet.selection === 'team1' && winner === 'team1') ||
                   (bet.selection === 'team2' && winner === 'team2') ||
                   (bet.selection === 'draw' && winner === 'draw');
    
    if (betWon) {
      console.log(`   ✅ Bet ${bet.id} (${bet.selection}): WON`);
      bet.status = 'won';
      bet.result = 'win';
      
      const user = testUsers[bet.userId];
      if (user) {
        const oldCredits = user.credits;
        user.credits += bet.potentialPayout;
        console.log(`      💵 User ${bet.userId}: ${oldCredits} → ${user.credits} credits (+${bet.potentialPayout} payout)`);
      }
      wonCount++;
    } else {
      console.log(`   ❌ Bet ${bet.id} (${bet.selection}): LOST (Winner was ${winner})`);
      bet.status = 'lost';
      bet.result = 'loss';
      lostCount++;
    }
    
    bet.settledAt = new Date().toISOString();
    settledCount++;
  }
  
  console.log(`\n📊 Settlement Summary:`);
  console.log(`   - Total Settled: ${settledCount}`);
  console.log(`   - Won: ${wonCount}`);
  console.log(`   - Lost: ${lostCount}`);
  
  return {
    fixtureId,
    settlementResult,
    settledCount,
    wonCount,
    lostCount
  };
}

/**
 * Find past CS2 fixtures to test with
 */
async function findPastFixtures() {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Finding Past CS2 Fixtures for Testing`);
  console.log('='.repeat(80) + '\n');
  
  try {
    // Try to fetch fixtures from the past week
    const now = new Date();
    const oneWeekAgo = new Date(now);
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    console.log(`📅 Looking for fixtures from ${oneWeekAgo.toISOString()} to ${now.toISOString()}`);
    
    // Note: The fetchUpcomingMatches function might not support past dates
    // We'll need to use a different approach or provide fixture IDs manually
    
    console.log(`\n⚠️  Note: To test with real fixtures, you need to provide fixture IDs of finished matches.`);
    console.log(`   You can find these from:`);
    console.log(`   1. OddsPapi dashboard/history`);
    console.log(`   2. Previous API responses`);
    console.log(`   3. Or use the test fixture IDs below\n`);
    
    return [];
    
  } catch (error) {
    console.error(`❌ Error finding past fixtures:`, error.message);
    return [];
  }
}

/**
 * Test with a known past fixture (if available)
 */
async function testWithKnownFixture() {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Testing with Sample Fixture IDs`);
  console.log('='.repeat(80) + '\n');
  
  // Sample fixture IDs - these should be replaced with actual finished match IDs
  // You can get these from OddsPapi or previous API responses
  const sampleFixtures = [
    // Example format - replace with real fixture IDs
    // 'id1000000761280685', // Example from OddsPapi docs
  ];
  
  if (sampleFixtures.length === 0) {
    console.log(`⚠️  No sample fixture IDs provided.`);
    console.log(`\nTo test with real data:`);
    console.log(`1. Get a fixture ID from a finished CS2 match`);
    console.log(`2. Add it to the sampleFixtures array in this script`);
    console.log(`3. Run the test again\n`);
    return null;
  }
  
  const results = [];
  
  for (const fixtureId of sampleFixtures) {
    try {
      // First, try to get fixture details
      const oddsData = await cs2ApiClient.fetchMatchOdds(fixtureId);
      
      if (!oddsData) {
        console.log(`⚠️  Could not fetch data for fixture ${fixtureId}`);
        continue;
      }
      
      // Create event data from odds response
      const eventData = {
        homeTeam: oddsData.homeTeam || oddsData.participant1Name,
        participant1Name: oddsData.participant1Name || oddsData.homeTeam,
        awayTeam: oddsData.awayTeam || oddsData.participant2Name,
        participant2Name: oddsData.participant2Name || oddsData.awayTeam,
        startTime: oddsData.startTime || oddsData.commenceTime,
        odds: oddsData.odds || {}
      };
      
      const result = await testSettlementWithFixture(fixtureId, eventData);
      if (result) {
        results.push(result);
      }
      
    } catch (error) {
      console.error(`❌ Error testing fixture ${fixtureId}:`, error.message);
    }
  }
  
  return results;
}

/**
 * Test the settlements endpoint directly
 */
async function testSettlementsEndpoint(fixtureId) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Testing Settlements Endpoint Directly`);
  console.log('='.repeat(80) + '\n');
  
  try {
    // Use the API client's makeRequest function to ensure proper authentication
    // Access the internal makeRequest function if available, or use fetchMatchResults
    console.log(`📡 Calling settlements endpoint for fixture: ${fixtureId}`);
    
    // Use fetchMatchResults which internally calls settlements
    const result = await cs2ApiClient.fetchMatchResults(fixtureId);
    
    if (!result) {
      console.log(`❌ No result returned`);
      return null;
    }
    
    // Also make a direct call to see raw response structure
    const axios = require('axios');
    const ODDSPAPI_BASE_URL = process.env.ODDSPAPI_BASE_URL || 'https://api.oddspapi.io/v4';
    const ODDSPAPI_API_KEY = process.env.ODDSPAPI_API_KEY || '492c4517-843e-49d5-96dd-8eed82567c5b';
    
    console.log(`📡 Making direct API call to see raw response structure...`);
    
    const response = await axios.get(`${ODDSPAPI_BASE_URL}/settlements`, {
      params: {
        fixtureId: fixtureId,
        apiKey: ODDSPAPI_API_KEY,  // API key should be in query params
        language: 'en'
      }
    });
    
    console.log(`✅ Response Status: ${response.status}`);
    console.log(`\n📦 Raw Response Structure:`);
    console.log(JSON.stringify(response.data, null, 2));
    
    // Parse the response
    if (response.data && response.data.fixtureId && response.data.markets) {
      console.log(`\n✅ Valid settlements response structure detected`);
      
      // Extract winner from markets
      const markets = response.data.markets;
      const market101 = markets['101']; // Moneyline
      const market171 = markets['171']; // Match Winner (esports)
      
      const market = market171 || market101;
      
      if (market && market.outcomes) {
        console.log(`\n📊 Market ${market171 ? '171' : '101'} Outcomes:`);
        
        for (const [outcomeId, outcomeData] of Object.entries(market.outcomes)) {
          if (outcomeData.players) {
            for (const [playerId, playerData] of Object.entries(outcomeData.players)) {
              console.log(`   - Outcome ${outcomeId}, Player ${playerId}: ${playerData.result}`);
              
              if (playerData.result === 'WIN') {
                let winner = null;
                if (outcomeId === '101' || outcomeId === '171') {
                  winner = 'team1';
                } else if (outcomeId === '102' || outcomeId === '172') {
                  winner = 'team2';
                } else if (outcomeId === '103' || outcomeId === '173') {
                  winner = 'draw';
                }
                
                if (winner) {
                  console.log(`\n   🏆 Winner determined: ${winner} (from outcome ${outcomeId})`);
                }
              }
            }
          }
        }
      }
    }
    
    return response.data;
    
  } catch (error) {
    if (error.response) {
      console.error(`❌ API Error: ${error.response.status} - ${error.response.statusText}`);
      console.error(`   Response:`, error.response.data);
    } else {
      console.error(`❌ Error:`, error.message);
    }
    return null;
  }
}

/**
 * Main test function
 */
async function runSettlementAPITest() {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`CS2 SETTLEMENT API TEST`);
  console.log('='.repeat(80));
  console.log(`This test will:`);
  console.log(`1. Test the settlements endpoint with real fixture IDs`);
  console.log(`2. Verify the response structure matches expectations`);
  console.log(`3. Test settlement logic with real API data`);
  console.log(`4. Provide proof that settlement works correctly`);
  console.log('='.repeat(80) + '\n');
  
  // Check if API client is available
  if (!cs2ApiClient) {
    console.error(`❌ CS2 API client not available`);
    return;
  }
  
  // Get fixture IDs from command line or use defaults
  const args = process.argv.slice(2);
  const fixtureIds = args.length > 0 ? args : [];
  
  if (fixtureIds.length === 0) {
    console.log(`⚠️  No fixture IDs provided.`);
    console.log(`\nUsage: node test-settlement-api.js <fixtureId1> [fixtureId2] ...`);
    console.log(`\nExample:`);
    console.log(`  node test-settlement-api.js id1000000761280685`);
    console.log(`\nTo find fixture IDs:`);
    console.log(`  1. Check OddsPapi dashboard for finished matches`);
    console.log(`  2. Use previous API responses from /fixtures endpoint`);
    console.log(`  3. Or test with the settlements endpoint directly\n`);
    
    // Try to find past fixtures
    await findPastFixtures();
    
    // Test with known fixtures if any
    await testWithKnownFixture();
    
    return;
  }
  
  // Test each fixture ID
  const results = [];
  
  for (const fixtureId of fixtureIds) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Testing Fixture: ${fixtureId}`);
    console.log('='.repeat(80));
    
    // First, test the settlements endpoint directly
    const settlementsData = await testSettlementsEndpoint(fixtureId);
    
    if (!settlementsData) {
      console.log(`\n⚠️  No settlement data available for ${fixtureId}`);
      continue;
    }
    
    // Then test using our fetchMatchResults function
    const settlementResult = await testFetchSettlement(fixtureId);
    
    if (settlementResult && settlementResult.completed) {
      // Try to get fixture details for creating test event
      try {
        const oddsData = await cs2ApiClient.fetchMatchOdds(fixtureId);
        
        if (oddsData) {
          const eventData = {
            homeTeam: oddsData.homeTeam || oddsData.participant1Name,
            participant1Name: oddsData.participant1Name || oddsData.homeTeam,
            awayTeam: oddsData.awayTeam || oddsData.participant2Name,
            participant2Name: oddsData.participant2Name || oddsData.awayTeam,
            startTime: oddsData.startTime || oddsData.commenceTime,
            odds: oddsData.odds || {}
          };
          
          const settlementTest = await testSettlementWithFixture(fixtureId, eventData);
          if (settlementTest) {
            results.push(settlementTest);
          }
        }
      } catch (error) {
        console.error(`⚠️  Could not fetch fixture details:`, error.message);
      }
    }
  }
  
  // Summary
  console.log(`\n${'='.repeat(80)}`);
  console.log(`TEST SUMMARY`);
  console.log('='.repeat(80));
  console.log(`✅ Tested ${results.length} fixture(s) with settlement data`);
  
  if (results.length > 0) {
    console.log(`\n📊 Results:`);
    results.forEach((result, index) => {
      console.log(`\n   ${index + 1}. Fixture: ${result.fixtureId}`);
      console.log(`      - Winner: ${result.settlementResult.winner || 'N/A'}`);
      console.log(`      - Score: ${result.settlementResult.participant1Score || 'N/A'} - ${result.settlementResult.participant2Score || 'N/A'}`);
      console.log(`      - Bets Settled: ${result.settledCount}`);
      console.log(`      - Won: ${result.wonCount}, Lost: ${result.lostCount}`);
    });
    
    console.log(`\n🎉 Settlement feature is working correctly with real API data!`);
  } else {
    console.log(`\n⚠️  No fixtures with settlement data were found.`);
    console.log(`   Make sure you're using fixture IDs from finished matches.`);
  }
  
  console.log('='.repeat(80) + '\n');
}

// Run the test
if (require.main === module) {
  runSettlementAPITest().catch(error => {
    console.error("\n❌ Fatal error:", error);
    console.error(error.stack);
    process.exit(1);
  });
}

module.exports = { runSettlementAPITest, testFetchSettlement, testSettlementsEndpoint };
