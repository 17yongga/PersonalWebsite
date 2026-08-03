'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadPlanner() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'games', 'blackjack.js'), 'utf8');
  const window = {};
  vm.runInNewContext(source, {
    window,
    document: {},
    console,
    setTimeout,
    clearTimeout,
    Math,
    Number,
    Array,
    Set,
    Map
  }, { filename: 'blackjack.js' });
  return window.__blackjackPresentation;
}

const pair = [
  { value: '8', suit: 'hearts' },
  { value: '8', suit: 'spades' }
];
const dealerStart = [null, { value: '6', suit: 'hearts' }];

function state(overrides = {}) {
  return {
    roundId: 'round-1',
    settled: false,
    phase: 'player',
    activeHandIndex: 0,
    playerHands: [{ cards: pair, score: 16, result: null, payout: 0 }],
    dealerHand: dealerStart,
    dealerScore: 6,
    bet: 100,
    insuranceBet: 0,
    payout: 0,
    ...overrides
  };
}

test('Blackjack transition planner preserves split card identity and schedules both replacement cards', () => {
  const { buildBlackjackTransitionPlan } = loadPlanner();
  const next = state({
    activeHandIndex: 0,
    playerHands: [
      { cards: [pair[0], { value: '3', suit: 'clubs' }], score: 11, result: null, payout: 0 },
      { cards: [pair[1], { value: '2', suit: 'diamonds' }], score: 10, result: null, payout: 0 }
    ]
  });
  const plan = buildBlackjackTransitionPlan({ previousState: state(), nextState: next, acceptedAction: 'split' });

  assert.equal(plan.kind, 'split');
  assert.equal(plan.splitCreated, true);
  assert.deepEqual(Array.from(plan.preservedSplitCardIndices), [0, 1]);
  assert.deepEqual(Array.from(plan.playerCardsByHand[0], card => card.index), [1]);
  assert.deepEqual(Array.from(plan.playerCardsByHand[1], card => card.index), [1]);
  assert.ok(plan.playerCardsByHand[0][0].delayMs < plan.playerCardsByHand[1][0].delayMs);
  assert.ok(plan.completionMs > plan.playerCardsByHand[1][0].delayMs);
});

test('Blackjack transition planner sequences active split-hand handoff after accepted stand', () => {
  const { buildBlackjackTransitionPlan } = loadPlanner();
  const previous = state({
    playerHands: [
      { cards: [pair[0], { value: '3', suit: 'clubs' }], score: 11, result: null, payout: 0 },
      { cards: [pair[1], { value: '2', suit: 'diamonds' }], score: 10, result: null, payout: 0 }
    ]
  });
  const next = state({ ...previous, activeHandIndex: 1 });
  const plan = buildBlackjackTransitionPlan({ previousState: previous, nextState: next, acceptedAction: 'stand' });

  assert.equal(plan.kind, 'hand-handoff');
  assert.equal(plan.activeHandChanged, true);
  assert.equal(plan.previousActiveHandIndex, 0);
  assert.equal(plan.nextActiveHandIndex, 1);
  assert.ok(plan.handoffAtMs >= 0);
});

test('Blackjack settlement planner orders dealer reveal, dealer draws, per-hand results, wallet, and summary', () => {
  const { buildBlackjackTransitionPlan } = loadPlanner();
  const previous = state();
  const next = state({
    settled: true,
    phase: 'settled',
    playerHands: [
      { cards: pair, score: 16, result: 'loss', payout: 0 },
      { cards: [{ value: '10', suit: 'clubs' }, { value: '9', suit: 'diamonds' }], score: 19, result: 'win', payout: 200 }
    ],
    dealerHand: [...dealerStart, { value: '10', suit: 'clubs' }],
    dealerScore: 26,
    bet: 200,
    payout: 200
  });
  const plan = buildBlackjackTransitionPlan({ previousState: previous, nextState: next, acceptedAction: 'stand' });

  assert.equal(plan.kind, 'settlement');
  assert.equal(plan.revealDealerAtMs, 0);
  assert.ok(plan.dealerCards[0].delayMs > plan.revealDealerAtMs);
  assert.equal(plan.handSettlementAtMs.length, 2);
  assert.ok(plan.handSettlementAtMs[1] > plan.handSettlementAtMs[0]);
  assert.ok(plan.walletCommitAtMs > plan.handSettlementAtMs[1]);
  assert.ok(plan.summaryAtMs > plan.walletCommitAtMs);
  assert.ok(plan.completionMs > plan.summaryAtMs);
});

test('Blackjack reduced-motion plan removes invisible presentation waits', () => {
  const { buildBlackjackTransitionPlan } = loadPlanner();
  const next = state({ settled: true, phase: 'settled', dealerHand: [...dealerStart, { value: '10', suit: 'clubs' }], dealerScore: 26, playerHands: [{ cards: pair, score: 16, result: 'win', payout: 200 }], payout: 200 });
  const plan = buildBlackjackTransitionPlan({ previousState: state(), nextState: next, acceptedAction: 'stand', reducedMotion: true });

  assert.equal(plan.reducedMotion, true);
  assert.equal(plan.completionMs, 0);
  assert.equal(plan.walletCommitAtMs, 0);
  assert.equal(plan.summaryAtMs, 0);
  assert.deepEqual(Array.from(plan.handSettlementAtMs), [0]);
});

test('Blackjack accepted initial deal alternates player and dealer cards', () => {
  const plan = loadPlanner().buildBlackjackTransitionPlan({
    previousState: null,
    nextState: state({ roundId:'round-deal', playerHands:[{ cards:[{ value:'8', suit:'hearts' }, { value:'3', suit:'clubs' }], score:11, result:null, payout:0 }], dealerHand:[null, { value:'6', suit:'hearts' }] }),
    acceptedAction: null,
    acceptedStart: true,
    initialHydration: false,
    reducedMotion: false
  });
  assert.deepEqual(Array.from(plan.playerCardsByHand[0], card => card.delayMs), [0, 920]);
  assert.deepEqual(Array.from(plan.dealerCards, card => card.delayMs), [460, 1380]);
  assert.equal(plan.kind, 'deal');
  assert.ok(plan.completionMs > 1380);
});

test('Blackjack insurance acknowledgement owns a finite input-lock phase without changing outcomes', () => {
  const before = state({ phase:'insurance' });
  const after = state({ phase:'player', insuranceBet:50 });
  const plan = loadPlanner().buildBlackjackTransitionPlan({ previousState:before, nextState:after, acceptedAction:'insurance', acceptedStart:false, initialHydration:false, reducedMotion:false });
  assert.equal(plan.kind, 'insurance');
  assert.ok(plan.completionMs > 0);
  assert.equal(plan.replaySettlement, false);
  assert.deepEqual(Array.from(plan.handSettlementAtMs), []);
});

test('Blackjack hydration is motionless and does not replay settlement', () => {
  const { buildBlackjackTransitionPlan } = loadPlanner();
  const next = state({ settled: true, phase: 'settled', playerHands: [{ cards: pair, score: 16, result: 'loss', payout: 0 }], dealerHand: [{ value: '10', suit: 'clubs' }, { value: '9', suit: 'hearts' }], dealerScore: 19 });
  const plan = buildBlackjackTransitionPlan({ previousState: null, nextState: next, initialHydration: true });

  assert.equal(plan.kind, 'hydrate');
  assert.equal(plan.completionMs, 0);
  assert.equal(plan.replaySettlement, false);
});
