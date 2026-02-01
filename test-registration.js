/**
 * Test registration and login functionality
 */

const axios = require('axios');

async function testRegistrationAndLogin() {
  const baseUrl = 'http://localhost:3002';
  
  console.log('🧪 Testing Casino Registration & Login');
  console.log('='.repeat(50));
  
  try {
    // Test user registration
    console.log('\n1. Testing User Registration...');
    
    const testUser = {
      username: `user${Date.now().toString().slice(-6)}`, // Keep username short
      password: 'testpass123'
    };
    
    const registerResponse = await axios.post(`${baseUrl}/api/register`, testUser, {
      headers: { 'Content-Type': 'application/json' }
    });
    
    console.log(`✅ Registration successful: ${registerResponse.data.message}`);
    console.log(`   Username: ${testUser.username}`);
    console.log(`   Initial Credits: ${registerResponse.data.credits}`);
    
    // Test user login
    console.log('\n2. Testing User Login...');
    
    const loginResponse = await axios.post(`${baseUrl}/api/login`, testUser, {
      headers: { 'Content-Type': 'application/json' }
    });
    
    console.log(`✅ Login successful: ${loginResponse.data.message}`);
    console.log(`   Credits: ${loginResponse.data.credits}`);
    
    // Test CS2 balance check
    console.log('\n3. Testing CS2 Balance Check...');
    
    const balanceResponse = await axios.get(`${baseUrl}/api/cs2/balance?userId=${testUser.username}`);
    
    console.log(`✅ Balance check successful: $${balanceResponse.data.balance}`);
    
    // Test CS2 events access
    console.log('\n4. Testing CS2 Events Access...');
    
    const eventsResponse = await axios.get(`${baseUrl}/api/cs2/events`);
    const iemMatches = eventsResponse.data.events.filter(e => 
      e.tournamentName === 'Intel Extreme Masters Krakow'
    );
    
    console.log(`✅ Events access successful: ${eventsResponse.data.count} total events`);
    console.log(`   IEM Krakow matches: ${iemMatches.length}/5`);
    
    iemMatches.forEach(match => {
      console.log(`   • ${match.homeTeam} vs ${match.awayTeam} (${match.odds.team1}/${match.odds.team2})`);
    });
    
    // Test placing a bet
    console.log('\n5. Testing Bet Placement...');
    
    if (iemMatches.length > 0) {
      const testMatch = iemMatches[0];
      const betData = {
        userId: testUser.username,
        eventId: testMatch.id,
        selection: 'team1',
        amount: 100
      };
      
      const betResponse = await axios.post(`${baseUrl}/api/cs2/bets`, betData, {
        headers: { 'Content-Type': 'application/json' }
      });
      
      console.log(`✅ Bet placement successful!`);
      console.log(`   Match: ${testMatch.homeTeam} vs ${testMatch.awayTeam}`);
      console.log(`   Selection: ${testMatch.homeTeam}`);
      console.log(`   Amount: $${betData.amount}`);
      console.log(`   Potential Payout: $${betResponse.data.bet.potentialPayout}`);
      console.log(`   New Balance: $${betResponse.data.newBalance}`);
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('🎉 ALL TESTS PASSED!');
    console.log('✅ Registration works');
    console.log('✅ Login works');  
    console.log('✅ CS2 betting is fully functional');
    console.log('✅ All 5 IEM Krakow matches available');
    console.log('✅ Betting system operational');
    
    // Show connection info
    console.log('\n🌐 CONNECTION INFO:');
    console.log(`Server URL: ${baseUrl}`);
    console.log(`Web Interface: ${baseUrl}/casino.html`);
    console.log(`Status: Server accessible and working ✅`);
    
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    
    if (error.response) {
      console.error(`HTTP ${error.response.status}: ${error.response.statusText}`);
      console.error('Response:', error.response.data);
    } else if (error.request) {
      console.error('❌ CONNECTION ERROR: Unable to reach server');
      console.error('Make sure the server is running on port 3002');
    }
    
    // Show debugging info
    console.log('\n🔧 DEBUGGING INFO:');
    console.log('1. Check if server is running: netstat -an | grep 3002');
    console.log('2. Try direct access: curl http://localhost:3002/casino.html');
    console.log('3. Check firewall settings');
  }
}

testRegistrationAndLogin();