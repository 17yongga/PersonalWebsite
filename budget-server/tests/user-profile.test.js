const test = require('node:test');
const assert = require('node:assert/strict');
const { serializeUserProfileInput } = require('../lib/userProfile');

test('profile input updates editable details but ignores login email', () => {
  const result = serializeUserProfileInput({
    name: ' Gary Yong ',
    email: 'new-login@example.com',
    avatarUrl: ' https://cdn.example.com/gary.jpg ',
    eTransferEmail: ' PAYME@Example.COM ',
  });

  assert.deepEqual(result, {
    name: 'Gary Yong',
    avatar_url: 'https://cdn.example.com/gary.jpg',
    etransfer_email: 'payme@example.com',
  });
  assert.equal(Object.hasOwn(result, 'email'), false);
});

test('profile input rejects invalid e-transfer email', () => {
  assert.throws(
    () => serializeUserProfileInput({ name: 'Gary', eTransferEmail: 'not-an-email' }),
    /valid e-transfer email/,
  );
});

test('profile input allows clearing avatar and e-transfer email', () => {
  const result = serializeUserProfileInput({ name: 'Gary', avatarUrl: '', eTransferEmail: '' });

  assert.equal(result.avatar_url, null);
  assert.equal(result.etransfer_email, null);
});
