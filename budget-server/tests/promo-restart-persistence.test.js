const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const repoDir = path.resolve(__dirname, '..');
const port = 3313;

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'flowt-restart-persist-'));
}

function runNode(script, env) {
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: repoDir,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function waitForHealth(baseUrl, timeoutMs = 10000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(`${baseUrl}/api/health`);
        if (res.status === 200) return resolve();
      } catch (_) {}
      if (Date.now() - start > timeoutMs) return reject(new Error('server did not become healthy'));
      setTimeout(tick, 150);
    };
    tick();
  });
}

function startServer(env) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: repoDir,
    env: { ...process.env, ...env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  return { child, getOutput: () => output };
}

async function stopServer(server) {
  if (server.child.exitCode !== null) return;
  server.child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2000);
    server.child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  if (server.child.exitCode === null) server.child.kill('SIGKILL');
}

test('promo redemption and user pro state persist across server restart', async () => {
  const dir = tempDir();
  const dbPath = path.join(dir, 'flowt-persist.db');
  const env = { BUDGET_DB_PATH: dbPath, JWT_SECRET: 'restart-persistence-test-secret' };

  const code = runNode(`
    (async () => {
      const { initialize, runSql } = require('./database');
      const { generatePromoCode, hashPromoCode } = require('./lib/promoCodes');
      await initialize();
      const code = generatePromoCode({ prefix: 'FLOWT' });
      runSql('INSERT INTO promo_codes (code_hash, label, duration_days, max_redemptions, active) VALUES (?, ?, ?, ?, ?)', [hashPromoCode(code), 'restart persistence test', 31, 1, 1]);
      process.stdout.write(code);
    })().catch((err) => { console.error(err); process.exit(1); });
  `, env);
  assert.equal(fs.existsSync(dbPath), true);

  const baseUrl = `http://127.0.0.1:${port}`;
  let server = startServer(env);
  try {
    await waitForHealth(baseUrl);
    const email = `restart-persist-${Date.now()}@example.com`;
    const password = `Smoke-${Date.now()}-not-printed`;

    const register = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name: 'Restart Persistence Test' }),
    });
    const registerBody = await register.json();
    assert.equal(register.status, 200);
    assert.equal(Boolean(registerBody.token), true);

    const redeem = await fetch(`${baseUrl}/api/promo-codes/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${registerBody.token}` },
      body: JSON.stringify({ code }),
    });
    const redeemBody = await redeem.json();
    assert.equal(redeem.status, 200);
    assert.equal(redeemBody.user.is_pro, true);

    const duplicate = await fetch(`${baseUrl}/api/promo-codes/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${registerBody.token}` },
      body: JSON.stringify({ code }),
    });
    assert.equal(duplicate.status, 409);

    await stopServer(server);
    server = startServer(env);
    await waitForHealth(baseUrl);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const loginBody = await login.json();
    assert.equal(login.status, 200);

    const me = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${loginBody.token}` },
    });
    const meBody = await me.json();
    assert.equal(me.status, 200);
    assert.equal(meBody.user.is_pro, true);
    assert.equal(meBody.user.current_entitlement, 'flowt_pro');
  } finally {
    await stopServer(server);
  }
});
