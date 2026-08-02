'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CasinoLedger } = require('../casino-ledger');
const { FairRng } = require('../casino-fairness');
const { CaseGameService, CASE_CATALOG } = require('../casino-cases');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neon777-cases-'));
  const ledger = new CasinoLedger({ dbPath: path.join(dir, 'casino.sqlite') });
  ledger.importAccounts({ alice: { credits: 10000 }, bob: { credits: 10000 } });
  const fair = new FairRng({ db: ledger.db });
  const cases = new CaseGameService({ ledger, fairRng: fair });
  return { dir, ledger, fair, cases, close() { ledger.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

function prepare(service, userId, game, requestId) {
  return service.prepare({ userId, game, requestId, clientSeed: `${userId}-seed` });
}

test('catalog uses disclosed one-million-point odds and 95% expected return', () => {
  assert.equal(CASE_CATALOG.length, 6);
  assert.deepEqual(new Set(CASE_CATALOG.map(entry => entry.generation)), new Set(['csgo', 'cs2']));
  for (const entry of CASE_CATALOG) {
    assert.equal(entry.items.reduce((sum, item) => sum + item.weight, 0), 1_000_000, entry.id);
    const expected = entry.items.reduce((sum, item) => sum + item.value * item.weight / 1_000_000, 0);
    assert.equal(expected / entry.price, 0.95, entry.id);
    for (const item of entry.items) {
      assert.match(item.name, / \| /);
      assert.match(item.image, /^\/assets\/cs2-skins\/.+\.png$/);
      assert.ok(item.officialId);
      assert.ok(item.officialRarity);
      assert.ok(item.officialRarityColor);
      assert.ok(Array.isArray(item.wears));
      assert.equal(item.source, 'ByMykel/CSGO-API + Valve Steam CDN');
      assert.ok(fs.existsSync(path.join(__dirname, '..', item.image.slice(1))), item.image);
    }
  }
});

test('solo opening requires a published commitment, settles once, reveals proof, and creates inventory', t => {
  const env = setup(); t.after(env.close);
  assert.throws(() => env.cases.open({ userId: 'alice', caseId: 'cs2-quantum', count: 1, requestId: 'open-no-prepare', fairRoundId: 'missing', clientSeed: 'alice-seed' }), /prepared fair round/i);

  const ready = prepare(env.cases, 'alice', 'case_opening', 'prepare-open-1');
  assert.match(ready.commitment, /^[a-f0-9]{64}$/);
  assert.equal('serverSeed' in ready, false);
  const opened = env.cases.open({ userId: 'alice', caseId: 'cs2-quantum', count: 3, requestId: 'open-request-1', fairRoundId: ready.roundId, clientSeed: 'alice-seed' });
  assert.equal(opened.items.length, 3);
  assert.equal(opened.balance, 10000 - 3 * 400);
  assert.equal(opened.proof.roundId, ready.roundId);
  assert.match(opened.proof.serverSeed, /^[a-f0-9]{64}$/);
  assert.equal(opened.inventory.length, 3);
  for (const [index, item] of opened.items.entries()) {
    assert.equal(item.counter, index);
    assert.equal(opened.proof.result.items[index].counter, index);
    const check = FairRng.verify({ ...opened.proof, maxExclusive: 1_000_000, counter: index, expectedValue: item.roll });
    assert.equal(check.valid, true);
  }

  const replay = env.cases.open({ userId: 'alice', caseId: 'cs2-quantum', count: 3, requestId: 'open-request-1', fairRoundId: ready.roundId, clientSeed: 'alice-seed' });
  assert.deepEqual(replay, opened);
  assert.equal(env.ledger.balance('alice'), 8800);
  assert.throws(() => env.cases.open({ userId: 'alice', caseId: 'cs2-quantum', count: 1, requestId: 'open-request-1', fairRoundId: ready.roundId, clientSeed: 'alice-seed' }), /different request/i);
});

test('inventory sell is idempotent and credits the disclosed whole-number value once', t => {
  const env = setup(); t.after(env.close);
  const ready = prepare(env.cases, 'alice', 'case_opening', 'prepare-sell-1');
  const opened = env.cases.open({ userId: 'alice', caseId: 'legacy-dust', count: 1, requestId: 'open-sell-1', fairRoundId: ready.roundId, clientSeed: 'alice-seed' });
  const item = opened.inventory[0];
  const sold = env.cases.sell({ userId: 'alice', inventoryId: item.inventoryId, requestId: 'sell-request-1' });
  assert.equal(sold.balance, opened.balance + item.value);
  assert.equal(sold.item.status, 'sold');
  assert.deepEqual(env.cases.sell({ userId: 'alice', inventoryId: item.inventoryId, requestId: 'sell-request-1' }), sold);
  assert.throws(() => env.cases.sell({ userId: 'alice', inventoryId: item.inventoryId, requestId: 'sell-request-2' }), /already sold/i);
});

test('bot battle opens identical sequence and winner takes all generated items', t => {
  const env = setup(); t.after(env.close);
  const ready = prepare(env.cases, 'alice', 'case_battle', 'prepare-bot-1');
  const battle = env.cases.createBattle({
    userId: 'alice', requestId: 'battle-bot-1', fairRoundId: ready.roundId, clientSeed: 'alice-seed',
    opponent: 'bot', caseIds: ['legacy-dust', 'cs2-quantum', 'cs2-reactor']
  });
  assert.equal(battle.status, 'settled');
  assert.equal(battle.participants.length, 2);
  assert.equal(battle.participants[1].type, 'bot');
  assert.equal(battle.rounds.length, 3);
  assert.equal(battle.proof.roundId, ready.roundId);
  assert.ok(['alice', 'NEON BOT'].includes(battle.winner));
  assert.equal(battle.winnerId, battle.winner);
  assert.equal(battle.results.length, 2);
  assert.deepEqual(battle.results.map(result => result.userId), battle.participants.map(result => result.id));
  const aliceInventory = env.cases.inventory('alice');
  assert.equal(aliceInventory.length, battle.winner === 'alice' ? 6 : 0);
  assert.equal(env.ledger.balance('alice'), 10000 - (100 + 400 + 1000));
  assert.deepEqual(env.cases.createBattle({
    userId: 'alice', requestId: 'battle-bot-1', fairRoundId: ready.roundId, clientSeed: 'alice-seed',
    opponent: 'bot', caseIds: ['legacy-dust', 'cs2-quantum', 'cs2-reactor']
  }), battle);
});

test('human battle reserves both entries, rejects self-join, settles atomically, and survives service restart', t => {
  const env = setup(); t.after(env.close);
  const ready = prepare(env.cases, 'alice', 'case_battle', 'prepare-human-1');
  const waiting = env.cases.createBattle({
    userId: 'alice', requestId: 'battle-human-1', fairRoundId: ready.roundId, clientSeed: 'alice-seed',
    opponent: 'human', caseIds: ['legacy-phoenix', 'cs2-spectrum']
  });
  assert.equal(waiting.status, 'waiting');
  assert.equal(env.ledger.balance('alice'), 9250);
  assert.throws(() => env.cases.joinBattle({ userId: 'alice', battleId: waiting.battleId, requestId: 'self-join-1' }), /own battle/i);

  const reloaded = new CaseGameService({ ledger: env.ledger, fairRng: env.fair });
  assert.equal(reloaded.getBattle(waiting.battleId).status, 'waiting');
  const settled = reloaded.joinBattle({ userId: 'bob', battleId: waiting.battleId, requestId: 'bob-join-1', clientSeed: 'bob-battle-seed' });
  assert.equal(settled.status, 'settled');
  assert.equal(env.ledger.balance('bob'), 9250);
  assert.equal(reloaded.inventory(settled.winner).length, 4);
  assert.equal(reloaded.inventory(settled.winner === 'alice' ? 'bob' : 'alice').length, 0);
  assert.equal(settled.proof.clientSeed, settled.clientSeeds.combinedClientSeed);
  assert.equal(settled.clientSeeds.creatorClientSeed, 'alice-seed');
  assert.equal(settled.clientSeeds.opponentClientSeed, 'bob-battle-seed');
  for (const participant of settled.participants) {
    for (const drop of participant.drops) {
      assert.equal(FairRng.verify({
        ...settled.proof,
        maxExclusive: 1_000_000,
        counter: drop.counter,
        expectedValue: drop.roll
      }).valid, true);
    }
  }
});

test('join settlement failure rolls back the seat, opponent debit and combined fairness seed', t => {
  const env = setup(); t.after(env.close);
  const ready = prepare(env.cases, 'alice', 'case_battle', 'prepare-atomic-join');
  const waiting = env.cases.createBattle({
    userId: 'alice', requestId: 'battle-atomic-join', fairRoundId: ready.roundId, clientSeed: 'alice-seed',
    opponent: 'human', caseIds: ['legacy-dust', 'cs2-pulse']
  });
  const originalSettle = env.cases._settleBattleInside;
  env.cases._settleBattleInside = () => { throw new Error('injected settlement failure'); };
  assert.throws(() => env.cases.joinBattle({
    userId: 'bob', battleId: waiting.battleId, requestId: 'bob-failed-join', clientSeed: 'bob-failed-seed'
  }), /injected settlement failure/);
  env.cases._settleBattleInside = originalSettle;

  assert.equal(env.ledger.balance('bob'), 10000);
  assert.equal(env.cases.getBattle(waiting.battleId).status, 'waiting');
  assert.equal(env.cases.getBattle(waiting.battleId).opponentId, null);
  assert.equal(env.fair.getProof(ready.roundId).clientSeed, 'alice-seed');

  const settled = env.cases.joinBattle({
    userId: 'bob', battleId: waiting.battleId, requestId: 'bob-good-join', clientSeed: 'bob-good-seed'
  });
  assert.equal(settled.status, 'settled');
  assert.equal(env.ledger.balance('bob'), 9750);
});

test('bot settlement failure rolls back battle creation, creator debit and fairness use', t => {
  const env = setup(); t.after(env.close);
  const ready = prepare(env.cases, 'alice', 'case_battle', 'prepare-atomic-bot');
  const originalSettle = env.cases._settleBattleInside;
  env.cases._settleBattleInside = () => { throw new Error('injected bot failure'); };
  assert.throws(() => env.cases.createBattle({
    userId: 'alice', requestId: 'battle-atomic-bot', fairRoundId: ready.roundId, clientSeed: 'alice-seed',
    opponent: 'bot', caseIds: ['legacy-dust']
  }), /injected bot failure/);
  env.cases._settleBattleInside = originalSettle;

  assert.equal(env.ledger.balance('alice'), 10000);
  assert.equal(env.cases.listBattles().length, 0);
  assert.equal(env.fair.getProof(ready.roundId).clientSeed, 'alice-seed');

  const settled = env.cases.createBattle({
    userId: 'alice', requestId: 'battle-atomic-bot', fairRoundId: ready.roundId, clientSeed: 'alice-seed',
    opponent: 'bot', caseIds: ['legacy-dust']
  });
  assert.equal(settled.status, 'settled');
});

test('waiting human battle can be cancelled and refunds exactly once', t => {
  const env = setup(); t.after(env.close);
  const ready = prepare(env.cases, 'alice', 'case_battle', 'prepare-cancel-1');
  const waiting = env.cases.createBattle({
    userId: 'alice', requestId: 'battle-cancel-1', fairRoundId: ready.roundId, clientSeed: 'alice-seed',
    opponent: 'human', caseIds: ['legacy-dust']
  });
  assert.equal(env.ledger.balance('alice'), 9900);
  const cancelled = env.cases.cancelBattle({ userId: 'alice', battleId: waiting.battleId, requestId: 'cancel-battle-1' });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(env.ledger.balance('alice'), 10000);
  assert.deepEqual(env.cases.cancelBattle({ userId: 'alice', battleId: waiting.battleId, requestId: 'cancel-battle-1' }), cancelled);
  assert.throws(() => env.cases.cancelBattle({ userId: 'alice', battleId: waiting.battleId, requestId: 'cancel-battle-2' }), /different request/);
  assert.ok(cancelled.proof.serverSeed);
});
