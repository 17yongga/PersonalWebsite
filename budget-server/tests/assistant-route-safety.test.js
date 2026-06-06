const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const {
  buildAssistantUsageDetails,
  getMonthlyQuota,
  isUserFlowtPro,
  resolveAssistantMonth,
} = require('../ai');

test('assistant free quota is 10 monthly queries and Pro quota is 100', () => {
  assert.equal(getMonthlyQuota({ isPro: false }), 10);
  assert.equal(getMonthlyQuota({ isPro: true }), 100);
});

test('assistant detects Flowt Pro from persisted user entitlement fields', () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  assert.equal(isUserFlowtPro({ subscription_status: 'active', current_entitlement: 'flowt_pro', subscription_expires_at: future }), true);
  assert.equal(isUserFlowtPro({ subscription_status: 'active', current_entitlement: 'flowt_pro', subscription_expires_at: '2000-01-01T00:00:00.000Z' }), false);
  assert.equal(isUserFlowtPro({ subscription_status: 'free', current_entitlement: 'flowt_pro', subscription_expires_at: future }), false);
});

test('assistant resolves named prior months from the user question instead of blindly using current month', () => {
  assert.equal(resolveAssistantMonth({ message: 'what was my May budget?', requestedMonth: '2026-06', referenceMonth: '2026-06' }), '2026-05');
  assert.equal(resolveAssistantMonth({ message: 'compare April and May', requestedMonth: '2026-06', referenceMonth: '2026-06' }), '2026-05');
  assert.equal(resolveAssistantMonth({ message: 'how am I doing this month?', requestedMonth: '2026-06', referenceMonth: '2026-06' }), '2026-06');
});

test('assistant usage details never bind undefined values into SQL.js params', () => {
  const details = buildAssistantUsageDetails({
    message: 'Explain my balance',
    response: {
      providerStatus: undefined,
      usage: {
        model: undefined,
        estimatedCostCents: undefined,
        inputTokens: undefined,
        outputTokens: undefined,
      },
    },
  });

  assert.equal(details.messageLength, 18);
  assert.equal(details.providerStatus, 'unknown');
  assert.equal(details.model, 'unknown');
  assert.equal(details.estimatedCostCents, 0);
  assert.equal(details.inputTokens, 0);
  assert.equal(details.outputTokens, 0);
  assert.equal(Object.values(details).some((value) => value === undefined), false);
});
