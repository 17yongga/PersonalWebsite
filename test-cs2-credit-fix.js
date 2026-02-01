// Test Script for CS2 Credit Balance Fix
// Run this to verify the fix works correctly

const axios = require('axios');

const BASE_URL = 'http://localhost:3001';
const TEST_USER = 'test-user-' + Date.now();

async function testCS2CreditBalance() {
  try {
    console.log('🧪 Testing CS2 Credit Balance Fix...\n');
    
    // Step 1: Check initial balance
    console.log('1. Checking initial balance...');
    let balanceResponse = await axios.get(`${BASE_URL}/api/cs2/balance?userId=${TEST_USER}`);
    console.log(`   Initial balance: ${balanceResponse.data.balance}`);
    const initialBalance = balanceResponse.data.balance;
    
    // Step 2: Get available events
    console.log('\n2. Fetching available CS2 events...');
    const eventsResponse = await axios.get(`${BASE_URL}/api/cs2/events`);
    const events = eventsResponse.data.events;
    console.log(`   Found ${events.length} events`);
    
    if (events.length === 0) {
      console.log('❌ No events available for testing');
      return;
    }
    
    // Find an event with odds
    const eventWithOdds = events.find(event => 
      event.odds && 
      event.odds.team1 && 
      event.odds.team2 && 
      event.status === 'scheduled'
    );
    
    if (!eventWithOdds) {
      console.log('❌ No events with odds available for testing');
      console.log('   Available events:', events.map(e => ({ id: e.id, status: e.status, hasOdds: !!e.odds })));
      return;
    }
    
    console.log(`   Testing with event: ${eventWithOdds.id}`);
    console.log(`   Teams: ${eventWithOdds.teams?.team1?.name} vs ${eventWithOdds.teams?.team2?.name}`);
    console.log(`   Odds: ${eventWithOdds.odds.team1} / ${eventWithOdds.odds.team2}`);
    
    // Step 3: Place a test bet
    const betAmount = 100;
    const selection = 'team1';
    
    console.log(`\n3. Placing test bet...`);
    console.log(`   Amount: ${betAmount}, Selection: ${selection}`);
    
    const betResponse = await axios.post(`${BASE_URL}/api/cs2/bets`, {
      userId: TEST_USER,
      eventId: eventWithOdds.id,
      selection: selection,
      amount: betAmount
    });
    
    if (!betResponse.data.success) {
      console.log('❌ Bet placement failed:', betResponse.data.error);
      return;
    }
    
    console.log('   ✅ Bet placed successfully');
    console.log(`   New balance from API: ${betResponse.data.newBalance}`);
    
    // Step 4: Verify balance was deducted correctly
    console.log('\n4. Verifying balance deduction...');
    balanceResponse = await axios.get(`${BASE_URL}/api/cs2/balance?userId=${TEST_USER}`);
    const newBalance = balanceResponse.data.balance;
    console.log(`   Current balance: ${newBalance}`);
    console.log(`   Expected balance: ${initialBalance - betAmount}`);
    
    if (newBalance === initialBalance - betAmount) {
      console.log('   ✅ Balance deduction is CORRECT');
    } else {
      console.log('   ❌ Balance deduction is INCORRECT');
      console.log(`   Difference: ${Math.abs(newBalance - (initialBalance - betAmount))}`);
    }
    
    // Step 5: Check bet was recorded
    console.log('\n5. Checking bet record...');
    console.log(`   Bet ID: ${betResponse.data.bet.id}`);
    console.log(`   Status: ${betResponse.data.bet.status}`);
    console.log(`   Potential payout: ${betResponse.data.bet.potentialPayout}`);
    
    console.log('\n🎉 Credit balance test completed!');
    
    // Summary
    console.log('\n📊 SUMMARY:');
    console.log(`   Initial balance: ${initialBalance}`);
    console.log(`   Bet amount: ${betAmount}`);
    console.log(`   Final balance: ${newBalance}`);
    console.log(`   Balance change: ${newBalance - initialBalance}`);
    console.log(`   Test result: ${newBalance === initialBalance - betAmount ? '✅ PASS' : '❌ FAIL'}`);
    
  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
    if (error.response?.data) {
      console.error('   Server response:', error.response.data);
    }
  }
}

// Run the test
testCS2CreditBalance();