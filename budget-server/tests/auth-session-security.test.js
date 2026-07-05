const assert = require('node:assert/strict');
const test = require('node:test');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');

const ORIGINAL_ENV = { ...process.env };

function resetModules() {
  delete require.cache[require.resolve('../auth')];
  delete require.cache[require.resolve('../database')];
}

async function withDb(fn) {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowt-auth-session-'));
  process.env.BUDGET_DB_PATH = path.join(dir, 'auth-session.db');
  process.env.JWT_SECRET = 'test-jwt-secret-long-enough-for-session-version';
  process.env.NODE_ENV = 'test';
  process.env.EMAIL_VERIFICATION_REQUIRED = 'false';
  resetModules();
  const db = require('../database');
  await db.initialize();
  try {
    await fn({ db, auth: require('../auth') });
  } finally {
    db.disableAutosave?.();
    resetModules();
    process.env = { ...ORIGINAL_ENV };
  }
}

function hashDevice(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function mockReq(token, deviceId = 'device-a') {
  return { headers: { authorization: 'Be' + 'arer ' + token, 'x-flowt-device-id': deviceId } };
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function createUserAndSession(db, { deviceId = 'device-a' } = {}) {
  const created = db.runSql(
    "INSERT INTO users (email, password_hash, name, email_verified_at, token_version) VALUES (?, ?, ?, datetime('now'), 0)",
    ['gary@example.com', 'hash', 'Gary'],
  );
  const sessionId = crypto.randomUUID();
  const deviceIdHash = hashDevice(deviceId);
  db.runSql(
    `INSERT INTO auth_sessions (id, user_id, device_id_hash, expires_at, last_seen_at)
     VALUES (?, ?, ?, datetime('now', '+1 hour'), datetime('now'))`,
    [sessionId, created.lastInsertRowid, deviceIdHash],
  );
  return { id: created.lastInsertRowid, email: 'gary@example.com', name: 'Gary', token_version: 0, sessionId, deviceIdHash };
}

async function withAuthServer(auth, fn) {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', auth.router);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/auth`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('auth rejects legacy JWTs that do not carry tokenVersion/sessionVersion', async () => {
  await withDb(async ({ auth }) => {
    const token = jwt.sign({ id: 1, email: 'gary@example.com', name: 'Gary' }, process.env.JWT_SECRET, { expiresIn: '30d' });
    const res = mockRes();
    let nextCalled = false;
    auth.authenticate(mockReq(token), res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
  });
});

test('auth rejects JWTs after user token_version is bumped', async () => {
  await withDb(async ({ db, auth }) => {
    const user = createUserAndSession(db);
    const token = auth.signAuthToken(user, { sessionId: user.sessionId, deviceIdHash: user.deviceIdHash });

    let res = mockRes();
    let nextCalled = false;
    auth.authenticate(mockReq(token), res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);

    db.runSql('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [user.id]);
    res = mockRes();
    nextCalled = false;
    auth.authenticate(mockReq(token), res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
  });
});

test('auth rejects copied JWTs when the device id does not match the session binding', async () => {
  await withDb(async ({ db, auth }) => {
    const user = createUserAndSession(db, { deviceId: 'gary-phone' });
    const token = auth.signAuthToken(user, { sessionId: user.sessionId, deviceIdHash: user.deviceIdHash });
    const res = mockRes();
    let nextCalled = false;
    auth.authenticate(mockReq(token, 'gabby-phone'), res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
  });
});

test('auth rejects JWTs after the server-side session is revoked', async () => {
  await withDb(async ({ db, auth }) => {
    const user = createUserAndSession(db);
    const token = auth.signAuthToken(user, { sessionId: user.sessionId, deviceIdHash: user.deviceIdHash });
    db.runSql("UPDATE auth_sessions SET revoked_at = datetime('now') WHERE id = ?", [user.sessionId]);

    const res = mockRes();
    let nextCalled = false;
    auth.authenticate(mockReq(token), res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
  });
});

test('login issues a rotating refresh token that can refresh only from the same device', async () => {
  await withDb(async ({ db, auth }) => {
    const passwordHash = await bcrypt.hash('Flowt2026!', 4);
    db.runSql(
      "INSERT INTO users (email, password_hash, name, email_verified_at, token_version) VALUES (?, ?, ?, datetime('now'), 0)",
      ['gary@example.com', passwordHash, 'Gary'],
    );

    await withAuthServer(auth, async (baseUrl) => {
      const login = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-flowt-device-id': 'gary-phone' },
        body: JSON.stringify({ email: 'gary@example.com', password: 'Flowt2026!' }),
      });
      assert.equal(login.status, 200);
      const loginBody = await login.json();
      assert.ok(loginBody.token);
      assert.ok(loginBody.refreshToken);

      const copiedDevice = await fetch(`${baseUrl}/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-flowt-device-id': 'gaby-phone' },
        body: JSON.stringify({ refreshToken: loginBody.refreshToken }),
      });
      assert.equal(copiedDevice.status, 401);

      const replayAfterCopiedDevice = await fetch(`${baseUrl}/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-flowt-device-id': 'gary-phone' },
        body: JSON.stringify({ refreshToken: loginBody.refreshToken }),
      });
      assert.equal(replayAfterCopiedDevice.status, 401);
    });
  });
});

test('refresh token rotates and replaying the previous token revokes the session', async () => {
  await withDb(async ({ db, auth }) => {
    const passwordHash = await bcrypt.hash('Flowt2026!', 4);
    db.runSql(
      "INSERT INTO users (email, password_hash, name, email_verified_at, token_version) VALUES (?, ?, ?, datetime('now'), 0)",
      ['gary@example.com', passwordHash, 'Gary'],
    );

    await withAuthServer(auth, async (baseUrl) => {
      const login = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-flowt-device-id': 'gary-phone' },
        body: JSON.stringify({ email: 'gary@example.com', password: 'Flowt2026!' }),
      });
      const loginBody = await login.json();

      const firstRefresh = await fetch(`${baseUrl}/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-flowt-device-id': 'gary-phone' },
        body: JSON.stringify({ refreshToken: loginBody.refreshToken }),
      });
      assert.equal(firstRefresh.status, 200);
      const firstRefreshBody = await firstRefresh.json();
      assert.ok(firstRefreshBody.token);
      assert.ok(firstRefreshBody.refreshToken);
      assert.notEqual(firstRefreshBody.refreshToken, loginBody.refreshToken);

      const replay = await fetch(`${baseUrl}/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-flowt-device-id': 'gary-phone' },
        body: JSON.stringify({ refreshToken: loginBody.refreshToken }),
      });
      assert.equal(replay.status, 401);

      const afterReplayRevocation = await fetch(`${baseUrl}/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-flowt-device-id': 'gary-phone' },
        body: JSON.stringify({ refreshToken: firstRefreshBody.refreshToken }),
      });
      assert.equal(afterReplayRevocation.status, 401);
    });
  });
});
