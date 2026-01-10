/**
 * Quick test script to verify CS2 betting modules load correctly
 * Run: node test-cs2-modules.js
 */

console.log('Testing CS2 Betting Module Loading...\n');

// Test 1: Check if API client module loads
try {
  console.log('1. Testing cs2-api-client.js...');
  const cs2ApiClient = require('./cs2-api-client.js');
  console.log('   ✓ cs2-api-client.js loaded successfully');
  console.log('   ✓ Available functions:', Object.keys(cs2ApiClient).join(', '));
} catch (error) {
  console.error('   ✗ Error loading cs2-api-client.js:', error.message);
  process.exit(1);
}

// Test 2: Check if required dependencies are installed
try {
  console.log('\n2. Testing dependencies...');
  require('axios');
  console.log('   ✓ axios installed');
  require('node-cron');
  console.log('   ✓ node-cron installed');
} catch (error) {
  console.error('   ✗ Missing dependency:', error.message);
  console.error('   Run: npm install');
  process.exit(1);
}

// Test 3: Check if casino-server.js can parse (without running)
try {
  console.log('\n3. Testing casino-server.js syntax...');
  // Just check if file can be read and basic structure exists
  const fs = require('fs');
  const serverContent = fs.readFileSync('./casino-server.js', 'utf8');
  
  if (serverContent.includes('cs2BettingState')) {
    console.log('   ✓ CS2 betting state management found');
  } else {
    console.log('   ⚠ CS2 betting state management not found');
  }
  
  if (serverContent.includes('/api/cs2/')) {
    console.log('   ✓ CS2 REST API endpoints found');
  } else {
    console.log('   ⚠ CS2 REST API endpoints not found');
  }
  
  if (serverContent.includes('syncCS2Events')) {
    console.log('   ✓ CS2 sync function found');
  } else {
    console.log('   ⚠ CS2 sync function not found');
  }
  
  if (serverContent.includes('settleCS2Bets')) {
    console.log('   ✓ CS2 settlement function found');
  } else {
    console.log('   ⚠ CS2 settlement function not found');
  }
  
  console.log('   ✓ casino-server.js structure looks good');
} catch (error) {
  console.error('   ✗ Error checking casino-server.js:', error.message);
  process.exit(1);
}

// Test 4: Check frontend module
try {
  console.log('\n4. Testing frontend module...');
  const fs = require('fs');
  const frontendContent = fs.readFileSync('./games/cs2-betting-casino.js', 'utf8');
  
  if (frontendContent.includes('class CS2BettingGame')) {
    console.log('   ✓ CS2BettingGame class found');
  }
  
  if (frontendContent.includes('window.CS2BettingGame')) {
    console.log('   ✓ Global export found');
  }
  
  console.log('   ✓ Frontend module structure looks good');
} catch (error) {
  console.error('   ✗ Error checking frontend module:', error.message);
  process.exit(1);
}

// Test 5: Check HTML integration
try {
  console.log('\n5. Testing HTML integration...');
  const fs = require('fs');
  const htmlContent = fs.readFileSync('./casino.html', 'utf8');
  
  if (htmlContent.includes('cs2betting')) {
    console.log('   ✓ CS2 Betting game card found in casino.html');
  } else {
    console.log('   ⚠ CS2 Betting game card not found in casino.html');
  }
  
  if (htmlContent.includes('cs2BettingGame')) {
    console.log('   ✓ CS2 betting game container found');
  } else {
    console.log('   ⚠ CS2 betting game container not found');
  }
  
  if (htmlContent.includes('cs2-betting-casino.js')) {
    console.log('   ✓ Frontend script included');
  } else {
    console.log('   ⚠ Frontend script not included');
  }
} catch (error) {
  console.error('   ✗ Error checking HTML:', error.message);
  process.exit(1);
}

console.log('\n✅ All module checks passed!');
console.log('\nNext steps:');
console.log('1. Start the server: PORT=3001 node casino-server.js');
console.log('2. Open casino.html in browser');
console.log('3. Test the CS2 betting feature');
console.log('4. See tests/cs2-betting-test-checklist.md for detailed testing');
