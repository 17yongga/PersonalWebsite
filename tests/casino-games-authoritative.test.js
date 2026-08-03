'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BlackjackService,
  PACHINKO_MULTIPLIERS,
  calculatePachinkoSettlement,
  createShuffledDeck,
  generatePachinkoResult,
  scoreHand
} = require('../casino-games-authoritative');

test('blackjack ace scoring is correct', () => {
  assert.equal(scoreHand([{ value: 'ace' }, { value: 'king' }]), 21);
  assert.equal(scoreHand([{ value: 'ace' }, { value: 'ace' }, { value: '9' }]), 21);
  assert.equal(scoreHand([{ value: 'king' }, { value: 'queen' }, { value: '2' }]), 22);
});

test('blackjack deck contains 52 unique cards', () => {
  const deck = createShuffledDeck(() => 0);
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map(card => `${card.value}-${card.suit}`)).size, 52);
});

test('blackjack service rejects replay and returns no hidden dealer card after settlement', () => {
  const service = new BlackjackService({ randomInt: () => 0 });
  let state = service.start('gary', 100);
  if (state.phase === 'insurance') state = service.action('gary', state.roundId, 'declineInsurance');
  while (!state.settled) state = service.action('gary', state.roundId, 'stand');
  assert.ok(state.dealerHand.every(Boolean));
  assert.ok(Number.isSafeInteger(state.payout));
  const replay = service.action('gary', state.roundId, 'stand');
  assert.equal(replay.payout, state.payout);
  assert.throws(() => service.action('other', state.roundId, 'stand'), /not found/);
});

test('blackjack split creates two independently playable equal-stake hands', () => {
  const service = new BlackjackService({ randomInt: () => 0 });
  const started = service.start('split-player', 100, { roundId: 'split-round' });
  const round = service.rounds.get('split-player');
  round.phase = 'player';
  round.playerHands = [{ cards: [
    { value: '8', suit: 'hearts' },
    { value: '8', suit: 'spades' }
  ], bet: 100, doubled: false, complete: false, result: null, payout: 0 }];
  round.deck = [{ value: '3', suit: 'clubs' }, { value: '2', suit: 'diamonds' }];

  const split = service.action('split-player', started.roundId, 'split');
  assert.equal(split.playerHands.length, 2);
  assert.deepEqual(split.playerHands.map(hand => hand.bet), [100, 100]);
  assert.deepEqual(split.playerHands.map(hand => hand.cards.length), [2, 2]);
  assert.equal(split.activeHandIndex, 0);
  assert.equal(split.canSplit, false);
  assert.equal(split.bet, 200);

  const firstStood = service.action('split-player', started.roundId, 'stand');
  assert.equal(firstStood.activeHandIndex, 1);
  assert.equal(firstStood.settled, false);
  const settled = service.action('split-player', started.roundId, 'stand');
  assert.equal(settled.settled, true);
  assert.equal(settled.handResults.length, 2);
  assert.equal(settled.playerHands.every(hand => hand.result), true);
});

test('blackjack split aces receive one card each and settle automatically', () => {
  const service = new BlackjackService({ randomInt: () => 0 });
  const started = service.start('ace-player', 50, { roundId: 'ace-split-round' });
  const round = service.rounds.get('ace-player');
  round.phase = 'player';
  round.playerHands = [{ cards: [
    { value: 'ace', suit: 'hearts' },
    { value: 'ace', suit: 'clubs' }
  ], bet: 50, doubled: false, complete: false, result: null, payout: 0 }];
  round.deck = [{ value: '9', suit: 'clubs' }, { value: '10', suit: 'diamonds' }];

  const state = service.action('ace-player', started.roundId, 'split');
  assert.equal(state.settled, true);
  assert.equal(state.playerHands.length, 2);
  assert.deepEqual(state.playerHands.map(hand => hand.cards.length), [2, 2]);
  assert.equal(state.canHit, false);
  assert.equal(state.bet, 100);
});

test('blackjack allows double after split and advances to the next hand', () => {
  const service = new BlackjackService({ randomInt: () => 0 });
  const started = service.start('double-split-player', 75, { roundId: 'double-split-round' });
  const round = service.rounds.get('double-split-player');
  round.phase = 'player';
  round.playerHands = [
    { cards: [{ value: '5' }, { value: '6' }], bet: 75, doubled: false, complete: false, result: null, payout: 0 },
    { cards: [{ value: '9' }, { value: '7' }], bet: 75, doubled: false, complete: false, result: null, payout: 0 }
  ];
  round.activeHandIndex = 0;
  round.hasSplit = true;
  round.deck = [{ value: '10', suit: 'hearts' }];

  const state = service.action('double-split-player', started.roundId, 'double');
  assert.equal(state.playerHands[0].bet, 150);
  assert.equal(state.playerHands[0].cards.length, 3);
  assert.equal(state.activeHandIndex, 1);
  assert.equal(state.bet, 225);
});

test('blackjack split twenty-one pays as a regular win rather than a natural', () => {
  const service = new BlackjackService({ randomInt: () => 0 });
  const started = service.start('split-twenty-one', 100, { roundId: 'split-twenty-one-round' });
  const round = service.rounds.get('split-twenty-one');
  round.phase = 'player';
  round.dealer = [{ value: '10', suit: 'clubs' }, { value: '8', suit: 'hearts' }];
  round.playerHands = [{ cards: [
    { value: 'king', suit: 'hearts' },
    { value: 'king', suit: 'spades' }
  ], bet: 100, doubled: false, complete: false, result: null, payout: 0 }];
  round.deck = [{ value: 'ace', suit: 'clubs' }, { value: 'ace', suit: 'diamonds' }];

  service.action('split-twenty-one', started.roundId, 'split');
  service.action('split-twenty-one', started.roundId, 'stand');
  const settled = service.action('split-twenty-one', started.roundId, 'stand');
  assert.deepEqual(settled.playerHands.map(hand => hand.score), [21, 21]);
  assert.deepEqual(settled.playerHands.map(hand => hand.result), ['win', 'win']);
  assert.deepEqual(settled.playerHands.map(hand => hand.payout), [200, 200]);
  assert.equal(settled.payout, 400);
});

test('blackjack split requires exact matching ranks and rejects value-only pairs', () => {
  const service = new BlackjackService({ randomInt: () => 0 });
  const started = service.start('mismatched-pair', 100, { roundId: 'mismatched-pair-round' });
  const round = service.rounds.get('mismatched-pair');
  round.phase = 'player';
  round.playerHands = [{ cards: [
    { value: 'king', suit: 'hearts' },
    { value: 'queen', suit: 'spades' }
  ], bet: 100, doubled: false, complete: false, result: null, payout: 0 }];
  assert.equal(service.publicState(round).canSplit, false);
  assert.throws(() => service.action('mismatched-pair', started.roundId, 'split'), /equal-rank/);
});

test('pachinko server result uses 16-row binomial path and canonical multiplier table', () => {
  const left = generatePachinkoResult('medium', () => 0);
  assert.deepEqual(left, { slotIndex: 0, multiplier: 50 });
  const right = generatePachinkoResult('high', () => 1);
  assert.deepEqual(right, { slotIndex: 16, multiplier: 220 });
  assert.equal(PACHINKO_MULTIPLIERS.low.length, 17);
  assert.throws(() => generatePachinkoResult('invalid'), /Invalid risk/);
});

test('pachinko settlement preserves every sub-1x payout in milli-credits', () => {
  for (const [risk, multipliers] of Object.entries(PACHINKO_MULTIPLIERS)) {
    multipliers.forEach((multiplier, slotIndex) => {
      if (multiplier >= 1) return;
      const settlement = calculatePachinkoSettlement(1, risk, [{ slotIndex, multiplier }]);
      assert.equal(settlement.payout, multiplier, `${risk} ${multiplier}x must not floor to zero`);
      assert.deepEqual(settlement.results[0], { slotIndex, multiplier, payout: multiplier });
    });
  }

  const batch = calculatePachinkoSettlement(2, 'high', [
    { slotIndex: 8, multiplier: 0.28 },
    { slotIndex: 7, multiplier: 0.48 },
    { slotIndex: 6, multiplier: 0.78 }
  ]);
  assert.equal(batch.payout, 3.08);
  assert.deepEqual(batch.results.map(result => result.payout), [0.56, 0.96, 1.56]);
  assert.throws(() => calculatePachinkoSettlement(1, 'high', [{ slotIndex: 8, multiplier: 220 }]), /canonical multiplier/);
});
