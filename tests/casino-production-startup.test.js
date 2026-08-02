'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const { CasinoLedger } = require('../casino-ledger');

const root = path.resolve(__dirname, '..');
function launch(env) {
  return spawnSync(process.execPath, ['casino-server.js'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10_000,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: '0',
      CASINO_EMAIL_PROVIDER: 'disabled',
      CS2_SYNC_DISABLED: '1',
      CASINO_ALLOWED_ORIGINS: 'https://example.invalid',
      ...env
    }
  });
}

test('production startup fails closed without explicit matching Casino database paths', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'casino-production-startup-'));
  const missing = launch({ CASINO_DATA_DIR: dir, CASINO_DB_PATH: '', CASINO_EXPECTED_DB_PATH: '' });
  assert.notEqual(missing.status, 0);
  assert.match(`${missing.stdout}\n${missing.stderr}`, /requires explicit CASINO_DB_PATH/);

  const dbPath = path.join(dir, 'casino.sqlite');
  const ledger = new CasinoLedger({ dbPath });
  ledger.close();
  const mismatch = launch({ CASINO_DATA_DIR: dir, CASINO_DB_PATH: dbPath, CASINO_EXPECTED_DB_PATH: path.join(dir, 'other.sqlite') });
  assert.notEqual(mismatch.status, 0);
  assert.match(`${mismatch.stdout}\n${mismatch.stderr}`, /database path mismatch/i);
});

test('production startup rejects an unrelated SQLite database even when paths match', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'casino-production-unrelated-'));
  const dbPath = path.join(dir, 'casino.sqlite');
  const db = new Database(dbPath);
  db.exec('CREATE TABLE unrelated(id INTEGER PRIMARY KEY)');
  db.close();
  const result = launch({ CASINO_DATA_DIR: dir, CASINO_DB_PATH: dbPath, CASINO_EXPECTED_DB_PATH: dbPath });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /identity metadata is missing/);
});
