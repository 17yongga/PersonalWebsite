const crypto = require('crypto');

const PROMO_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DEFAULT_PROMO_PREFIX = 'FLOWT';
const DEFAULT_PROMO_DURATION_DAYS = 31;

function normalizePromoCode(input) {
  return String(input || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function formatPromoCode(normalized, prefix = DEFAULT_PROMO_PREFIX) {
  const compactPrefix = normalizePromoCode(prefix);
  const body = normalized.startsWith(compactPrefix) ? normalized.slice(compactPrefix.length) : normalized;
  return `${compactPrefix}-${body.slice(0, 4)}-${body.slice(4, 8)}`;
}

function generatePromoCode({ prefix = DEFAULT_PROMO_PREFIX, randomBytes = crypto.randomBytes } = {}) {
  let body = '';
  while (body.length < 8) {
    const bytes = randomBytes(8);
    for (const byte of bytes) {
      body += PROMO_CODE_ALPHABET[byte % PROMO_CODE_ALPHABET.length];
      if (body.length === 8) break;
    }
  }
  return `${normalizePromoCode(prefix)}-${body.slice(0, 4)}-${body.slice(4)}`;
}

function hashPromoCode(code) {
  return crypto.createHash('sha256').update(normalizePromoCode(code)).digest('hex');
}

function addUtcDays(date, days) {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function calculatePromoGrantExpiry({ now = new Date(), existingExpiresAt = null, durationDays = DEFAULT_PROMO_DURATION_DAYS }) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const existingDate = existingExpiresAt ? new Date(existingExpiresAt) : null;
  const base = existingDate && !Number.isNaN(existingDate.getTime()) && existingDate > nowDate
    ? existingDate
    : nowDate;
  return addUtcDays(base, durationDays).toISOString();
}

function isBackendProActive(user, now = new Date()) {
  if (!user) return false;
  const status = user.subscription_status ?? user.subscriptionStatus;
  const entitlement = user.current_entitlement ?? user.currentEntitlement;
  const expiresAt = user.subscription_expires_at ?? user.subscriptionExpiresAt;
  if (!expiresAt) return false;
  const expiry = new Date(expiresAt);
  return !Number.isNaN(expiry.getTime()) && expiry > now && status === 'active' && entitlement === 'flowt_pro';
}

function serializeUserSubscription(user, now = new Date()) {
  const active = isBackendProActive(user, now);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatar_url: user.avatar_url ?? null,
    etransfer_email: user.etransfer_email ?? null,
    eTransferEmail: user.etransfer_email ?? null,
    created_at: user.created_at,
    is_pro: active,
    isPro: active,
    subscription_status: active ? 'active' : (user.subscription_status ?? null),
    subscriptionStatus: active ? 'active' : (user.subscription_status ?? null),
    current_entitlement: active ? 'flowt_pro' : (user.current_entitlement ?? null),
    currentEntitlement: active ? 'flowt_pro' : (user.current_entitlement ?? null),
    subscription_expires_at: user.subscription_expires_at ?? null,
    subscriptionExpiresAt: user.subscription_expires_at ?? null,
  };
}

function buildPromoCodeEmailList(codes) {
  return [
    'Flowt Pro access codes — each unlocks one free month and is intended for one redemption.',
    '',
    ...codes.map((code, index) => `${index + 1}. ${code}`),
    '',
    'Note: these codes become usable after the promo-code backend is deployed and the seed script is run against the target Flowt database.',
  ].join('\n');
}

module.exports = {
  DEFAULT_PROMO_DURATION_DAYS,
  normalizePromoCode,
  formatPromoCode,
  generatePromoCode,
  hashPromoCode,
  calculatePromoGrantExpiry,
  isBackendProActive,
  serializeUserSubscription,
  buildPromoCodeEmailList,
};
