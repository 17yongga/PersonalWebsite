#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { AtomicJsonStore } = require('../casino-persistence');
const { CasinoLedger } = require('../casino-ledger');

function value(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}

async function main() {
  const usersInput = value('users');
  const dbInput = value('db');
  const outputInput = value('output');
  if (!usersInput || !dbInput || !outputInput) throw new Error('Usage: export-ledger-balances.js --users FILE --db FILE --output FILE');
  const usersPath = path.resolve(usersInput);
  const dbPath = path.resolve(dbInput);
  const outputPath = path.resolve(outputInput);
  if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);
  const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
  const ledger = new CasinoLedger({ dbPath });
  try {
    const recovered = ledger.recoverActiveEscrows({ reason: 'rollback_export', preserveGames: ['cs2betting'] });
    const balances = ledger.listBalances();
    for (const [userId, balance] of Object.entries(balances)) {
      if (!users[userId]) throw new Error(`Ledger account missing from users JSON: ${userId}`);
      users[userId].credits = balance;
    }
    await new AtomicJsonStore(outputPath, { defaultValue: users }).write(users);
    console.log(JSON.stringify({ success: true, accounts: Object.keys(balances).length, recoveredRealtimeEscrows: recovered.length, outputPath }));
  } finally {
    ledger.close();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
