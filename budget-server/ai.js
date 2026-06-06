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

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
const MONTH_ALIASES = new Map(MONTH_NAMES.flatMap((name, index) => [
  [name, index + 1],
  [name.slice(0, 3), index + 1],
]));

function normalizeMonthValue(value, fallback = getCurrentMonth()) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}$/.test(text) ? text : fallback;
}

function resolveAssistantMonth({ message, requestedMonth, referenceMonth = getCurrentMonth() }) {
  const fallbackMonth = normalizeMonthValue(requestedMonth, normalizeMonthValue(referenceMonth));
  const reference = normalizeMonthValue(referenceMonth, fallbackMonth);
  const text = String(message || '').toLowerCase();
  let resolved = fallbackMonth;

  const explicit = text.match(/\b(20\d{2})[-/](0?[1-9]|1[0-2])\b/);
  if (explicit) {
    return `${explicit[1]}-${String(Number(explicit[2])).padStart(2, '0')}`;
  }

  const foundMonths = [];
  for (const [alias, monthNumber] of MONTH_ALIASES.entries()) {
    const re = new RegExp(`\\b${alias}\\b`, 'i');
    if (!re.test(text)) continue;
    const yearNearMonth = text.match(new RegExp(`\\b${alias}\\b[^0-9]{0,12}(20\\d{2})`, 'i'))
      || text.match(new RegExp(`(20\\d{2})[^a-z]{0,12}\\b${alias}\\b`, 'i'));
    const referenceYear = Number(reference.slice(0, 4));
    const referenceMonthNumber = Number(reference.slice(5, 7));
    const year = yearNearMonth ? Number(yearNearMonth[1]) : (monthNumber > referenceMonthNumber ? referenceYear - 1 : referenceYear);
    foundMonths.push(`${year}-${String(monthNumber).padStart(2, '0')}`);
  }
  if (foundMonths.length > 0) {
    resolved = foundMonths.sort().at(-1);
  }
  return resolved;
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
  const monthlyHistory = queryAll(
    `SELECT substr(date, 1, 7) as month,
            ROUND(SUM(amount), 2) as totalSpent,
            ROUND(SUM(CASE WHEN is_shared = 1 THEN amount ELSE 0 END), 2) as sharedSpent,
            COUNT(*) as transactionCount
     FROM expenses
     WHERE household_id = ?
     GROUP BY substr(date, 1, 7)
     ORDER BY month DESC
     LIMIT 12`,
    [householdId]
  );
  const budgetRows = queryAll(
    `SELECT b.month, b.amount, b.budget_type, b.user_id, u.name
     FROM budgets b
     LEFT JOIN users u ON u.id = b.user_id
     WHERE b.household_id = ?
     ORDER BY b.month DESC, b.user_id IS NULL, b.user_id
     LIMIT 120`,
    [householdId]
  );
  const budgetByMonth = new Map();
  for (const row of budgetRows) {
    if (!budgetByMonth.has(row.month)) {
      budgetByMonth.set(row.month, { month: row.month, householdBudget: 0, personalBudgets: [] });
    }
    const item = budgetByMonth.get(row.month);
    if (row.budget_type === 'personal' && row.user_id != null) {
      item.householdBudget = Number((item.householdBudget + Number(row.amount || 0)).toFixed(2));
      item.personalBudgets.push({ userId: Number(row.user_id), name: row.name, amount: Number(row.amount || 0) });
    }
  }
  const budgetHistory = Array.from(budgetByMonth.values()).slice(0, 12);
  return { members, expenses, settlements, budgets, monthlyHistory, budgetHistory };
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
    const month = resolveAssistantMonth({
      message,
      requestedMonth: req.body?.month,
      referenceMonth: getCurrentMonth(),
    });
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
router.resolveAssistantMonth = resolveAssistantMonth;
module.exports = router;
