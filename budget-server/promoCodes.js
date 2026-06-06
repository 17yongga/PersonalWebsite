const express = require('express');
const { queryOne, runSql } = require('./database');
const { authenticate } = require('./auth');
const {
  normalizePromoCode,
  hashPromoCode,
  calculatePromoGrantExpiry,
  serializeUserSubscription,
} = require('./lib/promoCodes');

const router = express.Router();

router.post('/redeem', authenticate, (req, res) => {
  try {
    const normalizedCode = normalizePromoCode(req.body?.code);
    if (!normalizedCode) {
      return res.status(400).json({ error: 'Access code is required' });
    }

    const now = new Date();
    const code = queryOne('SELECT * FROM promo_codes WHERE code_hash = ?', [hashPromoCode(normalizedCode)]);
    if (!code || code.active !== 1) {
      return res.status(400).json({ error: 'Invalid or expired access code' });
    }
    if (code.expires_at && new Date(code.expires_at) < now) {
      return res.status(400).json({ error: 'Invalid or expired access code' });
    }
    if (Number(code.redemption_count || 0) >= Number(code.max_redemptions || 1)) {
      return res.status(409).json({ error: 'This access code has already been used' });
    }

    const priorRedemption = queryOne(
      'SELECT id FROM promo_code_redemptions WHERE promo_code_id = ? AND user_id = ?',
      [code.id, req.user.id]
    );
    if (priorRedemption) {
      return res.status(409).json({ error: 'You already redeemed this access code' });
    }

    const user = queryOne('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const grantExpiresAt = calculatePromoGrantExpiry({
      now,
      existingExpiresAt: user.subscription_expires_at,
      durationDays: code.duration_days || 31,
    });

    runSql(
      `UPDATE users
       SET subscription_status = ?, current_entitlement = ?, subscription_expires_at = ?, promo_grant_source = ?
       WHERE id = ?`,
      ['active', 'flowt_pro', grantExpiresAt, `promo_code:${code.id}`, req.user.id]
    );
    runSql(
      'UPDATE promo_codes SET redemption_count = redemption_count + 1 WHERE id = ?',
      [code.id]
    );
    runSql(
      'INSERT INTO promo_code_redemptions (promo_code_id, user_id, redeemed_at, grant_expires_at) VALUES (?, ?, ?, ?)',
      [code.id, req.user.id, now.toISOString(), grantExpiresAt]
    );

    const updatedUser = queryOne('SELECT * FROM users WHERE id = ?', [req.user.id]);
    res.json({
      message: 'Flowt Pro unlocked for one free month.',
      grantExpiresAt,
      user: serializeUserSubscription(updatedUser, now),
    });
  } catch (err) {
    console.error('Promo code redeem error:', err);
    res.status(500).json({ error: 'Failed to redeem access code' });
  }
});

module.exports = router;
