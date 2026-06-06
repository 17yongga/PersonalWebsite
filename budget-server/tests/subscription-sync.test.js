const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeSubscriptionSyncInput } = require('../lib/subscriptionSync');

test('subscription sync accepts active RevenueCat Flowt Pro and normalizes backend fields', () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  assert.deepEqual(normalizeSubscriptionSyncInput({
    source: 'revenuecat',
    entitlementId: 'Flowt Pro',
    subscriptionStatus: 'active',
    currentEntitlement: 'flowt_pro',
    subscriptionExpiresAt: future,
    productIdentifier: 'flowt_pro_monthly',
  }), {
    subscription_status: 'active',
    current_entitlement: 'flowt_pro',
    subscription_expires_at: future,
    promo_grant_source: 'revenuecat:flowt_pro_monthly',
  });
});

test('subscription sync rejects inactive, wrong, or expired entitlement claims', () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  assert.throws(() => normalizeSubscriptionSyncInput({ source: 'revenuecat', subscriptionStatus: 'active', currentEntitlement: 'plus', subscriptionExpiresAt: future }), /Flowt Pro/);
  assert.throws(() => normalizeSubscriptionSyncInput({ source: 'revenuecat', subscriptionStatus: 'inactive', currentEntitlement: 'flowt_pro', subscriptionExpiresAt: future }), /active/);
  assert.throws(() => normalizeSubscriptionSyncInput({ source: 'revenuecat', subscriptionStatus: 'active', currentEntitlement: 'flowt_pro', subscriptionExpiresAt: '2000-01-01T00:00:00.000Z' }), /expired/);
});
