const BACKEND_PRO_ENTITLEMENT = 'flowt_pro';
const REVENUECAT_PRO_ENTITLEMENT = 'Flowt Pro';

function normalizeSubscriptionStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'active' || normalized === 'trialing') return 'active';
  throw new Error('RevenueCat entitlement must be active to sync Flowt Pro.');
}

function normalizeCurrentEntitlement(entitlement, entitlementId) {
  const normalized = String(entitlement || '').trim().toLowerCase();
  const revenueCatId = String(entitlementId || '').trim();
  if (normalized === BACKEND_PRO_ENTITLEMENT || revenueCatId === REVENUECAT_PRO_ENTITLEMENT) {
    return BACKEND_PRO_ENTITLEMENT;
  }
  throw new Error('Flowt Pro entitlement is required.');
}

function normalizeSubscriptionExpiry(expiresAt) {
  if (!expiresAt) throw new Error('Subscription expiry is required.');
  const expiry = new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) throw new Error('Subscription expiry is invalid.');
  if (expiry <= new Date()) throw new Error('Subscription entitlement is expired.');
  return expiry.toISOString();
}

function normalizeGrantSource(source, productIdentifier) {
  const normalizedSource = String(source || '').trim().toLowerCase();
  if (normalizedSource !== 'revenuecat') throw new Error('Only RevenueCat subscription sync is supported.');
  const product = String(productIdentifier || '').trim();
  return product ? `revenuecat:${product}` : 'revenuecat';
}

function normalizeSubscriptionSyncInput(input = {}) {
  const subscription_status = normalizeSubscriptionStatus(input.subscriptionStatus ?? input.subscription_status);
  const current_entitlement = normalizeCurrentEntitlement(
    input.currentEntitlement ?? input.current_entitlement,
    input.entitlementId ?? input.entitlement_id,
  );
  const subscription_expires_at = normalizeSubscriptionExpiry(input.subscriptionExpiresAt ?? input.subscription_expires_at);
  const promo_grant_source = normalizeGrantSource(input.source, input.productIdentifier ?? input.product_identifier);

  return {
    subscription_status,
    current_entitlement,
    subscription_expires_at,
    promo_grant_source,
  };
}

module.exports = {
  BACKEND_PRO_ENTITLEMENT,
  REVENUECAT_PRO_ENTITLEMENT,
  normalizeSubscriptionSyncInput,
};
