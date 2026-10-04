const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { query, one, ensureSchema, hashPassword, verifyPassword } = require('./lib/db');
const { notify, adminIds, staffLoginIds, PUSH_ENABLED } = require('./lib/notify');
const { WEEK_START_DAY, payday, dueWeek, addDays, isValidDate, parseTime, shiftMinutes, weekStart, weekEnd } = require('./lib/time');

const app = express();
const PORT = process.env.PORT || 3000;
const CURRENCY = process.env.CURRENCY || '£';
const TIMEZONE = process.env.APP_TIMEZONE || 'Europe/London';
const IS_PROD = !!process.env.VERCEL || process.env.NODE_ENV === 'production';

if (IS_PROD && !process.env.SESSION_SECRET) throw new Error('SESSION_SECRET must be set in production');
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_DAYS = 30;
const COOKIE = 'sid';

app.set('trust proxy', 1);
app.use(express.json());
// On Vercel, files in public/ are served by the CDN; this covers local runs.
app.use(express.static(path.join(__dirname, 'public')));

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);

// Wraps async handlers so thrown errors become JSON responses.
const h = (fn) => async (req, res, next) => {
  try {
    await ensureSchema();
    const out = await fn(req, res);
    if (out !== undefined) res.json(out);
  } catch (err) { next(err); }
};

// ---- Signed-cookie sessions (stateless, so they work across serverless instances) ----
const sign = (data) => crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');

function setSession(res, adminId) {
  const payload = Buffer.from(JSON.stringify({ a: adminId, e: Date.now() + SESSION_DAYS * 864e5 })).toString('base64url');
  res.cookie(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true, sameSite: 'lax', secure: IS_PROD, maxAge: SESSION_DAYS * 864e5, path: '/',
  });
}

function readSession(req) {
  const raw = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(COOKIE + '='));
  if (!raw) return null;
  const [payload, sig] = raw.slice(COOKIE.length + 1).split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const { a, e } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return e > Date.now() ? a : null;
  } catch { return null; }
}

// Looks the login up on every request so a removed login stops working at once.
async function requireUser(req, res, next) {
  try {
    await ensureSchema();
    const id = readSession(req);
    const user = id && await one('SELECT id, username, role, staff_id, must_change_password FROM admin WHERE id = $1', [id]);
    if (!user) return res.status(401).json({ error: 'Not logged in' });
    req.user = user;
    next();
  } catch (err) { next(err); }
}

const requireAdmin = (req, res, next) => (req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Not allowed' }));

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const cleanUsername = (u) => String(u || '').trim().toLowerCase();

const toPence = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw bad('Rate must be a positive number');
  return Math.round(n * 100);
};

// Today's date where the business is, not where the server is.
const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date());

// Short labels for notification text, e.g. "Sat 3 Oct" and "12h 00m".
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDay = (iso) => {
  const d = new Date(iso + 'T00:00:00Z');
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}`;
};
const fmtHours = (mins) => `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
const fmtMoney = (pence) => CURRENCY + (pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shiftText = (s) => `${fmtDay(s.shift_date)} · ${s.start_time}–${s.end_time} · ${fmtHours(s.minutes)}`;

async function getStaff(id) {
  const s = await one('SELECT * FROM staff WHERE id = $1', [Number(id) || 0]);
  if (!s) throw new HttpError(404, 'Staff not found');
  return s;
}

const weekPayment = (staffId, ws) => one('SELECT * FROM payments WHERE staff_id = $1 AND week_start = $2', [staffId, ws]);

// A shift as an absolute time range in minutes, so overnight shifts compare correctly.
function shiftRange(date, start, end) {
  const from = Date.parse(date + 'T00:00:00Z') / 60000 + parseTime(start);
  let span = parseTime(end) - parseTime(start);
  if (span <= 0) span += 1440;
  return [from, from + span];
}

// Refuse a shift that overlaps another shift for the same person (this also stops duplicates).
async function assertNoOverlap(staffId, v, ignoreId = 0) {
  const nearby = await query(
    'SELECT id, shift_date, start_time, end_time FROM shifts WHERE staff_id = $1 AND shift_date BETWEEN $2 AND $3 AND id <> $4',
    [staffId, addDays(v.shift_date, -1), addDays(v.shift_date, 1), ignoreId],
  );
  const [a1, a2] = shiftRange(v.shift_date, v.start_time, v.end_time);
  const clash = nearby.find((o) => {
    const [b1, b2] = shiftRange(o.shift_date, o.start_time, o.end_time);
    return a1 < b2 && b1 < a2;
  });
  if (clash) throw bad(`This overlaps a shift already entered: ${clash.shift_date} ${clash.start_time}–${clash.end_time}`);
}

async function assertWeekUnpaid(staffId, ws) {
  if (await weekPayment(staffId, ws)) {
    throw bad(`Week starting ${ws} is already paid. Undo the payment first to change its hours.`);
  }
}

// Weekly totals for one staff member (or everyone), newest week first.
async function weeklySummary(staffId) {
  const rows = await query(`
    SELECT s.staff_id, st.name, s.week_start,
           COUNT(*)::int AS shift_count,
           SUM(s.minutes)::int AS minutes,
           SUM(ROUND(s.minutes * s.rate_pence / 60.0))::int AS amount_pence,
           p.id AS payment_id, p.amount_pence AS paid_pence, p.paid_on, p.method, p.note AS payment_note
    FROM shifts s
    JOIN staff st ON st.id = s.staff_id
    LEFT JOIN payments p ON p.staff_id = s.staff_id AND p.week_start = s.week_start
    ${staffId ? 'WHERE s.staff_id = $1' : ''}
    GROUP BY s.staff_id, st.name, s.week_start, p.id
    ORDER BY s.week_start DESC, st.name
  `, staffId ? [Number(staffId)] : []);
  return rows.map((r) => ({ ...r, week_end: weekEnd(r.week_start), payday: payday(r.week_start), paid: r.payment_id != null }));
}

// ---- Auth ----
const MAX_FAILURES = 10;
const FAILURE_WINDOW = '15 minutes';

app.post('/api/login', h(async (req, res) => {
  const ip = req.ip || 'unknown';
  const { n } = await one(`SELECT COUNT(*)::int AS n FROM login_failures WHERE ip = $1 AND at > now() - interval '${FAILURE_WINDOW}'`, [ip]);
  if (n >= MAX_FAILURES) throw new HttpError(429, 'Too many failed attempts. Try again in 15 minutes.');

  const { username, password } = req.body || {};
  const admin = await one('SELECT * FROM admin WHERE username = $1', [cleanUsername(username)]);
  if (!admin || !verifyPassword(password || '', admin.password_hash)) {
    await query('INSERT INTO login_failures (ip) VALUES ($1)', [ip]);
    await query("DELETE FROM login_failures WHERE at < now() - interval '1 day'");
    throw new HttpError(401, 'Wrong username or password');
  }
  await query('DELETE FROM login_failures WHERE ip = $1', [ip]);
  setSession(res, admin.id);
  return { username: admin.username };
}));

app.post('/api/logout', (req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

// ---- Daily reminders (Vercel Cron calls this once a day) ----
const MISSING_DAYS = 3;

app.get('/api/cron/daily', h(async (req) => {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    throw new HttpError(401, 'Not allowed');
  }
  const today = localToday();
  const admins = await adminIds();
  const weeks = await weeklySummary();
  const sent = [];

  // Payday: what is due today.
  const dueWs = dueWeek(today);
  if (payday(dueWs) === today) {
    const due = weeks.filter((w) => w.week_start === dueWs && !w.paid);
    if (due.length) {
      const total = due.reduce((t, w) => t + w.amount_pence, 0);
      await notify(admins, {
        kind: 'payday', title: `Pay due today: ${fmtMoney(total)}`,
        body: `${due.length} ${due.length === 1 ? 'person' : 'people'} · week ${fmtDay(dueWs)} – ${fmtDay(weekEnd(dueWs))}`,
        link: 'home', dedupe: `payday:${today}`,
      });
      sent.push('payday');
    }
  }

  // Overdue: unpaid weeks whose payday has passed.
  const overdue = weeks.filter((w) => !w.paid && w.payday < today);
  if (overdue.length) {
    const total = overdue.reduce((t, w) => t + w.amount_pence, 0);
    await notify(admins, {
      kind: 'overdue', title: `Overdue: ${fmtMoney(total)}`,
      body: `${overdue.length} unpaid ${overdue.length === 1 ? 'week' : 'weeks'} past payday`,
      link: 'home', dedupe: `overdue:${today}`,
    });
    sent.push('overdue');
  }

  // Missing hours: active staff with no shift in the last few days (once per gap).
  const lastShifts = await query(`
    SELECT st.id, st.name, MAX(s.shift_date) AS last_date
    FROM staff st LEFT JOIN shifts s ON s.staff_id = st.id
    WHERE st.active = 1 GROUP BY st.id, st.name
  `);
  for (const s of lastShifts) {
    if (!s.last_date || s.last_date >= addDays(today, -MISSING_DAYS)) continue;
    await notify(admins, {
      kind: 'missing', title: `${s.name} hasn't entered hours`,
      body: `Last shift was ${fmtDay(s.last_date)}`, link: 'weeks', dedupe: `missing:${s.id}:${s.last_date}`,
    });
    sent.push(`missing:${s.id}`);
  }
  return { ok: true, today, sent };
}));

// ---- Everyone who is logged in ----
app.use('/api', requireUser);

// ---- Notifications ----
app.get('/api/notifications', h(async (req) => {
  const [items, unread] = await Promise.all([
    query('SELECT id, kind, title, body, link, read_at, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [req.user.id]),
    one('SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [req.user.id]),
  ]);
  return { items, unread: unread.n, push_key: PUSH_ENABLED ? process.env.VAPID_PUBLIC_KEY : null };
}));

app.get('/api/notifications/count', h(async (req) => {
  const { n } = await one('SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
  return { unread: n };
}));

app.post('/api/notifications/read', h(async (req) => {
  await query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
  return { ok: true };
}));

app.post('/api/push/subscribe', h(async (req) => {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) throw bad('Invalid subscription');
  // One phone belongs to whoever subscribed last on it.
  await query(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4)
               ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth = $4`,
    [req.user.id, String(endpoint), String(keys.p256dh), String(keys.auth)]);
  return { ok: true };
}));

app.post('/api/push/unsubscribe', h(async (req) => {
  await query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [String(req.body?.endpoint || ''), req.user.id]);
  return { ok: true };
}));

app.get('/api/me', h(async (req) => {
  const u = req.user;
  const staff = u.staff_id ? await one('SELECT name FROM staff WHERE id = $1', [u.staff_id]) : null;
  return {
    username: u.username, role: u.role, staff_id: u.staff_id, staff_name: staff ? staff.name : null,
    must_change_password: u.must_change_password, currency: CURRENCY, week_start_day: WEEK_START_DAY,
  };
}));

app.post('/api/change-password', h(async (req) => {
  const { current, next } = req.body || {};
  const a = await one('SELECT * FROM admin WHERE id = $1', [req.user.id]);
  if (!verifyPassword(current || '', a.password_hash)) throw bad('Current password is wrong');
  if (!next || String(next).length < 8) throw bad('New password must be at least 8 characters');
  await query('UPDATE admin SET password_hash = $1, must_change_password = FALSE WHERE id = $2', [hashPassword(String(next)), a.id]);
  return { ok: true };
}));

// ---- Adding and changing shifts (admins: anyone's; staff: only their own) ----
function validateShift(body) {
  const { shift_date, start_time, end_time, break_minutes = 0, note } = body || {};
  if (!isValidDate(shift_date)) throw bad('Pick a valid date');
  if (parseTime(start_time) === null || parseTime(end_time) === null) throw bad('Times must be HH:MM (24-hour)');
  let minutes;
  try { minutes = shiftMinutes(start_time, end_time, break_minutes); }
  catch (e) { throw bad(e.message); }
  return { shift_date, start_time, end_time, break_minutes: Number(break_minutes) || 0, minutes, note: note || null };
}

const isStaffLogin = (req) => req.user.role === 'staff';


async function loadOwnShift(req) {
  const shift = await one('SELECT * FROM shifts WHERE id = $1', [Number(req.params.id) || 0]);
  if (!shift || (isStaffLogin(req) && shift.staff_id !== req.user.staff_id)) throw new HttpError(404, 'Shift not found');
  return shift;
}

app.post('/api/shifts', h(async (req) => {
  const staff = await getStaff(isStaffLogin(req) ? req.user.staff_id : req.body?.staff_id);
  if (isStaffLogin(req) && !staff.active) throw new HttpError(403, 'Your staff record is inactive. Ask an admin.');
  const v = validateShift(req.body);
  if (isStaffLogin(req) && await one('SELECT 1 FROM shifts WHERE staff_id = $1 AND shift_date = $2', [staff.id, v.shift_date])) {
    throw bad('You have already submitted hours for this day. To change them, add a message for the admin on that shift.');
  }
  const ws = weekStart(v.shift_date);
  await assertWeekUnpaid(staff.id, ws);
  await assertNoOverlap(staff.id, v);
  const shift = await one(`
    INSERT INTO shifts (staff_id, shift_date, start_time, end_time, break_minutes, minutes, rate_pence, week_start, note, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *
  `, [staff.id, v.shift_date, v.start_time, v.end_time, v.break_minutes, v.minutes, staff.rate_pence, ws, v.note, req.user.id]);
  if (isStaffLogin(req)) {
    await notify(await adminIds(), { kind: 'shift', title: `${staff.name} added hours`, body: shiftText(shift), link: 'weeks' });
  }
  return shift;
}));

const SUBMITTED_LOCKED = "Submitted hours can't be changed. Add a message for the admin instead.";

app.put('/api/shifts/:id', h(async (req) => {
  if (isStaffLogin(req)) throw new HttpError(403, SUBMITTED_LOCKED);
  const old = await loadOwnShift(req);
  await assertWeekUnpaid(old.staff_id, old.week_start);
  const v = validateShift(req.body);
  const ws = weekStart(v.shift_date);
  await assertWeekUnpaid(old.staff_id, ws);
  await assertNoOverlap(old.staff_id, v, old.id);
  const shift = await one(`
    UPDATE shifts SET shift_date = $1, start_time = $2, end_time = $3, break_minutes = $4, minutes = $5, week_start = $6, note = $7,
      staff_note = NULL, staff_note_at = NULL
    WHERE id = $8 RETURNING *
  `, [v.shift_date, v.start_time, v.end_time, v.break_minutes, v.minutes, ws, v.note, old.id]);
  const changed = ['shift_date', 'start_time', 'end_time', 'break_minutes'].some((k) => old[k] !== shift[k]);
  if (changed || old.staff_note) {
    await notify(await staffLoginIds(old.staff_id), {
      kind: 'shift-updated', title: 'Your shift was updated', body: `Now ${shiftText(shift)}`, link: 'weeks',
    });
  }
  return shift;
}));

app.delete('/api/shifts/:id', h(async (req) => {
  if (isStaffLogin(req)) throw new HttpError(403, SUBMITTED_LOCKED);
  const old = await loadOwnShift(req);
  await assertWeekUnpaid(old.staff_id, old.week_start);
  await query('DELETE FROM shifts WHERE id = $1', [old.id]);
  await notify(await staffLoginIds(old.staff_id), {
    kind: 'shift-updated', title: 'A shift was removed', body: shiftText(old), link: 'weeks',
  });
  return { ok: true };
}));

// A message on a shift asking an admin to correct it. Staff set it on their own
// shifts (empty text clears it); an admin can dismiss it, and editing the shift clears it.
app.put('/api/shifts/:id/message', h(async (req) => {
  const shift = await loadOwnShift(req);
  const text = String(req.body?.text || '').trim().slice(0, 500);
  if (!isStaffLogin(req) && text) throw bad('Only staff can leave a message');
  await query('UPDATE shifts SET staff_note = $1, staff_note_at = $2 WHERE id = $3',
    [text || null, text ? new Date().toISOString() : null, shift.id]);
  if (text) {
    const staff = await getStaff(shift.staff_id);
    await notify(await adminIds(), { kind: 'message', title: `Message from ${staff.name}`, body: `${text} (${shiftText(shift)})`, link: 'home' });
  }
  return { ok: true };
}));

// ---- Admins only from here, except these read-only screens, which staff can
// open for their own data (scopedStaffId below forces their own staff id). ----
const STAFF_READABLE = ['/staff', '/shifts', '/weeks', '/payments', '/dashboard'];
app.use('/api', (req, res, next) => (
  isStaffLogin(req) && req.method === 'GET' && STAFF_READABLE.includes(req.path) ? next() : requireAdmin(req, res, next)
));
const scopedStaffId = (req, requested) => (isStaffLogin(req) ? req.user.staff_id : requested);

// ---- Logins ----
app.get('/api/users', h(() => query(`
  SELECT u.id, u.username, u.role, u.staff_id, st.name AS staff_name, u.must_change_password
  FROM admin u LEFT JOIN staff st ON st.id = u.staff_id
  ORDER BY u.role, u.username
`)));

app.post('/api/users', h(async (req) => {
  const { password, role, staff_id } = req.body || {};
  const username = cleanUsername(req.body?.username);
  if (!USERNAME_RE.test(username)) throw bad('Username must be 3–32 characters: letters, numbers, dot, dash or underscore');
  if (!password || String(password).length < 8) throw bad('Password must be at least 8 characters');
  if (!['admin', 'staff'].includes(role)) throw bad('Choose Admin or Staff');
  let staffId = null;
  if (role === 'staff') {
    staffId = (await getStaff(staff_id)).id;
    if (await one("SELECT 1 FROM admin WHERE role = 'staff' AND staff_id = $1", [staffId])) throw bad('That staff member already has a login');
  }
  if (await one('SELECT 1 FROM admin WHERE username = $1', [username])) throw bad('That username is taken');
  return one(`INSERT INTO admin (username, password_hash, role, staff_id) VALUES ($1, $2, $3, $4)
              RETURNING id, username, role, staff_id`, [username, hashPassword(String(password)), role, staffId]);
}));

// Reset a login's password.
app.put('/api/users/:id', h(async (req) => {
  const u = await one('SELECT * FROM admin WHERE id = $1', [Number(req.params.id) || 0]);
  if (!u) throw new HttpError(404, 'Login not found');
  const { password } = req.body || {};
  if (!password || String(password).length < 8) throw bad('Password must be at least 8 characters');
  await query('UPDATE admin SET password_hash = $1, must_change_password = FALSE WHERE id = $2', [hashPassword(String(password)), u.id]);
  return { ok: true };
}));

app.delete('/api/users/:id', h(async (req) => {
  const u = await one('SELECT * FROM admin WHERE id = $1', [Number(req.params.id) || 0]);
  if (!u) throw new HttpError(404, 'Login not found');
  if (u.id === req.user.id) throw bad("You can't remove your own login");
  if (u.role === 'admin') {
    const { n } = await one("SELECT COUNT(*)::int AS n FROM admin WHERE role = 'admin'");
    if (n <= 1) throw bad('There must be at least one admin');
  }
  await query('DELETE FROM admin WHERE id = $1', [u.id]);
  return { ok: true };
}));

// ---- Staff ----
app.get('/api/staff', h((req) => (isStaffLogin(req)
  ? query('SELECT * FROM staff WHERE id = $1', [req.user.staff_id])
  : query('SELECT * FROM staff ORDER BY active DESC, name'))));

app.post('/api/staff', h(async (req) => {
  const { name, phone, rate } = req.body || {};
  if (!name || !String(name).trim()) throw bad('Name is required');
  return one('INSERT INTO staff (name, phone, rate_pence) VALUES ($1, $2, $3) RETURNING *',
    [String(name).trim(), phone || null, toPence(rate)]);
}));

app.put('/api/staff/:id', h(async (req) => {
  const s = await getStaff(req.params.id);
  const { name, phone, rate, active } = req.body || {};
  if (name !== undefined && !String(name).trim()) throw bad('Name is required');
  return one('UPDATE staff SET name = $1, phone = $2, rate_pence = $3, active = $4 WHERE id = $5 RETURNING *', [
    name !== undefined ? String(name).trim() : s.name,
    phone !== undefined ? (phone || null) : s.phone,
    rate !== undefined ? toPence(rate) : s.rate_pence,
    active !== undefined ? (active ? 1 : 0) : s.active,
    s.id,
  ]);
}));

// ---- Shifts ----
app.get('/api/shifts', h(async (req) => {
  const { week_start } = req.query;
  const staff_id = scopedStaffId(req, req.query.staff_id);
  const where = [];
  const args = [];
  if (staff_id) { args.push(Number(staff_id)); where.push(`s.staff_id = $${args.length}`); }
  if (week_start) {
    if (!isValidDate(week_start)) throw bad('Invalid week');
    args.push(weekStart(week_start)); where.push(`s.week_start = $${args.length}`);
  }
  return query(`
    SELECT s.*, st.name, (p.id IS NOT NULL) AS paid, cb.username AS created_by_name, cb.role AS created_by_role
    FROM shifts s JOIN staff st ON st.id = s.staff_id
    LEFT JOIN payments p ON p.staff_id = s.staff_id AND p.week_start = s.week_start
    LEFT JOIN admin cb ON cb.id = s.created_by
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY s.shift_date DESC, s.start_time DESC LIMIT 500
  `, args);
}));

// ---- Weeks & payments ----
app.get('/api/weeks', h((req) => weeklySummary(scopedStaffId(req, req.query.staff_id))));

app.post('/api/payments', h(async (req) => {
  const { staff_id, week_start, paid_on, method, note } = req.body || {};
  const staff = await getStaff(staff_id);
  if (!isValidDate(week_start)) throw bad('Invalid week');
  const ws = weekStart(week_start);
  if (await weekPayment(staff.id, ws)) throw bad(`Week starting ${ws} is already paid`);
  const paidOn = paid_on || localToday();
  if (!isValidDate(paidOn)) throw bad('Invalid payment date');
  const week = (await weeklySummary(staff.id)).find((w) => w.week_start === ws);
  if (!week) throw bad('No hours recorded for that week');
  const payment = await one(`
    INSERT INTO payments (staff_id, week_start, minutes, amount_pence, paid_on, method, note)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
  `, [staff.id, ws, week.minutes, week.amount_pence, paidOn, method || null, note || null]);
    await notify(await staffLoginIds(staff.id), {
    kind: 'paid', title: `You've been paid ${fmtMoney(week.amount_pence)}`, body: `Week ${fmtDay(ws)} – ${fmtDay(weekEnd(ws))} · ${fmtHours(week.minutes)}`, link: 'payments',
  });
  return payment;
}));

app.delete('/api/payments/:id', h(async (req) => {
  const rows = await query('DELETE FROM payments WHERE id = $1 RETURNING id', [Number(req.params.id) || 0]);
  if (!rows.length) throw new HttpError(404, 'Payment not found');
  return { ok: true };
}));

app.get('/api/payments', h(async (req) => {
  const staff_id = scopedStaffId(req, req.query.staff_id);
  const rows = await query(`
    SELECT p.*, st.name FROM payments p JOIN staff st ON st.id = p.staff_id
    ${staff_id ? 'WHERE p.staff_id = $1' : ''}
    ORDER BY p.paid_on DESC, p.id DESC
  `, staff_id ? [Number(staff_id)] : []);
  return rows.map((p) => ({ ...p, week_end: weekEnd(p.week_start) }));
}));

// ?week=YYYY-MM-DD picks the week shown in the per-week figures (defaults to this week).
app.get('/api/dashboard', h(async (req) => {
  const currentWeek = weekStart(localToday());
  if (req.query.week && !isValidDate(req.query.week)) throw bad('Invalid week');
  const thisWeek = req.query.week ? weekStart(req.query.week) : currentWeek;
  const own = scopedStaffId(req, null);
  const [weeks, staff, messages] = await Promise.all([
    weeklySummary(own),
    own
      ? query('SELECT id, name, rate_pence, active FROM staff WHERE id = $1', [own])
      : query('SELECT id, name, rate_pence, active FROM staff ORDER BY name'),
    own ? [] : query(`SELECT s.*, st.name FROM shifts s JOIN staff st ON st.id = s.staff_id
           WHERE s.staff_note IS NOT NULL ORDER BY s.staff_note_at`),
  ]);
  const perStaff = staff.map((s) => {
    const mine = weeks.filter((w) => w.staff_id === s.id);
    const sum = (arr, k) => arr.reduce((t, w) => t + (w[k] || 0), 0);
    const unpaid = mine.filter((w) => !w.paid);
    const current = mine.find((w) => w.week_start === thisWeek);
    return {
      ...s,
      total_minutes: sum(mine, 'minutes'),
      paid_pence: sum(mine.filter((w) => w.paid), 'paid_pence'),
      unpaid_pence: sum(unpaid, 'amount_pence'),
      unpaid_weeks: unpaid.length,
      this_week_minutes: current ? current.minutes : 0,
      this_week_pence: current ? current.amount_pence : 0,
      this_week_paid: current ? current.paid : null,
    };
  });
  const total = (k) => perStaff.reduce((t, s) => t + s[k], 0);

  // Payday view: the week paid on the next payday, the payday before it, and
  // anything still unpaid whose payday has already passed.
  const today = localToday();
  const dueWs = dueWeek(today);
  const lastWs = addDays(dueWs, -7);
  const weekRows = (ws) => weeks.filter((w) => w.week_start === ws).map((w) => ({
    staff_id: w.staff_id, name: w.name, week_start: w.week_start, minutes: w.minutes,
    amount_pence: w.paid ? w.paid_pence : w.amount_pence, paid: w.paid, paid_on: w.paid_on,
  }));
  const summarise = (ws) => {
    const rows = weekRows(ws);
    const sum = (arr, k) => arr.reduce((t, r) => t + r[k], 0);
    return {
      week_start: ws, week_end: weekEnd(ws), payday: payday(ws),
      minutes: sum(rows, 'minutes'), amount_pence: sum(rows, 'amount_pence'),
      paid_pence: sum(rows.filter((r) => r.paid), 'amount_pence'),
      unpaid_pence: sum(rows.filter((r) => !r.paid), 'amount_pence'),
      staff: rows,
    };
  };
  const due = { ...summarise(dueWs), is_today: payday(dueWs) === today };
  const overdue = weeks
    .filter((w) => !w.paid && w.payday < today && w.week_start !== dueWs)
    .map((w) => ({ staff_id: w.staff_id, name: w.name, week_start: w.week_start, week_end: w.week_end, payday: w.payday, minutes: w.minutes, amount_pence: w.amount_pence }));
  const unpaidWeeks = weeks.filter((w) => !w.paid);
  const sumAmt = (arr) => arr.reduce((t, w) => t + w.amount_pence, 0);

  return {
    today,
    messages,
    due,
    last_payday: summarise(lastWs),
    overdue,
    owed: {
      due_now_pence: sumAmt(unpaidWeeks.filter((w) => w.payday <= today)),
      upcoming_pence: sumAmt(unpaidWeeks.filter((w) => w.payday > today)),
    },
    week_start: thisWeek,
    week_end: weekEnd(thisWeek),
    current_week_start: currentWeek,
    totals: {
      total_minutes: total('total_minutes'),
      paid_pence: total('paid_pence'),
      unpaid_pence: total('unpaid_pence'),
      this_week_minutes: total('this_week_minutes'),
      this_week_pence: total('this_week_pence'),
    },
    staff: perStaff,
  };
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Server error' : err.message });
});

// Vercel imports the app; locally we start a server.
if (require.main === module) {
  app.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));
}

module.exports = app;
