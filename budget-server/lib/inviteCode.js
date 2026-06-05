const crypto = require('crypto');

function generateInviteCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function generateUniqueInviteCode(existingCodes, generator = generateInviteCode, maxAttempts = 10) {
  const existing = existingCodes instanceof Set ? existingCodes : new Set(existingCodes || []);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const code = String(generator()).trim().toUpperCase();
    if (/^[0-9A-F]{6}$/.test(code) && !existing.has(code)) {
      return code;
    }
  }

  throw new Error('Could not generate a unique invite code');
}

module.exports = {
  generateInviteCode,
  generateUniqueInviteCode,
};
