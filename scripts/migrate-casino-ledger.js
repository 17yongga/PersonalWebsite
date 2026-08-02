#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parse: parseLossless } = require('lossless-json');
const { AtomicJsonStore } = require('../casino-persistence');
const { CasinoLedger } = require('../casino-ledger');

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

async function main() {
  const a = args(process.argv.slice(2));
  if (!a.users || !a.db || !a['cs2-output']) {
    throw new Error('Usage: migrate-casino-ledger.js --users FILE --db FILE --cs2-output FILE [--cs2 FILE]');
  }
  const usersPath = path.resolve(a.users);
  const dbPath = path.resolve(a.db);
  const cs2Path = a.cs2 ? path.resolve(a.cs2) : null;
  const cs2Output = path.resolve(a['cs2-output']);
  if (fs.existsSync(dbPath) && !a.resume) throw new Error(`Refusing to overwrite existing database: ${dbPath}`);

  const usersRaw = fs.readFileSync(usersPath, 'utf8');
  const users = JSON.parse(usersRaw);
  if (!users || typeof users !== 'object' || Array.isArray(users)) throw new Error('Invalid users file');
  const exactUsers = parseLossless(usersRaw);
  for (const [userId, user] of Object.entries(users)) {
    const exact = Number(exactUsers[userId].credits.toString());
    const normalized = Math.round(exact * 1000) / 1000;
    if (!Number.isFinite(exact) || Math.abs(exact - normalized) > 1e-7) {
      throw new Error(`Balance for ${userId} has unsupported precision`);
    }
    // Normalize only legacy IEEE-754 residue around an exact milli-credit.
    user.credits = normalized.toString();
  }
  const ledger = new CasinoLedger({ dbPath });
  try {
    ledger.importAccounts(users);
    const balances = ledger.listBalances();
    for (const [userId, user] of Object.entries(users)) {
      if (balances[userId] !== Number(user.credits)) throw new Error(`Balance mismatch while importing ${userId}`);
    }

    let cs2 = { events: {}, bets: {}, lastSettlementCheck: null };
    if (cs2Path && fs.existsSync(cs2Path)) cs2 = JSON.parse(fs.readFileSync(cs2Path, 'utf8'));
    let importedPending = 0;
    for (const bet of Object.values(cs2.bets || {})) {
      if (!bet || bet.status !== 'pending') continue;
      if (!users[bet.userId]) throw new Error(`Pending CS2 bet ${bet.id} references unknown user ${bet.userId}`);
      if (!Number.isSafeInteger(bet.amount) || bet.amount < 1) throw new Error(`Invalid stake on pending CS2 bet ${bet.id}`);
      const escrow = ledger.importActiveEscrow({
        escrowId: bet.escrowId || crypto.randomUUID(), userId: bet.userId, game: 'cs2betting',
        referenceId: bet.id, stake: bet.amount, recoveryPayout: bet.amount,
        metadata: { eventId: bet.eventId, selection: bet.selection, migratedFromJson: true }
      });
      bet.escrowId = escrow.escrowId;
      importedPending += 1;
    }
    await new AtomicJsonStore(cs2Output, { defaultValue: cs2 }).write(cs2);
    if (ledger.integrityCheck() !== 'ok') throw new Error('SQLite integrity check failed after migration');
    console.log(JSON.stringify({ success: true, accounts: Object.keys(balances).length, pendingCs2Escrows: importedPending,
      dbPath, cs2Output, usersSha256: crypto.createHash('sha256').update(fs.readFileSync(usersPath)).digest('hex') }));
  } finally {
    ledger.close();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
