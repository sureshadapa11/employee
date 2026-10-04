const webpush = require('web-push');
const { query } = require('./db');

const PUSH_ENABLED = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (PUSH_ENABLED) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'https://employee-red-tau.vercel.app',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
}

const adminIds = async () => (await query("SELECT id FROM admin WHERE role = 'admin'")).map((r) => r.id);
const staffLoginIds = async (staffId) => (await query("SELECT id FROM admin WHERE role = 'staff' AND staff_id = $1", [staffId])).map((r) => r.id);

// Save a notification for each user and push it to their phones.
// `dedupe` makes repeat calls (e.g. a daily reminder) a no-op for that user.
// Failures are logged, never thrown: a notification must not break the action that caused it.
async function notify(userIds, { kind, title, body = '', link = '', dedupe = null }) {
  try {
    const created = [];
    for (const userId of new Set(userIds)) {
      const rows = await query(
        `INSERT INTO notifications (user_id, kind, title, body, link, dedupe_key)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (user_id, dedupe_key) DO NOTHING RETURNING user_id`,
        [userId, kind, title, body, link, dedupe],
      );
      if (rows.length) created.push(userId);
    }
    if (!PUSH_ENABLED || !created.length) return;
    const subs = await query('SELECT * FROM push_subscriptions WHERE user_id = ANY($1::int[])', [created]);
    const payload = JSON.stringify({ title, body, url: link ? `/#${link}` : '/' });
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 24 });
      } catch (err) {
        // 404/410: the phone unsubscribed or the subscription expired.
        if (err.statusCode === 404 || err.statusCode === 410) await query('DELETE FROM push_subscriptions WHERE id = $1', [s.id]);
        else console.error('push failed', err.statusCode || err.message);
      }
    }));
  } catch (err) {
    console.error('notify failed', err);
  }
}

module.exports = { notify, adminIds, staffLoginIds, PUSH_ENABLED };
