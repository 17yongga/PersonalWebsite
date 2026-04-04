const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { queryOne, queryAll, runSql } = require('./database');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'finsync-secret-key-change-in-production';
const TOKEN_EXPIRY = '30d';
const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

// ── Email transport ────────────────────────────────────────────────────────────
// Set EMAIL_USER + EMAIL_PASS (Gmail App Password) on EC2 via PM2 env or .env
// If not configured, reset tokens are logged to console for local dev/testing.
function createTransport() {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
}

async function sendResetEmail(toEmail, rawToken) {
  const deepLink = `flowt://reset-password?token=${rawToken}`;
  const transport = createTransport();

  if (!transport) {
    // Dev fallback — log token so you can test without email creds
    console.log(`[DEV] Password reset token for ${toEmail}: ${rawToken}`);
    console.log(`[DEV] Deep link: ${deepLink}`);
    return;
  }

  await transport.sendMail({
    from: `"Flowt" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: 'Reset your Flowt password',
    text: [
      'You requested a password reset for your Flowt account.',
      '',
      'Tap the link below on your iPhone to reset your password:',
      deepLink,
      '',
      'This link expires in 1 hour and can only be used once.',
      '',
      'If you did not request this, you can safely ignore this email.',
    ].join('\n'),
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#0f172a">Reset your Flowt password</h2>
        <p style="color:#475569">You requested a password reset for your Flowt account.</p>
        <p style="margin:24px 0">
          <a href="${deepLink}"
             style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
            Reset Password
          </a>
        </p>
        <p style="color:#94a3b8;font-size:13px">
          This link expires in 1 hour and can only be used once.<br>
          If you didn't request this, ignore this email — your password won't change.
        </p>
      </div>
    `,
  });
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
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }

    const existing = queryOne('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = runSql(
      'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
      [email, passwordHash, name]
    );

    const token = jwt.sign(
      { id: result.lastInsertRowid, email, name },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRY }
    );
    res.json({ token, user: { id: result.lastInsertRowid, email, name } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = queryOne('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) return res.status(401).json({ error: 'User not found' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid password' });

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRY }
    );
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
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

    const user = queryOne('SELECT id, email FROM users WHERE email = ?', [email.trim().toLowerCase()]);

    if (user) {
      // Invalidate any existing unused tokens for this user
      runSql(
        'UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0',
        [user.id]
      );

      // Generate a cryptographically secure raw token
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MS).toISOString();

      runSql(
        'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
        [user.id, tokenHash, expiresAt]
      );

      // Fire-and-forget — don't let email errors surface to client
      sendResetEmail(user.email, rawToken).catch(err =>
        console.error('Reset email send error:', err)
      );
    }

    // Always the same response regardless of whether email exists
    res.json({ message: 'If that email is registered, a reset link is on its way.' });
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

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
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

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', authenticate, (req, res) => {
  const user = queryOne(
    'SELECT id, email, name, created_at FROM users WHERE id = ?',
    [req.user.id]
  );
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
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
