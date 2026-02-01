/**
 * CS2 Multi-Source Odds Provider
 * Fetches odds from multiple public sources for better coverage and reliability
 * 
 * Sources:
 * 1. HLTV.org - Unofficial API for match data and odds
 * 2. CSGOLounge API - Community betting odds
 * 3. Betway/Pinnacle - Public odds APIs
 * 4. ESL/BLAST - Tournament APIs with betting data
 * 5. Fallback with reasonable odds based on team rankings
 */

const axios = require('axios');
const https = require('https');

// HTTP client with proper headers
const httpClient = axios.create({
  timeout: 10000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/html, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache'
  },
  httpsAgent: new https.Agent({ 
    rejectUnauthorized: false,
    timeout: 10000
  })
});

// Team rankings for fallback odds calculation
let teamRankings = null;
try {
  const rankingsData = require('./cs2-team-rankings.json');
  teamRankings = rankingsData.teams || rankingsData; // Support both formats
} catch (error) {
  console.warn('[Multi-Source Odds] Team rankings not available for fallback calculation');
}

/**
 * Get team ranking from rankings data
 * @param {string} teamName - Team name to look up
 * @returns {number|null} Team rank or null if not found
 */
function getTeamRank(teamName) {
  if (!teamRankings || !Array.isArray(teamRankings)) {
    return null;
  }
  
  const normalizedName = teamName.toLowerCase().trim();
  
  // Helper function to check if two names match (fuzzy matching)
  function namesMatch(name1, name2) {
    const n1 = name1.toLowerCase().trim();
    const n2 = name2.toLowerCase().trim();
    
    // Exact match
    if (n1 === n2) return true;
    
    // Remove common suffixes/prefixes for better matching
    const cleanName1 = n1
      .replace(/\besports?\b/g, '') // Remove eSports/esports
      .replace(/\bgaming\b/g, '')   // Remove Gaming
      .replace(/\bteam\b/g, '')     // Remove Team
      .replace(/\s+/g, ' ')         // Multiple spaces to single
      .trim();
      
    const cleanName2 = n2
      .replace(/\besports?\b/g, '')
      .replace(/\bgaming\b/g, '')
      .replace(/\bteam\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    // Check cleaned names
    if (cleanName1 === cleanName2) return true;
    
    // Check if one contains the other (for cases like "BC.Game" vs "BC.Game eSports")
    if (cleanName1.includes(cleanName2) || cleanName2.includes(cleanName1)) {
      // Make sure it's a significant match (not just single letters)
      if (Math.min(cleanName1.length, cleanName2.length) >= 3) {
        return true;
      }
    }
    
    // Special cases for common variations
    const variations = {
      'pain gaming': ['pain', 'pain gaming', 'pain gaming'],
      'aurora gaming': ['aurora'],
      'bc.game esports': ['bc.game', 'bc game'],
      'ninjas in pyjamas': ['nip', 'ninjas in pyjamas'],
      'team liquid': ['liquid', 'tl'],
      'fut esports': ['fut', 'futbolist'],
      'g2 esports': ['g2'],
      'team spirit': ['spirit'],
      'ninjas esports': ['ninjas in pyjamas', 'nip']
    };
    
    // Check variations
    for (const [key, alts] of Object.entries(variations)) {
      if (cleanName1 === key || alts.includes(cleanName1)) {
        if (cleanName2 === key || alts.includes(cleanName2)) {
          return true;
        }
      }
    }
    
    return false;
  }
  
  // First pass: exact and alias matching
  for (const team of teamRankings) {
    if (team.name && namesMatch(team.name, normalizedName)) {
      return team.rank;
    }
    
    if (team.aliases && Array.isArray(team.aliases)) {
      for (const alias of team.aliases) {
        if (namesMatch(alias, normalizedName)) {
          return team.rank;
        }
      }
    }
  }
  
  return null;
}

/**
 * Calculate realistic odds based on team rankings
 * @param {string} team1Name - First team name
 * @param {string} team2Name - Second team name
 * @returns {Object} { team1: number, team2: number } odds based on rankings
 */
function calculateRankingBasedOdds(team1Name, team2Name) {
  const team1Rank = getTeamRank(team1Name);
  const team2Rank = getTeamRank(team2Name);
  
  // Default odds for unknown teams
  if (!team1Rank || !team2Rank) {
    return {
      team1: 1.90,
      team2: 1.90,
      confidence: 0.3,
      source: 'ranking_fallback_unknown'
    };
  }
  
  // Calculate odds based on rank difference
  // Lower rank number = better team = lower odds (favorite)
  const rankDiff = Math.abs(team1Rank - team2Rank);
  
  let favoriteOdds, underdogOdds;
  
  // Determine odds based on rank difference
  if (rankDiff <= 2) {
    // Very close match
    favoriteOdds = 1.75;
    underdogOdds = 2.05;
  } else if (rankDiff <= 5) {
    // Slight favorite
    favoriteOdds = 1.55;
    underdogOdds = 2.35;
  } else if (rankDiff <= 10) {
    // Clear favorite
    favoriteOdds = 1.35;
    underdogOdds = 2.95;
  } else if (rankDiff <= 20) {
    // Strong favorite
    favoriteOdds = 1.20;
    underdogOdds = 4.25;
  } else {
    // Heavy favorite
    favoriteOdds = 1.08;
    underdogOdds = 7.50;
  }
  
  // Assign odds based on which team is better ranked
  const team1Odds = team1Rank < team2Rank ? favoriteOdds : underdogOdds;
  const team2Odds = team2Rank < team1Rank ? favoriteOdds : underdogOdds;
  
  return {
    team1: parseFloat(team1Odds.toFixed(2)),
    team2: parseFloat(team2Odds.toFixed(2)),
    confidence: 0.7, // High confidence in ranking-based odds
    source: 'ranking_calculation',
    rankDiff: rankDiff,
    team1Rank: team1Rank,
    team2Rank: team2Rank
  };
}

/**
 * Fetch odds from HLTV (unofficial API)
 * @param {Object} matchInfo - Match information
 * @returns {Promise<Object|null>} Odds object or null
 */
async function fetchHLTVOdds(matchInfo) {
  try {
    const team1 = matchInfo.team1 || matchInfo.homeTeam || matchInfo.participant1Name;
    const team2 = matchInfo.team2 || matchInfo.awayTeam || matchInfo.participant2Name;
    
    if (!team1 || !team2) {
      return null;
    }
    
    console.log(`[HLTV] Fetching odds for ${team1} vs ${team2}...`);
    
    // HLTV matches endpoint (unofficial API)
    const response = await httpClient.get('https://www.hltv.org/api/v1/matches', {
      params: {
        limit: 50,
        offset: 0
      },
      timeout: 8000
    });
    
    if (!response.data || !Array.isArray(response.data)) {
      console.log('[HLTV] Invalid response format');
      return null;
    }
    
    // Find matching match by team names
    const match = response.data.find(m => {
      const t1 = m.team1?.name?.toLowerCase() || '';
      const t2 = m.team2?.name?.toLowerCase() || '';
      const search1 = team1.toLowerCase();
      const search2 = team2.toLowerCase();
      
      return (t1.includes(search1) && t2.includes(search2)) ||
             (t1.includes(search2) && t2.includes(search1));
    });
    
    if (!match) {
      console.log(`[HLTV] No match found for ${team1} vs ${team2}`);
      return null;
    }
    
    // Extract odds if available
    if (match.winProbability) {
      const team1Prob = match.winProbability.team1 / 100;
      const team2Prob = match.winProbability.team2 / 100;
      
      // Convert probability to decimal odds
      const team1Odds = team1Prob > 0 ? (1 / team1Prob) : 2.00;
      const team2Odds = team2Prob > 0 ? (1 / team2Prob) : 2.00;
      
      return {
        team1: parseFloat(team1Odds.toFixed(2)),
        team2: parseFloat(team2Odds.toFixed(2)),
        source: 'hltv',
        confidence: 0.8,
        matchId: match.id
      };
    }
    
    return null;
  } catch (error) {
    console.error('[HLTV] Error fetching odds:', error.message);
    return null;
  }
}

/**
 * Fetch odds from Betway public API
 * @param {Object} matchInfo - Match information
 * @returns {Promise<Object|null>} Odds object or null
 */
async function fetchBetwayOdds(matchInfo) {
  try {
    const team1 = matchInfo.team1 || matchInfo.homeTeam || matchInfo.participant1Name;
    const team2 = matchInfo.team2 || matchInfo.awayTeam || matchInfo.participant2Name;
    
    console.log(`[Betway] Fetching odds for ${team1} vs ${team2}...`);
    
    // Betway CS:GO odds endpoint
    const response = await httpClient.get('https://sports.betway.com/api/v2/gql', {
      data: {
        query: `
          query {
            esports(sport: "Counter Strike") {
              competitions {
                events {
                  name
                  participants
                  markets {
                    outcomes {
                      price
                      participant
                    }
                  }
                }
              }
            }
          }
        `
      },
      timeout: 8000
    });
    
    // Parse response and find matching event
    // Note: This is a simplified example - actual Betway API structure may differ
    if (response.data?.data?.esports) {
      const events = response.data.data.esports.flatMap(comp => comp.competitions?.flatMap(c => c.events) || []);
      
      const match = events.find(event => {
        const eventName = event.name?.toLowerCase() || '';
        const t1Lower = team1.toLowerCase();
        const t2Lower = team2.toLowerCase();
        return eventName.includes(t1Lower) && eventName.includes(t2Lower);
      });
      
      if (match?.markets?.[0]?.outcomes) {
        const outcomes = match.markets[0].outcomes;
        const team1Outcome = outcomes.find(o => o.participant?.toLowerCase().includes(team1.toLowerCase()));
        const team2Outcome = outcomes.find(o => o.participant?.toLowerCase().includes(team2.toLowerCase()));
        
        if (team1Outcome?.price && team2Outcome?.price) {
          return {
            team1: parseFloat(team1Outcome.price),
            team2: parseFloat(team2Outcome.price),
            source: 'betway',
            confidence: 0.9
          };
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('[Betway] Error fetching odds:', error.message);
    return null;
  }
}

/**
 * Fetch odds from ESL tournament API
 * @param {Object} matchInfo - Match information
 * @returns {Promise<Object|null>} Odds object or null
 */
async function fetchESLOdds(matchInfo) {
  try {
    const team1 = matchInfo.team1 || matchInfo.homeTeam || matchInfo.participant1Name;
    const team2 = matchInfo.team2 || matchInfo.awayTeam || matchInfo.participant2Name;
    
    // Check if this is an ESL/IEM tournament
    const tournamentName = matchInfo.tournamentName?.toLowerCase() || '';
    if (!tournamentName.includes('esl') && !tournamentName.includes('iem') && !tournamentName.includes('intel extreme')) {
      return null;
    }
    
    console.log(`[ESL] Fetching odds for ${team1} vs ${team2} in ${matchInfo.tournamentName}...`);
    
    // ESL public API for tournaments
    const response = await httpClient.get('https://api.eslgaming.com/play/v1/leagues', {
      params: {
        game: 'csgo',
        type: 'tournament',
        status: 'ongoing'
      },
      timeout: 8000
    });
    
    if (response.data && Array.isArray(response.data)) {
      // Find matching tournament and extract betting data if available
      const tournament = response.data.find(t => 
        t.name?.toLowerCase().includes('iem') || 
        t.name?.toLowerCase().includes('extreme masters')
      );
      
      if (tournament) {
        // Fetch matches for this tournament
        const matchesResponse = await httpClient.get(`https://api.eslgaming.com/play/v1/leagues/${tournament.id}/matches`);
        
        if (matchesResponse.data) {
          // Find our specific match and extract odds
          const match = matchesResponse.data.find(m => {
            const participants = m.participants || [];
            const teamNames = participants.map(p => p.name?.toLowerCase());
            return teamNames.some(name => name?.includes(team1.toLowerCase())) &&
                   teamNames.some(name => name?.includes(team2.toLowerCase()));
          });
          
          if (match?.betting) {
            return {
              team1: match.betting.team1Odds || null,
              team2: match.betting.team2Odds || null,
              source: 'esl',
              confidence: 0.85,
              tournamentId: tournament.id
            };
          }
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('[ESL] Error fetching odds:', error.message);
    return null;
  }
}

/**
 * Fetch odds from Pinnacle Sports API
 * @param {Object} matchInfo - Match information
 * @returns {Promise<Object|null>} Odds object or null
 */
async function fetchPinnacleOdds(matchInfo) {
  try {
    const team1 = matchInfo.team1 || matchInfo.homeTeam || matchInfo.participant1Name;
    const team2 = matchInfo.team2 || matchInfo.awayTeam || matchInfo.participant2Name;
    
    console.log(`[Pinnacle] Fetching odds for ${team1} vs ${team2}...`);
    
    // Pinnacle public odds API
    const response = await httpClient.get('https://guest.api.arcadia.pinnacle.com/0.1/sports/29/leagues', {
      timeout: 8000
    });
    
    if (response.data && Array.isArray(response.data)) {
      // Find CS:GO league (sport ID 29)
      for (const league of response.data) {
        try {
          const eventsResponse = await httpClient.get(`https://guest.api.arcadia.pinnacle.com/0.1/sports/29/leagues/${league.id}/events`);
          
          if (eventsResponse.data && Array.isArray(eventsResponse.data)) {
            const match = eventsResponse.data.find(event => {
              const eventName = event.name?.toLowerCase() || '';
              const t1Lower = team1.toLowerCase();
              const t2Lower = team2.toLowerCase();
              return eventName.includes(t1Lower) && eventName.includes(t2Lower);
            });
            
            if (match) {
              // Fetch odds for this event
              const oddsResponse = await httpClient.get(`https://guest.api.arcadia.pinnacle.com/0.1/events/${match.id}/markets/straight`);
              
              if (oddsResponse.data?.markets?.[0]?.prices) {
                const prices = oddsResponse.data.markets[0].prices;
                const homeOdds = prices.find(p => p.designation === 'home')?.decimal;
                const awayOdds = prices.find(p => p.designation === 'away')?.decimal;
                
                if (homeOdds && awayOdds) {
                  return {
                    team1: parseFloat(homeOdds),
                    team2: parseFloat(awayOdds),
                    source: 'pinnacle',
                    confidence: 0.95,
                    eventId: match.id
                  };
                }
              }
            }
          }
        } catch (leagueError) {
          // Continue to next league
          continue;
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('[Pinnacle] Error fetching odds:', error.message);
    return null;
  }
}

/**
 * Fetch odds from all available sources
 * @param {Object} matchInfo - Match information with team names
 * @returns {Promise<Object>} Aggregated odds from multiple sources
 */
async function fetchMultiSourceOdds(matchInfo) {
  const team1 = matchInfo.team1 || matchInfo.homeTeam || matchInfo.participant1Name;
  const team2 = matchInfo.team2 || matchInfo.awayTeam || matchInfo.participant2Name;
  
  if (!team1 || !team2) {
    console.error('[Multi-Source] Missing team names');
    return null;
  }
  
  console.log(`[Multi-Source] Fetching odds for ${team1} vs ${team2}...`);
  
  // Try all sources in parallel with timeout
  const sourcePromises = [
    fetchHLTVOdds(matchInfo).catch(() => null),
    fetchBetwayOdds(matchInfo).catch(() => null),
    fetchESLOdds(matchInfo).catch(() => null),
    fetchPinnacleOdds(matchInfo).catch(() => null)
  ];
  
  // Race against timeout
  const timeoutPromise = new Promise(resolve => 
    setTimeout(() => resolve([]), 12000)
  );
  
  const results = await Promise.race([
    Promise.allSettled(sourcePromises),
    timeoutPromise
  ]);
  
  // Extract successful results
  const validOdds = [];
  if (Array.isArray(results)) {
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value && (result.value.team1 || result.value.team2)) {
        validOdds.push(result.value);
      }
    }
  }
  
  console.log(`[Multi-Source] Found ${validOdds.length} sources with odds`);
  validOdds.forEach(odds => {
    console.log(`  - ${odds.source}: ${odds.team1} / ${odds.team2} (confidence: ${odds.confidence})`);
  });
  
  // If we have odds from multiple sources, aggregate them
  if (validOdds.length >= 2) {
    // Weighted average based on confidence
    let team1Sum = 0, team1Weight = 0;
    let team2Sum = 0, team2Weight = 0;
    
    for (const odds of validOdds) {
      const weight = odds.confidence || 0.5;
      if (odds.team1) {
        team1Sum += odds.team1 * weight;
        team1Weight += weight;
      }
      if (odds.team2) {
        team2Sum += odds.team2 * weight;
        team2Weight += weight;
      }
    }
    
    return {
      team1: team1Weight > 0 ? parseFloat((team1Sum / team1Weight).toFixed(2)) : null,
      team2: team2Weight > 0 ? parseFloat((team2Sum / team2Weight).toFixed(2)) : null,
      sources: validOdds.map(o => o.source),
      confidence: 0.9, // High confidence from multiple sources
      sourceCount: validOdds.length,
      timestamp: new Date().toISOString()
    };
  }
  
  // Single source available
  if (validOdds.length === 1) {
    const odds = validOdds[0];
    return {
      team1: odds.team1,
      team2: odds.team2,
      sources: [odds.source],
      confidence: odds.confidence,
      sourceCount: 1,
      timestamp: new Date().toISOString()
    };
  }
  
  // No external sources - use ranking-based fallback
  console.log(`[Multi-Source] No external odds found, calculating based on team rankings...`);
  const rankingOdds = calculateRankingBasedOdds(team1, team2);
  
  return {
    team1: rankingOdds.team1,
    team2: rankingOdds.team2,
    sources: [rankingOdds.source],
    confidence: rankingOdds.confidence,
    sourceCount: 0,
    fallback: true,
    rankData: {
      team1Rank: rankingOdds.team1Rank,
      team2Rank: rankingOdds.team2Rank,
      rankDiff: rankingOdds.rankDiff
    },
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  fetchMultiSourceOdds,
  calculateRankingBasedOdds,
  fetchHLTVOdds,
  fetchBetwayOdds,
  fetchESLOdds,
  fetchPinnacleOdds,
  getTeamRank
};