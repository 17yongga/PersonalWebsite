/**
 * CS2 bo3.gg API Client
 * 
 * Free alternative to OddsPapi for CS2 match data.
 * bo3.gg provides a public API with upcoming/finished matches.
 * 
 * API Base: https://api.bo3.gg/api/v1
 * No API key required.
 */

const axios = require('axios');

const BASE_URL = 'https://api.bo3.gg/api/v1';

// Rate limiting
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1000; // 1 second between requests

// Team name cache (team_id -> name)
const teamNameCache = new Map();

const httpClient = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json'
  }
});

async function rateLimitedRequest(url, params = {}) {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL) {
    await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL - elapsed));
  }
  lastRequestTime = Date.now();
  
  const response = await httpClient.get(url, { params });
  return response.data;
}

/**
 * Parse team names from match slug
 * Format: "team1-slug-vs-team2-slug-DD-MM-YYYY"
 */
function parseTeamNamesFromSlug(slug) {
  if (!slug) return { team1: 'TBD', team2: 'TBD' };
  
  // Remove date suffix (DD-MM-YYYY)
  const withoutDate = slug.replace(/-\d{2}-\d{2}-\d{4}$/, '');
  
  // Split on "-vs-"
  const parts = withoutDate.split('-vs-');
  if (parts.length !== 2) return { team1: slug, team2: 'TBD' };
  
  // Convert slug to team name (replace hyphens with spaces, title case)
  function slugToName(s) {
    return s.split('-')
      .map(word => {
        // Keep known abbreviations uppercase
        const upper = word.toUpperCase();
        if (['CS2', 'CSGO', 'CS', 'NIP', 'OG', 'G2', 'B8', 'VP', 'BIG', 'SAW', 'M80', 'NRG', 'TSM', 'EG', 'KOI', 'HOTU'].includes(upper)) {
          return upper;
        }
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(' ')
      .replace(/\s+cs2$/i, '') // Remove "CS2" suffix some teams have
      .replace(/\s+cs\s*go$/i, '') // Remove "CS GO" suffix
      .trim();
  }
  
  return {
    team1: slugToName(parts[0]),
    team2: slugToName(parts[1])
  };
}

/**
 * Fetch upcoming CS2 matches from bo3.gg
 * @param {Object} options - { limit: number }
 * @returns {Promise<Array>} Matches in internal format
 */
async function fetchUpcomingMatches(options = {}) {
  const limit = options.limit || 50;
  
  try {
    console.log('[bo3.gg] Fetching upcoming CS2 matches...');
    
    const data = await rateLimitedRequest('/matches', {
      'filter[matches.status][eq]': 'upcoming',
      'filter[matches.game_version][eq]': 2, // CS2 only
      'page[limit]': Math.min(limit, 50),
      'sort': 'start_date'
    });
    
    if (!data || !data.results) {
      console.log('[bo3.gg] No results returned');
      return [];
    }
    
    const matches = data.results.map(match => {
      const { team1, team2 } = parseTeamNamesFromSlug(match.slug);
      
      return {
        id: `bo3gg_${match.id}`,
        fixtureId: `bo3gg_${match.id}`,
        homeTeam: team1,
        awayTeam: team2,
        participant1Name: team1,
        participant2Name: team2,
        tournamentId: match.tournament_id,
        tournamentName: match.slug ? extractTournamentFromSlug(match) : 'CS2 Tournament',
        commenceTime: match.start_date,
        startTime: match.start_date,
        status: 'scheduled',
        statusId: 0,
        completed: false,
        hasOdds: false,
        odds: { team1: null, team2: null, draw: null },
        source: 'bo3gg',
        boType: match.bo_type,
        tier: match.tier
      };
    });
    
    console.log(`[bo3.gg] Found ${matches.length} upcoming CS2 matches`);
    return matches;
  } catch (error) {
    console.error('[bo3.gg] Error fetching upcoming matches:', error.message);
    return [];
  }
}

/**
 * Fetch recently finished CS2 matches for settlement
 * @param {Object} options - { limit: number, days: number }
 * @returns {Promise<Array>} Finished matches
 */
async function fetchRecentResults(options = {}) {
  const limit = options.limit || 30;
  
  try {
    console.log('[bo3.gg] Fetching recent CS2 results...');
    
    const data = await rateLimitedRequest('/matches', {
      'filter[matches.status][eq]': 'finished',
      'filter[matches.game_version][eq]': 2,
      'page[limit]': Math.min(limit, 50),
      'sort': '-end_date' // Most recent first
    });
    
    if (!data || !data.results) {
      return [];
    }
    
    const results = data.results.map(match => {
      const { team1, team2 } = parseTeamNamesFromSlug(match.slug);
      
      let winner = null;
      if (match.winner_team_id === match.team1_id) winner = 'team1';
      else if (match.winner_team_id === match.team2_id) winner = 'team2';
      
      return {
        id: `bo3gg_${match.id}`,
        team1,
        team2,
        winner,
        winnerName: winner === 'team1' ? team1 : (winner === 'team2' ? team2 : null),
        score: `${match.team1_score}-${match.team2_score}`,
        team1Score: match.team1_score,
        team2Score: match.team2_score,
        startDate: match.start_date,
        endDate: match.end_date,
        status: 'finished',
        source: 'bo3gg',
        confidence: 0.95
      };
    });
    
    console.log(`[bo3.gg] Found ${results.length} recent results`);
    return results;
  } catch (error) {
    console.error('[bo3.gg] Error fetching results:', error.message);
    return [];
  }
}

function extractTournamentFromSlug(match) {
  // bo3.gg doesn't include tournament name directly,
  // but we can infer from tier
  const tierNames = {
    's': 'S-Tier',
    'a': 'A-Tier',
    'b': 'B-Tier',
    'c': 'C-Tier',
    'd': 'D-Tier'
  };
  return tierNames[match.tier] || 'CS2 Match';
}

module.exports = {
  fetchUpcomingMatches,
  fetchRecentResults,
  parseTeamNamesFromSlug
};
