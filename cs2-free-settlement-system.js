/**
 * CS2 Free Settlement System
 * 
 * Settles bets using FREE result sources (HLTV, Liquipedia)
 * No OddsPapi API calls needed for settlement!
 * 
 * Settlement Flow:
 * 1. Get pending bets from betting data
 * 2. For each pending match, fetch result from free sources
 * 3. Determine winners and calculate payouts
 * 4. Update user balances and bet statuses
 * 5. Log settlement for audit trail
 */

const fs = require('fs').promises;
const path = require('path');
const { resultFetcher, teamsMatch } = require('./cs2-free-result-sources');
const { staticOddsCache } = require('./cs2-static-odds-cache');

const BETTING_DATA_FILE = path.join(__dirname, 'cs2-betting-data.json');
const SETTLEMENT_LOG_FILE = path.join(__dirname, 'cs2-settlement-log.json');

class CS2FreeSettlementSystem {
  constructor() {
    this.bettingData = null;
    this.settlementLog = [];
    this.config = {
      // Minimum time after match start before attempting settlement
      minSettlementDelay: 2 * 60 * 60 * 1000, // 2 hours
      // Maximum age for a bet before forcing settlement attempt
      maxBetAge: 48 * 60 * 60 * 1000, // 48 hours
      // Minimum confidence required to auto-settle
      minConfidenceForAutoSettle: 0.85,
      // How often to run auto-settlement (ms)
      settlementInterval: 15 * 60 * 1000 // 15 minutes
    };
    this.lastSettlementRun = null;
    this.settlementsToday = 0;
  }

  async init() {
    await this.loadBettingData();
    await this.loadSettlementLog();
    console.log('⚖️ [Free Settlement] System initialized');
  }

  async loadBettingData() {
    try {
      const data = await fs.readFile(BETTING_DATA_FILE, 'utf8');
      this.bettingData = JSON.parse(data);
      console.log(`⚖️ [Free Settlement] Loaded ${Object.keys(this.bettingData.bets || {}).length} bets`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.bettingData = { events: {}, bets: {}, users: {} };
        await this.saveBettingData();
      } else {
        console.error('⚖️ [Free Settlement] Error loading betting data:', error.message);
        this.bettingData = { events: {}, bets: {}, users: {} };
      }
    }
  }

  async saveBettingData() {
    try {
      await fs.writeFile(BETTING_DATA_FILE, JSON.stringify(this.bettingData, null, 2));
    } catch (error) {
      console.error('⚖️ [Free Settlement] Error saving betting data:', error.message);
    }
  }

  async loadSettlementLog() {
    try {
      const data = await fs.readFile(SETTLEMENT_LOG_FILE, 'utf8');
      this.settlementLog = JSON.parse(data);
    } catch (error) {
      this.settlementLog = [];
    }
  }

  async saveSettlementLog() {
    try {
      // Keep only last 500 entries
      if (this.settlementLog.length > 500) {
        this.settlementLog = this.settlementLog.slice(-500);
      }
      await fs.writeFile(SETTLEMENT_LOG_FILE, JSON.stringify(this.settlementLog, null, 2));
    } catch (error) {
      console.error('⚖️ [Free Settlement] Error saving settlement log:', error.message);
    }
  }

  /**
   * Main settlement function - processes all pending bets
   */
  async runSettlement() {
    console.log('\n⚖️ [Free Settlement] Starting settlement run...');
    await this.init();
    
    const stats = {
      startTime: Date.now(),
      pendingBets: 0,
      settledBets: 0,
      failedSettlements: 0,
      totalPayouts: 0,
      matchesChecked: 0,
      resultsFound: 0
    };

    try {
      // Get all pending bets
      const pendingBets = Object.values(this.bettingData.bets || {})
        .filter(bet => bet.status === 'pending');
      
      stats.pendingBets = pendingBets.length;
      console.log(`⚖️ [Free Settlement] Found ${pendingBets.length} pending bets`);

      if (pendingBets.length === 0) {
        console.log('⚖️ [Free Settlement] No pending bets to settle');
        this.lastSettlementRun = Date.now();
        return stats;
      }

      // Group bets by match
      const betsByMatch = new Map();
      for (const bet of pendingBets) {
        const matchKey = this.getMatchKey(bet);
        if (!betsByMatch.has(matchKey)) {
          betsByMatch.set(matchKey, []);
        }
        betsByMatch.get(matchKey).push(bet);
      }

      console.log(`⚖️ [Free Settlement] Grouped into ${betsByMatch.size} unique matches`);

      // Process each match
      for (const [matchKey, bets] of betsByMatch) {
        stats.matchesChecked++;
        
        // Get match info from first bet
        const sampleBet = bets[0];
        const team1 = sampleBet.team1 || sampleBet.homeTeam || this.extractTeam1(sampleBet);
        const team2 = sampleBet.team2 || sampleBet.awayTeam || this.extractTeam2(sampleBet);
        
        console.log(`\n⚖️ [Free Settlement] Checking: ${team1} vs ${team2} (${bets.length} bets)`);

        // Check if match should be settled (enough time passed)
        const oldestBet = bets.reduce((oldest, bet) => 
          new Date(bet.placedAt) < new Date(oldest.placedAt) ? bet : oldest
        );
        const betAge = Date.now() - new Date(oldestBet.placedAt).getTime();
        
        if (betAge < this.config.minSettlementDelay) {
          const waitTime = Math.round((this.config.minSettlementDelay - betAge) / 60000);
          console.log(`   ⏳ Too early to settle (wait ${waitTime} more minutes)`);
          continue;
        }

        // Try to get match result from free sources
        try {
          const result = await resultFetcher.findMatchResult(team1, team2);
          
          if (!result || !result.winner) {
            console.log(`   ❓ No result found yet`);
            
            // If bet is very old, mark as needs_review
            if (betAge > this.config.maxBetAge) {
              console.log(`   ⚠️ Bet too old, marking for review`);
              for (const bet of bets) {
                bet.status = 'needs_review';
                bet.reviewReason = 'No result found after 48 hours';
              }
              await this.saveBettingData();
            }
            continue;
          }

          stats.resultsFound++;
          console.log(`   ✅ Result found: ${result.winner} wins (${Math.round(result.confidence * 100)}% confidence)`);

          // Check confidence threshold
          if (result.confidence < this.config.minConfidenceForAutoSettle) {
            console.log(`   ⚠️ Confidence too low for auto-settle (${Math.round(result.confidence * 100)}% < ${Math.round(this.config.minConfidenceForAutoSettle * 100)}%)`);
            continue;
          }

          // Settle all bets for this match
          for (const bet of bets) {
            const settlementResult = await this.settleBet(bet, result);
            
            if (settlementResult.success) {
              stats.settledBets++;
              stats.totalPayouts += settlementResult.payout || 0;
            } else {
              stats.failedSettlements++;
            }
          }

          // Mark match as settled in cache
          await staticOddsCache.markSettled(sampleBet.eventId || sampleBet.matchId, {
            winner: result.winner,
            score: result.score,
            source: result.source,
            settledAt: new Date().toISOString()
          });

        } catch (error) {
          console.log(`   ❌ Error getting result: ${error.message}`);
          stats.failedSettlements += bets.length;
        }
      }

      await this.saveBettingData();
      await this.saveSettlementLog();
      
      stats.duration = Date.now() - stats.startTime;
      this.lastSettlementRun = Date.now();
      this.settlementsToday += stats.settledBets;

      console.log('\n⚖️ [Free Settlement] Run Complete:');
      console.log(`   Pending bets processed: ${stats.pendingBets}`);
      console.log(`   Matches checked: ${stats.matchesChecked}`);
      console.log(`   Results found: ${stats.resultsFound}`);
      console.log(`   Bets settled: ${stats.settledBets}`);
      console.log(`   Total payouts: $${stats.totalPayouts.toFixed(2)}`);
      console.log(`   Duration: ${stats.duration}ms`);

      return stats;

    } catch (error) {
      console.error('⚖️ [Free Settlement] Error:', error.message);
      return { ...stats, error: error.message };
    }
  }

  /**
   * Settle a single bet
   */
  async settleBet(bet, matchResult) {
    try {
      const betSelection = (bet.selection || bet.team || '').toLowerCase();
      const winner = (matchResult.winner || '').toLowerCase();
      const team1 = (bet.team1 || bet.homeTeam || this.extractTeam1(bet)).toLowerCase();
      const team2 = (bet.team2 || bet.awayTeam || this.extractTeam2(bet)).toLowerCase();

      // Determine if bet won
      let betWon = false;
      
      if (betSelection === 'team1' || betSelection === 'home') {
        betWon = teamsMatch(winner, team1);
      } else if (betSelection === 'team2' || betSelection === 'away') {
        betWon = teamsMatch(winner, team2);
      } else {
        // Direct team name selection
        betWon = teamsMatch(winner, betSelection);
      }

      // Calculate payout
      let payout = 0;
      if (betWon) {
        const odds = parseFloat(bet.odds) || 2.0;
        const stake = parseFloat(bet.amount) || parseFloat(bet.stake) || 0;
        payout = stake * odds;
      }

      // Update bet status
      bet.status = betWon ? 'won' : 'lost';
      bet.result = betWon ? 'win' : 'loss';
      bet.payout = payout;
      bet.settledAt = new Date().toISOString();
      bet.settlementSource = matchResult.source;
      bet.settlementConfidence = matchResult.confidence;
      bet.matchScore = matchResult.score;
      bet.matchWinner = matchResult.winner;

      // Update user balance if won
      if (betWon && payout > 0) {
        await this.updateUserBalance(bet.userId, payout);
      }

      // Log settlement
      this.settlementLog.push({
        timestamp: new Date().toISOString(),
        betId: bet.id,
        userId: bet.userId,
        matchId: bet.eventId || bet.matchId,
        teams: `${team1} vs ${team2}`,
        selection: betSelection,
        winner: matchResult.winner,
        result: betWon ? 'WIN' : 'LOSS',
        stake: bet.amount || bet.stake,
        odds: bet.odds,
        payout,
        source: matchResult.source,
        confidence: matchResult.confidence
      });

      console.log(`   ${betWon ? '💰' : '❌'} Bet ${bet.id}: ${betWon ? 'WON' : 'LOST'} ${betWon ? `(+$${payout.toFixed(2)})` : ''}`);

      return { success: true, won: betWon, payout };

    } catch (error) {
      console.error(`   ❌ Error settling bet ${bet.id}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update user balance
   */
  async updateUserBalance(userId, amount) {
    if (!this.bettingData.users) {
      this.bettingData.users = {};
    }
    
    if (!this.bettingData.users[userId]) {
      this.bettingData.users[userId] = {
        id: userId,
        balance: 10000, // Default balance
        totalWagered: 0,
        totalWon: 0,
        betsPlaced: 0,
        betsWon: 0
      };
    }

    const user = this.bettingData.users[userId];
    const previousBalance = user.balance;
    
    user.balance = parseFloat((user.balance + amount).toFixed(2));
    user.totalWon = parseFloat((user.totalWon + amount).toFixed(2));
    user.betsWon = (user.betsWon || 0) + 1;
    user.lastUpdated = new Date().toISOString();

    console.log(`   💳 User ${userId}: $${previousBalance} → $${user.balance} (+$${amount.toFixed(2)})`);
  }

  /**
   * Get match key for grouping bets
   */
  getMatchKey(bet) {
    const team1 = (bet.team1 || bet.homeTeam || this.extractTeam1(bet) || '').toLowerCase();
    const team2 = (bet.team2 || bet.awayTeam || this.extractTeam2(bet) || '').toLowerCase();
    return [team1, team2].sort().join('-');
  }

  /**
   * Extract team1 from bet event ID
   */
  extractTeam1(bet) {
    if (bet.eventId) {
      // Handle formats like: "g2-vs-vitality-2024", "g2 vs vitality", "team1-vs-team2"
      const parts = bet.eventId.split(/[-_\s]*vs[-_\s]*/i);
      if (parts.length >= 2) {
        // Remove trailing date/numbers from team name
        return parts[0].replace(/[-_]\d+.*$/, '').trim();
      }
    }
    return 'Team1';
  }

  /**
   * Extract team2 from bet event ID
   */
  extractTeam2(bet) {
    if (bet.eventId) {
      // Handle formats like: "g2-vs-vitality-2024", "g2 vs vitality", "team1-vs-team2"
      const parts = bet.eventId.split(/[-_\s]*vs[-_\s]*/i);
      if (parts.length >= 2) {
        // Remove trailing date/numbers from team name
        return parts[1].replace(/[-_]\d+.*$/, '').trim();
      }
    }
    return 'Team2';
  }

  /**
   * Get settlement statistics
   */
  getStats() {
    const bets = Object.values(this.bettingData?.bets || {});
    
    return {
      totalBets: bets.length,
      pendingBets: bets.filter(b => b.status === 'pending').length,
      settledBets: bets.filter(b => b.status === 'won' || b.status === 'lost').length,
      wonBets: bets.filter(b => b.status === 'won').length,
      lostBets: bets.filter(b => b.status === 'lost').length,
      needsReview: bets.filter(b => b.status === 'needs_review').length,
      settlementsToday: this.settlementsToday,
      lastSettlementRun: this.lastSettlementRun,
      settlementLogEntries: this.settlementLog.length
    };
  }

  /**
   * Get recent settlement log entries
   */
  getRecentSettlements(limit = 20) {
    return this.settlementLog.slice(-limit).reverse();
  }

  /**
   * Manual settlement for specific match (admin function)
   */
  async manualSettle(matchId, winner) {
    await this.init();
    
    const matchBets = Object.values(this.bettingData.bets || {})
      .filter(bet => 
        (bet.eventId === matchId || bet.matchId === matchId) && 
        bet.status === 'pending'
      );
    
    if (matchBets.length === 0) {
      return { success: false, error: 'No pending bets found for this match' };
    }

    console.log(`⚖️ [Manual Settlement] Settling ${matchBets.length} bets for ${matchId} with winner: ${winner}`);

    const result = {
      winner,
      score: 'manual',
      source: 'admin',
      confidence: 1.0
    };

    let settled = 0;
    let totalPayout = 0;

    for (const bet of matchBets) {
      const settlementResult = await this.settleBet(bet, result);
      if (settlementResult.success) {
        settled++;
        totalPayout += settlementResult.payout || 0;
      }
    }

    await this.saveBettingData();
    await this.saveSettlementLog();

    return {
      success: true,
      settled,
      totalPayout,
      matchId,
      winner
    };
  }

  /**
   * Check if any pending bets need attention
   */
  async getPendingBetsSummary() {
    await this.init();
    
    const pendingBets = Object.values(this.bettingData.bets || {})
      .filter(bet => bet.status === 'pending');
    
    // Group by match
    const byMatch = new Map();
    for (const bet of pendingBets) {
      const key = this.getMatchKey(bet);
      if (!byMatch.has(key)) {
        byMatch.set(key, {
          teams: key.split('-').map(t => t.charAt(0).toUpperCase() + t.slice(1)),
          bets: [],
          totalStaked: 0,
          potentialPayout: 0,
          oldestBet: null
        });
      }
      const match = byMatch.get(key);
      match.bets.push(bet);
      match.totalStaked += parseFloat(bet.amount || bet.stake || 0);
      match.potentialPayout += parseFloat(bet.potentialPayout || (bet.amount * bet.odds) || 0);
      
      if (!match.oldestBet || new Date(bet.placedAt) < new Date(match.oldestBet)) {
        match.oldestBet = bet.placedAt;
      }
    }

    return Array.from(byMatch.values()).map(match => ({
      ...match,
      betCount: match.bets.length,
      ageHours: Math.round((Date.now() - new Date(match.oldestBet)) / (1000 * 60 * 60))
    }));
  }
}

// Singleton
const freeSettlementSystem = new CS2FreeSettlementSystem();

// Auto-settlement scheduler
let autoSettlementInterval = null;

function startAutoSettlement(intervalMs = 15 * 60 * 1000) {
  if (autoSettlementInterval) {
    clearInterval(autoSettlementInterval);
  }
  
  console.log(`⚖️ [Free Settlement] Starting auto-settlement (every ${intervalMs / 60000} minutes)`);
  
  // Run immediately on start
  freeSettlementSystem.runSettlement().catch(console.error);
  
  // Schedule recurring runs
  autoSettlementInterval = setInterval(() => {
    freeSettlementSystem.runSettlement().catch(console.error);
  }, intervalMs);
}

function stopAutoSettlement() {
  if (autoSettlementInterval) {
    clearInterval(autoSettlementInterval);
    autoSettlementInterval = null;
    console.log('⚖️ [Free Settlement] Auto-settlement stopped');
  }
}

module.exports = {
  CS2FreeSettlementSystem,
  freeSettlementSystem,
  startAutoSettlement,
  stopAutoSettlement
};
