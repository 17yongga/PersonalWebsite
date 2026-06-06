const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { hashPromoCode } = require('../lib/promoCodes');

async function waitForHealth(baseUrl, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Server did not become healthy');
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const json = await res.json();
  return { res, json };
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowt-promo-test-'));
  const dbPath = path.join(tmpDir, 'promo-test.db');
  const port = 3137 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  process.env.BUDGET_DB_PATH = dbPath;
  const { initialize, runSql } = require('../database');
  await initialize();
  const code = 'FLOWT-TEST-1234';
  runSql(
    'INSERT INTO promo_codes (code_hash, label, duration_days, max_redemptions) VALUES (?, ?, ?, ?)',
    [hashPromoCode(code), 'local smoke', 31, 1],
  );

  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      JWT_SECRET: 'promo-code-local-test-secret-32chars-minimum',
      BUDGET_DB_PATH: dbPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  try {
    await waitForHealth(baseUrl);
    const email = `promo-${Date.now()}@example.com`;
    const register = await requestJson(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      body: JSON.stringify({ email, password: 'password123', name: 'Promo Tester' }),
    });
    assert.equal(register.res.status, 200);
    assert.equal(register.json.user.is_pro, false);

    const redeem = await requestJson(`${baseUrl}/api/promo-codes/redeem`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${register.json.token}` },
      body: JSON.stringify({ code: ' flowt test 1234 ' }),
    });
    assert.equal(redeem.res.status, 200);
    assert.equal(redeem.json.user.is_pro, true);
    assert.equal(redeem.json.user.current_entitlement, 'flowt_pro');
    assert.match(redeem.json.grantExpiresAt, /^\d{4}-\d{2}-\d{2}T/);

    const me = await requestJson(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${register.json.token}` },
    });
    assert.equal(me.res.status, 200);
    assert.equal(me.json.user.is_pro, true);

    const duplicate = await requestJson(`${baseUrl}/api/promo-codes/redeem`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${register.json.token}` },
      body: JSON.stringify({ code }),
    });
    assert.equal(duplicate.res.status, 409);

    console.log(JSON.stringify({ ok: true, dbPath, redeemedUserId: register.json.user.id, grantExpiresAt: redeem.json.grantExpiresAt }, null, 2));
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    if (stderr.trim()) console.error(stderr.trim());
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
