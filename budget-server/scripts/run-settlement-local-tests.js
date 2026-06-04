#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'local-secret-at-least-thirty-two-characters';
process.env.PORT = process.env.PORT || '0';

const repoDir = path.resolve(__dirname, '..');
const dbPath = path.join(repoDir, 'finsync.db');
const backupPath = path.join(repoDir, `.finsync.db.integration-backup-${Date.now()}`);
let hadDb = false;
let server;

function backupDb() {
  hadDb = fs.existsSync(dbPath);
  if (hadDb) fs.copyFileSync(dbPath, backupPath);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
}

function restoreDb() {
  try { if (server) server.close(); } catch {}
  try { if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath); } catch {}
  if (hadDb && fs.existsSync(backupPath)) fs.renameSync(backupPath, dbPath);
}

function tokenFor(user) {
  return jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '1h' });
}

async function request(baseUrl, method, path, token, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  return { status: res.status, data };
}

async function main() {
  backupDb();

  const { initialize, runSql, queryOne, queryAll } = require('../database');
  await initialize();

  runSql('INSERT INTO users (id, email, password_hash, name) VALUES (?,?,?,?)', [1, 'gary@example.com', 'x', 'Gary']);
  runSql('INSERT INTO users (id, email, password_hash, name) VALUES (?,?,?,?)', [2, 'emily@example.com', 'x', 'Emily']);
  runSql('INSERT INTO users (id, email, password_hash, name) VALUES (?,?,?,?)', [3, 'outsider@example.com', 'x', 'Outsider']);
  runSql('INSERT INTO households (id, name, invite_code, created_by) VALUES (?,?,?,?)', [1, 'Archie Home Test', 'ABC123', 1]);
  runSql('INSERT INTO household_members (household_id, user_id, role, partner_name) VALUES (?,?,?,?)', [1, 1, 'owner', 'Gary']);
  runSql('INSERT INTO household_members (household_id, user_id, role, partner_name) VALUES (?,?,?,?)', [1, 2, 'member', 'Emily']);
  runSql('INSERT INTO categories (household_id, name) VALUES (?,?)', [1, '🐾 Pet']);
  runSql('INSERT INTO categories (household_id, name) VALUES (?,?)', [1, '📦 Other']);

  // Simulates the current Archie Home period after the latest legacy settlement.
  runSql(`INSERT INTO settlements (id, household_id, settled_by, amount, date, notes) VALUES (?,?,?,?,?,?)`, [1, 1, 1, 209.71, '2026-05-11', 'legacy cutoff']);
  runSql(`INSERT INTO expenses (household_id, amount, category, paid_by, split_type, custom_split, date, notes, is_shared, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)`, [1, 1727.05, '🐾 Pet', 2, '50/50', null, '2026-05-27', 'Emily paid group', 1, 2]);
  runSql(`INSERT INTO expenses (household_id, amount, category, paid_by, split_type, custom_split, date, notes, is_shared, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)`, [1, 845.49, '📦 Other', 1, '50/50', null, '2026-05-28', 'Gary paid group', 1, 1]);
  runSql(`INSERT INTO expenses (household_id, amount, category, paid_by, split_type, custom_split, date, notes, is_shared, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)`, [1, 14.68, '📦 Other', 2, 'custom', 5, '2026-05-13', 'Apple.com/bill custom split', 1, 2]);
  runSql(`INSERT INTO expenses (household_id, amount, category, paid_by, split_type, custom_split, date, notes, is_shared, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)`, [1, 9999, '📦 Other', 1, 'single', null, '2026-05-14', 'personal ignored', 0, 1]);

  const app = express();
  app.use(express.json());
  app.get('/api/health', (_, res) => res.json({ status: 'ok' }));
  app.use('/api/households', require('../households'));
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const garyToken = tokenFor({ id: 1, email: 'gary@example.com', name: 'Gary' });
  const emilyToken = tokenFor({ id: 2, email: 'emily@example.com', name: 'Emily' });
  const outsiderToken = tokenFor({ id: 3, email: 'outsider@example.com', name: 'Outsider' });

  const results = [];
  async function check(name, fn) {
    await fn();
    results.push(name);
  }

  await check('GET /balance requires auth', async () => {
    const res = await request(baseUrl, 'GET', '/api/households/1/balance');
    assert.equal(res.status, 401);
  });

  await check('GET /balance rejects non-members', async () => {
    const res = await request(baseUrl, 'GET', '/api/households/1/balance', outsiderToken);
    assert.equal(res.status, 403);
  });

  await check('GET /balance returns Archie regression result and analytics', async () => {
    const res = await request(baseUrl, 'GET', '/api/households/1/balance', garyToken);
    assert.equal(res.status, 200);
    assert.equal(res.data.legacy_cutoff_date, '2026-05-11');
    assert.equal(res.data.legacy_settlement_count, 1);
    assert.equal(res.data.analytics.shared_count, 3);
    assert.equal(res.data.analytics.personal_count, 1);
    assert.equal(res.data.analytics.shared_total, 2587.22);
    assert.equal(res.data.analytics.personal_total, 9999);
    assert.deepEqual(res.data.balances.map((b) => [b.user_id, b.net]), [[1, -454.73], [2, 454.73]]);
    assert.deepEqual(res.data.suggested_settlements, [{ from_user_id: 1, from_name: 'Gary', to_user_id: 2, to_name: 'Emily', amount: 454.73 }]);
    assert.equal(res.data.analytics.top_shared_categories[0].category, '🐾 Pet');
  });

  await check('POST /settlements rejects missing direction', async () => {
    const res = await request(baseUrl, 'POST', '/api/households/1/settlements', garyToken, { amount: 454.73, date: '2026-06-04' });
    assert.equal(res.status, 400);
    assert.match(res.data.error, /distinct fromUserId and toUserId/);
  });

  await check('POST /settlements rejects reversed direction unless manual adjustment', async () => {
    const res = await request(baseUrl, 'POST', '/api/households/1/settlements', garyToken, {
      amount: 454.73,
      date: '2026-06-04',
      fromUserId: 2,
      toUserId: 1,
    });
    assert.equal(res.status, 400);
    assert.match(res.data.error, /does not match current outstanding balance/);
  });

  await check('POST /settlements rejects over-settlement', async () => {
    const res = await request(baseUrl, 'POST', '/api/households/1/settlements', garyToken, {
      amount: 500,
      date: '2026-06-04',
      fromUserId: 1,
      toUserId: 2,
    });
    assert.equal(res.status, 400);
  });

  await check('POST /settlements accepts valid directional full settlement', async () => {
    const res = await request(baseUrl, 'POST', '/api/households/1/settlements', garyToken, {
      amount: 454.73,
      date: '2026-06-04',
      fromUserId: 1,
      toUserId: 2,
      notes: 'integration test settlement',
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.settlement.amount, 454.73);
    assert.equal(res.data.settlement.from_user_id, 1);
    assert.equal(res.data.settlement.to_user_id, 2);
    assert.equal(res.data.settlement.settlement_type, 'full');
  });

  await check('GET /balance is zero after full settlement', async () => {
    const res = await request(baseUrl, 'GET', '/api/households/1/balance', emilyToken);
    assert.equal(res.status, 200);
    assert.deepEqual(res.data.balances.map((b) => [b.user_id, b.net]), [[1, 0], [2, 0]]);
    assert.deepEqual(res.data.suggested_settlements, []);
  });

  await check('settlement row stores direction and snapshot', async () => {
    const row = queryOne('SELECT * FROM settlements WHERE from_user_id = 1 AND to_user_id = 2 ORDER BY id DESC LIMIT 1');
    assert.equal(row.amount, 454.73);
    assert.equal(row.settlement_type, 'full');
    const snapshot = JSON.parse(row.balance_snapshot_json);
    assert.deepEqual(snapshot.suggested_settlements[0], { from_user_id: 1, from_name: 'Gary', to_user_id: 2, to_name: 'Emily', amount: 454.73 });
  });

  await check('activity log records settlement metadata', async () => {
    const rows = queryAll('SELECT * FROM activity_log WHERE entity_type = ? AND action = ?', ['settlement', 'settled']);
    assert.equal(rows.length, 1);
    const details = JSON.parse(rows[0].details);
    assert.equal(details.fromUserId, 1);
    assert.equal(details.toUserId, 2);
    assert.equal(details.amount, 454.73);
  });

  console.log(JSON.stringify({
    status: 'pass',
    checks: results.length,
    check_names: results,
  }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    restoreDb();
    setTimeout(() => process.exit(process.exitCode || 0), 25);
  });
