const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { queryOne, queryAll, runSql } = require('./database');
const { serializeUserSubscription } = require('./lib/promoCodes');
const { sendResetEmail, sendVerificationEmail } = require('./lib/transactionalEmail');
const { serializeUserProfileInput } = require('./lib/userProfile');
const { normalizeSubscriptionSyncInput } = require('./lib/subscriptionSync');

const router = express.Router();
const DEFAULT_INSECURE_JWT_SECRET = 'finsync-secret-key-change-in-production';
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is required. Refusing to start without explicit auth secret.');
}

if (process.env.NODE_ENV === 'production' && JWT_SECRET === DEFAULT_INSECURE_JWT_SECRET) {
  throw new Error('Refusing to start with default JWT_SECRET in production.');
}

if (process.env.NODE_ENV === 'production' && JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters in production.');
}

const TOKEN_EXPIRY = '30d';
const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const EMAIL_VERIFICATION_TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const BYPASS_EMAIL_VERIFICATION_FOR_TESTS = process.env.NODE_ENV === 'test' && process.env.EMAIL_VERIFICATION_REQUIRED !== 'true';

function createRawToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function issueEmailVerificationToken(userId) {
  runSql('UPDATE email_verification_tokens SET used = 1 WHERE user_id = ? AND used = 0', [userId]);
  const rawToken = createRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_EXPIRY_MS).toISOString();
  runSql(
    'INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
    [userId, tokenHash, expiresAt]
  );
  return rawToken;
}

async function sendVerificationEmailForUser(user) {
  const rawToken = issueEmailVerificationToken(user.id);
  const result = await sendVerificationEmail(user.email, rawToken);
  console.log('Verification email sent', {
    provider: result.provider,
    messageId: result.messageId || null,
  });
  return { ...result, rawToken };
}

// ── Auth middleware (used by protected routes in other files) ──────────────────
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ── POST /api/auth/register ───────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { email, password, name, eTransferEmail, etransfer_email } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const existing = queryOne('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    let profileInput;
    try {
      profileInput = serializeUserProfileInput({
        name,
        eTransferEmail: eTransferEmail ?? etransfer_email ?? normalizedEmail,
      });
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Invalid profile details' });
    }

    const result = runSql(
      "INSERT INTO users (email, password_hash, name, etransfer_email, email_verified_at) VALUES (?, ?, ?, ?, CASE WHEN ? THEN datetime('now') ELSE NULL END)",
      [normalizedEmail, passwordHash, profileInput.name, profileInput.etransfer_email, BYPASS_EMAIL_VERIFICATION_FOR_TESTS ? 1 : 0]
    );

    const createdUser = queryOne('SELECT * FROM users WHERE id = ?', [result.lastInsertRowid]);
    if (BYPASS_EMAIL_VERIFICATION_FOR_TESTS) {
      const token = jwt.sign(
        { id: result.lastInsertRowid, email: normalizedEmail, name: profileInput.name },
        JWT_SECRET,
        { expiresIn: TOKEN_EXPIRY }
      );
      return res.json({ token, user: serializeUserSubscription(createdUser) });
    }
    try {
      const emailResult = await sendVerificationEmailForUser(createdUser);
      return res.json({
        pendingVerification: true,
        email: normalizedEmail,
        message: 'Check your email to verify your Flowt account before signing in.',
        ...(process.env.NODE_ENV !== 'production' && process.env.EMAIL_DEBUG_TOKENS === 'true'
          ? { debugVerificationToken: emailResult.rawToken }
          : {}),
      });
    } catch (emailErr) {
      console.error('Verification email send error:', emailErr.message || emailErr);
      return res.status(502).json({ error: 'Account created, but verification email could not be sent. Please try resending the verification email.' });
    }
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = queryOne('SELECT * FROM users WHERE email = ?', [String(email || '').trim().toLowerCase()]);
    if (!user) return res.status(401).json({ error: 'User not found' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid password' });

    if (!user.email_verified_at) {
      return res.status(403).json({
        error: 'Please verify your email before signing in.',
        code: 'EMAIL_NOT_VERIFIED',
        email: user.email,
      });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRY }
    );
    res.json({ token, user: serializeUserSubscription(user) });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── POST /api/auth/forgot-password ────────────────────────────────────────────
// Always returns 200 — never reveal whether the email exists (prevents enumeration)
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    let debugResetToken = null;

    const user = queryOne('SELECT id, email FROM users WHERE email = ?', [email.trim().toLowerCase()]);

    if (user) {
      // Invalidate any existing unused tokens for this user
      runSql(
        'UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0',
        [user.id]
      );

      // Generate a cryptographically secure raw token
      const rawToken = createRawToken();
      debugResetToken = rawToken;
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MS).toISOString();

      runSql(
        'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
        [user.id, tokenHash, expiresAt]
      );

      // Fire-and-forget — don't let email errors surface to client
      sendResetEmail(user.email, rawToken)
        .then((result) => {
          console.log('Reset email sent', {
            provider: result.provider,
            messageId: result.messageId || null,
          });
        })
        .catch(err =>
          console.error('Reset email send error:', err.message || err)
        );
    }

    // Always the same response regardless of whether email exists
    res.json({
      message: 'If that email is registered, a reset link is on its way.',
      ...(process.env.NODE_ENV !== 'production' && process.env.EMAIL_DEBUG_TOKENS === 'true' && debugResetToken
        ? { debugResetToken }
        : {}),
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Request failed' });
  }
});

// ── POST /api/auth/reset-password ─────────────────────────────────────────────
// Replaces the old insecure version — now requires a valid one-time token
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const tokenHash = hashToken(token);
    const record = queryOne(
      'SELECT * FROM password_reset_tokens WHERE token_hash = ?',
      [tokenHash]
    );

    if (!record) {
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }
    if (record.used) {
      return res.status(400).json({ error: 'This reset link has already been used' });
    }
    if (new Date(record.expires_at) < new Date()) {
      return res.status(400).json({ error: 'This reset link has expired. Please request a new one.' });
    }

    // Mark token as used before updating password (prevents race condition)
    runSql('UPDATE password_reset_tokens SET used = 1 WHERE id = ?', [record.id]);

    const passwordHash = await bcrypt.hash(newPassword, 10);
    runSql('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, record.user_id]);

    res.json({ message: 'Password updated successfully. You can now sign in.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

// ── POST /api/auth/verify-email ───────────────────────────────────────────────
router.post('/verify-email', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Verification token is required' });

    const tokenHash = hashToken(token);
    const record = queryOne(
      'SELECT * FROM email_verification_tokens WHERE token_hash = ?',
      [tokenHash]
    );

    if (!record) return res.status(400).json({ error: 'Invalid or expired verification link' });
    if (record.used) return res.status(400).json({ error: 'This verification link has already been used' });
    if (new Date(record.expires_at) < new Date()) {
      return res.status(400).json({ error: 'This verification link has expired. Please request a new one.' });
    }

    const user = queryOne('SELECT * FROM users WHERE id = ?', [record.user_id]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    runSql('UPDATE email_verification_tokens SET used = 1 WHERE id = ?', [record.id]);
    if (!user.email_verified_at) {
      runSql("UPDATE users SET email_verified_at = datetime('now') WHERE id = ?", [user.id]);
    }

    res.json({ message: 'Email verified. You can now sign in.', email: user.email });
  } catch (err) {
    console.error('Verify email error:', err);
    res.status(500).json({ error: 'Email verification failed' });
  }
});

// ── POST /api/auth/resend-verification ────────────────────────────────────────
// Always returns 200 for well-formed emails to avoid account enumeration.
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) return res.status(400).json({ error: 'Email is required' });

    const user = queryOne('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
    let debugVerificationToken = null;
    if (user && !user.email_verified_at) {
      try {
        const emailResult = await sendVerificationEmailForUser(user);
        debugVerificationToken = emailResult.rawToken;
      } catch (emailErr) {
        console.error('Resend verification email error:', emailErr.message || emailErr);
        return res.status(502).json({ error: 'Verification email could not be sent. Please try again.' });
      }
    }

    res.json({
      message: 'If that email needs verification, a new link is on its way.',
      ...(process.env.NODE_ENV !== 'production' && process.env.EMAIL_DEBUG_TOKENS === 'true' && debugVerificationToken
        ? { debugVerificationToken }
        : {}),
    });
  } catch (err) {
    console.error('Resend verification error:', err);
    res.status(500).json({ error: 'Request failed' });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', authenticate, (req, res) => {
  const user = queryOne(
    'SELECT * FROM users WHERE id = ?',
    [req.user.id]
  );
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: serializeUserSubscription(user) });
});

// ── POST /api/auth/subscription/sync ─────────────────────────────────────────
// Mobile RevenueCat knows immediately when a user has Flowt Pro. Persist the
// entitlement so backend-only features such as Flowt Assistant quota treat the
// same user as Pro on the next request.
router.post('/subscription/sync', authenticate, (req, res) => {
  try {
    const subscription = normalizeSubscriptionSyncInput(req.body);
    runSql(
      `UPDATE users
       SET subscription_status = ?, current_entitlement = ?, subscription_expires_at = ?, promo_grant_source = ?
       WHERE id = ?`,
      [
        subscription.subscription_status,
        subscription.current_entitlement,
        subscription.subscription_expires_at,
        subscription.promo_grant_source,
        req.user.id,
      ]
    );

    const user = queryOne('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: serializeUserSubscription(user) });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Subscription sync failed' });
  }
});

// ── PUT /api/auth/profile ─────────────────────────────────────────────────────
router.put('/profile', authenticate, (req, res) => {
  try {
    let profileInput;
    try {
      profileInput = serializeUserProfileInput(req.body);
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Invalid profile details' });
    }

    runSql(
      'UPDATE users SET name = ?, avatar_url = ?, etransfer_email = ? WHERE id = ?',
      [profileInput.name, profileInput.avatar_url, profileInput.etransfer_email, req.user.id]
    );
    const user = queryOne('SELECT * FROM users WHERE id = ?', [req.user.id]);
    res.json({ user: serializeUserSubscription(user) });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ── DELETE /api/auth/account ──────────────────────────────────────────────────
// Permanently deletes the user account and all associated data.
// Apple Guideline 5.1.1 — account deletion must be available in-app.
//
// Deletion logic per household:
//   - Sole member  → delete entire household + all its data
//   - Shared       → remove user from household_members only; partner keeps data
//                    ownership transfers to next member if user was creator
router.delete('/account', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    // Fetch all households this user belongs to
    const memberships = queryAll(
      `SELECT h.id, h.created_by
       FROM households h
       JOIN household_members hm ON h.id = hm.household_id
       WHERE hm.user_id = ?`,
      [userId]
    );

    for (const household of memberships) {
      const otherMembers = queryAll(
        'SELECT user_id FROM household_members WHERE household_id = ? AND user_id != ?',
        [household.id, userId]
      );

      if (otherMembers.length === 0) {
        // Only member — purge entire household in safe FK order
        runSql('DELETE FROM activity_log WHERE household_id = ?', [household.id]);
        runSql('DELETE FROM settlements WHERE household_id = ?', [household.id]);
        runSql('DELETE FROM budgets WHERE household_id = ?', [household.id]);
        runSql('DELETE FROM expenses WHERE household_id = ?', [household.id]);
        runSql('DELETE FROM categories WHERE household_id = ?', [household.id]);
        runSql('DELETE FROM household_members WHERE household_id = ?', [household.id]);
        runSql('DELETE FROM households WHERE id = ?', [household.id]);
      } else {
        // Shared household — remove this user only, keep all data for partner
        runSql(
          'DELETE FROM household_members WHERE household_id = ? AND user_id = ?',
          [household.id, userId]
        );
        // Transfer ownership if this user was the creator
        if (household.created_by === userId) {
          const newOwner = otherMembers[0].user_id;
          runSql('UPDATE households SET created_by = ? WHERE id = ?', [newOwner, household.id]);
          runSql(
            'UPDATE household_members SET role = ? WHERE household_id = ? AND user_id = ?',
            ['owner', household.id, newOwner]
          );
        }
      }
    }

    // Clean up password reset tokens (CASCADE handles it, but explicit is safer)
    runSql('DELETE FROM password_reset_tokens WHERE user_id = ?', [userId]);

    // Finally delete the user record
    runSql('DELETE FROM users WHERE id = ?', [userId]);

    res.json({ message: 'Account deleted successfully' });
  } catch (err) {
    console.error('Delete account error:', err);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

module.exports = { router, authenticate };
