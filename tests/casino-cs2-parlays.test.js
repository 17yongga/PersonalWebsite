'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  combinedOdds,
  validateParlayLegs,
  potentialPayout,
  evaluateWager,
  CS2_PARLAY_MAX_ODDS,
  CS2_MAX_PAYOUT
} = require('../cs2-wager-rules');

const legs = [
  { eventId: 'match-a', selection: 'team1', odds: 1.8 },
  { eventId: 'match-b', selection: 'team2', odds: 2.25 },
  { eventId: 'match-c', selection: 'team1', odds: 1.5 }
];

test('parlay odds are deterministic and duplicate matches fail closed', () => {
  assert.equal(combinedOdds(legs), 6.075);
  assert.equal(validateParlayLegs(legs), 6.075);
  assert.throws(() => validateParlayLegs([legs[0]]), /2-8 legs/);
  assert.throws(() => validateParlayLegs([legs[0], { ...legs[1], eventId: 'match-a' }]), /one selection per match/);
  assert.throws(() => validateParlayLegs([{ ...legs[0], odds: 10 }, { ...legs[1], odds: 11 }]), new RegExp(String(CS2_PARLAY_MAX_ODDS)));
});

test('payout caps prevent accidental unbounded parlay exposure', () => {
  assert.equal(potentialPayout(100, 6.075), 608);
  assert.throws(() => potentialPayout(CS2_MAX_PAYOUT, 2), /Potential payout/);
});

test('parlay remains pending until every non-losing leg is authoritative', () => {
  const wager = { amount: 100, legs };
  const result = evaluateWager(wager, {
    'match-a': { status: 'finished', winner: 'team1' },
    'match-b': { status: 'finished', winner: 'team2' }
  });
  assert.equal(result.status, 'pending');
  assert.deepEqual(result.legs.map(leg => leg.status), ['won', 'won', 'pending']);
});

test('one losing leg settles the parlay once for zero payout', () => {
  const result = evaluateWager({ amount: 100, legs }, {
    'match-a': { status: 'finished', winner: 'team1' },
    'match-b': { status: 'finished', winner: 'team1' }
  });
  assert.equal(result.status, 'lost');
  assert.equal(result.payout, 0);
});

test('void legs are removed from combined odds and an all-void wager refunds', () => {
  const partial = evaluateWager({ amount: 100, legs }, {
    'match-a': { status: 'cancelled' },
    'match-b': { status: 'finished', winner: 'team2' },
    'match-c': { status: 'finished', winner: 'team1' }
  });
  assert.equal(partial.status, 'won');
  assert.equal(partial.effectiveOdds, 3.375);
  assert.equal(partial.payout, 338);
  const allVoid = evaluateWager({ amount: 100, legs: legs.slice(0, 2) }, {
    'match-a': { status: 'cancelled' },
    'match-b': { status: 'cancelled' }
  });
  assert.equal(allVoid.status, 'void');
  assert.equal(allVoid.payout, 100);
});

test('legacy single bets use the same settlement rules', () => {
  const wager = { amount: 135, eventId: 'bo3gg_124993', selection: 'team2', odds: 2.33 };
  const won = evaluateWager(wager, { bo3gg_124993: { status: 'finished', winner: 'team2' } });
  assert.equal(won.status, 'won');
  assert.equal(won.payout, 315);
  const unresolvedFinished = evaluateWager(wager, { bo3gg_124993: { status: 'finished', winner: null } });
  assert.equal(unresolvedFinished.status, 'pending');
});
