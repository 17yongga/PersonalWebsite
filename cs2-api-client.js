/**
 * CS2 Betting API Client
 * Handles integration with OddsPapi (https://oddspapi.io) for CS2 match data and odds
 * 
 * Uses REST API endpoints as documented at: https://oddspapi.io/en/docs
 * Note: WebSocket API requires additional permissions, so we use REST endpoints only
 */

const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Import performance caching system
const { CS2PerformanceCache, createPerformanceMiddleware } = require('./cs2-performance-cache.js');

// Initialize performance caching
const apiCache = new CS2PerformanceCache();
const performanceMiddleware = createPerformanceMiddleware(apiCache);

// Configuration - can be overridden via environment variables
const ODDSPAPI_BASE_URL = process.env.ODDSPAPI_BASE_URL || 'https://api.oddspapi.io/v4';
const ODDSPAPI_LANGUAGE = process.env.ODDSPAPI_LANGUAGE || 'en';
const ODDSPAPI_ODDS_FORMAT = process.env.ODDSPAPI_ODDS_FORMAT || 'decimal'; // decimal, fractional, american

// API Key configuration with working keys prioritized (Updated 3:07 PM EST)
// Verified working keys moved to front, exhausted keys at end
const ODDSPAPI_API_KEYS = [
  '9003763c-674b-4b96-be80-fb8d08ff99db', // ✅ WORKING (59 sports available)
  'ba42222d-487b-4c70-a53e-7d50c212559f', // ✅ WORKING (59 sports available) 
  '8afcb165-1989-42f1-8739-da129bb40337', // ✅ WORKING (59 sports available)
  '4d4fde92-a84b-433f-a815-462b3d6aca20', // ✅ WORKING (59 sports available)
  process.env.ODDSPAPI_API_KEY || '492c4517-843e-49d5-96dd-8eed82567c5b', // ❌ Rate limited
  '0ddeae0a-1e13-4285-9e35-b5b590190fa8', // ❌ Rate limited
  '2fc3c182-766b-4992-9729-f439efdac2ba'  // ❌ Rate limited
];

// Current active API key index
let currentApiKeyIndex = 0;

// Get current API key
function getCurrentApiKey() {
  return ODDSPAPI_API_KEYS[currentApiKeyIndex];
}

// Verify API key is set
if (!getCurrentApiKey() || getCurrentApiKey().length < 10) {
  console.warn('[CS2 API Client] WARNING: API key appears to be invalid or not set');
}

let currentSportId = null;
let requestCount = 0;
const REQUEST_LIMIT_PER_MONTH = 200; // Free plan limit per OddsPapi docs
const ENDPOINT_COOLDOWN_MS = 500; // 500ms cooldown between requests (per API docs)
let lastRequestTime = 0; // Track last request time for rate limiting

// API Call Logging
const API_LOG_FILE = path.join(__dirname, 'oddspapi-api-calls.log');

// Initialize log file with header on first run
if (!fs.existsSync(API_LOG_FILE)) {
  const currentKey = getCurrentApiKey();
  const header = `# OddsPapi API Call Log
# Started: ${new Date().toISOString()}
# API Key: ${currentKey.substring(0, 8)}...${currentKey.substring(currentKey.length - 4)}
# Format: JSON Lines (one JSON object per line)
#
`;
  fs.writeFileSync(API_LOG_FILE, header);
  console.log(`[API Logger] Created new log file: ${API_LOG_FILE}`);
}

/**
 * Log API call to file with timestamp
 * @param {string} endpoint - API endpoint called
 * @param {string} purpose - Purpose/reason for the API call
 * @param {Object} params - Request parameters (excluding API key)
 * @param {string} status - 'success' or 'error'
 * @param {string} errorMessage - Error message if status is 'error'
 * @param {number} responseTime - Response time in milliseconds
 */
function logApiCall(endpoint, purpose, params = {}, status = 'success', errorMessage = null, responseTime = null) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    endpoint,
    purpose,
    params: { ...params, apiKey: '[REDACTED]' }, // Don't log the actual API key
    status,
    errorMessage: errorMessage || null,
    responseTime: responseTime || null,
    requestCount: requestCount + 1
  };
  
  const logLine = JSON.stringify(logEntry) + '\n';
  
  // Append to log file asynchronously
  fs.appendFile(API_LOG_FILE, logLine, (err) => {
    if (err) {
      console.error('[API Logger] Failed to write to log file:', err.message);
    }
  });
  
  // Also log to console for immediate visibility
  const statusIcon = status === 'success' ? '✓' : '✗';
  console.log(`[API Logger] ${statusIcon} ${timestamp} | ${endpoint} | ${purpose} | Status: ${status}${responseTime ? ` | Time: ${responseTime}ms` : ''}`);
}

// Market IDs for OddsPapi:
// 101 = Moneyline/1X2 (home/draw/away) - for traditional sports
// 171 = Match Winner - for esports (CS2 uses this)
const MARKET_MONEYLINE = '101';
const MARKET_MATCH_WINNER = '171';

/**
 * Make authenticated request to OddsPapi API with automatic fallback to backup keys
 * @param {string} endpoint - API endpoint (e.g., '/sports', '/fixtures')
 * @param {Object} params - Query parameters
 * @param {string} purpose - Purpose/reason for this API call (for logging)
 * @param {number} retryKeyIndex - Internal parameter for retrying with different keys (default: current key)
 * @returns {Promise<Object>} API response
 */
async function makeRequest(endpoint, params = {}, purpose = 'API call', retryKeyIndex = null) {
  const startTime = Date.now();
  const keyIndex = retryKeyIndex !== null ? retryKeyIndex : currentApiKeyIndex;
  const apiKey = ODDSPAPI_API_KEYS[keyIndex];
  
  try {
    // Respect API cooldown (500ms between requests)
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < ENDPOINT_COOLDOWN_MS) {
      const waitTime = ENDPOINT_COOLDOWN_MS - timeSinceLastRequest;
      console.log(`[OddsPapi] Rate limiting: waiting ${waitTime}ms before request...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    lastRequestTime = Date.now();

    const url = `${ODDSPAPI_BASE_URL}${endpoint}`;
    const queryParams = {
      ...params,
      apiKey: apiKey,
      language: ODDSPAPI_LANGUAGE
    };

    console.log(`[OddsPapi] Fetching: ${url}`);
    console.log(`[OddsPapi] Using API key: ${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)} (key ${keyIndex + 1}/${ODDSPAPI_API_KEYS.length})`);

    const response = await axios.get(url, {
      params: queryParams,
      timeout: 15000,
      httpsAgent: new https.Agent({ rejectUnauthorized: true }),
      headers: {
        'Accept': 'application/json'
      }
    });

    requestCount++;
    const responseTime = Date.now() - startTime;
    
    // Update current key index if we're using a fallback key
    if (keyIndex !== currentApiKeyIndex) {
      console.log(`[OddsPapi] ✓ Successfully using fallback API key ${keyIndex + 1}, switching to it`);
      currentApiKeyIndex = keyIndex;
    }
    
    // Log successful API call
    logApiCall(endpoint, purpose, params, 'success', null, responseTime);
    
    return response.data;
  } catch (error) {
    const responseTime = Date.now() - startTime;
    const errorMessage = error.message || 'Unknown error';
    
    // Check if this is an authentication error (401, 403) and we have more keys to try
    if (error.response && (error.response.status === 401 || error.response.status === 403)) {
      const nextKeyIndex = keyIndex + 1;
      
      if (nextKeyIndex < ODDSPAPI_API_KEYS.length) {
        console.warn(`[OddsPapi] ⚠ API key ${keyIndex + 1} failed (${error.response.status}). Trying fallback key ${nextKeyIndex + 1}...`);
        
        // Try with next API key (recursive call will automatically try all remaining keys)
        return await makeRequest(endpoint, params, purpose, nextKeyIndex);
      } else {
        // All keys exhausted
        console.error(`[OddsPapi] ❌ All ${ODDSPAPI_API_KEYS.length} API keys have been tried and failed.`);
      }
    }
    
    // Log failed API call (only log once at the end, not for each failed key attempt)
    // Skip logging if we're in the middle of trying fallback keys (keyIndex > currentApiKeyIndex)
    if (keyIndex === currentApiKeyIndex || (error.response && error.response.status !== 401 && error.response.status !== 403)) {
      logApiCall(endpoint, purpose, params, 'error', errorMessage, responseTime);
    }
    
    console.error(`[OddsPapi] Error fetching ${endpoint}:`, errorMessage);
    if (error.response) {
      console.error('[OddsPapi] Response status:', error.response.status);
      console.error('[OddsPapi] Response data:', JSON.stringify(error.response.data, null, 2));

      if (error.response.status === 401 || error.response.status === 403) {
        // Only show detailed error if we've exhausted all keys
        if (keyIndex >= ODDSPAPI_API_KEYS.length - 1) {
          console.error('[OddsPapi] ⚠ All API keys appear to be invalid or unauthorized.');
          console.error(`[OddsPapi]   - Last tried key: ${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`);
          console.error(`[OddsPapi]   - Total keys tried: ${ODDSPAPI_API_KEYS.length}`);
          console.error(`[OddsPapi]   - Get a valid key at: https://oddspapi.io`);
          console.error(`[OddsPapi]   - Or set ODDSPAPI_API_KEY environment variable`);
        }
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
    const data = await makeRequest('/sports', {}, 'Get available sports list to find CS2 sport ID');
    
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
// Original fetchUpcomingMatches function (before caching)
async function _fetchUpcomingMatches(options = {}) {
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

    const data = await makeRequest('/fixtures', params, 'Fetch upcoming CS2 fixtures/matches');

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

// Cached version of fetchUpcomingMatches
const fetchUpcomingMatches = performanceMiddleware.wrapAPIFunction(_fetchUpcomingMatches, 'matches');

/**
 * Fetch odds for a specific fixture
 * @param {string} fixtureId - Fixture ID from OddsPapi (e.g., "id1000001761300517")
 * @returns {Promise<Object|null>} Fixture with odds or null if not found
 */
// Original fetchMatchOdds function (before caching)
async function _fetchMatchOdds(fixtureId) {
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
    }, `Fetch odds for fixture ${fixtureId}`);

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

// Cached version of fetchMatchOdds
const fetchMatchOdds = performanceMiddleware.wrapAPIFunction(_fetchMatchOdds, 'odds');

/**
 * Fetch match results/scores from OddsPapi
 * @param {string} fixtureId - Fixture ID
 * @returns {Promise<Object|null>} Match result with scores or null
 */
// Original fetchMatchResults function (before caching)
async function _fetchMatchResults(fixtureId) {
  try {
    if (requestCount >= REQUEST_LIMIT_PER_MONTH) {
      console.warn('[OddsPapi] Request limit reached.');
      return null;
    }

    // Use settlements endpoint to check if match is finished
    // According to OddsPapi docs: https://oddspapi.io/en/docs/get-settlements
    // Response structure: { fixtureId, markets: { marketId: { outcomes: { outcomeId: { players: { playerId: { result: "WIN"/"LOSE"/"PUSH" } } } } } } }
    const settlements = await makeRequest('/settlements', {
      fixtureId: fixtureId
    }, `Check match settlement/results for fixture ${fixtureId}`);

    // Also try scores endpoint for actual scores
    let scoresData = null;
    try {
      scoresData = await makeRequest('/scores', {
        fixtureId: fixtureId
      }, `Get match scores for fixture ${fixtureId}`);
    } catch (error) {
      // Scores endpoint may not be available, that's OK
      console.log('[OddsPapi] Scores endpoint not available, using settlements only');
    }

    // Parse settlements response (object, not array)
    if (settlements && settlements.fixtureId && settlements.markets) {
      // Extract winner from market 101 (Moneyline) or 171 (Match Winner for esports)
      const marketId = settlements.markets['171'] ? '171' : (settlements.markets['101'] ? '101' : null);
      
      if (marketId && settlements.markets[marketId] && settlements.markets[marketId].outcomes) {
        const outcomes = settlements.markets[marketId].outcomes;
        let winner = null;
        
        // Check outcomes: 101 = team1/home, 102 = team2/away, 103 = draw
        // For market 171 (esports): similar structure
        for (const [outcomeId, outcomeData] of Object.entries(outcomes)) {
          // Check if any player has WIN result
          if (outcomeData.players) {
            for (const playerData of Object.values(outcomeData.players)) {
              if (playerData.result === 'WIN') {
                // Map outcome ID to winner
                if (outcomeId === '101' || outcomeId === '171') {
                  winner = 'team1';
                } else if (outcomeId === '102' || outcomeId === '172') {
                  winner = 'team2';
                } else if (outcomeId === '103' || outcomeId === '173') {
                  winner = 'draw';
                }
                break;
              }
            }
            if (winner) break;
          }
        }
        
        // Get scores from scores endpoint if available
        let participant1Score = null;
        let participant2Score = null;
        if (scoresData && scoresData.scores) {
          participant1Score = scoresData.scores.participant1Score || null;
          participant2Score = scoresData.scores.participant2Score || null;
        }
        
        if (winner) {
          return {
            fixtureId: settlements.fixtureId || fixtureId,
            completed: true,
            statusId: scoresData?.statusId || 3, // 3 = finished
            winner: winner,
            participant1Score: participant1Score,
            participant2Score: participant2Score
          };
        }
      }
    }

    // If no settlement, check scores data as fallback
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

// Cached version of fetchMatchResults
const fetchMatchResults = performanceMiddleware.wrapAPIFunction(_fetchMatchResults, 'results');

/**
 * Get performance cache statistics
 * @returns {Object} Cache statistics including hit rate, memory usage, etc.
 */
function getCacheStats() {
  return apiCache.getStats();
}

/**
 * Clear all cached data
 * @returns {Promise<void>}
 */
async function clearCache() {
  return apiCache.clear();
}

/**
 * Extract odds from all bookmakers and calculate common range
 * Returns odds selected from the most common range across bookmakers
 * @param {Object} fixture - Fixture object with bookmakerOdds
 * @returns {Object} { team1Odds, team2Odds, drawOdds } with values from common range
 */
function extractOddsWithCommonRange(fixture) {
  const fixtureId = fixture.fixtureId || fixture.id;
  let team1Odds = null;
  let team2Odds = null;
  let drawOdds = null;

  if (!fixture.bookmakerOdds || Object.keys(fixture.bookmakerOdds).length === 0) {
    console.log(`[OddsPapi] No bookmakerOdds found for fixture ${fixtureId}`);
    return { team1Odds, team2Odds, drawOdds };
  }

  const bookmakerNames = Object.keys(fixture.bookmakerOdds);
  console.log(`[OddsPapi] Found ${bookmakerNames.length} bookmaker(s): ${bookmakerNames.join(', ')}`);

  // Collect all odds from all bookmakers
  const allTeam1Odds = [];
  const allTeam2Odds = [];
  const allDrawOdds = [];

  // Try market 171 first (Match Winner for esports), then fallback to 101 (Moneyline)
  for (const bookmakerName of bookmakerNames) {
    const bookmaker = fixture.bookmakerOdds[bookmakerName];
    if (!bookmaker || !bookmaker.markets) continue;

    // Try market 171 (esports match winner)
    let market = bookmaker.markets[MARKET_MATCH_WINNER];
    let marketType = '171';
    
    // Fallback to market 101 (moneyline) if 171 not available
    if (!market) {
      market = bookmaker.markets[MARKET_MONEYLINE];
      marketType = '101';
    }

    if (!market || !market.outcomes) continue;

    // Extract odds from market 171 (outcomes 171 and 172) or 101 (outcomes 101, 102, 103)
    if (marketType === '171') {
      // Market 171: outcomes 171 and 172
      // PROBLEM: Different bookmakers have these reversed!
      // Some have: 171 = participant1, 172 = participant2
      // Others have: 171 = participant2, 172 = participant1
      // Solution: For each bookmaker, determine which outcome maps to which participant
      // by checking the pattern: if 171 has lower odds, it's likely the favorite
      // We'll use a majority-vote approach: determine which pattern is more common
      let outcome171Price = null;
      let outcome172Price = null;

      if (market.outcomes['171'] && market.outcomes['171'].players) {
        for (const playerId in market.outcomes['171'].players) {
          const player = market.outcomes['171'].players[playerId];
          if (player && player.active !== false && player.price) {
            outcome171Price = parseFloat(player.price);
            break;
          }
        }
      }

      if (market.outcomes['172'] && market.outcomes['172'].players) {
        for (const playerId in market.outcomes['172'].players) {
          const player = market.outcomes['172'].players[playerId];
          if (player && player.active !== false && player.price) {
            outcome172Price = parseFloat(player.price);
            break;
          }
        }
      }

      if (outcome171Price && outcome172Price) {
        // Store both outcomes with bookmaker name and determine mapping per bookmaker
        if (!fixture._tempOutcomes) {
          fixture._tempOutcomes = { 
            outcome171: [], 
            outcome172: [],
            mappings: [] // Track which pattern each bookmaker uses
          };
        }
        fixture._tempOutcomes.outcome171.push({ bookmaker: bookmakerName, price: outcome171Price });
        fixture._tempOutcomes.outcome172.push({ bookmaker: bookmakerName, price: outcome172Price });
        
        // Determine this bookmaker's pattern: which outcome has lower odds (favorite)?
        // We'll use this to determine the mapping later
        const is171Favorite = outcome171Price < outcome172Price;
        fixture._tempOutcomes.mappings.push({
          bookmaker: bookmakerName,
          is171Favorite: is171Favorite,
          price171: outcome171Price,
          price172: outcome172Price
        });
      }
    } else {
      // Market 101: outcomes 101=team1, 102=draw, 103=team2
      if (market.outcomes['101'] && market.outcomes['101'].players) {
        for (const playerId in market.outcomes['101'].players) {
          const player = market.outcomes['101'].players[playerId];
          if (player && player.active !== false && player.price) {
            allTeam1Odds.push(parseFloat(player.price));
            break;
          }
        }
      }

      if (market.outcomes['102'] && market.outcomes['102'].players) {
        for (const playerId in market.outcomes['102'].players) {
          const player = market.outcomes['102'].players[playerId];
          if (player && player.active !== false && player.price) {
            allDrawOdds.push(parseFloat(player.price));
            break;
          }
        }
      }

      if (market.outcomes['103'] && market.outcomes['103'].players) {
        for (const playerId in market.outcomes['103'].players) {
          const player = market.outcomes['103'].players[playerId];
          if (player && player.active !== false && player.price) {
            allTeam2Odds.push(parseFloat(player.price));
            break;
          }
        }
      }
    }
  }

  // For market 171, we need to determine which outcome maps to which participant
  // by analyzing the pattern across all bookmakers
  if (fixture._tempOutcomes && fixture._tempOutcomes.outcome171.length > 0) {
    const mappings = fixture._tempOutcomes.mappings || [];
    
    // Count how many bookmakers have each pattern
    let count171AsFavorite = 0; // Bookmakers where 171 has lower odds (favorite)
    let count172AsFavorite = 0; // Bookmakers where 172 has lower odds (favorite)
    
    for (const mapping of mappings) {
      if (mapping.is171Favorite) {
        count171AsFavorite++;
      } else {
        count172AsFavorite++;
      }
    }
    
    // Determine the majority pattern
    // If most bookmakers show 171 as favorite, then 171 likely maps to the favorite participant
    // We need to determine which participant (1 or 2) is the favorite based on the odds pattern
    const majority171IsFavorite = count171AsFavorite >= count172AsFavorite;
    
    // Strategy: We'll determine the mapping by checking which outcome consistently has lower odds
    // If 171 is more commonly the favorite, we need to check if participant1 or participant2 should be favorite
    // Since we can't know from the fixture alone, we'll use a different approach:
    // For each bookmaker, map outcomes to participants based on their individual pattern
    // Then aggregate correctly
    
    // Collect odds for participant1 and participant2 separately
    // We'll use a two-pass approach:
    // 1. First, determine which outcome (171 or 172) more commonly maps to participant1
    // 2. Then, for each bookmaker, apply the correct mapping
    
    // Since we don't have team names in outcomes, we'll use a statistical approach:
    // If most bookmakers show 171 as favorite, assume 171 maps to the favorite participant
    // But we still need to know which participant is favorite...
    
    // Better approach: For each bookmaker, we have two outcomes with two prices
    // We'll collect all "favorite" odds and all "underdog" odds separately
    // Then determine which participant should be favorite based on the pattern
    
    // Actually, the simplest and most reliable approach:
    // 1. For each bookmaker, determine which outcome is favorite (lower odds)
    // 2. Collect all favorite odds and all underdog odds separately
    // 3. Map favorite odds to the participant that should be favorite
    // 4. But we still need to know which participant is favorite...
    
    // Final approach: Use the pattern where most bookmakers agree
    // If majority show 171 as favorite, then:
    //   - For bookmakers where 171 is favorite: 171→participant1, 172→participant2
    //   - For bookmakers where 172 is favorite: 171→participant2, 172→participant1 (reversed)
    // But we need to know which participant should be favorite...
    
    // Actually, let's use a simpler heuristic:
    // Since we can't know which participant is favorite from fixture data alone,
    // we'll assume the mapping is consistent for the majority of bookmakers
    // If most bookmakers show 171 as favorite, assume 171→participant1 (or whichever is more common)
    
    // Collect odds correctly mapped to participants
    for (let i = 0; i < mappings.length; i++) {
      const mapping = mappings[i];
      const price171 = mapping.price171;
      const price172 = mapping.price172;
      
      // Determine mapping for this bookmaker
      // If this bookmaker shows 171 as favorite and majority also shows 171 as favorite,
      // then 171→participant1, 172→participant2
      // If this bookmaker shows 172 as favorite but majority shows 171 as favorite,
      // then this bookmaker is reversed: 171→participant2, 172→participant1
      
      if (majority171IsFavorite) {
        // Majority pattern: 171 is favorite
        if (mapping.is171Favorite) {
          // This bookmaker matches majority: 171→participant1, 172→participant2
          allTeam1Odds.push(price171);
          allTeam2Odds.push(price172);
        } else {
          // This bookmaker is reversed: 171→participant2, 172→participant1
          allTeam1Odds.push(price172);
          allTeam2Odds.push(price171);
        }
      } else {
        // Majority pattern: 172 is favorite
        if (mapping.is171Favorite) {
          // This bookmaker is reversed: 171→participant2, 172→participant1
          allTeam1Odds.push(price172);
          allTeam2Odds.push(price171);
        } else {
          // This bookmaker matches majority: 171→participant1, 172→participant2
          allTeam1Odds.push(price171);
          allTeam2Odds.push(price172);
        }
      }
    }
    
    // Validate the mapping: if both averages are very low, something is wrong
    if (allTeam1Odds.length > 0 && allTeam2Odds.length > 0) {
      const avgTeam1 = allTeam1Odds.reduce((a, b) => a + b, 0) / allTeam1Odds.length;
      const avgTeam2 = allTeam2Odds.reduce((a, b) => a + b, 0) / allTeam2Odds.length;
      
      // Validate the mapping: Check if odds make sense
      // If both are very low (< 1.5), the entire mapping might be inverted
      // Also check if the odds distribution suggests an inversion:
      // - If one participant has consistently very low odds (< 1.2) and the other has high odds (> 3.0),
      //   but the low odds participant has higher average than expected, we might be inverted
      // - Better heuristic: If avgTeam1 < avgTeam2 but avgTeam1 > 2.0, something is likely wrong
      //   (the favorite should have odds < 2.0 typically)
      
      const shouldInvert = (avgTeam1 < 1.5 && avgTeam2 < 1.5) || // Both very low
                          (avgTeam1 > avgTeam2 && avgTeam1 > 2.5 && avgTeam2 < 2.0) || // Team1 has higher odds but Team2 is in favorite range
                          (avgTeam2 > avgTeam1 && avgTeam2 > 2.5 && avgTeam1 < 2.0); // Team2 has higher odds but Team1 is in favorite range
      
      if (shouldInvert) {
        console.warn(`[OddsPapi] Market 171: Odds distribution suggests inversion (${avgTeam1.toFixed(2)}, ${avgTeam2.toFixed(2)}), inverting all mappings`);
        // Invert all mappings
        const temp = [...allTeam1Odds];
        allTeam1Odds.length = 0;
        allTeam1Odds.push(...allTeam2Odds);
        allTeam2Odds.length = 0;
        allTeam2Odds.push(...temp);
      }
      
      console.log(`[OddsPapi] Market 171 mapping: ${majority171IsFavorite ? '171=favorite (majority)' : '172=favorite (majority)'} (${count171AsFavorite} vs ${count172AsFavorite} bookmakers)`);
      console.log(`[OddsPapi]   Participant1 avg: ${avgTeam1.toFixed(2)}, Participant2 avg: ${avgTeam2.toFixed(2)}`);
    }
    
    // Clean up temp data
    delete fixture._tempOutcomes;
  }

  // Calculate common range and select middle value
  // IMPORTANT: For market 171, we've already mapped outcomes to participants correctly above
  // For market 101, the mapping is standard (101=team1, 103=team2)
  team1Odds = calculateCommonRangeOdds(allTeam1Odds);
  team2Odds = calculateCommonRangeOdds(allTeam2Odds);
  drawOdds = calculateCommonRangeOdds(allDrawOdds);

  // Final validation: Check if the odds make sense
  // A valid match should have:
  // - One favorite with low odds (typically 1.0-2.0)
  // - One underdog with higher odds (typically 2.0+)
  // If both are very low (< 1.5), both are high (> 3.0), or the "favorite" has odds > 2.5,
  // the mapping is likely incorrect
  if (team1Odds && team2Odds) {
    const bothLow = team1Odds < 1.5 && team2Odds < 1.5;
    const bothHigh = team1Odds > 3.0 && team2Odds > 3.0;
    const favoriteHasHighOdds = (team1Odds < team2Odds && team1Odds > 2.5) || 
                                (team2Odds < team1Odds && team2Odds > 2.5);
    
    if (bothLow || bothHigh || favoriteHasHighOdds) {
      console.warn(`[OddsPapi] ⚠ WARNING: Odds distribution suggests incorrect mapping (${team1Odds}, ${team2Odds}).`);
      console.warn(`[OddsPapi]   Participant1: ${fixture.participant1Name}, Participant2: ${fixture.participant2Name}`);
      console.warn(`[OddsPapi]   Both low: ${bothLow}, Both high: ${bothHigh}, Favorite has high odds: ${favoriteHasHighOdds}`);
      
      // Swap as a last resort - the mapping logic above should have caught this
      const temp = team1Odds;
      team1Odds = team2Odds;
      team2Odds = temp;
      console.log(`[OddsPapi]   Final swap applied: Participant1=${team1Odds}, Participant2=${team2Odds}`);
    }
  }
  
  // Additional validation: Check if odds are in a reasonable range
  // One should be favorite (low odds, typically 1.0-2.0) and one should be underdog (higher odds, typically 2.0+)
  // If both are in the middle range (1.5-3.0), that's also fine (close match)
  // But if one is extremely high (> 10) and the other is also high (> 3), something might be wrong
  if (team1Odds && team2Odds) {
    const bothHigh = team1Odds > 3.0 && team2Odds > 3.0;
    const oneExtreme = (team1Odds > 10 && team2Odds < 2.0) || (team2Odds > 10 && team1Odds < 2.0);
    
    if (bothHigh && !oneExtreme) {
      console.warn(`[OddsPapi] ⚠ Both odds are relatively high (${team1Odds}, ${team2Odds}). This might indicate a mapping issue.`);
    }
  }

  if (team1Odds !== null || team2Odds !== null) {
    console.log(`[OddsPapi] ✓ Extracted odds for fixture ${fixtureId}: team1=${team1Odds}, team2=${team2Odds}, draw=${drawOdds}`);
    console.log(`[OddsPapi]   Participant1 (${fixture.participant1Name}): ${team1Odds}`);
    console.log(`[OddsPapi]   Participant2 (${fixture.participant2Name}): ${team2Odds}`);
  } else {
    console.log(`[OddsPapi] ⚠ No odds extracted from any bookmaker for fixture ${fixtureId}`);
  }

  return { team1Odds, team2Odds, drawOdds };
}

/**
 * Calculate common range odds from array of odds values
 * Finds the range where most bookmakers fall and selects middle value
 * @param {Array<number>} oddsArray - Array of odds values from different bookmakers
 * @returns {number|null} Selected odds value from common range, or null if no valid odds
 */
function calculateCommonRangeOdds(oddsArray) {
  if (!oddsArray || oddsArray.length === 0) {
    return null;
  }

  // Filter out invalid values
  const validOdds = oddsArray.filter(odds => odds && odds > 0 && isFinite(odds));
  if (validOdds.length === 0) {
    return null;
  }

  // If only one or two values, return average
  if (validOdds.length <= 2) {
    const avg = validOdds.reduce((a, b) => a + b, 0) / validOdds.length;
    return parseFloat(avg.toFixed(2));
  }

  // Sort odds
  const sortedOdds = [...validOdds].sort((a, b) => a - b);
  
  // Find the most common range (where most values cluster)
  // Use a sliding window approach to find the tightest cluster
  let bestRange = null;
  let maxCount = 0;
  const rangeSize = 0.5; // Look for ranges of 0.5 (e.g., 1.06-1.1, 6.2-8.0)

  for (let i = 0; i < sortedOdds.length; i++) {
    const rangeStart = sortedOdds[i];
    const rangeEnd = rangeStart + rangeSize;
    
    // Count how many odds fall in this range
    const count = sortedOdds.filter(odds => odds >= rangeStart && odds <= rangeEnd).length;
    
    if (count > maxCount) {
      maxCount = count;
      bestRange = { start: rangeStart, end: rangeEnd, count };
    }
  }

  // If we found a good cluster (at least 3 values or 50% of bookmakers)
  if (bestRange && bestRange.count >= Math.max(3, Math.floor(validOdds.length * 0.5))) {
    // Get all odds in the common range
    const commonRangeOdds = sortedOdds.filter(odds => 
      odds >= bestRange.start && odds <= bestRange.end
    );
    
    // Calculate middle value (median) of the common range
    const midIndex = Math.floor(commonRangeOdds.length / 2);
    const selectedOdds = commonRangeOdds[midIndex];
    
    console.log(`[OddsPapi] Common range: ${bestRange.start.toFixed(2)}-${bestRange.end.toFixed(2)} (${bestRange.count} bookmakers), selected: ${selectedOdds.toFixed(2)}`);
    return parseFloat(selectedOdds.toFixed(2));
  }

  // Fallback: use median of all odds
  const midIndex = Math.floor(sortedOdds.length / 2);
  const medianOdds = sortedOdds[midIndex];
  console.log(`[OddsPapi] Using median odds: ${medianOdds.toFixed(2)} (from ${validOdds.length} bookmakers)`);
  return parseFloat(medianOdds.toFixed(2));
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

  // Extract odds using common range approach
  const { team1Odds, team2Odds, drawOdds } = extractOddsWithCommonRange(fixture);

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
  mapOddsPapiFixtureToInternal,
  getCacheStats,
  clearCache
};
