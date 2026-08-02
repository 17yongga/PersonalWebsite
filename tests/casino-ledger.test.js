'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { CasinoLedger, assertCasinoDatabaseIdentity } = require('../casino-ledger');

function fixture(now = 1_700_000_000_000) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'casino-ledger-'));
  const ledger = new CasinoLedger({ dbPath: path.join(dir, 'casino.sqlite'), now: () => now });
  ledger.importAccounts({ gary: { credits: 1000 }, emily: { credits: 500 } });
  return { dir, ledger };
}

test('database identity guard accepts migrated Casino databases and rejects unrelated SQLite files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'casino-db-identity-'));
  const casinoPath = path.join(dir, 'casino.sqlite');
  const ledger = new CasinoLedger({ dbPath: casinoPath });
  ledger.close();
  assert.equal(assertCasinoDatabaseIdentity(casinoPath), casinoPath);

  const unrelatedPath = path.join(dir, 'unrelated.sqlite');
  const unrelated = new Database(unrelatedPath);
  unrelated.exec('CREATE TABLE unrelated(id INTEGER PRIMARY KEY)');
  unrelated.close();
  assert.throws(() => assertCasinoDatabaseIdentity(unrelatedPath), /identity metadata is missing/);
  assert.throws(() => assertCasinoDatabaseIdentity(path.join(dir, 'missing.sqlite')), /does not exist/);
});

test('balance changes are durable and idempotent', () => {
  const { dir, ledger } = fixture();
  const first = ledger.change({ userId: 'gary', delta: -100, idempotencyKey: 'blackjack:r1:start', game: 'blackjack', action: 'debit', referenceId: 'r1', response: ({ balanceAfter }) => ({ balance: balanceAfter }) });
  const replay = ledger.change({ userId: 'gary', delta: -100, idempotencyKey: 'blackjack:r1:start', game: 'blackjack', action: 'debit', referenceId: 'r1' });
  assert.equal(first.balance, 900);
  assert.equal(replay.balance, 900);
  assert.equal(replay.replayed, true);
  ledger.close();
  const reopened = new CasinoLedger({ dbPath: path.join(dir, 'casino.sqlite') });
  assert.equal(reopened.balance('gary'), 900);
  assert.equal(reopened.integrityCheck(), 'ok');
  reopened.close();
});

test('same idempotency key with a changed mutation payload fails closed without changing balances', () => {
  const { ledger } = fixture();
  const base = { userId: 'gary', delta: -100, idempotencyKey: 'idem:matrix:1', game: 'blackjack', action: 'debit', referenceId: 'r1', metadata: { risk: 'low', count: 1 } };
  ledger.change(base);
  const conflicts = [
    { ...base, userId: 'emily' },
    { ...base, delta: -101 },
    { ...base, game: 'roulette' },
    { ...base, action: 'reserve' },
    { ...base, referenceId: 'r2' },
    { ...base, metadata: { risk: 'high', count: 1 } },
    { ...base, metadata: { risk: 'low', count: 2 } }
  ];
  for (const input of conflicts) assert.throws(() => ledger.change(input), error => error.code === 'idempotency_conflict');
  assert.equal(ledger.balance('gary'), 900);
  assert.equal(ledger.balance('emily'), 500);
  assert.equal(ledger.db.prepare('SELECT COUNT(*) AS count FROM ledger_transactions').get().count, 1);
  ledger.close();
});

test('escrow retries reject changed stakes, payouts, metadata, and keys', () => {
  const { ledger } = fixture();
  const reserve = { userId: 'gary', game: 'crash', referenceId: 'round1', escrowId: 'escrow1', stake: 10, idempotencyKey: 'crash:gary:round1:reserve', metadata: { socket: 'A' } };
  ledger.reserve(reserve);
  assert.throws(() => ledger.reserve({ ...reserve, stake: 500 }), error => error.code === 'idempotency_conflict');
  assert.throws(() => ledger.reserve({ ...reserve, metadata: { socket: 'B' } }), error => error.code === 'idempotency_conflict');
  assert.throws(() => ledger.reserve({ ...reserve, idempotencyKey: 'crash:gary:round1:other' }), error => error.code === 'idempotency_conflict');
  ledger.settle({ escrowId: 'escrow1', payout: 20, idempotencyKey: 'crash:gary:round1:settle', metadata: { multiplier: 2 } });
  assert.throws(() => ledger.settle({ escrowId: 'escrow1', payout: 1000, idempotencyKey: 'crash:gary:round1:settle', metadata: { multiplier: 2 } }), error => error.code === 'idempotency_conflict');
  assert.equal(ledger.balance('gary'), 1010);
  ledger.close();
});

test('milli-credit storage preserves the production fractional-wallet contract', () => {
  const { ledger } = fixture();
  ledger.importAccounts({ fractional: { credits: '42.008' } });
  assert.equal(ledger.balance('fractional'), 42.008);
  const result = ledger.change({ userId: 'fractional', delta: 1, idempotencyKey: 'migration:fractional:1', game: 'migration', action: 'credit' });
  assert.equal(result.balance, 43.008);
  assert.equal(ledger.db.prepare('SELECT balance FROM accounts WHERE user_id=?').get('fractional').balance, 43008);
  assert.throws(() => ledger.change({ userId: 'fractional', delta: 0.0001, idempotencyKey: 'migration:fractional:bad', game: 'migration', action: 'credit' }), /three decimal places/);
  ledger.close();
});

test('insufficient balance rolls back without transaction or balance mutation', () => {
  const { ledger } = fixture();
  assert.throws(() => ledger.change({ userId: 'gary', delta: -2000, idempotencyKey: 'roulette:r1:reserve', game: 'roulette', action: 'reserve', referenceId: 'r1' }), /resulting balance/);
  assert.equal(ledger.balance('gary'), 1000);
  assert.equal(ledger.db.prepare('SELECT COUNT(*) AS count FROM ledger_transactions').get().count, 0);
  ledger.close();
});

test('escrow reserve and settlement commit balance and state atomically', () => {
  const { ledger } = fixture();
  const reserved = ledger.reserve({ userId: 'gary', game: 'coinflip', referenceId: 'room1', escrowId: 'escrow_room1', stake: 200, idempotencyKey: 'coinflip:room1:reserve' });
  assert.equal(reserved.balance, 800);
  assert.equal(reserved.escrow.status, 'active');
  const settled = ledger.settle({ escrowId: 'escrow_room1', payout: 400, idempotencyKey: 'coinflip:room1:settle', response: { result: 'win' } });
  assert.equal(settled.balance, 1200);
  assert.equal(settled.escrow.status, 'settled');
  const replay = ledger.settle({ escrowId: 'escrow_room1', payout: 400, idempotencyKey: 'coinflip:room1:settle' });
  assert.equal(replay.balance, 1200);
  assert.equal(ledger.balance('gary'), 1200);
  ledger.close();
});

test('startup recovery refunds every active escrow exactly once', () => {
  const { dir, ledger } = fixture();
  ledger.reserve({ userId: 'gary', game: 'roulette', referenceId: 'spin1', escrowId: 'escrow_spin1', stake: 125, idempotencyKey: 'roulette:spin1:reserve' });
  ledger.reserve({ userId: 'emily', game: 'poker', referenceId: 'table1', escrowId: 'escrow_table1', stake: 250, idempotencyKey: 'poker:table1:reserve' });
  ledger.close();
  const reopened = new CasinoLedger({ dbPath: path.join(dir, 'casino.sqlite') });
  assert.equal(reopened.recoverActiveEscrows().length, 2);
  assert.equal(reopened.balance('gary'), 1000);
  assert.equal(reopened.balance('emily'), 500);
  assert.equal(reopened.recoverActiveEscrows().length, 0);
  assert.equal(reopened.activeEscrows().length, 0);
  reopened.close();
});

test('escrow replacement refunds and reserves atomically with retry-stable history', () => {
  const { dir, ledger } = fixture();
  const first = ledger.reserve({
    userId: 'gary', game: 'roulette', referenceId: 'spin1:req-red', escrowId: 'escrow_red',
    stake: 100, idempotencyKey: 'roulette:spin1:req-red:reserve', metadata: { color: 'red' }
  });
  const input = {
    oldEscrowId: first.escrow.escrowId,
    refundIdempotencyKey: 'roulette:spin1:req-black:replace-refund',
    refundMetadata: { reason: 'replace', nextColor: 'black' },
    reservation: {
      userId: 'gary', game: 'roulette', referenceId: 'spin1:req-black', escrowId: 'escrow_black',
      stake: 250, idempotencyKey: 'roulette:spin1:req-black:reserve', metadata: { color: 'black' }
    }
  };
  const replaced = ledger.replaceEscrow(input);
  assert.equal(replaced.refund.escrow.status, 'refunded');
  assert.equal(replaced.reservation.escrow.status, 'active');
  assert.equal(replaced.balance, 750);
  const replay = ledger.replaceEscrow(input);
  assert.equal(replay.replayed, true);
  assert.equal(replay.balance, 750);
  assert.throws(() => ledger.replaceEscrow({
    ...input,
    reservation: { ...input.reservation, stake: 251 }
  }), /different (?:mutation payload|request)/);
  assert.throws(() => ledger.replaceEscrow({
    ...input,
    refundIdempotencyKey: 'roulette:spin1:wrong-user:refund',
    reservation: {
      ...input.reservation,
      userId: 'emily', referenceId: 'spin1:wrong-user', escrowId: 'escrow_wrong_user',
      idempotencyKey: 'roulette:spin1:wrong-user:reserve'
    }
  }), /(?:same user and game|ownership mismatch)/);
  assert.equal(ledger.balance('gary'), 750);
  assert.equal(ledger.db.prepare("SELECT COUNT(*) AS count FROM escrows WHERE status='active'").get().count, 1);
  assert.equal(ledger.db.prepare('SELECT COUNT(*) AS count FROM ledger_transactions').get().count, 3);
  ledger.close();
  const reopened = new CasinoLedger({ dbPath: path.join(dir, 'casino.sqlite') });
  const recovered = reopened.recoverActiveEscrows();
  assert.equal(recovered.length, 1, 'only the replacement escrow is active after restart');
  assert.equal(reopened.balance('gary'), 1000);
  assert.equal(reopened.activeEscrows().length, 0);
  reopened.close();
});

test('escrow replacement rolls the refund back when the new reservation fails', () => {
  const { ledger } = fixture();
  const first = ledger.reserve({
    userId: 'gary', game: 'roulette', referenceId: 'spin2:req-red', escrowId: 'escrow_red_2',
    stake: 100, idempotencyKey: 'roulette:spin2:req-red:reserve', metadata: { color: 'red' }
  });
  assert.throws(() => ledger.replaceEscrow({
    oldEscrowId: first.escrow.escrowId,
    refundIdempotencyKey: 'roulette:spin2:req-green:replace-refund',
    reservation: {
      userId: 'gary', game: 'roulette', referenceId: 'spin2:req-green', escrowId: 'escrow_green_2',
      stake: 2000, idempotencyKey: 'roulette:spin2:req-green:reserve', metadata: { color: 'green' }
    }
  }), /resulting balance/);
  assert.equal(ledger.balance('gary'), 900);
  assert.equal(ledger.activeEscrows()[0].escrowId, 'escrow_red_2');
  assert.equal(ledger.activeEscrows()[0].status, 'active');
  assert.equal(ledger.db.prepare('SELECT COUNT(*) AS count FROM ledger_transactions').get().count, 1);
  ledger.close();
});

test('email verification and password-recovery tokens are hashed, expiring and one-use', () => {
  let now = 1_700_000_000_000;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'casino-ledger-email-'));
  const ledger = new CasinoLedger({ dbPath: path.join(dir, 'casino.sqlite'), now: () => now });
  ledger.importAccounts({ gary: { credits: 1000 } });
  const verify = ledger.createVerificationToken('gary', 'Gary@Example.com', 1000);
  assert.equal(ledger.consumeVerificationToken(verify).email, 'gary@example.com');
  assert.equal(ledger.consumeVerificationToken(verify), null);
  assert.equal(ledger.accountByEmail('gary@example.com').user_id, 'gary');
  const reset = ledger.createRecoveryToken('gary', 1000);
  assert.equal(ledger.consumeRecoveryToken(reset), 'gary');
  assert.equal(ledger.consumeRecoveryToken(reset), null);
  const expired = ledger.createRecoveryToken('gary', 1000);
  now += 1001;
  assert.equal(ledger.consumeRecoveryToken(expired), null);
  assert.equal(ledger.db.prepare('SELECT COUNT(*) AS n FROM recovery_tokens WHERE token_hash=?').get(reset).n, 0, 'raw token must never be stored');
  ledger.close();
});

test('registration rollback removes only empty accounts and recovery claims can be restored after persistence failure', () => {
  const { ledger } = fixture();
  ledger.importAccounts({ pending: { credits: 10000 } });
  ledger.createVerificationToken('pending', 'pending@example.com');
  assert.equal(ledger.rollbackEmptyAccount('pending'), true);
  assert.equal(ledger.account('pending'), null);

  const reset = ledger.createRecoveryToken('gary');
  assert.equal(ledger.consumeRecoveryToken(reset), 'gary');
  assert.equal(ledger.restoreRecoveryToken(reset, 'gary'), true);
  assert.equal(ledger.consumeRecoveryToken(reset), 'gary');

  ledger.change({ userId: 'gary', delta: 1, idempotencyKey: 'history:gary:1', game: 'system', action: 'test' });
  assert.throws(() => ledger.rollbackEmptyAccount('gary'), /monetary history/);
  ledger.close();
});

test('database rejects duplicate emails and keeps original account unchanged', () => {
  const { ledger } = fixture();
  ledger.setVerifiedEmail('gary', 'one@example.com');
  assert.throws(() => ledger.setVerifiedEmail('emily', 'one@example.com'), /UNIQUE/);
  assert.equal(ledger.accountByEmail('one@example.com').user_id, 'gary');
  ledger.close();
});
