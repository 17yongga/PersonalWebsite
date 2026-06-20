const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildResetPasswordEmail,
  resolveEmailConfig,
  sendResetEmail,
} = require('../lib/transactionalEmail');

test('reset password email includes web fallback and app deep link', () => {
  const token = 'abc 123/+=';
  const email = buildResetPasswordEmail(token, {
    RESET_PASSWORD_WEB_URL: 'https://useflowt.app/reset-password',
  });

  assert.equal(email.subject, 'Reset your Flowt password');
  assert.match(email.text, /https:\/\/useflowt\.app\/reset-password\?token=abc%20123%2F%2B%3D/);
  assert.match(email.text, /flowt:\/\/reset-password\?token=abc%20123%2F%2B%3D/);
  assert.match(email.html, /Reset Password/);
  assert.match(email.html, /This link expires in 1 hour/);
});

test('production defaults to SES with Flowt sender', () => {
  const config = resolveEmailConfig({ NODE_ENV: 'production' });

  assert.equal(config.provider, 'ses');
  assert.equal(config.from, 'Flowt <noreply@useflowt.app>');
  assert.equal(config.region, 'us-east-1');
});

test('SMTP mode requires both username and password', () => {
  assert.throws(
    () => resolveEmailConfig({ EMAIL_PROVIDER: 'smtp', EMAIL_USER: 'user@example.com' }),
    /EMAIL_USER\/EMAIL_PASS/
  );
});

test('SES reset email sends expected message without logging raw token', async () => {
  const sends = [];
  const logs = [];
  const sesClient = {
    send(command) {
      sends.push(command.input);
      return Promise.resolve({ MessageId: 'test-message-id' });
    },
  };

  const result = await sendResetEmail('gary@example.com', 'raw-secret-token', {
    env: {
      NODE_ENV: 'production',
      EMAIL_PROVIDER: 'ses',
      AWS_REGION: 'us-east-1',
      EMAIL_FROM: 'Flowt <noreply@useflowt.app>',
    },
    sesClient,
    logger: { log: (msg) => logs.push(msg) },
  });

  assert.equal(result.provider, 'ses');
  assert.equal(result.messageId, 'test-message-id');
  assert.equal(sends.length, 1);
  assert.equal(sends[0].FromEmailAddress, 'Flowt <noreply@useflowt.app>');
  assert.deepEqual(sends[0].Destination.ToAddresses, ['gary@example.com']);
  assert.match(sends[0].Content.Simple.Body.Text.Data, /raw-secret-token/);
  assert.equal(logs.join('\n').includes('raw-secret-token'), false);
});
