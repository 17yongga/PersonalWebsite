const https = require('https');
const { queryAll, queryOne, runSql } = require('../database');

const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
  in_app_enabled: 1,
  push_enabled: 0,
  email_digest_enabled: 0,
  expense_activity: 1,
  settlement_activity: 1,
  invite_activity: 1,
  budget_alerts: 1,
});

const TYPE_TO_PREFERENCE = Object.freeze({
  expense_added: 'expense_activity',
  expense_updated: 'expense_activity',
  expense_deleted: 'expense_activity',
  settlement_recorded: 'settlement_activity',
  budget_space_invite_sent: 'invite_activity',
  budget_alert: 'budget_alerts',
});

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_PUSH_TOKEN_RE = /^ExponentPushToken\[[^\]]+\]$|^ExpoPushToken\[[^\]]+\]$/;
let pushTransport = defaultExpoPushTransport;

function nowIso() {
  return new Date().toISOString();
}

function normalizeBooleanFlag(value, fallback = 1) {
  if (value === undefined || value === null) return fallback ? 1 : 0;
  if (value === true || value === 1 || value === '1') return 1;
  if (value === false || value === 0 || value === '0') return 0;
  return fallback ? 1 : 0;
}

function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function defaultExpoPushTransport(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return Promise.resolve({ ok: true, skipped: true });
  const payload = JSON.stringify(messages);
  return new Promise((resolve) => {
    const req = https.request(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 5000,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = body ? JSON.parse(body) : null; } catch {}
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode, body: parsed || body });
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('Expo push request timed out'));
    });
    req.on('error', (error) => {
      console.warn('Expo push send failed:', error.message);
      resolve({ ok: false, error: error.message });
    });
    req.write(payload);
    req.end();
  });
}

function setPushTransportForTests(transport) {
  pushTransport = typeof transport === 'function' ? transport : defaultExpoPushTransport;
}

function isExpoPushToken(token) {
  return EXPO_PUSH_TOKEN_RE.test(String(token || '').trim());
}

function getPushTokensForUser(userId) {
  return queryAll(
    `SELECT token, platform, device_name
     FROM notification_push_tokens
     WHERE user_id = ? AND enabled = 1
     ORDER BY datetime(updated_at) DESC, id DESC`,
    [userId],
  ).filter((row) => isExpoPushToken(row.token));
}

function userAllowsPushNotification(userId, type) {
  const prefs = ensureNotificationPreferences(userId);
  if (!Number(prefs.push_enabled)) return false;
  const preferenceColumn = TYPE_TO_PREFERENCE[type];
  if (preferenceColumn && !Number(prefs[preferenceColumn])) return false;
  return true;
}

function buildExpoPushMessage(notification, token) {
  return {
    to: token,
    sound: 'default',
    title: notification.title,
    body: notification.body || '',
    data: {
      notificationId: notification.id,
      householdId: notification.household_id,
      type: notification.type,
      actionUrl: notification.action_url,
      ...(notification.metadata || {}),
    },
    priority: 'high',
  };
}

async function sendPushForNotification(notification) {
  if (!notification?.user_id) return { sent: 0, reason: 'missing_notification' };
  if (!userAllowsPushNotification(notification.user_id, notification.type)) {
    return { sent: 0, reason: 'push_disabled' };
  }
  const tokens = getPushTokensForUser(notification.user_id);
  if (!tokens.length) return { sent: 0, reason: 'no_tokens' };
  const messages = tokens.map((row) => buildExpoPushMessage(notification, row.token));
  const result = await pushTransport(messages);
  return { sent: messages.length, result };
}

function queuePushForNotification(notification) {
  if (!notification) return;
  sendPushForNotification(notification).catch((error) => {
    console.warn('Push notification queue failed:', error.message);
  });
}

function serializeNotification(row) {
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    household_id: row.household_id == null ? null : Number(row.household_id),
    type: row.type,
    title: row.title,
    body: row.body,
    action_url: row.action_url || null,
    metadata: parseMetadata(row.metadata_json),
    read_at: row.read_at || null,
    created_at: row.created_at,
  };
}

function ensureNotificationPreferences(userId) {
  const existing = queryOne('SELECT * FROM notification_preferences WHERE user_id = ?', [userId]);
  if (existing) return existing;
  runSql(
    `INSERT INTO notification_preferences (
      user_id, in_app_enabled, push_enabled, email_digest_enabled,
      expense_activity, settlement_activity, invite_activity, budget_alerts, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      DEFAULT_NOTIFICATION_PREFERENCES.in_app_enabled,
      DEFAULT_NOTIFICATION_PREFERENCES.push_enabled,
      DEFAULT_NOTIFICATION_PREFERENCES.email_digest_enabled,
      DEFAULT_NOTIFICATION_PREFERENCES.expense_activity,
      DEFAULT_NOTIFICATION_PREFERENCES.settlement_activity,
      DEFAULT_NOTIFICATION_PREFERENCES.invite_activity,
      DEFAULT_NOTIFICATION_PREFERENCES.budget_alerts,
      nowIso(),
    ],
  );
  return queryOne('SELECT * FROM notification_preferences WHERE user_id = ?', [userId]);
}

function serializePreferences(row) {
  const prefs = row || DEFAULT_NOTIFICATION_PREFERENCES;
  return {
    inApp: Boolean(Number(prefs.in_app_enabled ?? DEFAULT_NOTIFICATION_PREFERENCES.in_app_enabled)),
    push: Boolean(Number(prefs.push_enabled ?? DEFAULT_NOTIFICATION_PREFERENCES.push_enabled)),
    emailDigest: Boolean(Number(prefs.email_digest_enabled ?? DEFAULT_NOTIFICATION_PREFERENCES.email_digest_enabled)),
    expenseActivity: Boolean(Number(prefs.expense_activity ?? DEFAULT_NOTIFICATION_PREFERENCES.expense_activity)),
    settlementActivity: Boolean(Number(prefs.settlement_activity ?? DEFAULT_NOTIFICATION_PREFERENCES.settlement_activity)),
    inviteActivity: Boolean(Number(prefs.invite_activity ?? DEFAULT_NOTIFICATION_PREFERENCES.invite_activity)),
    budgetAlerts: Boolean(Number(prefs.budget_alerts ?? DEFAULT_NOTIFICATION_PREFERENCES.budget_alerts)),
    updatedAt: prefs.updated_at || null,
  };
}

function updatePreferences(userId, updates = {}) {
  const current = ensureNotificationPreferences(userId);
  const next = {
    in_app_enabled: normalizeBooleanFlag(updates.inApp, current.in_app_enabled),
    push_enabled: normalizeBooleanFlag(updates.push, current.push_enabled),
    email_digest_enabled: normalizeBooleanFlag(updates.emailDigest, current.email_digest_enabled),
    expense_activity: normalizeBooleanFlag(updates.expenseActivity, current.expense_activity),
    settlement_activity: normalizeBooleanFlag(updates.settlementActivity, current.settlement_activity),
    invite_activity: normalizeBooleanFlag(updates.inviteActivity, current.invite_activity),
    budget_alerts: normalizeBooleanFlag(updates.budgetAlerts, current.budget_alerts),
  };
  runSql(
    `UPDATE notification_preferences
     SET in_app_enabled = ?, push_enabled = ?, email_digest_enabled = ?, expense_activity = ?,
         settlement_activity = ?, invite_activity = ?, budget_alerts = ?, updated_at = ?
     WHERE user_id = ?`,
    [
      next.in_app_enabled,
      next.push_enabled,
      next.email_digest_enabled,
      next.expense_activity,
      next.settlement_activity,
      next.invite_activity,
      next.budget_alerts,
      nowIso(),
      userId,
    ],
  );
  return serializePreferences(queryOne('SELECT * FROM notification_preferences WHERE user_id = ?', [userId]));
}

function userAllowsNotification(userId, type) {
  const prefs = ensureNotificationPreferences(userId);
  if (!Number(prefs.in_app_enabled)) return false;
  const preferenceColumn = TYPE_TO_PREFERENCE[type];
  if (preferenceColumn && !Number(prefs[preferenceColumn])) return false;
  return true;
}

function createNotification({ userId, householdId = null, type, title, body, actionUrl = null, metadata = {} }) {
  if (!userId || !type || !title) return null;
  if (!userAllowsNotification(Number(userId), type)) return null;
  const createdAt = nowIso();
  const result = runSql(
    `INSERT INTO notifications (user_id, household_id, type, title, body, action_url, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      Number(userId),
      householdId == null ? null : Number(householdId),
      String(type),
      String(title).slice(0, 160),
      String(body || '').slice(0, 500),
      actionUrl,
      JSON.stringify(metadata || {}),
      createdAt,
    ],
  );
  const notification = serializeNotification(queryOne('SELECT * FROM notifications WHERE id = ?', [result.lastInsertRowid]));
  queuePushForNotification(notification);
  return notification;
}

function listNotifications(userId, { limit = 50, unreadOnly = false } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
  let sql = 'SELECT * FROM notifications WHERE user_id = ?';
  const params = [userId];
  if (unreadOnly) sql += ' AND read_at IS NULL';
  sql += ' ORDER BY datetime(created_at) DESC, id DESC LIMIT ?';
  params.push(safeLimit);
  return queryAll(sql, params).map(serializeNotification);
}

function unreadCount(userId) {
  const row = queryOne('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read_at IS NULL', [userId]);
  return Number(row?.count || 0);
}

function markNotificationRead(userId, notificationId) {
  const existing = queryOne('SELECT * FROM notifications WHERE id = ? AND user_id = ?', [notificationId, userId]);
  if (!existing) return null;
  if (!existing.read_at) {
    runSql('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?', [nowIso(), notificationId, userId]);
  }
  return serializeNotification(queryOne('SELECT * FROM notifications WHERE id = ? AND user_id = ?', [notificationId, userId]));
}

function markAllNotificationsRead(userId) {
  const readAt = nowIso();
  const result = runSql('UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE user_id = ?', [readAt, userId]);
  return { updated: result.changes || 0, readAt };
}

function membersForHousehold(householdId) {
  return queryAll(
    `SELECT hm.user_id, u.name, u.email
     FROM household_members hm
     JOIN users u ON u.id = hm.user_id
     WHERE hm.household_id = ?`,
    [householdId],
  );
}

function notifyHouseholdMembers({ householdId, actorUserId, recipientIds, type, title, body, actionUrl, metadata = {}, includeActor = false }) {
  const members = membersForHousehold(householdId);
  const allowedRecipients = new Set((recipientIds && recipientIds.length ? recipientIds : members.map((m) => m.user_id)).map(Number));
  return members
    .filter((member) => allowedRecipients.has(Number(member.user_id)))
    .filter((member) => includeActor || Number(member.user_id) !== Number(actorUserId))
    .map((member) => createNotification({
      userId: member.user_id,
      householdId,
      type,
      title,
      body,
      actionUrl,
      metadata: { ...metadata, actorUserId },
    }))
    .filter(Boolean);
}

function upsertPushToken({ userId, token, platform = 'unknown', deviceName = null }) {
  const trimmed = String(token || '').trim();
  if (!trimmed) throw new Error('Push token is required');
  if (!isExpoPushToken(trimmed)) throw new Error('Invalid Expo push token');
  runSql(
    `INSERT INTO notification_push_tokens (user_id, token, platform, device_name, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform,
       device_name = excluded.device_name, enabled = 1, updated_at = excluded.updated_at`,
    [userId, trimmed, String(platform || 'unknown'), deviceName, nowIso(), nowIso()],
  );
  ensureNotificationPreferences(userId);
  runSql('UPDATE notification_preferences SET push_enabled = 1, updated_at = ? WHERE user_id = ?', [nowIso(), userId]);
  return { token: trimmed, platform, enabled: true };
}

module.exports = {
  DEFAULT_NOTIFICATION_PREFERENCES,
  buildExpoPushMessage,
  createNotification,
  ensureNotificationPreferences,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notifyHouseholdMembers,
  sendPushForNotification,
  serializePreferences,
  setPushTransportForTests,
  unreadCount,
  updatePreferences,
  upsertPushToken,
};
