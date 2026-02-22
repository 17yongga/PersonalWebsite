// ========== COMPREHENSIVE POKER ENGINE TESTS ==========
// Run: node tests/poker-tests.js

const path = require('path');
const {
  createDeck,
  shuffleDeck,
  evaluateHand,
  evaluate5,
  compareHands,
  calculateSidePots,
  HAND_RANKS,
  HAND_NAMES,
  combinations
} = require(path.join(__dirname, '..', 'poker-engine.js'));

let passed = 0;
let failed = 0;
let total = 0;

function assert(condition, message) {
  total++;
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${message}`);
  }
}

function assertEq(actual, expected, message) {
  total++;
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${message} — expected ${expected}, got ${actual}`);
  }
}

function section(name) {
  console.log(`\n📋 ${name}`);
}

// ========== DECK TESTS ==========
section('Deck Creation & Shuffling');

const deck = createDeck();
assertEq(deck.length, 52, 'Deck should have 52 cards');
assertEq(new Set(deck).size, 52, 'All cards should be unique');
assert(deck.includes('Ah'), 'Deck should contain Ah');
assert(deck.includes('2c'), 'Deck should contain 2c');
assert(deck.includes('Td'), 'Deck should contain Td');
assert(deck.includes('Ks'), 'Deck should contain Ks');

const shuffled = shuffleDeck(deck);
assertEq(shuffled.length, 52, 'Shuffled deck should have 52 cards');
assertEq(new Set(shuffled).size, 52, 'Shuffled deck should have all unique cards');
// Probability of same order is essentially 0
let sameOrder = deck.every((c, i) => c === shuffled[i]);
// It's theoretically possible but astronomically unlikely
// We just check it doesn't throw

// ========== COMBINATIONS ==========
section('Combinations');

const c52_5 = combinations([1, 2, 3, 4, 5, 6, 7], 5);
assertEq(c52_5.length, 21, '7 choose 5 = 21 combinations');

const c5_5 = combinations([1, 2, 3, 4, 5], 5);
assertEq(c5_5.length, 1, '5 choose 5 = 1 combination');

// ========== HAND EVALUATION - ALL HAND TYPES ==========
section('Hand Evaluation - Royal Flush');
{
  const hand = evaluateHand(['Ah', 'Kh', 'Qh', 'Jh', 'Th']);
  assertEq(hand.rank, HAND_RANKS.ROYAL_FLUSH, 'Royal Flush should be detected');
  assertEq(hand.name, 'Royal Flush', 'Royal Flush name');
}

// Royal flush from 7 cards
{
  const hand = evaluateHand(['Ah', 'Kh', 'Qh', 'Jh', 'Th', '2c', '3d']);
  assertEq(hand.rank, HAND_RANKS.ROYAL_FLUSH, 'Royal Flush from 7 cards');
}

section('Hand Evaluation - Straight Flush');
{
  const hand = evaluateHand(['9h', '8h', '7h', '6h', '5h']);
  assertEq(hand.rank, HAND_RANKS.STRAIGHT_FLUSH, 'Straight Flush 9-high');
  assertEq(hand.values[0], 9, 'Straight Flush high card is 9');
}

// Ace-low straight flush (wheel flush)
{
  const hand = evaluateHand(['Ah', '2h', '3h', '4h', '5h']);
  assertEq(hand.rank, HAND_RANKS.STRAIGHT_FLUSH, 'Ace-low Straight Flush (A-5)');
  assertEq(hand.values[0], 5, 'Ace-low straight flush high card is 5');
}

section('Hand Evaluation - Four of a Kind');
{
  const hand = evaluateHand(['Ah', 'Ad', 'Ac', 'As', 'Kh']);
  assertEq(hand.rank, HAND_RANKS.FOUR_OF_A_KIND, 'Four of a Kind Aces');
  assertEq(hand.values[0], 14, 'Quads rank is Ace (14)');
  assertEq(hand.values[1], 13, 'Kicker is King (13)');
}

// From 7 cards
{
  const hand = evaluateHand(['7h', '7d', '7c', '7s', 'Ah', 'Kh', '2c']);
  assertEq(hand.rank, HAND_RANKS.FOUR_OF_A_KIND, 'Four of a Kind 7s from 7 cards');
  assertEq(hand.values[0], 7, 'Quads rank is 7');
  assertEq(hand.values[1], 14, 'Best kicker is Ace');
}

section('Hand Evaluation - Full House');
{
  const hand = evaluateHand(['Ah', 'Ad', 'Ac', 'Kh', 'Kd']);
  assertEq(hand.rank, HAND_RANKS.FULL_HOUSE, 'Full House Aces full of Kings');
  assertEq(hand.values[0], 14, 'Trips rank is Ace');
  assertEq(hand.values[1], 13, 'Pair rank is King');
}

// Full house from 7 cards — two trips scenario
{
  const hand = evaluateHand(['Ah', 'Ad', 'Ac', 'Kh', 'Kd', 'Kc', '2s']);
  assertEq(hand.rank, HAND_RANKS.FOUR_OF_A_KIND < hand.rank || hand.rank === HAND_RANKS.FULL_HOUSE ? HAND_RANKS.FULL_HOUSE : -1, 
    'Two trips makes Full House from 7 cards');
  // Best: A-A-A-K-K
  assertEq(hand.values[0], 14, 'Best full house: Aces full');
}

section('Hand Evaluation - Flush');
{
  const hand = evaluateHand(['Ah', 'Kh', 'Qh', '9h', '2h']);
  assertEq(hand.rank, HAND_RANKS.FLUSH, 'Flush detected');
  assertEq(hand.values[0], 14, 'Flush high card Ace');
}

// Flush from 7 cards (6 of same suit)
{
  const hand = evaluateHand(['Ah', 'Kh', 'Qh', '9h', '7h', '5h', '2c']);
  assertEq(hand.rank, HAND_RANKS.FLUSH, 'Flush from 7 cards with 6 hearts');
  assertEq(hand.values[0], 14, 'Best flush starts with Ace');
}

section('Hand Evaluation - Straight');
{
  const hand = evaluateHand(['Ah', 'Kd', 'Qc', 'Js', 'Th']);
  assertEq(hand.rank, HAND_RANKS.STRAIGHT, 'Ace-high Straight');
  assertEq(hand.values[0], 14, 'Straight high card is Ace (14)');
}

{
  const hand = evaluateHand(['9h', '8d', '7c', '6s', '5h']);
  assertEq(hand.rank, HAND_RANKS.STRAIGHT, '9-high Straight');
  assertEq(hand.values[0], 9, 'Straight high card is 9');
}

// Ace-low straight (wheel)
{
  const hand = evaluateHand(['Ah', '2d', '3c', '4s', '5h']);
  assertEq(hand.rank, HAND_RANKS.STRAIGHT, 'Ace-low Straight (Wheel)');
  assertEq(hand.values[0], 5, 'Wheel high card is 5');
}

// Straight from 7 cards
{
  const hand = evaluateHand(['Ah', 'Kd', 'Qc', 'Js', 'Th', '2c', '3d']);
  assertEq(hand.rank, HAND_RANKS.STRAIGHT, 'Ace-high Straight from 7 cards');
  assertEq(hand.values[0], 14, 'Straight high card is Ace');
}

section('Hand Evaluation - Three of a Kind');
{
  const hand = evaluateHand(['Ah', 'Ad', 'Ac', 'Kh', '9s']);
  assertEq(hand.rank, HAND_RANKS.THREE_OF_A_KIND, 'Three of a Kind');
  assertEq(hand.values[0], 14, 'Trips rank is Ace');
}

section('Hand Evaluation - Two Pair');
{
  const hand = evaluateHand(['Ah', 'Ad', 'Kh', 'Kd', '9s']);
  assertEq(hand.rank, HAND_RANKS.TWO_PAIR, 'Two Pair');
  assertEq(hand.values[0], 14, 'Higher pair is Ace');
  assertEq(hand.values[1], 13, 'Lower pair is King');
  assertEq(hand.values[2], 9, 'Kicker is 9');
}

// Two pair from 7 cards with 3 pairs
{
  const hand = evaluateHand(['Ah', 'Ad', 'Kh', 'Kd', 'Qh', 'Qd', '2s']);
  // Best: A-A, K-K with Q kicker
  assertEq(hand.rank, HAND_RANKS.TWO_PAIR, 'Best Two Pair from 3 pairs');
  assertEq(hand.values[0], 14, 'Higher pair is Ace');
  assertEq(hand.values[1], 13, 'Lower pair is King');
  assertEq(hand.values[2], 12, 'Kicker is Queen');
}

section('Hand Evaluation - One Pair');
{
  const hand = evaluateHand(['Ah', 'Ad', 'Kh', '9s', '5c']);
  assertEq(hand.rank, HAND_RANKS.ONE_PAIR, 'One Pair');
  assertEq(hand.values[0], 14, 'Pair rank is Ace');
  assertEq(hand.values[1], 13, 'First kicker is King');
}

section('Hand Evaluation - High Card');
{
  const hand = evaluateHand(['Ah', 'Kd', '9c', '7s', '3h']);
  assertEq(hand.rank, HAND_RANKS.HIGH_CARD, 'High Card');
  assertEq(hand.values[0], 14, 'High card is Ace');
}

// ========== HAND COMPARISON ==========
section('Hand Comparison - Different Ranks');

{
  const rf = evaluateHand(['Ah', 'Kh', 'Qh', 'Jh', 'Th']);
  const sf = evaluateHand(['9h', '8h', '7h', '6h', '5h']);
  assert(compareHands(rf, sf) > 0, 'Royal Flush beats Straight Flush');
}

{
  const sf = evaluateHand(['9h', '8h', '7h', '6h', '5h']);
  const quads = evaluateHand(['Ah', 'Ad', 'Ac', 'As', 'Kh']);
  assert(compareHands(sf, quads) > 0, 'Straight Flush beats Four of a Kind');
}

{
  const quads = evaluateHand(['Ah', 'Ad', 'Ac', 'As', 'Kh']);
  const fh = evaluateHand(['Ah', 'Ad', 'Ac', 'Kh', 'Kd']);
  assert(compareHands(quads, fh) > 0, 'Four of a Kind beats Full House');
}

{
  const fh = evaluateHand(['Ah', 'Ad', 'Ac', 'Kh', 'Kd']);
  const fl = evaluateHand(['Ah', 'Kh', 'Qh', '9h', '2h']);
  assert(compareHands(fh, fl) > 0, 'Full House beats Flush');
}

{
  const fl = evaluateHand(['Ah', 'Kh', 'Qh', '9h', '2h']);
  const st = evaluateHand(['Ac', 'Kd', 'Qh', 'Js', 'Th']);
  assert(compareHands(fl, st) > 0, 'Flush beats Straight');
}

{
  const st = evaluateHand(['Ac', 'Kd', 'Qh', 'Js', 'Th']);
  const trips = evaluateHand(['Ah', 'Ad', 'Ac', 'Kh', '9s']);
  assert(compareHands(st, trips) > 0, 'Straight beats Three of a Kind');
}

{
  const trips = evaluateHand(['Ah', 'Ad', 'Ac', 'Kh', '9s']);
  const tp = evaluateHand(['Ah', 'Ad', 'Kh', 'Kd', '9s']);
  assert(compareHands(trips, tp) > 0, 'Three of a Kind beats Two Pair');
}

{
  const tp = evaluateHand(['Ah', 'Ad', 'Kh', 'Kd', '9s']);
  const op = evaluateHand(['Ah', 'Ad', 'Kh', '9s', '5c']);
  assert(compareHands(tp, op) > 0, 'Two Pair beats One Pair');
}

{
  const op = evaluateHand(['Ah', 'Ad', 'Kh', '9s', '5c']);
  const hc = evaluateHand(['Ah', 'Kd', '9c', '7s', '3h']);
  assert(compareHands(op, hc) > 0, 'One Pair beats High Card');
}

section('Hand Comparison - Same Rank Tiebreakers');

// Higher pair wins
{
  const pairA = evaluateHand(['Ah', 'Ad', 'Kh', '9s', '5c']);
  const pairK = evaluateHand(['Kh', 'Kd', 'Ah', '9s', '5c']);
  assert(compareHands(pairA, pairK) > 0, 'Pair of Aces beats Pair of Kings');
}

// Same pair, kicker decides
{
  const pairAK = evaluateHand(['Ah', 'Ad', 'Kh', '9s', '5c']);
  const pairAQ = evaluateHand(['Ac', 'As', 'Qh', '9d', '5h']);
  assert(compareHands(pairAK, pairAQ) > 0, 'Same pair, King kicker beats Queen kicker');
}

// Two pair comparison
{
  const tpAK = evaluateHand(['Ah', 'Ad', 'Kh', 'Kd', '9s']);
  const tpAQ = evaluateHand(['Ac', 'As', 'Qh', 'Qd', 'Ts']);
  assert(compareHands(tpAK, tpAQ) > 0, 'AA-KK beats AA-QQ');
}

// Two pair, same pairs, kicker decides
{
  const tpK = evaluateHand(['Ah', 'Ad', 'Kh', 'Kd', '9s']);
  const tp8 = evaluateHand(['Ac', 'As', 'Kc', 'Ks', '8s']);
  assert(compareHands(tpK, tp8) > 0, 'Same two pair, 9 kicker beats 8 kicker');
}

// Flush comparison (kickers)
{
  const flushA = evaluateHand(['Ah', 'Kh', 'Qh', '9h', '2h']);
  const flushB = evaluateHand(['Ac', 'Kc', 'Qc', '8c', '2c']);
  assert(compareHands(flushA, flushB) > 0, 'Flush with 9 beats flush with 8');
}

// Straight comparison
{
  const stA = evaluateHand(['Ac', 'Kd', 'Qh', 'Js', 'Th']);
  const st9 = evaluateHand(['9c', '8d', '7h', '6s', '5h']);
  assert(compareHands(stA, st9) > 0, 'Ace-high straight beats 9-high straight');
}

// Wheel vs 6-high straight
{
  const wheel = evaluateHand(['Ah', '2d', '3c', '4s', '5h']);
  const six = evaluateHand(['6c', '5d', '4h', '3s', '2h']);
  assert(compareHands(six, wheel) > 0, '6-high straight beats wheel (5-high)');
}

// Split pot (exact tie)
{
  const hand1 = evaluateHand(['Ah', 'Kh', 'Qh', 'Jh', 'Th']);
  const hand2 = evaluateHand(['Ad', 'Kd', 'Qd', 'Jd', 'Td']);
  assertEq(compareHands(hand1, hand2), 0, 'Two royal flushes (different suits) tie');
}

// Same straight ties
{
  const st1 = evaluateHand(['9h', '8d', '7c', '6s', '5h']);
  const st2 = evaluateHand(['9c', '8h', '7d', '6h', '5c']);
  assertEq(compareHands(st1, st2), 0, 'Same straights tie');
}

// High card tiebreaker
{
  const hc1 = evaluateHand(['Ah', 'Kd', '9c', '7s', '3h']);
  const hc2 = evaluateHand(['Ac', 'Kh', '9d', '7h', '2s']);
  assert(compareHands(hc1, hc2) > 0, 'High card: same top 4, 3 kicker beats 2');
}

// Full house comparison
{
  const fhA = evaluateHand(['Ah', 'Ad', 'Ac', 'Kh', 'Kd']);
  const fhK = evaluateHand(['Kh', 'Kd', 'Kc', 'Ah', 'Ad']);
  assert(compareHands(fhA, fhK) > 0, 'Aces full beats Kings full');
}

// Same trips, different pair in full house
{
  const fhAK = evaluateHand(['Ah', 'Ad', 'Ac', 'Kh', 'Kd']);
  const fhAQ = evaluateHand(['As', 'Ah', 'Ad', 'Qh', 'Qd']);
  assert(compareHands(fhAK, fhAQ) > 0, 'Aces full of Kings beats Aces full of Queens');
}

// Quads comparison
{
  const quadsA = evaluateHand(['Ah', 'Ad', 'Ac', 'As', 'Kh']);
  const quadsK = evaluateHand(['Kh', 'Kd', 'Kc', 'Ks', 'Ah']);
  assert(compareHands(quadsA, quadsK) > 0, 'Quad Aces beats Quad Kings');
}

// Same quads, kicker decides
{
  const quadsAK = evaluateHand(['Ah', 'Ad', 'Ac', 'As', 'Kh']);
  const quadsAQ = evaluateHand(['Ah', 'Ad', 'Ac', 'As', 'Qh']);
  assert(compareHands(quadsAK, quadsAQ) > 0, 'Quad Aces K kicker beats Q kicker');
}

// ========== 7-CARD HAND EVALUATION (TYPICAL HOLDEM) ==========
section('7-Card Evaluation (Hold\'em scenarios)');

// Board makes the best hand (split pot scenario)
{
  const hand1 = evaluateHand(['2h', '3d', 'Ah', 'Kh', 'Qh', 'Jh', 'Th']);
  assertEq(hand1.rank, HAND_RANKS.ROYAL_FLUSH, 'Royal flush on board found from 7 cards');
}

// Player\'s hole cards improve the hand
{
  const hand = evaluateHand(['Ah', 'Kh', 'Qh', 'Jh', '9h', '2c', '3d']);
  assertEq(hand.rank, HAND_RANKS.FLUSH, 'Best hand is flush (not straight since not consecutive)');
}

// Hidden trips
{
  const hand = evaluateHand(['7h', '7d', 'Kh', 'Qs', '7c', '2d', '9s']);
  assertEq(hand.rank, HAND_RANKS.THREE_OF_A_KIND, 'Trip 7s from 7 cards');
}

// Full house from two pair on board + pocket pair
{
  const hand = evaluateHand(['Ah', 'Ad', 'Kh', 'Kd', 'Ac', '2s', '3s']);
  assertEq(hand.rank, HAND_RANKS.FULL_HOUSE, 'Full house A-A-A-K-K');
}

// ========== SIDE POT CALCULATION ==========
section('Side Pot Calculation');

// Simple case: no all-in, everyone puts in same amount
{
  const pots = calculateSidePots([
    { playerId: 'a', totalBet: 100, folded: false },
    { playerId: 'b', totalBet: 100, folded: false },
    { playerId: 'c', totalBet: 100, folded: false }
  ]);
  assertEq(pots.length, 1, 'Simple case: 1 pot');
  assertEq(pots[0].amount, 300, 'Simple case: pot = 300');
  assertEq(pots[0].eligiblePlayerIds.length, 3, 'Simple case: 3 eligible');
}

// One player all-in for less
{
  const pots = calculateSidePots([
    { playerId: 'a', totalBet: 50, folded: false },   // all-in
    { playerId: 'b', totalBet: 100, folded: false },
    { playerId: 'c', totalBet: 100, folded: false }
  ]);
  assertEq(pots.length, 2, 'One all-in: 2 pots');
  assertEq(pots[0].amount, 150, 'Main pot = 150 (50*3)');
  assertEq(pots[0].eligiblePlayerIds.length, 3, 'Main pot: 3 eligible');
  assertEq(pots[1].amount, 100, 'Side pot = 100 (50*2)');
  assertEq(pots[1].eligiblePlayerIds.length, 2, 'Side pot: 2 eligible');
  assert(!pots[1].eligiblePlayerIds.includes('a'), 'All-in player not in side pot');
}

// Two players all-in for different amounts
{
  const pots = calculateSidePots([
    { playerId: 'a', totalBet: 30, folded: false },   // all-in smallest
    { playerId: 'b', totalBet: 70, folded: false },   // all-in medium
    { playerId: 'c', totalBet: 100, folded: false }   // full bet
  ]);
  assertEq(pots.length, 3, 'Two all-ins: 3 pots');
  assertEq(pots[0].amount, 90, 'Main pot = 90 (30*3)');
  assertEq(pots[0].eligiblePlayerIds.length, 3, 'Main pot: 3 eligible');
  assertEq(pots[1].amount, 80, 'Side pot 1 = 80 (40*2)');
  assertEq(pots[1].eligiblePlayerIds.length, 2, 'Side pot 1: 2 eligible');
  assertEq(pots[2].amount, 30, 'Side pot 2 = 30');
  assertEq(pots[2].eligiblePlayerIds.length, 1, 'Side pot 2: 1 eligible');
}

// Folded player\'s money goes into pot but they can't win
{
  const pots = calculateSidePots([
    { playerId: 'a', totalBet: 50, folded: true },
    { playerId: 'b', totalBet: 100, folded: false },
    { playerId: 'c', totalBet: 100, folded: false }
  ]);
  // Folded player at level 50: eligible = b, c (not a, folded)
  // Level 100: eligible = b, c
  // Same eligible => merged into 1 pot
  assertEq(pots.length, 1, 'Folded player: merged into 1 pot (same eligible)');
  assertEq(pots[0].amount, 250, 'Total pot includes all bets');
  assert(!pots[0].eligiblePlayerIds.includes('a'), 'Folded player not eligible');
  assertEq(pots[0].eligiblePlayerIds.length, 2, '2 eligible (b, c)');
}

// All-in + fold scenario
{
  const pots = calculateSidePots([
    { playerId: 'a', totalBet: 50, folded: false },   // all-in
    { playerId: 'b', totalBet: 100, folded: false },
    { playerId: 'c', totalBet: 80, folded: true }     // folded after betting 80
  ]);
  // Level 50: all contributed -> 150, eligible: a, b
  // Level 80: b contributed 30, c contributed 30 -> 60, eligible: b
  // Level 100: b contributed 20 -> 20, eligible: b
  assertEq(pots.length, 2, 'All-in + fold: pots created');
  // pots[0]: 150, eligible: a, b (since a bet 50 and b bet >= 50)
  assertEq(pots[0].amount, 150, 'Main pot = 150');
  assert(pots[0].eligiblePlayerIds.includes('a'), 'All-in player eligible for main pot');
  assert(pots[0].eligiblePlayerIds.includes('b'), 'Full player eligible for main pot');
}

// ========== EDGE CASES ==========
section('Edge Cases');

// Board pair, both players have same kickers
{
  const hand1 = evaluateHand(['2h', '3d', 'Ah', 'Kd', 'Qc', 'Js', '9h']);
  const hand2 = evaluateHand(['2c', '3s', 'Ah', 'Kd', 'Qc', 'Js', '9h']);
  // Both use board: A-K-Q-J-9 high card
  assertEq(compareHands(hand1, hand2), 0, 'Same board cards = tie');
}

// Ace-high vs King-high
{
  const aceHigh = evaluateHand(['Ah', '9d', '7c', '4s', '2h']);
  const kingHigh = evaluateHand(['Kh', 'Qd', 'Jc', 'Ts', '8h']);
  assert(compareHands(aceHigh, kingHigh) > 0, 'Ace-high beats King-high');
}

// Three of a kind comparison
{
  const tripsA = evaluateHand(['Ah', 'Ad', 'Ac', '5s', '3h']);
  const tripsK = evaluateHand(['Kh', 'Kd', 'Kc', 'As', 'Qh']);
  assert(compareHands(tripsA, tripsK) > 0, 'Trip Aces beats Trip Kings');
}

// Straight flush vs quads
{
  const sf = evaluateHand(['5h', '6h', '7h', '8h', '9h']);
  const quads = evaluateHand(['Ah', 'Ad', 'Ac', 'As', 'Kh']);
  assert(compareHands(sf, quads) > 0, 'Straight flush beats quad aces');
}

// Verify Ace can be both high and low in straights
{
  const aceHigh = evaluateHand(['Ac', 'Kd', 'Qh', 'Js', 'Th']);
  const aceLow = evaluateHand(['Ah', '2d', '3c', '4s', '5h']);
  assert(compareHands(aceHigh, aceLow) > 0, 'Ace-high straight beats Ace-low straight');
  assertEq(aceHigh.values[0], 14, 'Ace-high straight value is 14');
  assertEq(aceLow.values[0], 5, 'Ace-low straight value is 5');
}

// 7-card hand where best 5 don't include hole cards
{
  // Board: A-K-Q-J-T (straight), hole: 2-3
  const hand = evaluateHand(['2h', '3d', 'As', 'Kd', 'Qc', 'Js', 'Th']);
  assertEq(hand.rank, HAND_RANKS.STRAIGHT, 'Board straight recognized');
  assertEq(hand.values[0], 14, 'Ace-high straight');
}

// Competing full houses from 7 cards
{
  // Board: K-K-Q-Q-J, hole1: K-Q (KKKQQ), hole2: Q-J (QQQKK or QQQJJ)
  const hand1 = evaluateHand(['Kh', 'Qd', 'Kd', 'Ks', 'Qc', 'Qs', 'Jh']);
  assertEq(hand1.rank, HAND_RANKS.FULL_HOUSE, 'KKK-QQ full house');
  // With 3 Kings and 3 Queens, best is K-K-K-Q-Q
  assertEq(hand1.values[0], 13, 'Trip Kings');
}

// ========== SUMMARY ==========
console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
if (failed === 0) {
  console.log('✅ ALL TESTS PASSED!');
} else {
  console.log('❌ SOME TESTS FAILED');
  process.exit(1);
}
