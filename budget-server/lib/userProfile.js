function normalizeOptionalString(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

function normalizeEmail(value) {
  const normalized = normalizeOptionalString(value);
  return normalized ? normalized.toLowerCase() : null;
}

function assertValidEmail(value, label) {
  if (!value) return;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error(`Please enter a valid ${label}`);
  }
}

function serializeUserProfileInput(input = {}) {
  const name = normalizeOptionalString(input.name);
  if (!name) throw new Error('Name is required');

  const avatar_url = normalizeOptionalString(input.avatarUrl ?? input.avatar_url);
  const etransfer_email = normalizeEmail(input.eTransferEmail ?? input.etransfer_email);
  assertValidEmail(etransfer_email, 'e-transfer email');

  return {
    name,
    avatar_url,
    etransfer_email,
  };
}

module.exports = {
  serializeUserProfileInput,
};
