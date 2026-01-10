/**
 * CS2 Betting API Client
 * Handles integration with OddsPapi (https://oddspapi.io) for CS2 match data and odds
 * 
 * Uses REST API endpoints as documented at: https://oddspapi.io/en/docs
 * Note: WebSocket API requires additional permissions, so we use REST endpoints only
 */

const axios = require('axios');
const https = require('https');

// Configuration - can be overridden via environment variables
const ODDSPAPI_BASE_URL = process.env.ODDSPAPI_BASE_URL || 'https://api.oddspapi.io/v4';
const ODDSPAPI_API_KEY = process.env.ODDSPAPI_API_KEY || '2fc3c182-766b-4992-9729-f439efdac2ba';
const ODDSPAPI_LANGUAGE = process.env.ODDSPAPI_LANGUAGE || 'en';
const ODDSPAPI_ODDS_FORMAT = process.env.ODDSPAPI_ODDS_FORMAT || 'decimal'; // decimal, fractional, american

// Verify API key is set
if (!ODDSPAPI_API_KEY || ODDSPAPI_API_KEY.length < 10) {
  console.warn('[CS2 API Client] WARNING: API key appears to be invalid or not set');
}

let currentSportId = null;
let requestCount = 0;
const REQUEST_LIMIT_PER_MONTH = 200; // Free plan limit per OddsPapi docs

// Market IDs for OddsPapi:
// 101 = Moneyline/1X2 (home/draw/away)
const MARKET_MONEYLINE = '101';

/**
 * Make authenticated request to OddsPapi API
 * @param {string} endpoint - API endpoint (e.g., '/sports', '/fixtures')
 * @param {Object} params - Query parameters
 * @returns {Promise<Object>} API response
 */
async function makeRequest(endpoint, params = {}) {
  try {
    const url = `${ODDSPAPI_BASE_URL}${endpoint}`;
    const queryParams = {
      ...params,
      apiKey: ODDSPAPI_API_KEY,
      language: ODDSPAPI_LANGUAGE
    };

    console.log(`[OddsPapi] Fetching: ${url}`);
    console.log(`[OddsPapi] Using API key: ${ODDSPAPI_API_KEY.substring(0, 8)}...${ODDSPAPI_API_KEY.substring(ODDSPAPI_API_KEY.length - 4)}`);

    const response = await axios.get(url, {
      params: queryParams,
      timeout: 15000,
      httpsAgent: new https.Agent({ rejectUnauthorized: true }),
      headers: {
        'Accept': 'application/json'
      }
    });

    requestCount++;
    return response.data;
  } catch (error) {
    console.error(`[OddsPapi] Error fetching ${endpoint}:`, error.message);
    if (error.response) {
      console.error('[OddsPapi] Response status:', error.response.status);
      console.error('[OddsPapi] Response data:', JSON.stringify(error.response.data, null, 2));

      if (error.response.status === 401) {
        console.error('[OddsPapi] ⚠ API key appears to be invalid. Please verify:');
        console.error(`[OddsPapi]   - API key: ${ODDSPAPI_API_KEY.substring(0, 8)}...${ODDSPAPI_API_KEY.substring(ODDSPAPI_API_KEY.length - 4)}`);
        console.error(`[OddsPapi]   - Get a valid key at: https://oddspapi.io`);
        console.error(`[OddsPapi]   - Or set ODDSPAPI_API_KEY environment variable`);
      } else if (error.response.status === 429) {
        console.warn('[OddsPapi] Rate limit exceeded. Please wait before making more requests.');
      }
    } else if (error.request) {
      console.error('[OddsPapi] No response received. Check network connection.');
    }
    throw error;
  }
}

/**
 * Get available sports from OddsPapi to find CS2 identifier
 * @returns {Promise<Array|null>} Array of sports or null if error
 */
async function getAvailableSports() {
  try {
    const data = await makeRequest('/sports');
    
    if (Array.isArray(data)) {
      console.log(`[OddsPapi] Successfully fetched sports list (${data.length} sports)`);
      return data;
    } else if (data && Array.isArray(data.sports)) {
      console.log(`[OddsPapi] Successfully fetched sports list (${data.sports.length} sports)`);
      return data.sports;
    }
    
    return null;
  } catch (error) {
    console.error('[OddsPapi] Could not retrieve sports list');
    return null;
  }
}

/**
 * Find CS2 sport identifier from available sports
 * @returns {Promise<number|null>} Sport ID or null if not found
 */
async function findCS2SportId() {
  if (currentSportId) {
    return currentSportId;
  }

  const sports = await getAvailableSports();
  if (!sports || !Array.isArray(sports)) {
    console.warn('[OddsPapi] Could not retrieve sports list');
    return null;
  }

  // Look for CS2 in the sports list
  // Try multiple variations: Counter Strike, Counter Strike 2, CS2, CS:GO, esports counter strike, etc.
  const searchTerms = [
    'esport counter-strike',  // Exact match for OddsPapi format
    'esports counter-strike',
    'esport counter strike',
    'esports counter strike',
    'counter strike 2',
    'counter-strike 2',
    'cs2',
    'counter strike',
    'counter-strike',
    'cs:go',
    'csgo',
    'esports cs2'
  ];

  // First, try to find exact or close matches (case-insensitive, handle hyphens/spaces)
  let cs2Sport = null;
  for (const term of searchTerms) {
    cs2Sport = sports.find(s => {
      const name = (s.name || s.title || s.key || '').toLowerCase();
      const slug = (s.slug || '').toLowerCase();
      const key = (s.key || '').toLowerCase();
      const searchTermLower = term.toLowerCase();
      
      // Normalize strings for comparison (remove extra spaces, handle hyphens)
      const normalize = (str) => str.replace(/\s+/g, ' ').replace(/-/g, ' ').trim();
      const normalizedName = normalize(name);
      const normalizedSlug = normalize(slug);
      const normalizedKey = normalize(key);
      const normalizedSearch = normalize(searchTermLower);
      
      return name.includes(searchTermLower) || 
             slug.includes(searchTermLower) ||
             key.includes(searchTermLower) ||
             normalizedName.includes(normalizedSearch) ||
             normalizedSlug.includes(normalizedSearch) ||
             normalizedKey.includes(normalizedSearch) ||
             name === searchTermLower ||
             slug === searchTermLower ||
             key === searchTermLower ||
             normalizedName === normalizedSearch ||
             normalizedSlug === normalizedSearch ||
             normalizedKey === normalizedSearch;
    });
    
    if (cs2Sport) {
      console.log(`[OddsPapi] Found CS2 using search term: "${term}"`);
      break;
    }
  }

  // If not found, try broader search for anything with "counter" or "cs"
  if (!cs2Sport) {
    cs2Sport = sports.find(s => {
      const name = (s.name || s.title || s.key || '').toLowerCase();
      const slug = (s.slug || '').toLowerCase();
      const key = (s.key || '').toLowerCase();
      
      return (name.includes('counter') || name.includes('cs') || 
              slug.includes('counter') || slug.includes('cs') ||
              key.includes('counter') || key.includes('cs')) &&
             !name.includes('counter-terrorist') && // Exclude unrelated matches
             !name.includes('terrorist'); // Exclude unrelated matches
    });
  }

  // Fallback: Try sport ID 17 if provided by user (common CS2 sport ID)
  // Check if we should use ID 17 as fallback
  if (!cs2Sport && process.env.ODDSPAPI_CS2_SPORT_ID) {
    const fallbackId = parseInt(process.env.ODDSPAPI_CS2_SPORT_ID);
    cs2Sport = sports.find(s => {
      const id = s.id || s.sportId || s.sport_id;
      return id === fallbackId;
    });
    if (cs2Sport) {
      console.log(`[OddsPapi] Using manually configured CS2 sport ID: ${fallbackId}`);
    }
  }

  if (cs2Sport) {
    currentSportId = cs2Sport.id || cs2Sport.sportId || cs2Sport.sport_id;
    
    // Try multiple field names to extract sport name - check all string fields
    let sportName = 'Unknown';
    const nameFields = ['name', 'title', 'key', 'slug', 'displayName', 'nameEn', 'name_en', 'label', 'display_name'];
    for (const field of nameFields) {
      if (cs2Sport[field] && typeof cs2Sport[field] === 'string' && cs2Sport[field].trim()) {
        sportName = cs2Sport[field];
        break;
      }
    }
    
    // If still unknown, try to find any string field that might be a name
    if (sportName === 'Unknown') {
      for (const key in cs2Sport) {
        if (cs2Sport[key] && typeof cs2Sport[key] === 'string' && cs2Sport[key].length > 0 && cs2Sport[key].length < 100) {
          // Likely a name field if it's a reasonable-length string
          if (!key.toLowerCase().includes('id') && !key.toLowerCase().includes('url') && 
              !key.toLowerCase().includes('path') && !key.toLowerCase().includes('date') &&
              !key.toLowerCase().includes('time')) {
            sportName = cs2Sport[key];
            console.log(`[OddsPapi] Found sport name in field "${key}": "${sportName}"`);
            break;
          }
        }
      }
    }
    
    console.log(`[OddsPapi] ✓ Found CS2 sport: "${sportName}" (ID: ${currentSportId})`);
    
    // Debug: Log all available fields for troubleshooting
    const availableFields = Object.keys(cs2Sport).filter(k => cs2Sport[k] !== null && cs2Sport[k] !== undefined);
    console.log(`[OddsPapi] Sport object has ${availableFields.length} fields: ${availableFields.join(', ')}`);
    
    // Verify it's actually CS2 by checking all text fields
    const allTextValues = availableFields
      .filter(k => typeof cs2Sport[k] === 'string')
      .map(k => cs2Sport[k].toLowerCase())
      .join(' ');
    
    if (allTextValues && (allTextValues.includes('counter') || allTextValues.includes('cs2') || allTextValues.includes('csgo'))) {
      console.log(`[OddsPapi] ✓ Confirmed: Sport ID ${currentSportId} appears to be CS2 based on text fields`);
    } else if (allTextValues) {
      console.warn(`[OddsPapi] ⚠ Warning: Sport ID ${currentSportId} may not be CS2. Text fields: "${allTextValues}"`);
      console.warn(`[OddsPapi] If this is not CS2, you may need to manually find the correct sport ID.`);
      console.warn(`[OddsPapi] Use GET /api/cs2/admin/sports to list all available sports.`);
    }
    
    return currentSportId;
  }

  // Log all available sports for debugging - especially esports-related
  console.warn('[OddsPapi] CS2 sport not found by name. Searching for related sports...');
  const relatedSports = sports.filter(s => {
    const name = (s.name || s.title || s.key || '').toLowerCase();
    const slug = (s.slug || '').toLowerCase();
    const key = (s.key || '').toLowerCase();
    return name.includes('esport') || 
           name.includes('cs') || 
           name.includes('counter') ||
           slug.includes('cs') ||
           slug.includes('counter') ||
           key.includes('cs') ||
           key.includes('counter');
  });
  
  if (relatedSports.length > 0) {
    console.warn('[OddsPapi] Related esports/cs sports found:');
    relatedSports.forEach(s => {
      const id = s.id || s.sportId || s.sport_id;
      const name = s.name || s.title || s.key || s.slug || 'Unknown';
      const fields = Object.keys(s).filter(k => s[k] !== null && s[k] !== undefined).join(', ');
      console.warn(`  - "${name}" (ID: ${id}) [fields: ${fields}]`);
    });
    
    // If sport ID 17 was found in related sports, use it
    const sport17 = relatedSports.find(s => {
      const id = s.id || s.sportId || s.sport_id;
      return id === 17;
    });
    
    if (sport17) {
      currentSportId = 17;
      const name = sport17.name || sport17.title || sport17.key || sport17.slug || 'Unknown';
      console.log(`[OddsPapi] Using sport ID 17 (found in related sports): "${name}"`);
      return 17;
    }
  } else {
    console.warn('[OddsPapi] No related esports/cs sports found. Logging all sports for debugging:');
    sports.forEach(s => {
      const id = s.id || s.sportId || s.sport_id;
      const name = s.name || s.title || s.key || s.slug || 'Unknown';
      console.warn(`  - "${name}" (ID: ${id})`);
    });
  }
  
  // Last resort: If sport ID 17 exists in the sports list, use it (common CS2 sport ID)
  const sport17 = sports.find(s => {
    const id = s.id || s.sportId || s.sport_id;
    return id === 17;
  });
  
  if (sport17) {
    currentSportId = 17;
    const name = sport17.name || sport17.title || sport17.key || sport17.slug || 'Sport ID 17 (unknown name)';
    console.log(`[OddsPapi] Fallback: Using sport ID 17: "${name}"`);
    console.log(`[OddsPapi] Sport 17 full object:`, JSON.stringify(sport17, null, 2));
    
    // Log all fields available
    const allFields = Object.keys(sport17).reduce((acc, k) => {
      if (sport17[k] !== null && sport17[k] !== undefined) {
        acc[k] = sport17[k];
      }
      return acc;
    }, {});
    console.log(`[OddsPapi] Sport 17 available fields:`, allFields);
    
    return 17;
  }
  
  console.error('[OddsPapi] Could not find CS2 sport and sport ID 17 does not exist in sports list');
  return null;
}

/**
 * Fetch upcoming CS2 fixtures/matches from OddsPapi
 * @param {Object} options - Options for fetching matches
 * @param {number} options.sportId - Sport ID (optional, will auto-detect CS2 if not provided)
 * @param {number} options.limit - Maximum number of matches to return
 * @param {Date} options.startTime - Filter matches starting after this time
 * @returns {Promise<Array>} Array of match objects
 */
async function fetchUpcomingMatches(options = {}) {
  try {
    const sportId = options.sportId || await findCS2SportId();
    
    if (!sportId) {
      console.warn('[OddsPapi] CS2 sport ID not found. Returning empty array. Will need alternative data source.');
      return [];
    }

    // Check request limit
    if (requestCount >= REQUEST_LIMIT_PER_MONTH) {
      console.warn('[OddsPapi] Request limit reached. Consider upgrading plan or implementing better caching.');
      return [];
    }

    // Build query parameters for fixtures endpoint
    // Based on OddsPapi docs: https://oddspapi.io/en/docs/get-fixtures
    // Note: 'from' and 'to' parameters are REQUIRED when using sportId
    // They must be under 10 days apart (maximum 10 days difference)
    const params = {};
    
    if (sportId) {
      params.sportId = sportId;
    }

    // Calculate date range (from now to 9 days from now - staying under 10 days)
    const now = options.startTime ? new Date(options.startTime) : new Date();
    const fromDate = new Date(now);
    fromDate.setHours(0, 0, 0, 0); // Start of today
    
    // 'to' must be within 10 days of 'from' (we use 9 days to be safe)
    const toDate = new Date(fromDate);
    toDate.setDate(toDate.getDate() + 9); // 9 days from now (to stay under 10 days)
    toDate.setHours(23, 59, 59, 999); // End of that day

    // Format dates as ISO 8601 strings (OddsPapi expects this format)
    params.from = fromDate.toISOString();
    params.to = toDate.toISOString();
    
    console.log(`[OddsPapi] Fetching fixtures from ${params.from} to ${params.to}`);

    // Note: OddsPapi may have additional filters like tournamentId, statusId, etc.
    // We can add those later if needed

    const data = await makeRequest('/fixtures', params);

    // Handle different response structures
    let fixtures = [];
    if (Array.isArray(data)) {
      fixtures = data;
    } else if (data && Array.isArray(data.fixtures)) {
      fixtures = data.fixtures;
    } else if (data && Array.isArray(data.data)) {
      fixtures = data.data;
    }

    console.log(`[OddsPapi] Found ${fixtures.length} upcoming fixtures`);
    
    // Log first fixture for debugging (to verify it's CS2)
    if (fixtures.length > 0) {
      const firstFixture = fixtures[0];
      const fixtureSportId = firstFixture.sportId || firstFixture.sport_id;
      console.log(`[OddsPapi] Sample fixture (sportId: ${fixtureSportId}):`);
      console.log(`[OddsPapi]   - Fixture ID: ${firstFixture.fixtureId || firstFixture.id}`);
      console.log(`[OddsPapi]   - Teams: ${firstFixture.participant1Name || 'TBD'} vs ${firstFixture.participant2Name || 'TBD'}`);
      console.log(`[OddsPapi]   - Tournament: ${firstFixture.tournamentName || 'Unknown'}`);
      console.log(`[OddsPapi]   - Start Time: ${firstFixture.startTime || firstFixture.trueStartTime || 'Unknown'}`);
      console.log(`[OddsPapi]   - Sport ID: ${fixtureSportId} (expected: ${sportId})`);
      
      // Verify sport ID matches
      if (fixtureSportId && fixtureSportId !== sportId) {
        console.warn(`[OddsPapi] ⚠ Warning: Fixture sportId (${fixtureSportId}) doesn't match requested sportId (${sportId})`);
      }
    }
    
    // Map fixtures to internal format (fetch odds if needed)
    const matchesWithOdds = [];
    for (const fixture of fixtures.slice(0, options.limit || 50)) {
      try {
        const mappedMatch = await mapOddsPapiFixtureToInternal(fixture);
        // Include all fixtures, even if odds aren't available yet (odds may be fetched later)
        if (mappedMatch) {
          matchesWithOdds.push(mappedMatch);
        }
      } catch (error) {
        console.error(`[OddsPapi] Error mapping fixture ${fixture.fixtureId || fixture.id}:`, error.message);
        // Continue with next fixture
      }
    }

    console.log(`[OddsPapi] Mapped ${matchesWithOdds.length} matches to internal format`);
    return matchesWithOdds;
  } catch (error) {
    console.error('[OddsPapi] Error fetching upcoming matches:', error.message);
    return [];
  }
}

/**
 * Fetch odds for a specific fixture
 * @param {string} fixtureId - Fixture ID from OddsPapi (e.g., "id1000001761300517")
 * @returns {Promise<Object|null>} Fixture with odds or null if not found
 */
async function fetchMatchOdds(fixtureId) {
  try {
    if (requestCount >= REQUEST_LIMIT_PER_MONTH) {
      console.warn('[OddsPapi] Request limit reached.');
      return null;
    }

    console.log(`[OddsPapi] Fetching odds for fixture ${fixtureId}...`);
    const data = await makeRequest('/odds', {
      fixtureId: fixtureId,
      oddsFormat: ODDSPAPI_ODDS_FORMAT,
      verbosity: 3 // Get detailed response
    });

    if (data && data.fixtureId) {
      console.log(`[OddsPapi] Received odds data for fixture ${fixtureId}, hasOdds: ${data.hasOdds}`);
      const mappedData = await mapOddsPapiFixtureToInternal(data);
      if (mappedData && (mappedData.odds.team1 || mappedData.odds.team2)) {
        console.log(`[OddsPapi] Successfully extracted odds:`, mappedData.odds);
      } else {
        console.warn(`[OddsPapi] No odds extracted from fixture ${fixtureId}. Raw data:`, JSON.stringify(data, null, 2).substring(0, 500));
      }
      return mappedData;
    }

    console.warn(`[OddsPapi] Invalid response for fixture ${fixtureId}`);
    return null;
  } catch (error) {
    console.error(`[OddsPapi] Error fetching odds for fixture ${fixtureId}:`, error.message);
    if (error.response) {
      console.error(`[OddsPapi] Response status: ${error.response.status}, data:`, error.response.data);
    }
    return null;
  }
}

/**
 * Fetch match results/scores from OddsPapi
 * @param {string} fixtureId - Fixture ID
 * @returns {Promise<Object|null>} Match result with scores or null
 */
async function fetchMatchResults(fixtureId) {
  try {
    if (requestCount >= REQUEST_LIMIT_PER_MONTH) {
      console.warn('[OddsPapi] Request limit reached.');
      return null;
    }

    // Use settlements endpoint to check if match is finished
    const settlements = await makeRequest('/settlements', {
      fixtureId: fixtureId
    });

    // Also try scores endpoint
    let scoresData = null;
    try {
      scoresData = await makeRequest('/scores', {
        fixtureId: fixtureId
      });
    } catch (error) {
      // Scores endpoint may not be available, that's OK
      console.log('[OddsPapi] Scores endpoint not available, using settlements only');
    }

    if (settlements && settlements.length > 0) {
      const settlement = settlements[0];
      return {
        fixtureId: settlement.fixtureId || fixtureId,
        completed: true,
        statusId: settlement.statusId,
        winner: determineWinnerFromSettlement(settlement),
        participant1Score: settlement.participant1Score || null,
        participant2Score: settlement.participant2Score || null
      };
    }

    // If no settlement, check scores data
    if (scoresData && scoresData.scores) {
      const scores = scoresData.scores;
      return {
        fixtureId: fixtureId,
        completed: scoresData.statusId !== 0 && scoresData.statusId !== 1, // 0=scheduled, 1=live, others=finished
        statusId: scoresData.statusId,
        participant1Score: scores.participant1Score || null,
        participant2Score: scores.participant2Score || null,
        winner: determineWinnerFromScores(scores)
      };
    }

    return null;
  } catch (error) {
    console.error(`[OddsPapi] Error fetching results for fixture ${fixtureId}:`, error.message);
    return null;
  }
}

/**
 * Map OddsPapi fixture format to internal format
 * @param {Object} fixture - Fixture object from OddsPapi
 * @returns {Promise<Object>} Internal match format
 */
async function mapOddsPapiFixtureToInternal(fixture) {
  // Extract basic fixture info
  const fixtureId = fixture.fixtureId || fixture.id;
  const participant1Name = fixture.participant1Name || 'Team 1';
  const participant2Name = fixture.participant2Name || 'Team 2';
  const startTime = fixture.startTime || fixture.trueStartTime;
  const statusId = fixture.statusId || 0; // 0=scheduled, 1=live, others=finished/cancelled

  // Extract odds from bookmakerOdds according to OddsPapi documentation
  // Market 101 = Moneyline: outcomes 101=home/team1, 102=draw, 103=away/team2
  // Structure: bookmakerOdds.{bookmaker}.markets.{marketId}.outcomes.{outcomeId}.players.{playerId}.price
  let team1Odds = null;
  let team2Odds = null;
  let drawOdds = null;

  if (fixture.bookmakerOdds && Object.keys(fixture.bookmakerOdds).length > 0) {
    // Try multiple bookmakers to find odds (prefer first available)
    const bookmakers = Object.values(fixture.bookmakerOdds);
    
    for (const bookmaker of bookmakers) {
      if (!bookmaker || !bookmaker.markets) continue;
      
      // Look for market 101 (Moneyline/1X2)
      const market = bookmaker.markets['101'] || bookmaker.markets[MARKET_MONEYLINE];
      if (!market || !market.outcomes) continue;
      
      // Extract team1 odds (outcome 101 = home)
      if (market.outcomes['101'] && market.outcomes['101'].players) {
        const players = market.outcomes['101'].players;
        // Get first active player with price
        for (const playerId in players) {
          const player = players[playerId];
          if (player && player.active !== false && player.price) {
            team1Odds = parseFloat(player.price);
            break;
          }
        }
      }
      
      // Extract draw odds (outcome 102)
      if (market.outcomes['102'] && market.outcomes['102'].players) {
        const players = market.outcomes['102'].players;
        for (const playerId in players) {
          const player = players[playerId];
          if (player && player.active !== false && player.price) {
            drawOdds = parseFloat(player.price);
            break;
          }
        }
      }
      
      // Extract team2 odds (outcome 103 = away)
      if (market.outcomes['103'] && market.outcomes['103'].players) {
        const players = market.outcomes['103'].players;
        for (const playerId in players) {
          const player = players[playerId];
          if (player && player.active !== false && player.price) {
            team2Odds = parseFloat(player.price);
            break;
          }
        }
      }
      
      // If we found odds, break (don't need to check other bookmakers)
      if (team1Odds !== null || team2Odds !== null) {
        break;
      }
    }
    
    console.log(`[OddsPapi] Extracted odds for fixture ${fixtureId}: team1=${team1Odds}, team2=${team2Odds}, draw=${drawOdds}`);
  } else {
    console.log(`[OddsPapi] No bookmakerOdds found for fixture ${fixtureId}`);
  }

  // Note: We don't fetch odds here to avoid rate limit issues
  // Odds will be fetched on-demand when a user wants to bet on a specific fixture
  // This is more efficient than fetching odds for all fixtures upfront

  const isFinished = statusId !== 0 && statusId !== 1; // 0=scheduled, 1=live

  return {
    id: fixtureId,
    fixtureId: fixtureId,
    sportId: fixture.sportId,
    sportName: fixture.sportName,
    tournamentId: fixture.tournamentId,
    tournamentName: fixture.tournamentName,
    commenceTime: startTime,
    startTime: startTime,
    homeTeam: participant1Name,
    awayTeam: participant2Name,
    participant1Name: participant1Name,
    participant2Name: participant2Name,
    odds: {
      team1: team1Odds,
      team2: team2Odds,
      draw: drawOdds
    },
    status: isFinished ? 'finished' : (statusId === 1 ? 'live' : 'scheduled'),
    statusId: statusId,
    completed: isFinished,
    hasOdds: fixture.hasOdds !== false && (team1Odds !== null || team2Odds !== null),
    lastUpdate: fixture.updatedAt || new Date().toISOString()
  };
}

/**
 * Determine winner from settlement data
 * @param {Object} settlement - Settlement object from OddsPapi
 * @returns {string|null} 'team1', 'team2', 'draw', or null
 */
function determineWinnerFromSettlement(settlement) {
  const p1Score = settlement.participant1Score;
  const p2Score = settlement.participant2Score;

  if (p1Score === null || p2Score === null || p1Score === undefined || p2Score === undefined) {
    return null;
  }

  if (p1Score > p2Score) {
    return 'team1';
  } else if (p2Score > p1Score) {
    return 'team2';
  } else {
    return 'draw';
  }
}

/**
 * Determine winner from scores data
 * @param {Object} scores - Scores object from OddsPapi
 * @returns {string|null} 'team1', 'team2', 'draw', or null
 */
function determineWinnerFromScores(scores) {
  return determineWinnerFromSettlement({
    participant1Score: scores.participant1Score,
    participant2Score: scores.participant2Score
  });
}

/**
 * Get remaining API requests for the month
 * @returns {number} Remaining requests
 */
function getRemainingRequests() {
  return Math.max(0, REQUEST_LIMIT_PER_MONTH - requestCount);
}

/**
 * Reset request counter (for testing or monthly reset)
 */
function resetRequestCounter() {
  requestCount = 0;
}

/**
 * Get current request count
 * @returns {number} Current request count
 */
function getRequestCount() {
  return requestCount;
}

/**
 * List all sports with CS/CS2-related keywords (for debugging)
 * @returns {Promise<Array>} Array of related sports
 */
async function listRelatedSports() {
  try {
    const sports = await getAvailableSports();
    if (!sports || !Array.isArray(sports)) {
      return [];
    }

    const related = sports.filter(s => {
      const name = (s.name || s.title || s.key || '').toLowerCase();
      const slug = (s.slug || '').toLowerCase();
      const key = (s.key || '').toLowerCase();
      
      return name.includes('esport') || 
             name.includes('cs') || 
             name.includes('counter') ||
             slug.includes('cs') ||
             slug.includes('counter') ||
             key.includes('cs') ||
             key.includes('counter') ||
             s.id === 17 || // Also check ID 17 specifically
             s.sportId === 17 ||
             s.sport_id === 17;
    });

    return related.map(s => ({
      id: s.id || s.sportId || s.sport_id,
      name: s.name || s.title || s.key || s.slug || 'Unknown',
      slug: s.slug,
      key: s.key,
      allFields: Object.keys(s).reduce((acc, k) => {
        if (s[k] !== null && s[k] !== undefined) {
          acc[k] = s[k];
        }
        return acc;
      }, {})
    }));
  } catch (error) {
    console.error('[OddsPapi] Error listing related sports:', error.message);
    return [];
  }
}

module.exports = {
  fetchUpcomingMatches,
  fetchMatchOdds,
  fetchMatchResults,
  getAvailableSports,
  findCS2SportId,
  listRelatedSports,
  getRemainingRequests,
  resetRequestCounter,
  getRequestCount,
  mapOddsPapiFixtureToInternal
};
