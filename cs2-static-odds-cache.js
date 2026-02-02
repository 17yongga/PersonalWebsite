/**
 * CS2 Static Odds Cache System
 * 
 * PHILOSOPHY: Fetch once, cache permanently per match
 * - Odds are captured as snapshots when a match is discovered
 * - Cached odds never expire (until match is settled)
 * - No live odds updates = minimal API usage
 * - Settlement uses free sources (HLTV/Liquipedia), not OddsPapi
 */

const fs = require('fs').promises;
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'cs2-static-odds-cache.json');

class CS2StaticOddsCache {
  constructor() {
    this.cache = {
      matches: {},      // matchId -> { odds, teams, tournament, startTime, cachedAt, status }
      metadata: {
        version: '2.0.0',
        lastUpdated: null,
        totalMatches: 0,
        totalApiCalls: 0,
        apiCallsSavedByCache: 0
      }
    };
    this.loaded = false;
  }

  async init() {
    if (this.loaded) return;
    
    try {
      const data = await fs.readFile(CACHE_FILE, 'utf8');
      const parsed = JSON.parse(data);
      
      // Migrate from old format if needed
      if (!parsed.metadata) {
        this.cache = {
          matches: parsed,
          metadata: {
            version: '2.0.0',
            lastUpdated: new Date().toISOString(),
            totalMatches: Object.keys(parsed).length,
            totalApiCalls: 0,
            apiCallsSavedByCache: 0
          }
        };
      } else {
        this.cache = parsed;
      }
      
      // Clean up settled/expired matches (older than 7 days)
      await this.cleanupOldMatches();
      
      console.log(`📦 [Static Cache] Loaded ${Object.keys(this.cache.matches).length} cached matches`);
      console.log(`📊 [Static Cache] API calls saved by cache: ${this.cache.metadata.apiCallsSavedByCache}`);
      this.loaded = true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('📦 [Static Cache] Creating new cache file');
        await this.save();
      } else {
        console.error('📦 [Static Cache] Error loading cache:', error.message);
      }
      this.loaded = true;
    }
  }

  async save() {
    try {
      this.cache.metadata.lastUpdated = new Date().toISOString();
      this.cache.metadata.totalMatches = Object.keys(this.cache.matches).length;
      await fs.writeFile(CACHE_FILE, JSON.stringify(this.cache, null, 2));
    } catch (error) {
      console.error('📦 [Static Cache] Error saving cache:', error.message);
    }
  }

  /**
   * Get cached odds for a match
   * Returns null if not cached (needs API fetch)
   */
  getOdds(matchId) {
    const cached = this.cache.matches[matchId];
    
    if (!cached) {
      return null;
    }
    
    // Check if odds are valid (not placeholder 2.0/2.0)
    if (!this.areOddsValid(cached.odds)) {
      console.log(`📦 [Static Cache] Match ${matchId} has placeholder odds, needs real odds`);
      return null;
    }
    
    // Track cache hit
    this.cache.metadata.apiCallsSavedByCache++;
    
    console.log(`📦 [Static Cache] HIT: ${matchId} - ${cached.teams?.team1 || 'Team1'} vs ${cached.teams?.team2 || 'Team2'}`);
    console.log(`   Odds: ${cached.odds.team1} vs ${cached.odds.team2} (cached ${this.getAge(cached.cachedAt)})`);
    
    return cached;
  }

  /**
   * Store odds snapshot for a match (called once when match discovered with real odds)
   */
  async setOdds(matchId, matchData) {
    // Don't cache placeholder odds
    if (!this.areOddsValid(matchData.odds)) {
      console.log(`📦 [Static Cache] SKIP: ${matchId} - placeholder odds not cached`);
      return false;
    }
    
    // Don't overwrite existing valid cached odds
    const existing = this.cache.matches[matchId];
    if (existing && this.areOddsValid(existing.odds)) {
      console.log(`📦 [Static Cache] SKIP: ${matchId} already has valid cached odds`);
      return false;
    }
    
    this.cache.matches[matchId] = {
      id: matchId,
      odds: matchData.odds,
      teams: {
        team1: matchData.homeTeam || matchData.participant1Name || matchData.teams?.team1,
        team2: matchData.awayTeam || matchData.participant2Name || matchData.teams?.team2
      },
      tournament: matchData.tournamentName || matchData.tournament,
      startTime: matchData.startTime || matchData.commenceTime,
      cachedAt: new Date().toISOString(),
      status: matchData.status || 'scheduled',
      source: matchData.source || 'api'
    };
    
    this.cache.metadata.totalApiCalls++;
    
    console.log(`📦 [Static Cache] STORED: ${matchId}`);
    console.log(`   ${this.cache.matches[matchId].teams.team1} vs ${this.cache.matches[matchId].teams.team2}`);
    console.log(`   Odds: ${matchData.odds.team1} vs ${matchData.odds.team2}`);
    
    await this.save();
    return true;
  }

  /**
   * Mark match as settled (keep for history but stop serving)
   */
  async markSettled(matchId, result) {
    const match = this.cache.matches[matchId];
    if (match) {
      match.status = 'settled';
      match.result = result;
      match.settledAt = new Date().toISOString();
      await this.save();
      console.log(`📦 [Static Cache] SETTLED: ${matchId} - Winner: ${result.winner}`);
    }
  }

  /**
   * Check if odds are valid (not placeholder)
   */
  areOddsValid(odds) {
    if (!odds) return false;
    
    const team1 = parseFloat(odds.team1);
    const team2 = parseFloat(odds.team2);
    
    // Valid odds: both present, both > 1.0, not both exactly 2.0 (placeholder)
    const hasTeam1 = !isNaN(team1) && team1 > 1.0;
    const hasTeam2 = !isNaN(team2) && team2 > 1.0;
    const notBothDefault = !(team1 === 2.0 && team2 === 2.0);
    
    return hasTeam1 && hasTeam2 && notBothDefault;
  }

  /**
   * Get all unsettled matches from cache
   */
  getUnsettledMatches() {
    return Object.values(this.cache.matches).filter(m => 
      m.status !== 'settled' && m.status !== 'cancelled'
    );
  }

  /**
   * Get matches that need odds (have placeholder or no odds)
   */
  getMatchesNeedingOdds() {
    return Object.values(this.cache.matches).filter(m => 
      m.status !== 'settled' && 
      m.status !== 'cancelled' &&
      !this.areOddsValid(m.odds)
    );
  }

  /**
   * Clean up old settled matches (> 7 days old)
   */
  async cleanupOldMatches() {
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    let cleaned = 0;
    
    for (const [matchId, match] of Object.entries(this.cache.matches)) {
      // Remove if settled more than 7 days ago
      if (match.settledAt && new Date(match.settledAt).getTime() < sevenDaysAgo) {
        delete this.cache.matches[matchId];
        cleaned++;
      }
      // Remove if start time was more than 2 days ago and still not settled
      else if (match.startTime) {
        const startDate = new Date(match.startTime).getTime();
        if (startDate < Date.now() - (2 * 24 * 60 * 60 * 1000) && match.status !== 'settled') {
          delete this.cache.matches[matchId];
          cleaned++;
        }
      }
    }
    
    if (cleaned > 0) {
      console.log(`📦 [Static Cache] Cleaned up ${cleaned} old matches`);
      await this.save();
    }
  }

  /**
   * Get human-readable age of cache entry
   */
  getAge(timestamp) {
    if (!timestamp) return 'unknown';
    
    const ms = Date.now() - new Date(timestamp).getTime();
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 24) {
      return `${Math.floor(hours / 24)}d ${hours % 24}h ago`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m ago`;
    } else {
      return `${minutes}m ago`;
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const matches = Object.values(this.cache.matches);
    const withOdds = matches.filter(m => this.areOddsValid(m.odds));
    const needsOdds = matches.filter(m => !this.areOddsValid(m.odds));
    const settled = matches.filter(m => m.status === 'settled');
    const pending = matches.filter(m => m.status !== 'settled');
    
    return {
      totalMatches: matches.length,
      matchesWithOdds: withOdds.length,
      matchesNeedingOdds: needsOdds.length,
      settledMatches: settled.length,
      pendingMatches: pending.length,
      apiCallsMade: this.cache.metadata.totalApiCalls,
      apiCallsSaved: this.cache.metadata.apiCallsSavedByCache,
      cacheEfficiency: this.cache.metadata.totalApiCalls > 0 
        ? ((this.cache.metadata.apiCallsSavedByCache / (this.cache.metadata.apiCallsSavedByCache + this.cache.metadata.totalApiCalls)) * 100).toFixed(1) + '%'
        : 'N/A',
      lastUpdated: this.cache.metadata.lastUpdated
    };
  }

  /**
   * Bulk update matches from discovery (only adds new ones with valid odds)
   */
  async bulkUpdate(matches) {
    let added = 0;
    let skipped = 0;
    
    for (const match of matches) {
      const matchId = match.id || match.fixtureId;
      if (!matchId) continue;
      
      // Check if already cached with valid odds
      const cached = this.cache.matches[matchId];
      if (cached && this.areOddsValid(cached.odds)) {
        skipped++;
        continue;
      }
      
      // Only add if has valid odds
      if (this.areOddsValid(match.odds)) {
        await this.setOdds(matchId, match);
        added++;
      } else {
        // Store match metadata without odds (for later fetching)
        if (!cached) {
          this.cache.matches[matchId] = {
            id: matchId,
            odds: match.odds || { team1: null, team2: null },
            teams: {
              team1: match.homeTeam || match.participant1Name,
              team2: match.awayTeam || match.participant2Name
            },
            tournament: match.tournamentName,
            startTime: match.startTime || match.commenceTime,
            cachedAt: new Date().toISOString(),
            status: 'needs_odds',
            source: 'discovery'
          };
        }
      }
    }
    
    await this.save();
    console.log(`📦 [Static Cache] Bulk update: ${added} added, ${skipped} already cached`);
    
    return { added, skipped };
  }
}

// Singleton instance
const staticOddsCache = new CS2StaticOddsCache();

module.exports = { CS2StaticOddsCache, staticOddsCache };
