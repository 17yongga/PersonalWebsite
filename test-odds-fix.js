/**
 * Test the fixed odds extraction logic
 */

const cs2ApiClient = require('./cs2-api-client');

async function testMatch(team1, team2) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Testing: ${team1} vs ${team2}`);
  console.log('='.repeat(80));

  // Find the match
  const sportId = await cs2ApiClient.findCS2SportId();
  const now = new Date();
  const fromDate = new Date(now);
  fromDate.setHours(0, 0, 0, 0);
  const toDate = new Date(fromDate);
  toDate.setDate(toDate.getDate() + 7);

  const axios = require('axios');
  const https = require('https');
  const fs = require('fs');
  const path = require('path');
  const ODDSPAPI_BASE_URL = process.env.ODDSPAPI_BASE_URL || 'https://api.oddspapi.io/v4';
  const ODDSPAPI_API_KEY = process.env.ODDSPAPI_API_KEY || '492c4517-843e-49d5-96dd-8eed82567c5b';
  
  // API Call Logging
  const API_LOG_FILE = path.join(__dirname, 'oddspapi-api-calls.log');
  const startTime = Date.now();

  const fixturesData = await axios.get(`${ODDSPAPI_BASE_URL}/fixtures`, {
    params: {
      sportId: sportId,
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      apiKey: ODDSPAPI_API_KEY,
      language: 'en'
    },
    timeout: 15000,
    httpsAgent: new https.Agent({ rejectUnauthorized: true })
  });
  
  // Log API call
  const responseTime = Date.now() - startTime;
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    endpoint: '/fixtures',
    purpose: `Test: Find match for odds fix verification (${team1} vs ${team2})`,
    params: { sportId, from: fromDate.toISOString(), to: toDate.toISOString(), apiKey: '[REDACTED]' },
    status: 'success',
    errorMessage: null,
    responseTime: responseTime
  };
  const logLine = JSON.stringify(logEntry) + '\n';
  fs.appendFile(API_LOG_FILE, logLine, (err) => {
    if (err) console.error('[API Logger] Failed to write to log file:', err.message);
  });
  console.log(`[API Logger] ✓ ${timestamp} | /fixtures | Test: Find match for odds fix verification | Status: success | Time: ${responseTime}ms`);

  let fixtures = [];
  if (Array.isArray(fixturesData.data)) {
    fixtures = fixturesData.data;
  } else if (fixturesData.data && Array.isArray(fixturesData.data.fixtures)) {
    fixtures = fixturesData.data.fixtures;
  }

  const team1Lower = team1.toLowerCase();
  const team2Lower = team2.toLowerCase();
  const match = fixtures.find(f => {
    const p1 = (f.participant1Name || '').toLowerCase();
    const p2 = (f.participant2Name || '').toLowerCase();
    return (p1.includes(team1Lower) && p2.includes(team2Lower)) ||
           (p1.includes(team2Lower) && p2.includes(team1Lower));
  });

  if (!match) {
    console.log('❌ Match not found');
    return;
  }

  const fixtureId = match.fixtureId || match.id;
  console.log(`\nFixture ID: ${fixtureId}`);
  console.log(`Participant 1: ${match.participant1Name}`);
  console.log(`Participant 2: ${match.participant2Name}`);

  // Fetch odds using the fixed logic
  console.log(`\n📊 Fetching odds with fixed logic...`);
  const oddsData = await cs2ApiClient.fetchMatchOdds(fixtureId);

  if (oddsData && oddsData.odds) {
    console.log(`\n✅ RESULT:`);
    console.log(`  ${match.participant1Name}: ${oddsData.odds.team1 || 'N/A'}`);
    console.log(`  ${match.participant2Name}: ${oddsData.odds.team2 || 'N/A'}`);
    
    // Verify the mapping makes sense
    const p1Name = (match.participant1Name || '').toLowerCase();
    const p2Name = (match.participant2Name || '').toLowerCase();
    const team1Lower = team1.toLowerCase();
    const team2Lower = team2.toLowerCase();
    
    const p1IsTeam1 = p1Name.includes(team1Lower) || team1Lower.includes(p1Name);
    
    if (p1IsTeam1) {
      console.log(`\n  Expected: ${team1} should have higher odds (underdog), ${team2} should have lower odds (favorite)`);
      console.log(`  Actual: ${team1} = ${oddsData.odds.team1}, ${team2} = ${oddsData.odds.team2}`);
    } else {
      console.log(`\n  Expected: ${team2} should have higher odds (underdog), ${team1} should have lower odds (favorite)`);
      console.log(`  Actual: ${team2} = ${oddsData.odds.team1}, ${team1} = ${oddsData.odds.team2}`);
    }
  } else {
    console.log('❌ No odds data returned');
  }
}

async function main() {
  console.log('Testing Fixed Odds Extraction Logic');
  console.log('='.repeat(80));

  // Test match 1
  await testMatch('Team Gamerlegion', 'Team Vitality');
  
  // Wait for rate limit
  await new Promise(resolve => setTimeout(resolve, 600));
  
  // Test match 2
  await testMatch('Parivision', 'Team Spirit');
}

main().catch(console.error);
