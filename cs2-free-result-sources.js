/**
 * CS2 Free Result Sources
 * 
 * Scrapers for HLTV and Liquipedia to get match results for settlement
 * These are FREE alternatives to OddsPapi for determining match winners
 * 
 * Sources:
 * 1. HLTV - Primary source (most comprehensive CS2 data)
 * 2. Liquipedia - Secondary source (wiki-based, may lag slightly)
 * 3. ESL/PGL - Tertiary sources for major tournaments
 */

const axios = require('axios');
const cheerio = require('cheerio');

// Rate limiting configuration
const RATE_LIMITS = {
  hltv: { minDelay: 3000, lastRequest: 0 },
  liquipedia: { minDelay: 2000, lastRequest: 0 },
  esl: { minDelay: 1000, lastRequest: 0 }
};

// User agents to avoid blocks
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function respectRateLimit(source) {
  const config = RATE_LIMITS[source];
  if (!config) return;
  
  const now = Date.now();
  const timeSinceLastRequest = now - config.lastRequest;
  
  if (timeSinceLastRequest < config.minDelay) {
    const waitTime = config.minDelay - timeSinceLastRequest;
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  config.lastRequest = Date.now();
}

/**
 * Normalize team name for matching
 */
function normalizeTeamName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/^team\s+/i, '')
    .replace(/\s*(esports?|gaming|team)$/i, '')
    .replace(/\s*esports?\s*$/i, '') // Handle "G2 Esports" -> "g2"
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if two team names match (fuzzy matching)
 */
function teamsMatch(name1, name2) {
  const n1 = normalizeTeamName(name1);
  const n2 = normalizeTeamName(name2);
  
  if (n1 === n2) return true;
  if (n1.includes(n2) || n2.includes(n1)) return true;
  
  // Handle common abbreviations
  const abbreviations = {
    'natus vincere': ['navi', 'natus'],
    'ninjas in pyjamas': ['nip', 'ninjas'],
    'g2 esports': ['g2'],
    'team vitality': ['vitality'],
    'team liquid': ['liquid', 'tl'],
    'faze clan': ['faze'],
    'mousesports': ['mouz'],
    'heroic': ['heroic'],
    'astralis': ['astralis'],
    'cloud9': ['c9'],
    'complexity': ['col'],
    'fnatic': ['fnatic'],
    'big': ['big'],
    'eternal fire': ['eter', 'eternal'],
    'spirit': ['spirit', 'team spirit']
  };
  
  for (const [full, abbrevs] of Object.entries(abbreviations)) {
    if ((n1.includes(full) || abbrevs.some(a => n1 === a)) &&
        (n2.includes(full) || abbrevs.some(a => n2 === a))) {
      return true;
    }
  }
  
  return false;
}

/**
 * HLTV Scraper - Primary source for CS2 match results
 */
class HLTVScraper {
  constructor() {
    this.baseUrl = 'https://www.hltv.org';
    this.resultsCache = new Map();
  }

  async fetchPage(url, retries = 3) {
    await respectRateLimit('hltv');
    
    for (let i = 0; i < retries; i++) {
      try {
        const response = await axios.get(url, {
          headers: {
            'User-Agent': getRandomUserAgent(),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache',
            'Referer': 'https://www.hltv.org/'
          },
          timeout: 15000
        });
        return response.data;
      } catch (error) {
        console.log(`[HLTV] Attempt ${i + 1}/${retries} failed: ${error.message}`);
        if (i < retries - 1) {
          await new Promise(r => setTimeout(r, 2000 * (i + 1)));
        }
      }
    }
    return null;
  }

  /**
   * Get recent match results from HLTV results page
   */
  async getRecentResults(maxResults = 50) {
    console.log('[HLTV] Fetching recent results...');
    
    const html = await this.fetchPage(`${this.baseUrl}/results`);
    if (!html) {
      console.log('[HLTV] Failed to fetch results page');
      return [];
    }
    
    const $ = cheerio.load(html);
    const results = [];
    
    // Parse results from HLTV structure
    $('.results-all .results-sublist').each((_, dayGroup) => {
      const date = $(dayGroup).find('.standard-headline').text().trim();
      
      $(dayGroup).find('.result-con').each((_, match) => {
        if (results.length >= maxResults) return false;
        
        try {
          const matchLink = $(match).find('a.a-reset').attr('href');
          const matchId = matchLink ? matchLink.split('/')[2] : null;
          
          const team1El = $(match).find('.team1 .team');
          const team2El = $(match).find('.team2 .team');
          
          const team1 = team1El.text().trim();
          const team2 = team2El.text().trim();
          
          const score1El = $(match).find('.result-score .score-won, .result-score span').first();
          const score2El = $(match).find('.result-score .score-lost, .result-score span').last();
          
          let score1 = parseInt(score1El.text().trim()) || 0;
          let score2 = parseInt(score2El.text().trim()) || 0;
          
          // Determine winner
          const team1Won = $(match).find('.team1').hasClass('team-won');
          const team2Won = $(match).find('.team2').hasClass('team-won');
          
          let winner = null;
          if (team1Won || score1 > score2) {
            winner = team1;
          } else if (team2Won || score2 > score1) {
            winner = team2;
          }
          
          const event = $(match).find('.event-name').text().trim();
          
          if (team1 && team2 && winner) {
            results.push({
              hltvId: matchId,
              team1,
              team2,
              score: `${score1}-${score2}`,
              winner,
              loser: winner === team1 ? team2 : team1,
              event,
              date,
              source: 'hltv',
              confidence: 0.95,
              fetchedAt: new Date().toISOString()
            });
          }
        } catch (e) {
          console.log('[HLTV] Error parsing match:', e.message);
        }
      });
    });
    
    console.log(`[HLTV] Found ${results.length} recent results`);
    return results;
  }

  /**
   * Search for a specific match result by team names
   */
  async findMatchResult(team1, team2, approximateDate = null) {
    const cacheKey = `${normalizeTeamName(team1)}-${normalizeTeamName(team2)}`;
    
    // Check cache first
    if (this.resultsCache.has(cacheKey)) {
      const cached = this.resultsCache.get(cacheKey);
      if (Date.now() - cached.fetchedAt < 3600000) { // 1 hour cache
        console.log(`[HLTV] Cache hit for ${team1} vs ${team2}`);
        return cached.result;
      }
    }
    
    const recentResults = await this.getRecentResults(100);
    
    // Find matching result
    for (const result of recentResults) {
      if ((teamsMatch(result.team1, team1) && teamsMatch(result.team2, team2)) ||
          (teamsMatch(result.team1, team2) && teamsMatch(result.team2, team1))) {
        
        // Cache the result
        this.resultsCache.set(cacheKey, {
          result,
          fetchedAt: Date.now()
        });
        
        console.log(`[HLTV] Found match: ${result.team1} ${result.score} ${result.team2} - Winner: ${result.winner}`);
        return result;
      }
    }
    
    console.log(`[HLTV] No match found for ${team1} vs ${team2}`);
    return null;
  }

  /**
   * Get upcoming matches from HLTV
   */
  async getUpcomingMatches(maxMatches = 30) {
    console.log('[HLTV] Fetching upcoming matches...');
    
    const html = await this.fetchPage(`${this.baseUrl}/matches`);
    if (!html) {
      console.log('[HLTV] Failed to fetch matches page');
      return [];
    }
    
    const $ = cheerio.load(html);
    const matches = [];
    
    $('.upcomingMatchesSection .match-day').each((_, dayGroup) => {
      if (matches.length >= maxMatches) return false;
      
      $(dayGroup).find('.upcomingMatch').each((_, match) => {
        if (matches.length >= maxMatches) return false;
        
        try {
          const team1 = $(match).find('.team1 .matchTeamName').text().trim();
          const team2 = $(match).find('.team2 .matchTeamName').text().trim();
          const event = $(match).find('.matchEvent .matchEventName').text().trim();
          const time = $(match).find('.matchTime').text().trim();
          const matchLink = $(match).find('a.match').attr('href');
          const matchId = matchLink ? matchLink.split('/')[2] : null;
          
          if (team1 && team2 && team1 !== 'TBD' && team2 !== 'TBD') {
            matches.push({
              hltvId: matchId,
              team1,
              team2,
              event,
              time,
              source: 'hltv',
              fetchedAt: new Date().toISOString()
            });
          }
        } catch (e) {
          console.log('[HLTV] Error parsing upcoming match:', e.message);
        }
      });
    });
    
    console.log(`[HLTV] Found ${matches.length} upcoming matches`);
    return matches;
  }
}

/**
 * Liquipedia Scraper - Secondary source for CS2 match results
 */
class LiquipediaScraper {
  constructor() {
    this.baseUrl = 'https://liquipedia.net/counterstrike';
    this.apiUrl = 'https://liquipedia.net/counterstrike/api.php';
  }

  async fetchPage(path, retries = 2) {
    await respectRateLimit('liquipedia');
    
    const url = `${this.baseUrl}${path}`;
    
    for (let i = 0; i < retries; i++) {
      try {
        const response = await axios.get(url, {
          headers: {
            'User-Agent': getRandomUserAgent(),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://liquipedia.net/'
          },
          timeout: 15000
        });
        return response.data;
      } catch (error) {
        console.log(`[Liquipedia] Attempt ${i + 1}/${retries} failed: ${error.message}`);
        if (i < retries - 1) {
          await new Promise(r => setTimeout(r, 1500 * (i + 1)));
        }
      }
    }
    return null;
  }

  /**
   * Get matches from main page (recent and upcoming)
   */
  async getMatches() {
    console.log('[Liquipedia] Fetching matches...');
    
    const html = await this.fetchPage('/Main_Page');
    if (!html) {
      console.log('[Liquipedia] Failed to fetch main page');
      return { results: [], upcoming: [] };
    }
    
    const $ = cheerio.load(html);
    const results = [];
    const upcoming = [];
    
    // Parse match tables
    $('table.infobox_matches_content').each((_, table) => {
      try {
        const team1 = $(table).find('.team-left .team-template-text').text().trim();
        const team2 = $(table).find('.team-right .team-template-text').text().trim();
        const score = $(table).find('.versus').text().trim();
        
        // Parse score (e.g., "2 - 1")
        const scoreMatch = score.match(/(\d+)\s*[-:vs]\s*(\d+)/);
        
        if (team1 && team2 && scoreMatch) {
          const score1 = parseInt(scoreMatch[1]);
          const score2 = parseInt(scoreMatch[2]);
          
          results.push({
            team1,
            team2,
            score: `${score1}-${score2}`,
            winner: score1 > score2 ? team1 : (score2 > score1 ? team2 : null),
            source: 'liquipedia',
            confidence: 0.90,
            fetchedAt: new Date().toISOString()
          });
        } else if (team1 && team2) {
          // Upcoming match (no score yet)
          upcoming.push({
            team1,
            team2,
            source: 'liquipedia',
            fetchedAt: new Date().toISOString()
          });
        }
      } catch (e) {
        console.log('[Liquipedia] Error parsing match:', e.message);
      }
    });
    
    console.log(`[Liquipedia] Found ${results.length} results, ${upcoming.length} upcoming`);
    return { results, upcoming };
  }

  /**
   * Find match result by team names
   */
  async findMatchResult(team1, team2) {
    const { results } = await this.getMatches();
    
    for (const result of results) {
      if ((teamsMatch(result.team1, team1) && teamsMatch(result.team2, team2)) ||
          (teamsMatch(result.team1, team2) && teamsMatch(result.team2, team1))) {
        console.log(`[Liquipedia] Found match: ${result.team1} ${result.score} ${result.team2}`);
        return result;
      }
    }
    
    console.log(`[Liquipedia] No match found for ${team1} vs ${team2}`);
    return null;
  }
}

/**
 * Combined Result Fetcher - Tries multiple sources
 */
class CS2ResultFetcher {
  constructor() {
    this.hltv = new HLTVScraper();
    this.liquipedia = new LiquipediaScraper();
    this.resultCache = new Map();
  }

  /**
   * Find match result using all available sources
   * Returns result with highest confidence
   */
  async findMatchResult(team1, team2, options = {}) {
    const cacheKey = `${normalizeTeamName(team1)}-${normalizeTeamName(team2)}`;
    
    // Check memory cache
    if (this.resultCache.has(cacheKey)) {
      const cached = this.resultCache.get(cacheKey);
      const age = Date.now() - cached.timestamp;
      if (age < (options.maxCacheAge || 1800000)) { // 30 min default
        console.log(`[ResultFetcher] Using cached result (${Math.round(age/60000)}min old)`);
        return cached.result;
      }
    }
    
    console.log(`[ResultFetcher] Looking for result: ${team1} vs ${team2}`);
    
    const results = [];
    
    // Try HLTV first (most reliable)
    try {
      const hltvResult = await this.hltv.findMatchResult(team1, team2);
      if (hltvResult && hltvResult.winner) {
        results.push(hltvResult);
      }
    } catch (e) {
      console.log(`[ResultFetcher] HLTV error: ${e.message}`);
    }
    
    // Try Liquipedia as backup
    if (results.length === 0 || options.verifyWithSecondSource) {
      try {
        const liqResult = await this.liquipedia.findMatchResult(team1, team2);
        if (liqResult && liqResult.winner) {
          results.push(liqResult);
        }
      } catch (e) {
        console.log(`[ResultFetcher] Liquipedia error: ${e.message}`);
      }
    }
    
    if (results.length === 0) {
      console.log(`[ResultFetcher] No result found from any source`);
      return null;
    }
    
    // Get highest confidence result
    const bestResult = results.sort((a, b) => b.confidence - a.confidence)[0];
    
    // If multiple sources agree, boost confidence
    if (results.length > 1) {
      const allAgree = results.every(r => 
        teamsMatch(r.winner, bestResult.winner)
      );
      if (allAgree) {
        bestResult.confidence = Math.min(0.99, bestResult.confidence + 0.05);
        bestResult.verifiedBySources = results.length;
      }
    }
    
    // Cache the result
    this.resultCache.set(cacheKey, {
      result: bestResult,
      timestamp: Date.now()
    });
    
    console.log(`[ResultFetcher] Best result: ${bestResult.winner} wins (${Math.round(bestResult.confidence * 100)}% confidence)`);
    return bestResult;
  }

  /**
   * Get recent results from all sources (for batch processing)
   */
  async getRecentResults() {
    const allResults = [];
    
    try {
      const hltvResults = await this.hltv.getRecentResults(30);
      allResults.push(...hltvResults);
    } catch (e) {
      console.log(`[ResultFetcher] HLTV batch error: ${e.message}`);
    }
    
    // Liquipedia is slower, only fetch if needed
    
    // Deduplicate by team matchup
    const seen = new Set();
    const unique = allResults.filter(r => {
      const key = [normalizeTeamName(r.team1), normalizeTeamName(r.team2)].sort().join('-');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    
    console.log(`[ResultFetcher] Got ${unique.length} unique recent results`);
    return unique;
  }

  /**
   * Get upcoming matches for discovery
   */
  async getUpcomingMatches() {
    let allMatches = [];
    
    try {
      const hltvMatches = await this.hltv.getUpcomingMatches(30);
      allMatches.push(...hltvMatches);
    } catch (e) {
      console.log(`[ResultFetcher] Error fetching upcoming: ${e.message}`);
    }
    
    console.log(`[ResultFetcher] Got ${allMatches.length} upcoming matches`);
    return allMatches;
  }
}

// Singleton instances
const hltvScraper = new HLTVScraper();
const liquipediaScraper = new LiquipediaScraper();
const resultFetcher = new CS2ResultFetcher();

module.exports = {
  HLTVScraper,
  LiquipediaScraper,
  CS2ResultFetcher,
  hltvScraper,
  liquipediaScraper,
  resultFetcher,
  teamsMatch,
  normalizeTeamName
};
