'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork, spawnSync } = require('node:child_process');
const { CasinoLedger } = require('../casino-ledger');

function temp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'casino-restart-')); }

test('SIGKILL during an uncommitted SQLite write leaves the canonical balance unchanged', async () => {
  const dir = temp();
  const dbPath = path.join(dir, 'casino.sqlite');
  const ledger = new CasinoLedger({ dbPath });
  ledger.importAccounts({ alice: { credits: 1000 } });
  ledger.close();
  const worker = path.join(dir, 'worker.js');
  fs.writeFileSync(worker, `
    const Database=require(${JSON.stringify(require.resolve('better-sqlite3'))});
    const db=new Database(process.argv[2]);
    db.exec('BEGIN IMMEDIATE');
    db.prepare('UPDATE accounts SET balance=1 WHERE user_id=?').run('alice');
    if(process.send) process.send('dirty');
    setInterval(()=>{},1000);
  `);
  const child = fork(worker, [dbPath], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  await new Promise((resolve, reject) => {
    child.once('message', resolve);
    child.once('error', reject);
  });
  child.kill('SIGKILL');
  await new Promise(resolve => child.once('exit', resolve));
  const reopened = new CasinoLedger({ dbPath });
  try {
    assert.equal(reopened.balance('alice'), 1000);
    assert.equal(reopened.integrityCheck(), 'ok');
  } finally { reopened.close(); }
});

test('restart recovery pays persisted poker chip claims but preserves pending CS2 escrows', () => {
  const dir = temp();
  const dbPath = path.join(dir, 'casino.sqlite');
  let ledger = new CasinoLedger({ dbPath });
  ledger.importAccounts({ alice: { credits: 1000 }, bob: { credits: 1000 } });
  const poker = ledger.reserve({ userId: 'alice', stake: 300, game: 'poker', referenceId: 'table-1:alice', idempotencyKey: 'poker:reserve' });
  ledger.updateRecoveryPayouts([{ escrowId: poker.escrow.escrowId, payout: 450 }]);
  ledger.reserve({ userId: 'bob', stake: 200, game: 'cs2betting', referenceId: 'bet-1', idempotencyKey: 'cs2:reserve' });
  ledger.close();
  ledger = new CasinoLedger({ dbPath });
  try {
    const recovered = ledger.recoverActiveEscrows({ preserveGames: ['cs2betting'] });
    assert.equal(recovered.length, 1);
    assert.equal(ledger.balance('alice'), 1150);
    assert.equal(ledger.balance('bob'), 800);
    assert.equal(ledger.activeEscrows().length, 1);
    assert.equal(ledger.activeEscrows()[0].game, 'cs2betting');
  } finally { ledger.close(); }
});

test('migration imports JSON balances and pending CS2 reservation without double-debit', () => {
  const dir = temp();
  const users = path.join(dir, 'users.json');
  const cs2 = path.join(dir, 'cs2.json');
  const db = path.join(dir, 'casino.sqlite');
  const migrated = path.join(dir, 'cs2-migrated.json');
  fs.writeFileSync(users, JSON.stringify({
    alice: { username: 'alice', credits: 750 },
    residue: { username: 'residue', credits: 0.007999999914318323 }
  }));
  fs.writeFileSync(cs2, JSON.stringify({ events: {}, bets: { bet_1: { id: 'bet_1', userId: 'alice', amount: 250, status: 'pending', eventId: 'e1', selection: 'team1' } } }));
  const run = spawnSync(process.execPath, [path.join(__dirname, '../scripts/migrate-casino-ledger.js'), '--users', users, '--cs2', cs2, '--db', db, '--cs2-output', migrated], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const ledger = new CasinoLedger({ dbPath: db });
  try {
    assert.equal(ledger.balance('alice'), 750);
    assert.equal(ledger.balance('residue'), 0.008);
    assert.equal(ledger.activeEscrows().length, 1);
    assert.equal(ledger.activeEscrows()[0].stake, 250);
    assert.ok(JSON.parse(fs.readFileSync(migrated, 'utf8')).bets.bet_1.escrowId);
  } finally { ledger.close(); }
});
