/**
 * CS2 Efficient Match Discovery
 * 
 * Strategy for minimal API usage:
 * 1. Discover matches via FREE sources (HLTV) first
 * 2. Only fetch odds from OddsPapi for NEW matches that don't have cached odds
 * 3. Never re-fetch odds for matches that already have valid cached odds
 * 4. Use team rankings for odds validation/correction
 */

const { staticOddsCache } = require('./cs2-static-odds-cache');
const { resultFetcher, hltvScraper } = require('./cs2-free-result-sources');

// Load OddsPapi client if available (for odds fetching only)
let oddsPapiClient = null;
try {
  oddsPapiClient = require('./cs2-api-client');
  console.log('[Match Discovery] OddsPapi client loaded for odds fetching');
} catch (e) {
  console.log('[Match Discovery] OddsPapi client not available - will use cached odds only');
}

class CS2EfficientMatchDiscovery {
  constructor() {
    this.lastDiscoveryRun = null;
    this.discoveryInterval = 30 * 60 * 1000; // 30 minutes between discovery runs
    this.apiCallsToday = 0;
    this.apiCallLimit = 50; // Conservative daily limit
    this.lastApiReset = new Date().toDateString();
  }

  /**
   * Main discovery function - finds new matches with minimal API usage
   */
  async discoverMatches() {
    console.log('\n🔍 [Match Discovery] Starting efficient discovery run...');
    await staticOddsCache.init();
    
    // Reset API counter at midnight
    const today = new Date().toDateString();
    if (this.lastApiReset !== today) {
      this.apiCallsToday = 0;
      this.lastApiReset = today;
      console.log('[Match Discovery] Daily API counter reset');
    }
    
    const stats = {
      hltvMatchesFound: 0,
      newMatchesDiscovered: 0,
      matchesNeedingOdds: 0,
      oddsApiCallsMade: 0,
      oddsFromCache: 0,
      startTime: Date.now()
    };

    try {
      // STEP 1: Get upcoming matches from FREE source (HLTV)
      console.log('[Match Discovery] Step 1: Fetching from HLTV (FREE)...');
      const hltvMatches = await hltvScraper.getUpcomingMatches(40);
      stats.hltvMatchesFound = hltvMatches.length;
      console.log(`[Match Discovery] Found ${hltvMatches.length} upcoming matches from HLTV`);

      // STEP 2: Check which matches we already have cached odds for
      console.log('[Match Discovery] Step 2: Checking cache status...');
      const matchesNeedingOdds = [];
      const matchesWithCachedOdds = [];

      for (const match of hltvMatches) {
        // Generate a consistent match ID from team names
        const matchId = this.generateMatchId(match.team1, match.team2, match.time);
        
        // Check cache
        const cached = staticOddsCache.getOdds(matchId);
        
        if (cached && staticOddsCache.areOddsValid(cached.odds)) {
          matchesWithCachedOdds.push({
            ...match,
            id: matchId,
            odds: cached.odds,
            source: 'cache'
          });
          stats.oddsFromCache++;
        } else {
          matchesNeedingOdds.push({
            ...match,
            id: matchId
          });
        }
      }

      stats.matchesNeedingOdds = matchesNeedingOdds.length;
      console.log(`[Match Discovery] ${matchesWithCachedOdds.length} matches have cached odds`);
      console.log(`[Match Discovery] ${matchesNeedingOdds.length} matches need odds from API`);

      // STEP 3: Fetch odds ONLY for new matches (if API calls available)
      let newMatchesWithOdds = [];
      
      if (matchesNeedingOdds.length > 0 && oddsPapiClient && this.apiCallsToday < this.apiCallLimit) {
        console.log('[Match Discovery] Step 3: Fetching odds for new matches...');
        
        // Limit how many matches we fetch odds for per run
        const maxFetches = Math.min(
          matchesNeedingOdds.length,
          this.apiCallLimit - this.apiCallsToday,
          10 // Max 10 per discovery run
        );

        const matchesToFetch = matchesNeedingOdds.slice(0, maxFetches);
        console.log(`[Match Discovery] Fetching odds for ${matchesToFetch.length} matches (API calls today: ${this.apiCallsToday}/${this.apiCallLimit})`);

        for (const match of matchesToFetch) {
          try {
            const oddsData = await this.fetchOddsForMatch(match);
            
            if (oddsData && staticOddsCache.areOddsValid(oddsData.odds)) {
              // Cache the odds permanently
              await staticOddsCache.setOdds(match.id, {
                ...match,
                ...oddsData,
                homeTeam: match.team1,
                awayTeam: match.team2
              });
              
              newMatchesWithOdds.push({
                ...match,
                odds: oddsData.odds,
                source: 'api_fresh'
              });
              
              stats.oddsApiCallsMade++;
              this.apiCallsToday++;
              stats.newMatchesDiscovered++;
            }
            
            // Rate limiting
            await this.delay(600);
            
          } catch (e) {
            console.log(`[Match Discovery] Error fetching odds for ${match.team1} vs ${match.team2}: ${e.message}`);
          }
        }
      } else if (matchesNeedingOdds.length > 0) {
        console.log('[Match Discovery] Step 3: Skipped - API limit reached or client unavailable');
      }

      // STEP 4: Combine results
      const allMatches = [...matchesWithCachedOdds, ...newMatchesWithOdds];
      
      // STEP 5: Add matches without odds (for display purposes)
      const matchesWithoutOdds = matchesNeedingOdds
        .filter(m => !newMatchesWithOdds.find(n => n.id === m.id))
        .map(m => ({
          ...m,
          odds: { team1: null, team2: null },
          source: 'hltv_no_odds'
        }));

      allMatches.push(...matchesWithoutOdds);

      stats.duration = Date.now() - stats.startTime;
      this.lastDiscoveryRun = Date.now();

      console.log('\n📊 [Match Discovery] Run Complete:');
      console.log(`   HLTV matches found: ${stats.hltvMatchesFound}`);
      console.log(`   Matches from cache: ${stats.oddsFromCache}`);
      console.log(`   New API calls made: ${stats.oddsApiCallsMade}`);
      console.log(`   Total API calls today: ${this.apiCallsToday}/${this.apiCallLimit}`);
      console.log(`   Duration: ${stats.duration}ms`);
      
      return {
        matches: allMatches,
        stats
      };

    } catch (error) {
      console.error('[Match Discovery] Error:', error.message);
      return {
        matches: [],
        stats,
        error: error.message
      };
    }
  }

  /**
   * Fetch odds for a specific match from OddsPapi
   */
  async fetchOddsForMatch(match) {
    if (!oddsPapiClient) {
      console.log('[Match Discovery] No OddsPapi client available');
      return null;
    }

    try {
      // Try to find matching fixture in OddsPapi
      // First get fixtures and match by team names
      const fixtures = await oddsPapiClient.fetchUpcomingMatches({ limit: 50 });
      
      for (const fixture of fixtures) {
        const fixTeam1 = (fixture.homeTeam || fixture.participant1Name || '').toLowerCase();
        const fixTeam2 = (fixture.awayTeam || fixture.participant2Name || '').toLowerCase();
        const matchTeam1 = (match.team1 || '').toLowerCase();
        const matchTeam2 = (match.team2 || '').toLowerCase();
        
        if ((fixTeam1.includes(matchTeam1) || matchTeam1.includes(fixTeam1)) &&
            (fixTeam2.includes(matchTeam2) || matchTeam2.includes(fixTeam2))) {
          
          if (fixture.odds && (fixture.odds.team1 || fixture.odds.team2)) {
            return {
              fixtureId: fixture.id || fixture.fixtureId,
              odds: fixture.odds,
              tournament: fixture.tournamentName,
              startTime: fixture.startTime || fixture.commenceTime
            };
          }
        }
      }
      
      console.log(`[Match Discovery] No matching fixture found for ${match.team1} vs ${match.team2}`);
      return null;
      
    } catch (error) {
      console.error('[Match Discovery] OddsPapi error:', error.message);
      return null;
    }
  }

  /**
   * Generate consistent match ID from team names and time
   */
  generateMatchId(team1, team2, time) {
    const t1 = (team1 || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const t2 = (team2 || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const teams = [t1, t2].sort().join('-');
    
    // Use date portion if time available
    let datePart = '';
    if (time) {
      try {
        const date = new Date(time);
        datePart = `-${date.toISOString().split('T')[0]}`;
      } catch (e) {
        // Ignore date parsing errors
      }
    }
    
    return `cs2-${teams}${datePart}`;
  }

  /**
   * Get matches for the frontend (combines cache + fresh data)
   */
  async getMatchesForDisplay(options = {}) {
    const forceRefresh = options.forceRefresh || false;
    
    // Check if we should run discovery
    const timeSinceLastRun = this.lastDiscoveryRun 
      ? Date.now() - this.lastDiscoveryRun 
      : Infinity;
    
    if (forceRefresh || timeSinceLastRun > this.discoveryInterval) {
      await this.discoverMatches();
    }
    
    // Get all cached matches
    await staticOddsCache.init();
    const unsettledMatches = staticOddsCache.getUnsettledMatches();
    
    // Format for frontend
    return unsettledMatches.map(match => ({
      id: match.id,
      homeTeam: match.teams?.team1 || 'Team 1',
      awayTeam: match.teams?.team2 || 'Team 2',
      odds: match.odds || { team1: null, team2: null },
      startTime: match.startTime,
      tournament: match.tournament,
      status: match.status,
      source: match.source,
      cachedAt: match.cachedAt,
      hasValidOdds: staticOddsCache.areOddsValid(match.odds)
    })).filter(m => m.hasValidOdds); // Only show matches with valid odds
  }

  /**
   * Get discovery statistics
   */
  getStats() {
    const cacheStats = staticOddsCache.getStats();
    
    return {
      ...cacheStats,
      apiCallsToday: this.apiCallsToday,
      apiCallLimit: this.apiCallLimit,
      lastDiscoveryRun: this.lastDiscoveryRun,
      discoveryIntervalMs: this.discoveryInterval,
      nextDiscoveryIn: this.lastDiscoveryRun 
        ? Math.max(0, this.discoveryInterval - (Date.now() - this.lastDiscoveryRun))
        : 0
    };
  }

  /**
   * Force immediate odds fetch for specific match (manual trigger)
   */
  async fetchOddsForSpecificMatch(team1, team2) {
    const matchId = this.generateMatchId(team1, team2);
    
    // Check cache first
    const cached = staticOddsCache.getOdds(matchId);
    if (cached && staticOddsCache.areOddsValid(cached.odds)) {
      console.log(`[Match Discovery] Already have valid cached odds for ${team1} vs ${team2}`);
      return cached;
    }
    
    // Fetch fresh
    const match = { id: matchId, team1, team2 };
    const oddsData = await this.fetchOddsForMatch(match);
    
    if (oddsData) {
      await staticOddsCache.setOdds(matchId, {
        ...match,
        ...oddsData,
        homeTeam: team1,
        awayTeam: team2
      });
      this.apiCallsToday++;
    }
    
    return oddsData;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton
const matchDiscovery = new CS2EfficientMatchDiscovery();

module.exports = { 
  CS2EfficientMatchDiscovery, 
  matchDiscovery 
};
