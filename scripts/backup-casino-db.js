#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

async function main() {
  const source = path.resolve(process.argv[2] || 'data/casino.sqlite');
  const destination = path.resolve(process.argv[3] || `${source}.backup`);
  if (!fs.existsSync(source)) throw new Error(`Database not found: ${source}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    const result = await db.backup(destination);
    fs.chmodSync(destination, 0o600);
    const check = new Database(destination, { readonly: true, fileMustExist: true });
    try {
      const integrity = check.pragma('integrity_check', { simple: true });
      if (integrity !== 'ok') throw new Error(`Backup integrity check failed: ${integrity}`);
    } finally { check.close(); }
    console.log(JSON.stringify({ success: true, pages: result.totalPages, destination }));
  } finally { db.close(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
