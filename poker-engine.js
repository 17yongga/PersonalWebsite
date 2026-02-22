// ========== TEXAS HOLD'EM POKER ENGINE ==========
// Standalone module: hand evaluation, deck, side pots
// Imported by casino-server.js

const SUITS = ['h', 'd', 'c', 's'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const RANK_VALUES = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };

const HAND_RANKS = {
  HIGH_CARD: 0,
  ONE_PAIR: 1,
  TWO_PAIR: 2,
  THREE_OF_A_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_OF_A_KIND: 7,
  STRAIGHT_FLUSH: 8,
  ROYAL_FLUSH: 9
};

const HAND_NAMES = {
  0: 'High Card',
  1: 'One Pair',
  2: 'Two Pair',
  3: 'Three of a Kind',
  4: 'Straight',
  5: 'Flush',
  6: 'Full House',
  7: 'Four of a Kind',
  8: 'Straight Flush',
  9: 'Royal Flush'
};

// ========== DECK ==========

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(rank + suit);
    }
  }
  return deck;
}

function shuffleDeck(deck) {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// ========== CARD UTILITIES ==========

function cardRank(card) {
  return RANK_VALUES[card[0]];
}

function cardSuit(card) {
  return card[1];
}

// ========== HAND EVALUATION ==========

/**
 * Given 5-7 cards, find the best 5-card hand.
 * Returns { rank, name, values } where rank is HAND_RANKS value,
 * values is an array for tiebreaking (sorted high to low).
 */
function evaluateHand(cards) {
  if (cards.length < 5) return null;
  
  // Generate all 5-card combinations
  const combos = combinations(cards, 5);
  let best = null;
  
  for (const combo of combos) {
    const hand = evaluate5(combo);
    if (!best || compareHandValues(hand, best) > 0) {
      best = hand;
    }
  }
  
  return best;
}

/**
 * Generate all k-element combinations from array.
 */
function combinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length === 0) return [];
  
  const result = [];
  const first = arr[0];
  const rest = arr.slice(1);
  
  // Combinations that include first
  for (const combo of combinations(rest, k - 1)) {
    result.push([first, ...combo]);
  }
  
  // Combinations that exclude first
  for (const combo of combinations(rest, k)) {
    result.push(combo);
  }
  
  return result;
}

/**
 * Evaluate exactly 5 cards.
 */
function evaluate5(cards) {
  const ranks = cards.map(c => cardRank(c)).sort((a, b) => b - a);
  const suits = cards.map(c => cardSuit(c));
  
  const isFlush = suits.every(s => s === suits[0]);
  
  // Check for straight
  let isStraight = false;
  let straightHigh = 0;
  
  const uniqueRanks = [...new Set(ranks)].sort((a, b) => b - a);
  
  if (uniqueRanks.length === 5) {
    // Normal straight check
    if (uniqueRanks[0] - uniqueRanks[4] === 4) {
      isStraight = true;
      straightHigh = uniqueRanks[0];
    }
    // Ace-low straight (wheel): A-2-3-4-5
    if (uniqueRanks[0] === 14 && uniqueRanks[1] === 5 && uniqueRanks[2] === 4 && uniqueRanks[3] === 3 && uniqueRanks[4] === 2) {
      isStraight = true;
      straightHigh = 5; // 5-high straight
    }
  }
  
  // Count rank occurrences
  const rankCounts = {};
  for (const r of ranks) {
    rankCounts[r] = (rankCounts[r] || 0) + 1;
  }
  
  const counts = Object.entries(rankCounts)
    .map(([rank, count]) => ({ rank: parseInt(rank), count }))
    .sort((a, b) => b.count - a.count || b.rank - a.rank);
  
  // Determine hand type
  if (isFlush && isStraight) {
    if (straightHigh === 14) {
      return { rank: HAND_RANKS.ROYAL_FLUSH, name: 'Royal Flush', values: [straightHigh], cards };
    }
    return { rank: HAND_RANKS.STRAIGHT_FLUSH, name: 'Straight Flush', values: [straightHigh], cards };
  }
  
  if (counts[0].count === 4) {
    const kicker = counts[1].rank;
    return { rank: HAND_RANKS.FOUR_OF_A_KIND, name: 'Four of a Kind', values: [counts[0].rank, kicker], cards };
  }
  
  if (counts[0].count === 3 && counts[1].count === 2) {
    return { rank: HAND_RANKS.FULL_HOUSE, name: 'Full House', values: [counts[0].rank, counts[1].rank], cards };
  }
  
  if (isFlush) {
    return { rank: HAND_RANKS.FLUSH, name: 'Flush', values: ranks, cards };
  }
  
  if (isStraight) {
    return { rank: HAND_RANKS.STRAIGHT, name: 'Straight', values: [straightHigh], cards };
  }
  
  if (counts[0].count === 3) {
    const kickers = counts.filter(c => c.count === 1).map(c => c.rank).sort((a, b) => b - a);
    return { rank: HAND_RANKS.THREE_OF_A_KIND, name: 'Three of a Kind', values: [counts[0].rank, ...kickers], cards };
  }
  
  if (counts[0].count === 2 && counts[1].count === 2) {
    const pairs = [counts[0].rank, counts[1].rank].sort((a, b) => b - a);
    const kicker = counts[2].rank;
    return { rank: HAND_RANKS.TWO_PAIR, name: 'Two Pair', values: [...pairs, kicker], cards };
  }
  
  if (counts[0].count === 2) {
    const kickers = counts.filter(c => c.count === 1).map(c => c.rank).sort((a, b) => b - a);
    return { rank: HAND_RANKS.ONE_PAIR, name: 'One Pair', values: [counts[0].rank, ...kickers], cards };
  }
  
  return { rank: HAND_RANKS.HIGH_CARD, name: 'High Card', values: ranks, cards };
}

/**
 * Compare two hand evaluations. Returns >0 if a wins, <0 if b wins, 0 for tie.
 */
function compareHandValues(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  
  for (let i = 0; i < Math.min(a.values.length, b.values.length); i++) {
    if (a.values[i] !== b.values[i]) return a.values[i] - b.values[i];
  }
  
  return 0;
}

/**
 * Compare two hands — convenience wrapper.
 */
function compareHands(handA, handB) {
  return compareHandValues(handA, handB);
}

// ========== SIDE POT CALCULATION ==========

/**
 * Calculate side pots from a list of player contributions.
 * @param {Array} playerContributions - [{ playerId, totalBet, folded }]
 * @returns {Array} - [{ amount, eligiblePlayerIds }]
 */
function calculateSidePots(playerContributions) {
  // Filter out folded players for eligibility, but include their bets in pot
  const allPlayers = [...playerContributions].sort((a, b) => a.totalBet - b.totalBet);
  
  const pots = [];
  let previousLevel = 0;
  
  for (let i = 0; i < allPlayers.length; i++) {
    const currentBet = allPlayers[i].totalBet;
    if (currentBet <= previousLevel) continue;
    
    const increment = currentBet - previousLevel;
    
    // Count how many players contributed at least this level
    const contributingPlayers = allPlayers.filter(p => p.totalBet > previousLevel);
    const potAmount = increment * contributingPlayers.length;
    
    // Eligible = contributed at this level AND not folded
    const eligiblePlayerIds = contributingPlayers
      .filter(p => !p.folded && p.totalBet >= currentBet)
      .map(p => p.playerId);
    
    // Also include players whose totalBet >= currentBet even if they're at a lower all-in
    // Actually, eligible means: not folded and totalBet >= currentBet level
    // Wait, re-think: eligible for THIS pot means they contributed at least up to currentBet level AND aren't folded
    // No — eligible for a side pot means: they put in at least as much as the all-in player for that pot level, and aren't folded
    
    if (potAmount > 0) {
      // Re-calculate eligible: not folded AND contributed at least currentBet
      const eligible = allPlayers
        .filter(p => !p.folded && p.totalBet >= currentBet)
        .map(p => p.playerId);
      
      pots.push({ amount: potAmount, eligiblePlayerIds: eligible });
    }
    
    previousLevel = currentBet;
  }
  
  // Merge consecutive pots with same eligible players
  const mergedPots = [];
  for (const pot of pots) {
    if (mergedPots.length > 0) {
      const lastPot = mergedPots[mergedPots.length - 1];
      const sameEligible = lastPot.eligiblePlayerIds.length === pot.eligiblePlayerIds.length &&
        lastPot.eligiblePlayerIds.every(id => pot.eligiblePlayerIds.includes(id));
      if (sameEligible) {
        lastPot.amount += pot.amount;
        continue;
      }
    }
    mergedPots.push({ ...pot, eligiblePlayerIds: [...pot.eligiblePlayerIds] });
  }
  
  return mergedPots;
}

// ========== EXPORTS ==========

module.exports = {
  SUITS,
  RANKS,
  RANK_VALUES,
  HAND_RANKS,
  HAND_NAMES,
  createDeck,
  shuffleDeck,
  cardRank,
  cardSuit,
  evaluateHand,
  evaluate5,
  compareHands,
  compareHandValues,
  combinations,
  calculateSidePots
};
