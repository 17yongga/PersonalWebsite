const express = require('express');
const { authenticate } = require('./auth');
const { queryAll, queryOne, runSql } = require('./database');
const { buildAssistantContextFromRows, sanitizeAssistantMessage } = require('./lib/aiContext');
const { callAssistantModel } = require('./lib/aiProvider');
const { isBackendProActive } = require('./lib/promoCodes');

const router = express.Router();

const DEFAULT_FREE_MONTHLY_QUOTA = Number(process.env.FLOWT_AI_FREE_QUOTA || 10);
const DEFAULT_PRO_MONTHLY_QUOTA = Number(process.env.FLOWT_AI_PRO_QUOTA || 100);

function getCurrentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function getUserHousehold({ householdId, userId }) {
  if (householdId) {
    return queryOne(
      `SELECT h.* FROM households h
       JOIN household_members hm ON hm.household_id = h.id
       WHERE h.id = ? AND hm.user_id = ?`,
      [householdId, userId]
    );
  }
  return queryOne(
    `SELECT h.* FROM households h
     JOIN household_members hm ON hm.household_id = h.id
     WHERE hm.user_id = ?
     ORDER BY h.created_at DESC, h.id DESC
     LIMIT 1`,
    [userId]
  );
}

function getAssistantUsageThisMonth({ userId }) {
  const monthPrefix = `${getCurrentMonth()}%`;
  const row = queryOne(
    `SELECT COUNT(*) as count
     FROM activity_log
     WHERE user_id = ? AND action = 'assistant_chat' AND created_at LIKE ?`,
    [userId, monthPrefix]
  );
  return Number(row?.count || 0);
}

function isUserFlowtPro(user) {
  return Boolean(user?.isPro || user?.is_pro || isBackendProActive(user));
}

function getMonthlyQuota({ isPro = false }) {
  return isPro ? DEFAULT_PRO_MONTHLY_QUOTA : DEFAULT_FREE_MONTHLY_QUOTA;
}

function getUserWithSubscription(userId) {
  return queryOne('SELECT * FROM users WHERE id = ?', [userId]);
}

function loadAssistantRows({ householdId, month }) {
  const members = queryAll(
    `SELECT hm.user_id, hm.role, hm.partner_name, u.email, u.name
     FROM household_members hm JOIN users u ON hm.user_id = u.id
     WHERE hm.household_id = ?`,
    [householdId]
  );
  const expenses = queryAll(
    `SELECT e.*, u.name as paid_by_name, u.email as paid_by_email
     FROM expenses e JOIN users u ON e.paid_by = u.id
     WHERE e.household_id = ? AND e.date LIKE ?
     ORDER BY e.date DESC, e.created_at DESC`,
    [householdId, `${month}%`]
  );
  const settlements = queryAll(
    `SELECT s.*, u.name as settled_by_name
     FROM settlements s JOIN users u ON s.settled_by = u.id
     WHERE s.household_id = ?
     ORDER BY s.date DESC, s.created_at DESC`,
    [householdId]
  );
  const budgets = queryAll(
    `SELECT * FROM budgets WHERE household_id = ? AND month = ?`,
    [householdId, month]
  );
  return { members, expenses, settlements, budgets };
}

function buildAssistantUsageDetails({ message, response }) {
  const usage = response?.usage || {};
  return {
    messageLength: Number(message?.length || 0),
    providerStatus: response?.providerStatus || 'unknown',
    model: usage.model || 'unknown',
    estimatedCostCents: Number(usage.estimatedCostCents || 0),
    inputTokens: Number(usage.inputTokens || 0),
    outputTokens: Number(usage.outputTokens || 0),
    transcriptStored: false,
  };
}

function logAssistantUsage({ householdId, userId, message, response }) {
  runSql(
    `INSERT INTO activity_log (household_id, user_id, action, entity_type, entity_id, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      householdId,
      userId,
      'assistant_chat',
      'ai_assistant',
      null,
      JSON.stringify(buildAssistantUsageDetails({ message, response })),
      new Date().toISOString(),
    ]
  );
}

router.post('/chat', authenticate, async (req, res) => {
  try {
    const message = sanitizeAssistantMessage(req.body?.message);
    const month = String(req.body?.month || getCurrentMonth()).slice(0, 7);
    const household = getUserHousehold({ householdId: req.body?.householdId, userId: req.user.id });
    if (!household) return res.status(403).json({ error: 'No household access' });

    // JWT payloads are intentionally compact, so load persisted subscription fields for Pro quota.
    const profile = getUserWithSubscription(req.user.id) || req.user;
    const isPro = isUserFlowtPro(profile);
    const quota = getMonthlyQuota({ isPro });
    const used = getAssistantUsageThisMonth({ userId: req.user.id });
    if (used >= quota) {
      return res.status(429).json({
        error: 'Flowt Assistant monthly limit reached',
        quota: { used, limit: quota, resets: `${getCurrentMonth()}-01` },
      });
    }

    const rows = loadAssistantRows({ householdId: household.id, month });
    const context = buildAssistantContextFromRows({
      userId: req.user.id,
      userName: req.user.name,
      householdId: household.id,
      householdName: household.name,
      month,
      message,
      ...rows,
    });
    const response = await callAssistantModel({ message, context });
    logAssistantUsage({ householdId: household.id, userId: req.user.id, message, response });

    res.json({
      answer: response.answer,
      cards: response.cards || [],
      suggestedPrompts: response.suggestedPrompts || [],
      usage: response.usage || null,
      providerStatus: response.providerStatus,
      quota: { used: used + 1, limit: quota },
      mode: 'read_only',
    });
  } catch (err) {
    if (err?.message === 'Message is required') return res.status(400).json({ error: err.message });
    console.error('Assistant chat error:', err);
    res.status(500).json({ error: 'Flowt Assistant is unavailable right now' });
  }
});

router.buildAssistantUsageDetails = buildAssistantUsageDetails;
router.getMonthlyQuota = getMonthlyQuota;
router.isUserFlowtPro = isUserFlowtPro;
module.exports = router;
