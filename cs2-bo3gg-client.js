/**
 * CS2 bo3.gg API Client
 * 
 * Free alternative to OddsPapi for CS2 match data.
 * bo3.gg provides a public API with upcoming/finished matches.
 * Uses bet_updates field for real team names and bookmaker odds.
 * Falls back to team API lookup or slug parsing.
 * 
 * API Base: https://api.bo3.gg/api/v1
 * No API key required.
 */

const axios = require('axios');

const BASE_URL = 'https://api.bo3.gg/api/v1';

// Rate limiting
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 800; // 800ms between requests

// Team name/logo cache (team_id -> { name, image_url })
const teamCache = new Map();

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
 * Fetch team details from bo3.gg API
 * @param {number} teamId 
 * @returns {Promise<{name: string, image_url: string|null}>}
 */
async function fetchTeamDetails(teamId) {
  if (teamCache.has(teamId)) return teamCache.get(teamId);
  
  try {
    const data = await rateLimitedRequest('/teams', {
      'filter[teams.id][eq]': teamId
    });
    
    if (data?.results?.[0]) {
      const team = data.results[0];
      const result = { name: team.name, image_url: team.image_url || null };
      teamCache.set(teamId, result);
      return result;
    }
  } catch (error) {
    console.warn(`[bo3.gg] Failed to fetch team ${teamId}:`, error.message);
  }
  
  return null;
}

/**
 * Batch-fetch team details for multiple team IDs
 * @param {number[]} teamIds 
 * @returns {Promise<Map<number, {name: string, image_url: string|null}>>}
 */
async function fetchTeamsBatch(teamIds) {
  const uncached = teamIds.filter(id => !teamCache.has(id));
  
  if (uncached.length > 0) {
    // Fetch in small batches to respect rate limits
    const batchSize = 10;
    for (let i = 0; i < uncached.length; i += batchSize) {
      const batch = uncached.slice(i, i + batchSize);
      try {
        const data = await rateLimitedRequest('/teams', {
          'filter[teams.id][in]': batch.join(','),
          'page[limit]': batchSize
        });
        
        if (data?.results) {
          for (const team of data.results) {
            teamCache.set(team.id, { name: team.name, image_url: team.image_url || null });
          }
        }
      } catch (error) {
        console.warn(`[bo3.gg] Batch team fetch failed:`, error.message);
        // Try individual fetches as fallback
        for (const id of batch) {
          await fetchTeamDetails(id);
        }
      }
    }
  }
  
  return teamCache;
}

/**
 * Parse team names from match slug (fallback when bet_updates and team API unavailable)
 * Format: "team1-slug-vs-team2-slug-DD-MM-YYYY"
 */
function parseTeamNamesFromSlug(slug) {
  if (!slug) return { team1: 'TBD', team2: 'TBD' };
  
  // Remove date suffix (DD-MM-YYYY)
  const withoutDate = slug.replace(/-\d{2}-\d{2}-\d{4}$/, '');
  
  // Split on "-vs-"
  const parts = withoutDate.split('-vs-');
  if (parts.length !== 2) return { team1: slug, team2: 'TBD' };
  
  function slugToName(s) {
    return s.split('-')
      .map(word => {
        const upper = word.toUpperCase();
        if (['CS2', 'CSGO', 'CS', 'NIP', 'OG', 'G2', 'B8', 'VP', 'BIG', 'SAW', 'M80', 'NRG', 'TSM', 'EG', 'KOI', 'HOTU'].includes(upper)) {
          return upper;
        }
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(' ')
      .replace(/\s+cs2$/i, '')
      .replace(/\s+cs\s*go$/i, '')
      .replace(/\s+cs$/i, '')
      .trim();
  }
  
  return {
    team1: slugToName(parts[0]),
    team2: slugToName(parts[1])
  };
}

/**
 * Extract team name and odds from a match's bet_updates field
 */
function extractFromBetUpdates(match) {
  const bu = match.bet_updates;
  if (!bu) return null;
  
  const t1 = bu.team_1;
  const t2 = bu.team_2;
  
  if (!t1 && !t2) return null;
  
  return {
    team1Name: t1?.name || null,
    team2Name: t2?.name || null,
    team1Odds: t1?.coeff || null,
    team2Odds: t2?.coeff || null,
    team1Logo: null, // bet_updates doesn't include logos
    team2Logo: null
  };
}

/**
 * Resolve team names and odds for a match using all available sources
 * Priority: bet_updates > team API > slug parsing
 */
async function resolveMatchDetails(match) {
  // Source 1: bet_updates (has real names and bookmaker odds)
  const betData = extractFromBetUpdates(match);
  
  let team1Name = betData?.team1Name;
  let team2Name = betData?.team2Name;
  let team1Odds = betData?.team1Odds;
  let team2Odds = betData?.team2Odds;
  let team1Logo = null;
  let team2Logo = null;
  
  // Source 2: Team API (has names and logos)
  const t1Id = match.team1_id;
  const t2Id = match.team2_id;
  
  if (t1Id && (!team1Name || !team1Logo)) {
    const t1 = teamCache.get(t1Id);
    if (t1) {
      team1Name = team1Name || t1.name;
      team1Logo = t1.image_url;
    }
  }
  
  if (t2Id && (!team2Name || !team2Logo)) {
    const t2 = teamCache.get(t2Id);
    if (t2) {
      team2Name = team2Name || t2.name;
      team2Logo = t2.image_url;
    }
  }
  
  // Source 3: Slug parsing (last resort)
  if (!team1Name || !team2Name) {
    const slugNames = parseTeamNamesFromSlug(match.slug);
    team1Name = team1Name || slugNames.team1;
    team2Name = team2Name || slugNames.team2;
  }
  
  return { team1Name, team2Name, team1Odds, team2Odds, team1Logo, team2Logo };
}

/**
 * Fetch upcoming CS2 matches from bo3.gg
 * Uses bet_updates for real team names and bookmaker odds
 * @param {Object} options - { limit: number }
 * @returns {Promise<Array>} Matches in internal format
 */
async function fetchUpcomingMatches(options = {}) {
  const limit = options.limit || 50;
  
  try {
    console.log('[bo3.gg] Fetching upcoming CS2 matches...');
    
    const data = await rateLimitedRequest('/matches', {
      'filter[matches.status][eq]': 'upcoming',
      'filter[matches.game_version][eq]': 2,
      'page[limit]': Math.min(limit, 50),
      'sort': 'start_date'
    });
    
    if (!data || !data.results) {
      console.log('[bo3.gg] No results returned');
      return [];
    }
    
    // Collect all team IDs for batch lookup
    const teamIds = new Set();
    for (const match of data.results) {
      if (match.team1_id) teamIds.add(match.team1_id);
      if (match.team2_id) teamIds.add(match.team2_id);
    }
    
    // Batch-fetch team details (names + logos)
    if (teamIds.size > 0) {
      console.log(`[bo3.gg] Fetching details for ${teamIds.size} teams...`);
      await fetchTeamsBatch([...teamIds]);
    }
    
    // Build match objects with resolved names and odds
    const matches = [];
    for (const match of data.results) {
      const details = await resolveMatchDetails(match);
      
      // Determine odds: use bookmaker odds from bet_updates, or null
      const hasRealOdds = details.team1Odds !== null && details.team2Odds !== null;
      
      const tierNames = { 's': 'S-Tier', 'a': 'A-Tier', 'b': 'B-Tier', 'c': 'C-Tier', 'd': 'D-Tier' };
      
      matches.push({
        id: `bo3gg_${match.id}`,
        fixtureId: `bo3gg_${match.id}`,
        homeTeam: details.team1Name,
        awayTeam: details.team2Name,
        participant1Name: details.team1Name,
        participant2Name: details.team2Name,
        team1Logo: details.team1Logo,
        team2Logo: details.team2Logo,
        tournamentId: match.tournament_id,
        tournamentName: tierNames[match.tier] || 'CS2 Match',
        commenceTime: match.start_date,
        startTime: match.start_date,
        status: 'scheduled',
        statusId: 0,
        completed: false,
        hasOdds: hasRealOdds,
        odds: {
          team1: details.team1Odds,
          team2: details.team2Odds,
          draw: null
        },
        source: 'bo3gg',
        boType: match.bo_type,
        tier: match.tier,
        tierRank: match.tier_rank,
        rating: match.rating
      });
    }
    
    // Sort by tier priority (S > A > B > C) then by start time
    const tierOrder = { 's': 0, 'a': 1, 'b': 2, 'c': 3, 'd': 4 };
    matches.sort((a, b) => {
      const tierDiff = (tierOrder[a.tier] || 9) - (tierOrder[b.tier] || 9);
      if (tierDiff !== 0) return tierDiff;
      return new Date(a.startTime) - new Date(b.startTime);
    });
    
    console.log(`[bo3.gg] Found ${matches.length} upcoming CS2 matches (${matches.filter(m => m.tier === 's' || m.tier === 'a').length} S/A-tier)`);
    return matches;
  } catch (error) {
    console.error('[bo3.gg] Error fetching upcoming matches:', error.message);
    return [];
  }
}

/**
 * Fetch recently finished CS2 matches for settlement
 * @param {Object} options - { limit: number }
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
      'sort': '-end_date'
    });
    
    if (!data || !data.results) {
      return [];
    }
    
    // Batch-fetch team names
    const teamIds = new Set();
    for (const match of data.results) {
      if (match.team1_id) teamIds.add(match.team1_id);
      if (match.team2_id) teamIds.add(match.team2_id);
    }
    if (teamIds.size > 0) {
      await fetchTeamsBatch([...teamIds]);
    }
    
    const results = [];
    for (const match of data.results) {
      const details = await resolveMatchDetails(match);
      
      let winner = null;
      if (match.winner_team_id === match.team1_id) winner = 'team1';
      else if (match.winner_team_id === match.team2_id) winner = 'team2';
      
      results.push({
        id: `bo3gg_${match.id}`,
        team1: details.team1Name,
        team2: details.team2Name,
        winner,
        winnerName: winner === 'team1' ? details.team1Name : (winner === 'team2' ? details.team2Name : null),
        score: `${match.team1_score}-${match.team2_score}`,
        team1Score: match.team1_score,
        team2Score: match.team2_score,
        startDate: match.start_date,
        endDate: match.end_date,
        status: 'finished',
        source: 'bo3gg',
        confidence: 0.95
      });
    }
    
    console.log(`[bo3.gg] Found ${results.length} recent results`);
    return results;
  } catch (error) {
    console.error('[bo3.gg] Error fetching results:', error.message);
    return [];
  }
}

module.exports = {
  fetchUpcomingMatches,
  fetchRecentResults,
  fetchTeamDetails,
  fetchTeamsBatch,
  parseTeamNamesFromSlug
};
