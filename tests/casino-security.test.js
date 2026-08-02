'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const {
  SessionStore,
  constantTimeEqual,
  parseCookies,
  sanitizeText,
  secureRandomInt,
  serializeSessionCookie,
  validateUsername
} = require('../casino-security');
const { AtomicJsonStore, KeyedLock } = require('../casino-persistence');

test('username validation permits only safe stable identifiers', () => {
  assert.equal(validateUsername('Gary_77').valid, true);
  assert.equal(validateUsername('a-b').valid, true);
  for (const value of ['ab', 'a'.repeat(21), '<img onerror=x>', '__proto__', 'name with spaces', 'ééé']) {
    assert.equal(validateUsername(value).valid, false, value);
  }
});

test('sessions expire, verify CSRF, and revoke fail-closed', () => {
  let now = 1000;
  const store = new SessionStore({ ttlMs: 100, now: () => now });
  const created = store.create('Gary_77');
  assert.equal(store.get(created.sessionId).username, 'Gary_77');
  assert.equal(store.verifyCsrf(store.get(created.sessionId), created.csrfToken), true);
  assert.equal(store.verifyCsrf(store.get(created.sessionId), `${created.csrfToken}x`), false);
  now = 1101;
  assert.equal(store.get(created.sessionId), null);
  const next = store.create('Gary_77');
  assert.equal(store.revoke(next.sessionId), true);
  assert.equal(store.get(next.sessionId), null);
});

test('cookie and constant-time helpers handle malformed input safely', () => {
  const parsed = parseCookies('a=1; casino_sid=abc%20123; malformed; b=%E0%A4%A');
  assert.equal(parsed.casino_sid, 'abc 123');
  assert.equal(constantTimeEqual('same', 'same'), true);
  assert.equal(constantTimeEqual('same', 'different'), false);
  const cookie = serializeSessionCookie('abc', { secure: true, ttlMs: 1000 });
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
});

test('text sanitizer removes controls and caps length', () => {
  assert.equal(sanitizeText('  hi\u0000there  ', 7), 'hithere');
  assert.equal(sanitizeText(null), '');
});

test('secureRandomInt validates bounds and stays in range', () => {
  assert.throws(() => secureRandomInt(0), /positive safe integer/);
  for (let i = 0; i < 100; i += 1) {
    const value = secureRandomInt(7);
    assert.ok(value >= 0 && value < 7);
  }
});

test('atomic JSON store serializes concurrent writes and leaves valid JSON', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'casino-store-'));
  const file = path.join(dir, 'data.json');
  const store = new AtomicJsonStore(file);
  await Promise.all(Array.from({ length: 20 }, (_, index) => store.write({ index, values: [index] })));
  await store.flush();
  const data = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(data.index, 19);
  const stat = await fs.stat(file);
  assert.equal(stat.mode & 0o777, 0o600);
});

test('keyed lock serializes one key while allowing recovery after failure', async () => {
  const lock = new KeyedLock();
  const order = [];
  const first = lock.run('gary', async () => {
    order.push('first-start');
    await new Promise(resolve => setTimeout(resolve, 15));
    order.push('first-end');
  });
  const second = lock.run('gary', async () => order.push('second'));
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first-start', 'first-end', 'second']);
  await assert.rejects(lock.run('gary', async () => { throw new Error('expected'); }), /expected/);
  await lock.run('gary', async () => order.push('after-failure'));
  assert.equal(order.at(-1), 'after-failure');
});
