/**
 * Get local IP address for mobile access
 */

const os = require('os');

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  
  console.log('📱 Mobile Access Setup for CS2 Betting System');
  console.log('='.repeat(50));
  
  let foundIPs = [];
  
  for (const name of Object.keys(interfaces)) {
    for (const interface of interfaces[name]) {
      // Skip internal (loopback) and non-IPv4 addresses
      if (interface.family === 'IPv4' && !interface.internal) {
        foundIPs.push({
          name: name,
          address: interface.address
        });
      }
    }
  }
  
  if (foundIPs.length > 0) {
    console.log('\n🌐 Found local IP addresses:');
    foundIPs.forEach((ip, index) => {
      console.log(`${index + 1}. ${ip.name}: ${ip.address}`);
    });
    
    // Use the first non-loopback IP (usually the main network connection)
    const primaryIP = foundIPs[0].address;
    
    console.log(`\n🎯 Primary IP Address: ${primaryIP}`);
    console.log('\n📱 MOBILE ACCESS URLS:');
    console.log(`🎮 Casino: http://${primaryIP}:3002/casino.html`);
    console.log(`📊 CS2 API: http://${primaryIP}:3002/api/cs2/events`);
    
    console.log('\n📋 INSTRUCTIONS:');
    console.log('1. Make sure your phone is on the same WiFi network');
    console.log('2. Open browser on your phone');
    console.log(`3. Go to: http://${primaryIP}:3002/casino.html`);
    console.log('4. Register/login and access CS2 betting');
    
    console.log('\n🔧 TESTING:');
    console.log('If the URL doesn\'t work, try these alternatives:');
    foundIPs.forEach((ip, index) => {
      if (index > 0) {
        console.log(`   Alternative ${index}: http://${ip.address}:3002/casino.html`);
      }
    });
    
    return primaryIP;
  } else {
    console.log('\n❌ No network interfaces found');
    console.log('Make sure you\'re connected to WiFi or ethernet');
    return null;
  }
}

const ip = getLocalIP();

if (ip) {
  console.log('\n✅ SUCCESS!');
  console.log(`📱 Use this URL on your phone: http://${ip}:3002/casino.html`);
} else {
  console.log('\n❌ Could not determine IP address');
  console.log('Try checking your network settings manually');
}