/**
 * Test script to investigate odds mapping issue
 * Fetches raw API data and checks if team names are associated with outcomes
 */

const cs2ApiClient = require('./cs2-api-client');
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');

const ODDSPAPI_BASE_URL = process.env.ODDSPAPI_BASE_URL || 'https://api.oddspapi.io/v4';
const ODDSPAPI_API_KEY = process.env.ODDSPAPI_API_KEY || '492c4517-843e-49d5-96dd-8eed82567c5b';
const ENDPOINT_COOLDOWN_MS = 500;
let lastRequestTime = 0;

// API Call Logging
const API_LOG_FILE = path.join(__dirname, 'oddspapi-api-calls.log');

/**
 * Log API call to file with timestamp
 */
function logApiCall(endpoint, purpose, params = {}, status = 'success', errorMessage = null, responseTime = null) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    endpoint,
    purpose,
    params: { ...params, apiKey: '[REDACTED]' },
    status,
    errorMessage: errorMessage || null,
    responseTime: responseTime || null
  };
  
  const logLine = JSON.stringify(logEntry) + '\n';
  fs.appendFile(API_LOG_FILE, logLine, (err) => {
    if (err) console.error('[API Logger] Failed to write to log file:', err.message);
  });
  
  const statusIcon = status === 'success' ? '✓' : '✗';
  console.log(`[API Logger] ${statusIcon} ${timestamp} | ${endpoint} | ${purpose} | Status: ${status}${responseTime ? ` | Time: ${responseTime}ms` : ''}`);
}

async function makeRequest(endpoint, params = {}, purpose = 'API call') {
  const startTime = Date.now();
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < ENDPOINT_COOLDOWN_MS) {
    const waitTime = ENDPOINT_COOLDOWN_MS - timeSinceLastRequest;
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  lastRequestTime = Date.now();

  const url = `${ODDSPAPI_BASE_URL}${endpoint}`;
  const queryParams = {
    ...params,
    apiKey: ODDSPAPI_API_KEY,
    language: 'en'
  };

  try {
    const response = await axios.get(url, {
      params: queryParams,
      timeout: 15000,
      httpsAgent: new https.Agent({ rejectUnauthorized: true }),
      headers: {
        'Accept': 'application/json'
      }
    });

    const responseTime = Date.now() - startTime;
    logApiCall(endpoint, purpose, params, 'success', null, responseTime);
    return response.data;
  } catch (error) {
    const responseTime = Date.now() - startTime;
    const errorMessage = error.message || 'Unknown error';
    logApiCall(endpoint, purpose, params, 'error', errorMessage, responseTime);
    throw error;
  }
}

async function findMatch(team1, team2) {
  const sportId = await cs2ApiClient.findCS2SportId();
  if (!sportId) {
    console.error('Could not find CS2 sport ID');
    return null;
  }

  const now = new Date();
  const fromDate = new Date(now);
  fromDate.setHours(0, 0, 0, 0);
  const toDate = new Date(fromDate);
  toDate.setDate(toDate.getDate() + 7);

  const data = await makeRequest('/fixtures', {
    sportId: sportId,
    from: fromDate.toISOString(),
    to: toDate.toISOString()
  });

  let fixtures = [];
  if (Array.isArray(data)) {
    fixtures = data;
  } else if (data && Array.isArray(data.fixtures)) {
    fixtures = data.fixtures;
  } else if (data && Array.isArray(data.data)) {
    fixtures = data.data;
  }

  const team1Lower = team1.toLowerCase();
  const team2Lower = team2.toLowerCase();

  const match = fixtures.find(f => {
    const p1 = (f.participant1Name || '').toLowerCase();
    const p2 = (f.participant2Name || '').toLowerCase();
    return (p1.includes(team1Lower) && p2.includes(team2Lower)) ||
           (p1.includes(team2Lower) && p2.includes(team1Lower));
  });

  return match;
}

async function analyzeOddsMapping(matchName, team1, team2) {
  console.log('\n' + '='.repeat(80));
  console.log(`ANALYZING: ${matchName}`);
  console.log(`${team1} vs ${team2}`);
  console.log('='.repeat(80));

  const match = await findMatch(team1, team2);
  if (!match) {
    console.log(`❌ Match not found!`);
    return;
  }

  const fixtureId = match.fixtureId || match.id;
  console.log(`\nFixture ID: ${fixtureId}`);
  console.log(`Participant 1: ${match.participant1Name}`);
  console.log(`Participant 2: ${match.participant2Name}`);

  // Fetch detailed odds with verbosity
  console.log(`\n📊 Fetching detailed odds from OddsPapi...`);
  const oddsData = await makeRequest('/odds', {
    fixtureId: fixtureId,
    verbosity: 3
  }, `Test: Investigate odds mapping for fixture ${fixtureId} (${team1} vs ${team2})`);

  if (!oddsData || !oddsData.bookmakerOdds) {
    console.log('❌ No odds data available');
    return;
  }

  console.log(`\n✅ API Response Structure:`);
  console.log(`- Participant1Name: ${oddsData.participant1Name || 'NOT FOUND'}`);
  console.log(`- Participant2Name: ${oddsData.participant2Name || 'NOT FOUND'}`);
  
  const bookmakerNames = Object.keys(oddsData.bookmakerOdds);
  console.log(`\nFound ${bookmakerNames.length} bookmaker(s): ${bookmakerNames.join(', ')}`);

  // Analyze Market 171 (Match Winner)
  console.log(`\n📈 ANALYZING MARKET 171 (Match Winner):`);
  console.log('-'.repeat(80));

  for (const bookmakerName of bookmakerNames.slice(0, 3)) { // Analyze first 3 bookmakers
    const bookmaker = oddsData.bookmakerOdds[bookmakerName];
    if (!bookmaker || !bookmaker.markets) continue;

    const market = bookmaker.markets['171'];
    if (!market || !market.outcomes) {
      console.log(`\n${bookmakerName}: No Market 171`);
      continue;
    }

    console.log(`\n${bookmakerName}:`);
    console.log(`  Market 171 structure:`, JSON.stringify(market, null, 2).substring(0, 500));

    // Check if outcomes have team names
    if (market.outcomes['171']) {
      const outcome171 = market.outcomes['171'];
      console.log(`  Outcome 171:`);
      console.log(`    - Name: ${outcome171.name || 'NO NAME'}`);
      console.log(`    - Description: ${outcome171.description || 'NO DESCRIPTION'}`);
      console.log(`    - Players:`, Object.keys(outcome171.players || {}).length, 'players');
      
      // Check players for team names
      if (outcome171.players) {
        for (const playerId in outcome171.players) {
          const player = outcome171.players[playerId];
          console.log(`      Player ${playerId}:`, {
            name: player.name,
            price: player.price,
            active: player.active
          });
        }
      }
    }

    if (market.outcomes['172']) {
      const outcome172 = market.outcomes['172'];
      console.log(`  Outcome 172:`);
      console.log(`    - Name: ${outcome172.name || 'NO NAME'}`);
      console.log(`    - Description: ${outcome172.description || 'NO DESCRIPTION'}`);
      console.log(`    - Players:`, Object.keys(outcome172.players || {}).length, 'players');
      
      if (outcome172.players) {
        for (const playerId in outcome172.players) {
          const player = outcome172.players[playerId];
          console.log(`      Player ${playerId}:`, {
            name: player.name,
            price: player.price,
            active: player.active
          });
        }
      }
    }
  }

  // Try to extract odds and see current mapping
  console.log(`\n🔍 CURRENT MAPPING TEST:`);
  console.log('-'.repeat(80));
  
  const oddsResult = await cs2ApiClient.fetchMatchOdds(fixtureId);
  if (oddsResult && oddsResult.odds) {
    console.log(`Current result from cs2ApiClient:`);
    console.log(`  ${match.participant1Name}: ${oddsResult.odds.team1 || 'N/A'}`);
    console.log(`  ${match.participant2Name}: ${oddsResult.odds.team2 || 'N/A'}`);
    
    // Expected mapping
    const p1Lower = (match.participant1Name || '').toLowerCase();
    const p2Lower = (match.participant2Name || '').toLowerCase();
    const team1Lower = team1.toLowerCase();
    const team2Lower = team2.toLowerCase();
    
    const p1IsTeam1 = p1Lower.includes(team1Lower) || team1Lower.includes(p1Lower);
    
    if (p1IsTeam1) {
      console.log(`\nExpected:`);
      console.log(`  ${team1} (participant1) should have ${team1 === 'Team Vitality' ? 'HIGH' : 'LOW'} odds`);
      console.log(`  ${team2} (participant2) should have ${team2 === 'Team Vitality' ? 'HIGH' : 'LOW'} odds`);
    } else {
      console.log(`\nExpected:`);
      console.log(`  ${team2} (participant1) should have ${team2 === 'Team Vitality' ? 'HIGH' : 'LOW'} odds`);
      console.log(`  ${team1} (participant2) should have ${team1 === 'Team Vitality' ? 'HIGH' : 'LOW'} odds`);
    }
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log('ODDS MAPPING INVESTIGATION');
  console.log('='.repeat(80));

  // Match 1: Team Gamerlegion vs Team Vitality
  await analyzeOddsMapping(
    'Blast Premier Series',
    'Team Gamerlegion',
    'Team Vitality'
  );

  // Wait between requests
  await new Promise(resolve => setTimeout(resolve, 600));

  // Match 2: Parivision vs Team Spirit
  await analyzeOddsMapping(
    'Blast Premier Series',
    'Parivision',
    'Team Spirit'
  );

  console.log('\n' + '='.repeat(80));
  console.log('Investigation Complete!');
  console.log('='.repeat(80));
}

main().catch(console.error);
