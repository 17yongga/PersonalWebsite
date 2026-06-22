const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbPath = path.join(os.tmpdir(), `flowt-notifications-${process.pid}.db`);
process.env.BUDGET_DB_PATH = dbPath;

const { initialize, runSql, queryOne } = require('../database');
const {
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
} = require('../lib/notifications');

async function seed() {
  await initialize();
  runSql('DELETE FROM notification_push_tokens');
  runSql('DELETE FROM notifications');
  runSql('DELETE FROM notification_preferences');
  runSql('DELETE FROM household_members');
  runSql('DELETE FROM households');
  runSql('DELETE FROM users');
  runSql("INSERT INTO users (id, email, password_hash, name, email_verified_at) VALUES (1, 'gary@example.com', 'x', 'Gary', datetime('now'))");
  runSql("INSERT INTO users (id, email, password_hash, name, email_verified_at) VALUES (2, 'emily@example.com', 'x', 'Emily', datetime('now'))");
  runSql("INSERT INTO users (id, email, password_hash, name, email_verified_at) VALUES (3, 'ava@example.com', 'x', 'Ava', datetime('now'))");
  runSql("INSERT INTO households (id, name, invite_code, created_by, relationship_type) VALUES (10, 'Trip Space', 'TRIP10', 1, 'group')");
  runSql("INSERT INTO household_members (household_id, user_id, role) VALUES (10, 1, 'owner')");
  runSql("INSERT INTO household_members (household_id, user_id, role) VALUES (10, 2, 'member')");
  runSql("INSERT INTO household_members (household_id, user_id, role) VALUES (10, 3, 'member')");
}

test('notification preferences default on and can be updated', async () => {
  await seed();
  const defaults = serializePreferences(ensureNotificationPreferences(1));
  assert.equal(defaults.inApp, true);
  assert.equal(defaults.expenseActivity, true);
  assert.equal(defaults.push, false);

  const updated = updatePreferences(1, { expenseActivity: false, push: true, emailDigest: true });
  assert.equal(updated.expenseActivity, false);
  assert.equal(updated.push, true);
  assert.equal(updated.emailDigest, true);
});

test('create/list/read notifications respects preferences and unread counts', async () => {
  await seed();
  const created = createNotification({
    userId: 2,
    householdId: 10,
    type: 'expense_added',
    title: 'Shared expense added',
    body: 'Gary added Groceries for $42.00.',
    metadata: { expenseId: 5 },
  });
  assert.equal(created.title, 'Shared expense added');
  assert.equal(created.metadata.expenseId, 5);
  assert.equal(unreadCount(2), 1);

  const read = markNotificationRead(2, created.id);
  assert.ok(read.read_at);
  assert.equal(unreadCount(2), 0);
  assert.equal(listNotifications(2).length, 1);

  updatePreferences(2, { expenseActivity: false });
  const suppressed = createNotification({ userId: 2, householdId: 10, type: 'expense_added', title: 'Muted', body: 'Muted' });
  assert.equal(suppressed, null);
  assert.equal(listNotifications(2).length, 1);
});

test('household notifications fan out to selected members and exclude actor by default', async () => {
  await seed();
  const notifications = notifyHouseholdMembers({
    householdId: 10,
    actorUserId: 1,
    recipientIds: [1, 2, 3],
    type: 'expense_added',
    title: 'Shared expense added',
    body: 'Gary added Dinner for $90.00.',
    metadata: { expenseId: 9 },
  });
  assert.equal(notifications.length, 2);
  assert.equal(unreadCount(1), 0);
  assert.equal(unreadCount(2), 1);
  assert.equal(unreadCount(3), 1);

  const result = markAllNotificationsRead(2);
  assert.equal(result.updated >= 1, true);
  assert.equal(unreadCount(2), 0);
});

test('push tokens are upserted and enable push preference', async () => {
  await seed();
  const token = upsertPushToken({ userId: 1, token: 'ExponentPushToken[test]', platform: 'ios', deviceName: 'iPhone' });
  assert.equal(token.enabled, true);
  const prefs = serializePreferences(ensureNotificationPreferences(1));
  assert.equal(prefs.push, true);
  upsertPushToken({ userId: 2, token: 'ExponentPushToken[test]', platform: 'android', deviceName: 'Pixel' });
  const row = queryOne('SELECT * FROM notification_push_tokens WHERE token = ?', ['ExponentPushToken[test]']);
  assert.equal(Number(row.user_id), 2);
  assert.equal(row.platform, 'android');
});

test('push delivery sends Expo payloads for enabled shared-expense notifications', async () => {
  await seed();
  const sentBatches = [];
  setPushTransportForTests(async (messages) => {
    sentBatches.push(messages);
    return { ok: true, data: [{ status: 'ok' }] };
  });
  try {
    upsertPushToken({ userId: 2, token: 'ExponentPushToken[emily]', platform: 'ios', deviceName: 'Emily iPhone' });
    const notification = createNotification({
      userId: 2,
      householdId: 10,
      type: 'expense_added',
      title: 'Shared expense added',
      body: 'Gary added Dinner for $90.00.',
      actionUrl: 'flowt://notifications',
      metadata: { expenseId: 42 },
    });
    const result = await sendPushForNotification(notification);
    assert.equal(result.sent, 1);
    assert.equal(sentBatches.at(-1)[0].to, 'ExponentPushToken[emily]');
    assert.equal(sentBatches.at(-1)[0].title, 'Shared expense added');
    assert.equal(sentBatches.at(-1)[0].data.expenseId, 42);
    assert.equal(sentBatches.at(-1)[0].channelId, 'flowt-shared-money');
    assert.equal(sentBatches.at(-1)[0].interruptionLevel, 'active');
    assert.equal(sentBatches.at(-1)[0].badge, 1);
  } finally {
    setPushTransportForTests(null);
  }
});

process.on('exit', () => {
  try { fs.unlinkSync(dbPath); } catch {}
});
