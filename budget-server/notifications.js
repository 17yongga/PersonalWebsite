const express = require('express');
const { authenticate } = require('./auth');
const {
  ensureNotificationPreferences,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  serializePreferences,
  unreadCount,
  updatePreferences,
  upsertPushToken,
} = require('./lib/notifications');

const router = express.Router();

router.get('/', authenticate, (req, res) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const unreadOnly = req.query.unreadOnly === '1' || req.query.unreadOnly === 'true';
    const notifications = listNotifications(req.user.id, { limit, unreadOnly });
    res.json({ notifications, unreadCount: unreadCount(req.user.id) });
  } catch (err) {
    console.error('List notifications error:', err);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

router.get('/unread-count', authenticate, (req, res) => {
  try {
    res.json({ unreadCount: unreadCount(req.user.id) });
  } catch (err) {
    console.error('Notification unread count error:', err);
    res.status(500).json({ error: 'Failed to load notification count' });
  }
});

router.get('/preferences', authenticate, (req, res) => {
  try {
    res.json({ preferences: serializePreferences(ensureNotificationPreferences(req.user.id)) });
  } catch (err) {
    console.error('Notification preferences error:', err);
    res.status(500).json({ error: 'Failed to load notification preferences' });
  }
});

router.put('/preferences', authenticate, (req, res) => {
  try {
    const preferences = updatePreferences(req.user.id, req.body || {});
    res.json({ preferences });
  } catch (err) {
    console.error('Update notification preferences error:', err);
    res.status(500).json({ error: 'Failed to update notification preferences' });
  }
});

router.post('/push-token', authenticate, (req, res) => {
  try {
    const token = upsertPushToken({
      userId: req.user.id,
      token: req.body?.token,
      platform: req.body?.platform,
      deviceName: req.body?.deviceName,
    });
    res.json({ token });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to register push token' });
  }
});

router.post('/read-all', authenticate, (req, res) => {
  try {
    res.json(markAllNotificationsRead(req.user.id));
  } catch (err) {
    console.error('Mark all notifications read error:', err);
    res.status(500).json({ error: 'Failed to mark notifications read' });
  }
});

router.post('/:id/read', authenticate, (req, res) => {
  try {
    const notification = markNotificationRead(req.user.id, Number(req.params.id));
    if (!notification) return res.status(404).json({ error: 'Notification not found' });
    res.json({ notification, unreadCount: unreadCount(req.user.id) });
  } catch (err) {
    console.error('Mark notification read error:', err);
    res.status(500).json({ error: 'Failed to mark notification read' });
  }
});

module.exports = router;
