/**
 * Debug script to show detailed odds from OddsPapi for specific matches
 */

const cs2ApiClient = require('./cs2-api-client');
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Configuration
const ODDSPAPI_BASE_URL = process.env.ODDSPAPI_BASE_URL || 'https://api.oddspapi.io/v4';
const ODDSPAPI_API_KEY = process.env.ODDSPAPI_API_KEY || '492c4517-843e-49d5-96dd-8eed82567c5b';
const ODDSPAPI_LANGUAGE = process.env.ODDSPAPI_LANGUAGE || 'en';
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

/**
 * Make authenticated request to OddsPapi API
 */
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
    language: ODDSPAPI_LANGUAGE
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

/**
 * Find match by team names
 */
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
  }, `Find match: ${team1} vs ${team2}`);

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

/**
 * Display detailed odds breakdown for a match
 */
async function displayDetailedOdds(matchName, team1, team2) {
  console.log('\n' + '='.repeat(80));
  console.log(`MATCH: ${matchName}`);
  console.log(`${team1} vs ${team2}`);
  console.log('='.repeat(80));

  const match = await findMatch(team1, team2);
  if (!match) {
    console.log(`❌ Match not found!`);
    return;
  }

  const fixtureId = match.fixtureId || match.id;
  console.log(`\nFixture ID: ${fixtureId}`);
  console.log(`Start Time: ${match.startTime || match.trueStartTime || 'Unknown'}`);
  console.log(`Tournament: ${match.tournamentName || 'Unknown'}`);

  // Fetch detailed odds
  console.log(`\n📊 Fetching detailed odds from OddsPapi...`);
  const oddsData = await makeRequest('/odds', {
    fixtureId: fixtureId,
    verbosity: 3
  }, `Debug: Fetch detailed odds for fixture ${fixtureId} (${team1} vs ${team2})`);

  if (!oddsData || !oddsData.bookmakerOdds) {
    console.log('❌ No odds data available');
    return;
  }

  const bookmakerNames = Object.keys(oddsData.bookmakerOdds);
  console.log(`\nFound ${bookmakerNames.length} bookmaker(s): ${bookmakerNames.join(', ')}`);

  // Collect all odds from market 171
  const allTeam1Odds = [];
  const allTeam2Odds = [];
  const oddsByBookmaker = {};

  for (const bookmakerName of bookmakerNames) {
    const bookmaker = oddsData.bookmakerOdds[bookmakerName];
    if (!bookmaker || !bookmaker.markets) continue;

    const market = bookmaker.markets['171'];
    if (!market || !market.outcomes) continue;

    let outcome171Price = null;
    let outcome172Price = null;

    if (market.outcomes['171'] && market.outcomes['171'].players) {
      for (const playerId in market.outcomes['171'].players) {
        const player = market.outcomes['171'].players[playerId];
        if (player && player.active && player.price) {
          outcome171Price = parseFloat(player.price);
          break;
        }
      }
    }

    if (market.outcomes['172'] && market.outcomes['172'].players) {
      for (const playerId in market.outcomes['172'].players) {
        const player = market.outcomes['172'].players[playerId];
        if (player && player.active && player.price) {
          outcome172Price = parseFloat(player.price);
          break;
        }
      }
    }

    if (outcome171Price && outcome172Price) {
      // Determine which is which based on typical pattern
      // Usually 171 = participant1, 172 = participant2
      // But we need to check which team is which
      const p1Name = (oddsData.participant1Name || '').toLowerCase();
      const p2Name = (oddsData.participant2Name || '').toLowerCase();
      const team1Lower = team1.toLowerCase();
      const team2Lower = team2.toLowerCase();

      // Check if participant1 matches team1
      const p1IsTeam1 = p1Name.includes(team1Lower) || team1Lower.includes(p1Name);
      
      let team1Odds, team2Odds;
      if (p1IsTeam1) {
        team1Odds = outcome171Price;
        team2Odds = outcome172Price;
      } else {
        // Might be reversed - check if lower odds = favorite
        if (outcome171Price < outcome172Price) {
          // 171 is favorite - check if it matches team1 or team2
          if (p1Name.includes(team1Lower)) {
            team1Odds = outcome171Price;
            team2Odds = outcome172Price;
          } else {
            team1Odds = outcome172Price;
            team2Odds = outcome171Price;
          }
        } else {
          // 172 is favorite
          if (p1Name.includes(team1Lower)) {
            team1Odds = outcome172Price;
            team2Odds = outcome171Price;
          } else {
            team1Odds = outcome171Price;
            team2Odds = outcome172Price;
          }
        }
      }

      oddsByBookmaker[bookmakerName] = {
        team1: team1Odds,
        team2: team2Odds,
        outcome171: outcome171Price,
        outcome172: outcome172Price
      };

      allTeam1Odds.push(team1Odds);
      allTeam2Odds.push(team2Odds);
    }
  }

  // Display breakdown
  console.log(`\n📈 ODDS BREAKDOWN BY BOOKMAKER (Market 171):`);
  console.log('-'.repeat(80));
  console.log(`${'Bookmaker'.padEnd(20)} | ${team1.padEnd(25)} | ${team2.padEnd(25)}`);
  console.log('-'.repeat(80));

  for (const bookmakerName of Object.keys(oddsByBookmaker).sort()) {
    const odds = oddsByBookmaker[bookmakerName];
    console.log(
      `${bookmakerName.padEnd(20)} | ${odds.team1.toFixed(2).padEnd(25)} | ${odds.team2.toFixed(2).padEnd(25)}`
    );
  }

  // Show statistics
  console.log('\n📊 STATISTICS:');
  console.log('-'.repeat(80));
  
  if (allTeam1Odds.length > 0) {
    const sorted1 = [...allTeam1Odds].sort((a, b) => a - b);
    const min1 = sorted1[0];
    const max1 = sorted1[sorted1.length - 1];
    const median1 = sorted1[Math.floor(sorted1.length / 2)];
    const avg1 = allTeam1Odds.reduce((a, b) => a + b, 0) / allTeam1Odds.length;

    console.log(`\n${team1}:`);
    console.log(`  Count: ${allTeam1Odds.length} bookmakers`);
    console.log(`  Range: ${min1.toFixed(2)} - ${max1.toFixed(2)}`);
    console.log(`  Median: ${median1.toFixed(2)}`);
    console.log(`  Average: ${avg1.toFixed(2)}`);
    console.log(`  All values: ${sorted1.map(o => o.toFixed(2)).join(', ')}`);
  }

  if (allTeam2Odds.length > 0) {
    const sorted2 = [...allTeam2Odds].sort((a, b) => a - b);
    const min2 = sorted2[0];
    const max2 = sorted2[sorted2.length - 1];
    const median2 = sorted2[Math.floor(sorted2.length / 2)];
    const avg2 = allTeam2Odds.reduce((a, b) => a + b, 0) / allTeam2Odds.length;

    console.log(`\n${team2}:`);
    console.log(`  Count: ${allTeam2Odds.length} bookmakers`);
    console.log(`  Range: ${min2.toFixed(2)} - ${max2.toFixed(2)}`);
    console.log(`  Median: ${median2.toFixed(2)}`);
    console.log(`  Average: ${avg2.toFixed(2)}`);
    console.log(`  All values: ${sorted2.map(o => o.toFixed(2)).join(', ')}`);
  }

  // Show what the current logic would select
  console.log('\n🔍 CURRENT LOGIC SELECTION:');
  console.log('-'.repeat(80));
  
  // Simulate the calculateCommonRangeOdds function
  function calculateCommonRangeOdds(oddsArray) {
    if (!oddsArray || oddsArray.length === 0) return null;
    const validOdds = oddsArray.filter(odds => odds && odds > 0 && isFinite(odds));
    if (validOdds.length === 0) return null;
    if (validOdds.length <= 2) {
      const avg = validOdds.reduce((a, b) => a + b, 0) / validOdds.length;
      return parseFloat(avg.toFixed(2));
    }
    const sortedOdds = [...validOdds].sort((a, b) => a - b);
    let bestRange = null;
    let maxCount = 0;
    const rangeSize = 0.5;

    for (let i = 0; i < sortedOdds.length; i++) {
      const rangeStart = sortedOdds[i];
      const rangeEnd = rangeStart + rangeSize;
      const count = sortedOdds.filter(odds => odds >= rangeStart && odds <= rangeEnd).length;
      if (count > maxCount) {
        maxCount = count;
        bestRange = { start: rangeStart, end: rangeEnd, count };
      }
    }

    if (bestRange && bestRange.count >= Math.max(3, Math.floor(validOdds.length * 0.5))) {
      const commonRangeOdds = sortedOdds.filter(odds => 
        odds >= bestRange.start && odds <= bestRange.end
      );
      const midIndex = Math.floor(commonRangeOdds.length / 2);
      return parseFloat(commonRangeOdds[midIndex].toFixed(2));
    }

    const midIndex = Math.floor(sortedOdds.length / 2);
    return parseFloat(sortedOdds[midIndex].toFixed(2));
  }

  const selectedTeam1 = calculateCommonRangeOdds(allTeam1Odds);
  const selectedTeam2 = calculateCommonRangeOdds(allTeam2Odds);

  console.log(`Selected ${team1} odds: ${selectedTeam1}`);
  console.log(`Selected ${team2} odds: ${selectedTeam2}`);
}

/**
 * Main function
 */
async function main() {
  console.log('='.repeat(80));
  console.log('DEBUG: Detailed Odds Breakdown for Problematic Matches');
  console.log('='.repeat(80));

  // Match 1: Team Gamerlegion vs Team Vitality
  await displayDetailedOdds(
    'Blast Premier Series',
    'Team Gamerlegion',
    'Team Vitality'
  );

  // Wait between requests
  await new Promise(resolve => setTimeout(resolve, 600));

  // Match 2: Parivision vs Team Spirit
  await displayDetailedOdds(
    'Blast Premier Series',
    'Parivision',
    'Team Spirit'
  );

  console.log('\n' + '='.repeat(80));
  console.log('Complete!');
  console.log('='.repeat(80));
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { displayDetailedOdds, findMatch };
