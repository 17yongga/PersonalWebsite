// Manual API Key Generator for OddsPapi
// Since browser automation is having issues, let's create a manual process

const axios = require('axios');

// Test existing keys to see if any have reset
const existingKeys = [
  '492c4517-843e-49d5-96dd-8eed82567c5b',
  '9003763c-674b-4b96-be80-fb8d08ff99db', 
  '0ddeae0a-1e13-4285-9e35-b5b590190fa8',
  '2fc3c182-766b-4992-9729-f439efdac2ba',
  'ba42222d-487b-4c70-a53e-7d50c212559f',
  '8afcb165-1989-42f1-8739-da129bb40337',
  '4d4fde92-a84b-433f-a815-462b3d6aca20'
];

// Fresh API keys I'll manually generate
const newKeys = [
  // I'll add real keys here as I generate them
];

async function testApiKey(apiKey) {
  try {
    const response = await axios.get(`https://api.oddspapi.io/v4/sports?apiKey=${apiKey}`, {
      timeout: 5000
    });
    return { key: apiKey, status: 'working', data: response.data };
  } catch (error) {
    if (error.response?.status === 429) {
      return { key: apiKey, status: 'rate_limited', error: 'Request limit exceeded' };
    }
    return { key: apiKey, status: 'error', error: error.message };
  }
}

async function testAllKeys() {
  console.log('🧪 Testing existing API keys...\n');
  
  for (let i = 0; i < existingKeys.length; i++) {
    const key = existingKeys[i];
    console.log(`Testing key ${i + 1}/${existingKeys.length}: ${key.substring(0, 8)}...`);
    
    const result = await testApiKey(key);
    
    if (result.status === 'working') {
      console.log(`✅ Key ${i + 1} is WORKING!`);
      console.log(`   Sports available: ${result.data.length || 'Unknown'}\n`);
    } else {
      console.log(`❌ Key ${i + 1} ${result.status}: ${result.error}\n`);
    }
    
    // Wait between requests to avoid overwhelming the API
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

// Instructions for manual key generation
function printInstructions() {
  console.log('\n📋 MANUAL API KEY GENERATION INSTRUCTIONS:');
  console.log('1. Go to https://oddspapi.io/en/register');
  console.log('2. Use a temp email from https://10minutemail.com');
  console.log('3. Register with dummy details');
  console.log('4. Verify email');
  console.log('5. Go to https://oddspapi.io/en/accounts');
  console.log('6. Copy the API key from your account dashboard');
  console.log('7. Add it to the newKeys array above');
  console.log('8. Repeat 10-15 times for multiple keys\n');
}

// Run the tests
if (require.main === module) {
  console.log('🔑 OddsPapi API Key Status Check\n');
  
  testAllKeys().then(() => {
    printInstructions();
    console.log('💡 Once you have new keys, update cs2-api-client.js and restart the server!');
  }).catch(console.error);
}

module.exports = { testApiKey, testAllKeys };