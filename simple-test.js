// Simple test for CS2 credit balance
const axios = require('axios');

async function simpleTest() {
  const baseUrl = 'http://localhost:3001';
  const userId = 'test-' + Date.now();
  
  try {
    console.log('Testing CS2 credit balance fix...');
    
    // Check initial balance
    const balRes = await axios.get(`${baseUrl}/api/cs2/balance?userId=${userId}`);
    console.log('Initial balance:', balRes.data.balance);
    
    // Get events
    const eventsRes = await axios.get(`${baseUrl}/api/cs2/events`);
    console.log('Events found:', eventsRes.data.events?.length || 0);
    
    if (eventsRes.data.events && eventsRes.data.events.length > 0) {
      const event = eventsRes.data.events[0];
      console.log('First event:', event.id, event.status);
      
      // Try to place a bet (might fail if no odds, but that's okay)
      try {
        const betRes = await axios.post(`${baseUrl}/api/cs2/bets`, {
          userId: userId,
          eventId: event.id,
          selection: 'team1',
          amount: 100
        });
        console.log('Bet result:', betRes.data.success ? 'SUCCESS' : 'FAILED');
        if (betRes.data.success) {
          console.log('New balance:', betRes.data.newBalance);
        } else {
          console.log('Error:', betRes.data.error);
        }
      } catch (betError) {
        console.log('Bet error:', betError.response?.data?.error || betError.message);
      }
    }
    
    console.log('Test completed');
    
  } catch (error) {
    console.error('Test error:', error.message);
  }
}

simpleTest();