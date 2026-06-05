const test = require('node:test');
const assert = require('node:assert/strict');
const {
  generateInviteCode,
  generateUniqueInviteCode,
} = require('../lib/inviteCode');

test('generates six-character uppercase hex invite codes', () => {
  const code = generateInviteCode();
  assert.match(code, /^[0-9A-F]{6}$/);
});

test('retries invite code generation until it avoids existing codes', () => {
  const existingCodes = new Set(['ABC123', 'DEF456']);
  const attempts = ['ABC123', 'DEF456', '987FED'];

  const code = generateUniqueInviteCode(existingCodes, () => attempts.shift());

  assert.equal(code, '987FED');
  assert.equal(attempts.length, 0);
});

test('throws after repeated invite code collisions instead of looping forever', () => {
  assert.throws(
    () => generateUniqueInviteCode(new Set(['AAAAAA']), () => 'AAAAAA', 3),
    /Could not generate a unique invite code/,
  );
});
