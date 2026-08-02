'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

async function waitForServer(url, child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}`);
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('server startup timed out');
}

function cookieFrom(response) {
  return String(response.headers.get('set-cookie') || '').split(';', 1)[0];
}

test('registration remains available without email delivery but does not trust the supplied email', { timeout: 20_000 }, async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neon777-no-email-'));
  const port = 33124;
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['casino-server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      CASINO_EMAIL_PROVIDER: 'disabled',
      CASINO_DATA_DIR: dataDir,
      CS2_SYNC_DISABLED: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk; });
  child.stderr.on('data', chunk => { logs += chunk; });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([
        new Promise(resolve => child.once('exit', resolve)),
        new Promise(resolve => setTimeout(resolve, 2_000))
      ]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  await waitForServer(url, child);
  let response = await fetch(`${url}/api/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'No_Email_Player', email: 'untrusted@example.com', password: 'correct-horse-99' })
  });
  const registration = await response.json();
  assert.equal(response.status, 200, JSON.stringify({ registration, logs }));
  assert.equal(registration.success, true);
  assert.equal(registration.emailVerificationRequired, false);
  assert.equal(registration.emailDeliveryAvailable, false);
  assert.match(registration.message, /account created/i);

  response = await fetch(`${url}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'No_Email_Player', password: 'correct-horse-99' })
  });
  const login = await response.json();
  assert.equal(response.status, 200, JSON.stringify(login));
  assert.match(cookieFrom(response), /^casino_sid=/);
  assert.equal(login.email, null);
  assert.equal(login.emailVerified, false);

  const db = new Database(path.join(dataDir, 'data', 'casino.sqlite'), { readonly: true });
  try {
    assert.deepEqual(db.prepare('SELECT email,email_verified_at FROM accounts WHERE user_id=?').get('No_Email_Player'), {
      email: null,
      email_verified_at: null
    });
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM verification_tokens WHERE user_id=?').get('No_Email_Player').count, 0);
  } finally {
    db.close();
  }

  response = await fetch(`${url}/api/account/password-recovery`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'untrusted@example.com' })
  });
  assert.equal(response.status, 202);
  assert.match((await response.json()).message, /if that verified email exists/i);
});
