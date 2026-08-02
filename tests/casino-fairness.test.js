'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CasinoLedger } = require('../casino-ledger');
const { FairRng, commitment, uniformInt } = require('../casino-fairness');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'casino-fair-'));
  const ledger = new CasinoLedger({ dbPath: path.join(dir, 'casino.sqlite') });
  return { ledger, fair: new FairRng({ db: ledger.db }) };
}

test('published commitment matches the consumed seed and rotates before reveal', () => {
  const { ledger, fair } = fixture();
  const published = fair.current('roulette');
  const context = fair.consume('roulette', 'roulette_round_1', 'gary-client');
  assert.equal(context.commitment, published.commitment);
  assert.notEqual(context.nextCommitment, context.commitment);
  assert.equal(fair.current('roulette').commitment, context.nextCommitment);
  const value = fair.int(context, 15);
  const proof = fair.reveal(context.roundId, { number: value });
  assert.equal(commitment(proof.serverSeed), published.commitment);
  const verified = FairRng.verify({ ...proof, maxExclusive: 15, expectedValue: value });
  assert.equal(verified.valid, true);
  ledger.close();
});

test('same seed contract derives deterministic unbiased-range values', () => {
  const seed = 'ab'.repeat(32);
  const first = uniformInt(seed, 'coinflip', 'client', 7, 2, 0).value;
  for (let index = 0; index < 100; index += 1) {
    assert.equal(uniformInt(seed, 'coinflip', 'client', 7, 2, 0).value, first);
  }
  assert.ok(first === 0 || first === 1);
});

test('round creation is idempotent and unrevealed proof hides server seed', () => {
  const { ledger, fair } = fixture();
  const first = fair.consume('pachinko', 'drop_12345678', 'gary');
  const replay = fair.consume('pachinko', 'drop_12345678', 'gary');
  assert.equal(replay.commitment, first.commitment);
  assert.throws(() => fair.consume('pachinko', 'drop_12345678', 'emily'), error => error.code === 'fairness_conflict');
  assert.throws(() => fair.consume('roulette', 'drop_12345678', 'gary'), error => error.code === 'fairness_conflict');
  assert.equal(fair.getProof('drop_12345678').serverSeed, undefined);
  const proof = fair.reveal('drop_12345678', { slotIndex: 8 });
  assert.equal(typeof proof.serverSeed, 'string');
  assert.equal(fair.reveal('drop_12345678', { slotIndex: 1 }).result.slotIndex, 8);
  ledger.close();
});

test('statistical smoke stays within broad tolerance', () => {
  const counts = Array(15).fill(0);
  for (let sample = 0; sample < 15000; sample += 1) {
    const seed = Buffer.alloc(32);
    seed.writeUInt32BE(sample, 28);
    counts[uniformInt(seed.toString('hex'), 'roulette', 'distribution', sample + 1, 15).value] += 1;
  }
  for (const count of counts) assert.ok(count > 850 && count < 1150, `bucket ${count} outside tolerance`);
});
