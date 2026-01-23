/**
 * Script to fetch odds for Team Vitality vs GamerLegion match
 * from BLAST Bounty Winter 2026 tournament
 */

const cs2ApiClient = require('./cs2-api-client');
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Configuration from cs2-api-client
const ODDSPAPI_BASE_URL = process.env.ODDSPAPI_BASE_URL || 'https://api.oddspapi.io/v4';
const ODDSPAPI_API_KEY = process.env.ODDSPAPI_API_KEY || '492c4517-843e-49d5-96dd-8eed82567c5b';
const ODDSPAPI_LANGUAGE = process.env.ODDSPAPI_LANGUAGE || 'en';
const ENDPOINT_COOLDOWN_MS = 500; // 500ms cooldown between requests (per API docs)
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
  // Respect API cooldown (500ms between requests)
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < ENDPOINT_COOLDOWN_MS) {
    const waitTime = ENDPOINT_COOLDOWN_MS - timeSinceLastRequest;
    console.log(`[Rate Limit] Waiting ${waitTime}ms before request...`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  lastRequestTime = Date.now();
  const url = `${ODDSPAPI_BASE_URL}${endpoint}`;
  const queryParams = {
    ...params,
    apiKey: ODDSPAPI_API_KEY,
    language: ODDSPAPI_LANGUAGE
  };

  console.log(`\n[Fetch] Requesting: ${endpoint}`);
  if (Object.keys(params).length > 0) {
    console.log(`[Fetch] Parameters:`, params);
  }

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
    
    console.error(`[Fetch] Error:`, errorMessage);
    if (error.response) {
      console.error(`[Fetch] Status: ${error.response.status}`);
      console.error(`[Fetch] Data:`, JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}

/**
 * Search for tournaments by name
 */
async function searchTournaments(searchTerm) {
  try {
    console.log(`\n[Tournament Search] Looking for tournaments matching: "${searchTerm}"`);
    
    // Get all tournaments (may need to filter by sportId for CS2)
    const sportId = await cs2ApiClient.findCS2SportId();
    if (!sportId) {
      console.error('[Tournament Search] Could not find CS2 sport ID');
      return [];
    }

    console.log(`[Tournament Search] Using CS2 sport ID: ${sportId}`);

    // Fetch tournaments for CS2
    const data = await makeRequest('/tournaments', {
      sportId: sportId
    }, `Search for tournaments matching "${searchTerm}"`);

    let tournaments = [];
    if (Array.isArray(data)) {
      tournaments = data;
    } else if (data && Array.isArray(data.tournaments)) {
      tournaments = data.tournaments;
    } else if (data && Array.isArray(data.data)) {
      tournaments = data.data;
    }

    console.log(`[Tournament Search] Found ${tournaments.length} tournaments`);

    // Filter by search term (case-insensitive)
    const searchLower = searchTerm.toLowerCase();
    const matching = tournaments.filter(t => {
      const name = (t.name || t.title || t.slug || '').toLowerCase();
      return name.includes(searchLower);
    });

    console.log(`[Tournament Search] Found ${matching.length} matching tournaments:`);
    matching.forEach(t => {
      const id = t.id || t.tournamentId || t.tournament_id;
      const name = t.name || t.title || t.slug || 'Unknown';
      console.log(`  - "${name}" (ID: ${id})`);
    });

    return matching;
  } catch (error) {
    console.error('[Tournament Search] Error:', error.message);
    return [];
  }
}

/**
 * Search for fixtures matching team names and tournament
 */
async function findMatch(team1, team2, tournamentId = null) {
  try {
    console.log(`\n[Match Search] Looking for: ${team1} vs ${team2}`);
    
    const sportId = await cs2ApiClient.findCS2SportId();
    if (!sportId) {
      console.error('[Match Search] Could not find CS2 sport ID');
      return null;
    }

    // Calculate date range (today to 7 days from now)
    const now = new Date();
    const fromDate = new Date(now);
    fromDate.setHours(0, 0, 0, 0);
    
    const toDate = new Date(fromDate);
    toDate.setDate(toDate.getDate() + 7);
    toDate.setHours(23, 59, 59, 999);

    const params = {
      sportId: sportId,
      from: fromDate.toISOString(),
      to: toDate.toISOString()
    };

    if (tournamentId) {
      params.tournamentId = tournamentId;
    }

    console.log(`[Match Search] Fetching fixtures from ${params.from} to ${params.to}`);

    const data = await makeRequest('/fixtures', params);

    let fixtures = [];
    if (Array.isArray(data)) {
      fixtures = data;
    } else if (data && Array.isArray(data.fixtures)) {
      fixtures = data.fixtures;
    } else if (data && Array.isArray(data.data)) {
      fixtures = data.data;
    }

    console.log(`[Match Search] Found ${fixtures.length} fixtures`);

    // Search for matching teams
    const team1Lower = team1.toLowerCase();
    const team2Lower = team2.toLowerCase();

    const matches = fixtures.filter(f => {
      const p1 = (f.participant1Name || '').toLowerCase();
      const p2 = (f.participant2Name || '').toLowerCase();
      
      return (p1.includes(team1Lower) && p2.includes(team2Lower)) ||
             (p1.includes(team2Lower) && p2.includes(team1Lower));
    });

    console.log(`[Match Search] Found ${matches.length} matching fixture(s):`);
    matches.forEach(m => {
      const id = m.fixtureId || m.id;
      const p1 = m.participant1Name || 'TBD';
      const p2 = m.participant2Name || 'TBD';
      const tournament = m.tournamentName || 'Unknown';
      const startTime = m.startTime || m.trueStartTime || 'Unknown';
      console.log(`  - ${p1} vs ${p2}`);
      console.log(`    Tournament: ${tournament}`);
      console.log(`    Start Time: ${startTime}`);
      console.log(`    Fixture ID: ${id}`);
    });

    return matches.length > 0 ? matches[0] : null;
  } catch (error) {
    console.error('[Match Search] Error:', error.message);
    return null;
  }
}

/**
 * Main function to fetch match odds
 */
async function main() {
  console.log('='.repeat(60));
  console.log('Fetching Team Vitality vs GamerLegion Match Odds');
  console.log('BLAST Bounty Winter 2026');
  console.log('='.repeat(60));

  try {
    // Step 1: Search for BLAST Bounty Winter 2026 tournament
    console.log('\n📋 Step 1: Searching for tournament...');
    const tournaments = await searchTournaments('BLAST Bounty Winter 2026');
    
    let tournamentId = null;
    if (tournaments.length > 0) {
      tournamentId = tournaments[0].id || tournaments[0].tournamentId || tournaments[0].tournament_id;
      console.log(`\n✓ Found tournament ID: ${tournamentId}`);
    } else {
      console.log('\n⚠ Tournament not found by name, will search all fixtures');
    }

    // Step 2: Find the specific match
    console.log('\n🔍 Step 2: Searching for match...');
    const match = await findMatch('Team Vitality', 'GamerLegion', tournamentId);
    
    if (!match) {
      console.error('\n❌ Match not found!');
      console.log('\nTrying alternative search without tournament filter...');
      const matchAlt = await findMatch('Team Vitality', 'GamerLegion', null);
      if (!matchAlt) {
        console.error('\n❌ Match still not found. The match may not be in the API yet.');
        return;
      }
      match = matchAlt;
    }

    const fixtureId = match.fixtureId || match.id;
    console.log(`\n✓ Found match! Fixture ID: ${fixtureId}`);

    // Step 3: Fetch detailed odds directly (raw data)
    console.log('\n💰 Step 3: Fetching detailed odds data...');
    const rawOddsData = await makeRequest('/odds', {
      fixtureId: fixtureId,
      verbosity: 3
    }, `Fetch detailed odds for fixture ${fixtureId} (Team Vitality vs GamerLegion)`);

    if (!rawOddsData || !rawOddsData.fixtureId) {
      console.error('\n❌ Could not fetch odds for this fixture');
      return;
    }

    // Step 4: Display results
    console.log('\n' + '='.repeat(60));
    console.log('MATCH INFORMATION');
    console.log('='.repeat(60));
    console.log(`Fixture ID: ${rawOddsData.fixtureId}`);
    console.log(`Teams: ${rawOddsData.participant1Name} vs ${rawOddsData.participant2Name}`);
    console.log(`Tournament: ${rawOddsData.tournamentName || 'Unknown'}`);
    console.log(`Start Time: ${rawOddsData.startTime || rawOddsData.trueStartTime || 'Unknown'}`);
    console.log(`Status: ${rawOddsData.statusId === 0 ? 'Scheduled' : rawOddsData.statusId === 1 ? 'Live' : 'Finished'}`);
    console.log(`Has Odds: ${rawOddsData.hasOdds ? 'Yes' : 'No'}`);
    console.log(`Last Updated: ${rawOddsData.updatedAt || 'Unknown'}`);

    // Extract and display odds from all available markets
    let bookmakerNames = [];
    let team1BestOdds = null;
    let team2BestOdds = null;
    let team1BestBookmaker = null;
    let team2BestBookmaker = null;
    
    if (rawOddsData.bookmakerOdds) {
      console.log('\n' + '='.repeat(60));
      console.log('BOOKMAKER ODDS');
      console.log('='.repeat(60));
      
      bookmakerNames = Object.keys(rawOddsData.bookmakerOdds);
      console.log(`\nFound ${bookmakerNames.length} bookmaker(s): ${bookmakerNames.join(', ')}`);
      
      // Try to find moneyline/match winner odds from any market
      let foundOdds = false;
      
      for (const bookmakerName of bookmakerNames) {
        const bookmaker = rawOddsData.bookmakerOdds[bookmakerName];
        if (!bookmaker || !bookmaker.markets) continue;
        
        const marketIds = Object.keys(bookmaker.markets);
        console.log(`\n📊 ${bookmakerName.toUpperCase()}:`);
        console.log(`   Available markets: ${marketIds.join(', ')}`);
        
        // Check market 101 (Moneyline) first
        if (bookmaker.markets['101']) {
          const market = bookmaker.markets['101'];
          console.log(`   Market 101 (Moneyline):`);
          if (market.outcomes) {
            for (const outcomeId in market.outcomes) {
              const outcome = market.outcomes[outcomeId];
              if (outcome.players) {
                for (const playerId in outcome.players) {
                  const player = outcome.players[playerId];
                  if (player.active && player.price) {
                    const outcomeName = outcomeId === '101' ? 'Team 1' : 
                                       outcomeId === '102' ? 'Draw' : 
                                       outcomeId === '103' ? 'Team 2' : `Outcome ${outcomeId}`;
                    console.log(`     ${outcomeName}: ${player.price} (Limit: ${player.limit || 'N/A'})`);
                    foundOdds = true;
                  }
                }
              }
            }
          }
        }
        
        // Check market 171 (might be match winner for esports)
        if (bookmaker.markets['171']) {
          const market = bookmaker.markets['171'];
          console.log(`   Market 171:`);
          if (market.outcomes) {
            for (const outcomeId in market.outcomes) {
              const outcome = market.outcomes[outcomeId];
              if (outcome.players) {
                for (const playerId in outcome.players) {
                  const player = outcome.players[playerId];
                  if (player.active && player.price) {
                    const outcomeName = outcome.bookmakerOutcomeId || `Outcome ${outcomeId}`;
                    console.log(`     ${outcomeName}: ${player.price} (Limit: ${player.limit || 'N/A'})`);
                    foundOdds = true;
                  }
                }
              }
            }
          }
        }
        
        // Display all other markets briefly
        for (const marketId of marketIds) {
          if (marketId !== '101' && marketId !== '171') {
            const market = bookmaker.markets[marketId];
            const outcomeCount = market.outcomes ? Object.keys(market.outcomes).length : 0;
            console.log(`   Market ${marketId}: ${outcomeCount} outcome(s)`);
          }
        }
      }
      
      if (!foundOdds) {
        console.log('\n⚠ No active odds found in standard markets (101, 171)');
        console.log('   Checking all markets for any available odds...');
        
        // Try to find any odds from any market
        for (const bookmakerName of bookmakerNames) {
          const bookmaker = rawOddsData.bookmakerOdds[bookmakerName];
          if (!bookmaker || !bookmaker.markets) continue;
          
          for (const marketId in bookmaker.markets) {
            const market = bookmaker.markets[marketId];
            if (market.outcomes) {
              for (const outcomeId in market.outcomes) {
                const outcome = market.outcomes[outcomeId];
                if (outcome.players) {
                  for (const playerId in outcome.players) {
                    const player = outcome.players[playerId];
                    if (player.active && player.price) {
                      const outcomeName = outcome.bookmakerOutcomeId || `Outcome ${outcomeId}`;
                      console.log(`   ${bookmakerName} - Market ${marketId} - ${outcomeName}: ${player.price}`);
                      foundOdds = true;
                    }
                  }
                }
              }
            }
          }
        }
      }
    } else {
      console.log('\n⚠ No bookmaker odds available');
    }

    // Extract and display simplified match winner odds
    if (rawOddsData.bookmakerOdds && bookmakerNames.length > 0) {
      console.log('\n' + '='.repeat(60));
      console.log('MATCH WINNER ODDS SUMMARY');
      console.log('='.repeat(60));
      
      // Extract best odds from market 171 (match winner for esports)
      // Based on the output, outcome 171 seems to be one team and 172 the other
      // We need to determine which is which based on typical odds patterns
      // Lower odds = favorite, higher odds = underdog
      
      for (const bookmakerName of bookmakerNames) {
        const bookmaker = rawOddsData.bookmakerOdds[bookmakerName];
        if (!bookmaker || !bookmaker.markets || !bookmaker.markets['171']) continue;
        
        const market = bookmaker.markets['171'];
        if (!market.outcomes) continue;
        
        let outcome171Price = null;
        let outcome172Price = null;
        
        // Extract prices from outcomes
        if (market.outcomes['171'] && market.outcomes['171'].players) {
          for (const playerId in market.outcomes['171'].players) {
            const player = market.outcomes['171'].players[playerId];
            if (player.active && player.price) {
              outcome171Price = parseFloat(player.price);
              break;
            }
          }
        }
        
        if (market.outcomes['172'] && market.outcomes['172'].players) {
          for (const playerId in market.outcomes['172'].players) {
            const player = market.outcomes['172'].players[playerId];
            if (player.active && player.price) {
              outcome172Price = parseFloat(player.price);
              break;
            }
          }
        }
        
        // Determine which outcome corresponds to which team
        // Typically, outcome 171 = participant1 (Team Gamerlegion), outcome 172 = participant2 (Team Vitality)
        // But we'll check the odds pattern - lower odds = favorite
        if (outcome171Price && outcome172Price) {
          // Outcome 171 is likely participant1 (Team Gamerlegion) - usually the underdog with higher odds
          // Outcome 172 is likely participant2 (Team Vitality) - usually the favorite with lower odds
          if (outcome171Price > outcome172Price) {
            // Outcome 171 is underdog (Team Gamerlegion), 172 is favorite (Team Vitality)
            if (!team1BestOdds || outcome171Price > team1BestOdds) {
              team1BestOdds = outcome171Price;
              team1BestBookmaker = bookmakerName;
            }
            if (!team2BestOdds || outcome172Price > team2BestOdds) {
              team2BestOdds = outcome172Price;
              team2BestBookmaker = bookmakerName;
            }
          } else {
            // Outcome 171 is favorite, 172 is underdog (less common but possible)
            if (!team1BestOdds || outcome171Price > team1BestOdds) {
              team1BestOdds = outcome171Price;
              team1BestBookmaker = bookmakerName;
            }
            if (!team2BestOdds || outcome172Price > team2BestOdds) {
              team2BestOdds = outcome172Price;
              team2BestBookmaker = bookmakerName;
            }
          }
        }
      }
      
      // Display summary - based on typical pattern, outcome 171 = Team Gamerlegion, 172 = Team Vitality
      console.log(`\n${rawOddsData.participant1Name} (Outcome 171):`);
      console.log(`  Best Odds: ${team1BestOdds ? team1BestOdds.toFixed(2) : 'N/A'} ${team1BestBookmaker ? `from ${team1BestBookmaker}` : ''}`);
      
      console.log(`\n${rawOddsData.participant2Name} (Outcome 172):`);
      console.log(`  Best Odds: ${team2BestOdds ? team2BestOdds.toFixed(2) : 'N/A'} ${team2BestBookmaker ? `from ${team2BestBookmaker}` : ''}`);
      
      // Show odds range across all bookmakers
      const allTeam1Odds = [];
      const allTeam2Odds = [];
      
      for (const bookmakerName of bookmakerNames) {
        const bookmaker = rawOddsData.bookmakerOdds[bookmakerName];
        if (!bookmaker || !bookmaker.markets || !bookmaker.markets['171']) continue;
        
        const market = bookmaker.markets['171'];
        if (market.outcomes['171'] && market.outcomes['171'].players) {
          for (const playerId in market.outcomes['171'].players) {
            const player = market.outcomes['171'].players[playerId];
            if (player.active && player.price) {
              allTeam1Odds.push({ price: parseFloat(player.price), bookmaker: bookmakerName });
              break;
            }
          }
        }
        if (market.outcomes['172'] && market.outcomes['172'].players) {
          for (const playerId in market.outcomes['172'].players) {
            const player = market.outcomes['172'].players[playerId];
            if (player.active && player.price) {
              allTeam2Odds.push({ price: parseFloat(player.price), bookmaker: bookmakerName });
              break;
            }
          }
        }
      }
      
      if (allTeam1Odds.length > 0 || allTeam2Odds.length > 0) {
        console.log('\n📊 Odds Range Across All Bookmakers:');
        if (allTeam1Odds.length > 0) {
          const min1 = Math.min(...allTeam1Odds.map(o => o.price));
          const max1 = Math.max(...allTeam1Odds.map(o => o.price));
          console.log(`  ${rawOddsData.participant1Name}: ${min1.toFixed(2)} - ${max1.toFixed(2)}`);
        }
        if (allTeam2Odds.length > 0) {
          const min2 = Math.min(...allTeam2Odds.map(o => o.price));
          const max2 = Math.max(...allTeam2Odds.map(o => o.price));
          console.log(`  ${rawOddsData.participant2Name}: ${min2.toFixed(2)} - ${max2.toFixed(2)}`);
        }
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('Complete!');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main, searchTournaments, findMatch };
