const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizePromoCode,
  generatePromoCode,
  hashPromoCode,
  calculatePromoGrantExpiry,
  buildPromoCodeEmailList,
} = require('../lib/promoCodes');

test('promo codes normalize spaces, hyphens, and lowercase before lookup', () => {
  assert.equal(normalizePromoCode(' flowt-ab12 cd '), 'FLOWTAB12CD');
});

test('promo code hashing never stores the raw shareable code', () => {
  const code = 'FLOWT-ABC123';
  const hash = hashPromoCode(code);
  assert.equal(hash.length, 64);
  assert.notEqual(hash, code);
  assert.equal(hashPromoCode(' flowtabc123 '), hashPromoCode('FLOWT-ABC123'));
});

test('generated promo codes are human-shareable and collision-resistant for a batch', () => {
  const codes = Array.from({ length: 50 }, () => generatePromoCode());
  assert.equal(new Set(codes).size, 50);
  for (const code of codes) {
    assert.match(code, /^FLOWT-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const body = code.replace(/^FLOWT-/, '');
    assert.equal(body.includes('O'), false);
    assert.equal(body.includes('I'), false);
  }
});

test('promo grant gives one free month from now for free users', () => {
  const now = new Date('2026-06-05T12:00:00.000Z');
  assert.equal(
    calculatePromoGrantExpiry({ now, existingExpiresAt: null, durationDays: 31 }),
    '2026-07-06T12:00:00.000Z',
  );
});

test('promo grant stacks from a future existing backend Pro expiry', () => {
  const now = new Date('2026-06-05T12:00:00.000Z');
  assert.equal(
    calculatePromoGrantExpiry({ now, existingExpiresAt: '2026-06-20T12:00:00.000Z', durationDays: 31 }),
    '2026-07-21T12:00:00.000Z',
  );
});

test('promo grant ignores expired backend Pro expiry and starts from now', () => {
  const now = new Date('2026-06-05T12:00:00.000Z');
  assert.equal(
    calculatePromoGrantExpiry({ now, existingExpiresAt: '2026-05-01T12:00:00.000Z', durationDays: 31 }),
    '2026-07-06T12:00:00.000Z',
  );
});

test('email list formats numbered codes without exposing hashes', () => {
  const body = buildPromoCodeEmailList(['FLOWT-ABCD-1234', 'FLOWT-EFGH-5678']);
  assert.match(body, /1\. FLOWT-ABCD-1234/);
  assert.match(body, /2\. FLOWT-EFGH-5678/);
  assert.doesNotMatch(body, /hash/i);
});
