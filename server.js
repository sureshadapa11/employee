const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { query, one, ensureSchema, hashPassword, verifyPassword } = require('./lib/db');
const { WEEK_START_DAY, isValidDate, parseTime, shiftMinutes, weekStart, weekEnd } = require('./lib/time');

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

function requireAdmin(req, res, next) {
  const id = readSession(req);
  if (!id) return res.status(401).json({ error: 'Not logged in' });
  req.adminId = id;
  next();
}

const toPence = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw bad('Rate must be a positive number');
  return Math.round(n * 100);
};

// Today's date where the business is, not where the server is.
const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date());

async function getStaff(id) {
  const s = await one('SELECT * FROM staff WHERE id = $1', [Number(id) || 0]);
  if (!s) throw new HttpError(404, 'Staff not found');
  return s;
}

const weekPayment = (staffId, ws) => one('SELECT * FROM payments WHERE staff_id = $1 AND week_start = $2', [staffId, ws]);

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
  return rows.map((r) => ({ ...r, week_end: weekEnd(r.week_start), paid: r.payment_id != null }));
}

// ---- Auth ----
const MAX_FAILURES = 10;
const FAILURE_WINDOW = '15 minutes';

app.post('/api/login', h(async (req, res) => {
  const ip = req.ip || 'unknown';
  const { n } = await one(`SELECT COUNT(*)::int AS n FROM login_failures WHERE ip = $1 AND at > now() - interval '${FAILURE_WINDOW}'`, [ip]);
  if (n >= MAX_FAILURES) throw new HttpError(429, 'Too many failed attempts. Try again in 15 minutes.');

  const { username, password } = req.body || {};
  const admin = await one('SELECT * FROM admin WHERE username = $1', [String(username || '')]);
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

app.use('/api', requireAdmin);

app.get('/api/me', h(async (req) => {
  const a = await one('SELECT username, must_change_password FROM admin WHERE id = $1', [req.adminId]);
  if (!a) throw new HttpError(401, 'Not logged in');
  return { username: a.username, must_change_password: a.must_change_password, currency: CURRENCY, week_start_day: WEEK_START_DAY };
}));

app.post('/api/change-password', h(async (req) => {
  const { current, next } = req.body || {};
  const a = await one('SELECT * FROM admin WHERE id = $1', [req.adminId]);
  if (!verifyPassword(current || '', a.password_hash)) throw bad('Current password is wrong');
  if (!next || String(next).length < 8) throw bad('New password must be at least 8 characters');
  await query('UPDATE admin SET password_hash = $1, must_change_password = FALSE WHERE id = $2', [hashPassword(String(next)), a.id]);
  return { ok: true };
}));

// ---- Staff ----
app.get('/api/staff', h(() => query('SELECT * FROM staff ORDER BY active DESC, name')));

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
  const { staff_id, week_start } = req.query;
  const where = [];
  const args = [];
  if (staff_id) { args.push(Number(staff_id)); where.push(`s.staff_id = $${args.length}`); }
  if (week_start) {
    if (!isValidDate(week_start)) throw bad('Invalid week');
    args.push(weekStart(week_start)); where.push(`s.week_start = $${args.length}`);
  }
  return query(`
    SELECT s.*, st.name, (p.id IS NOT NULL) AS paid
    FROM shifts s JOIN staff st ON st.id = s.staff_id
    LEFT JOIN payments p ON p.staff_id = s.staff_id AND p.week_start = s.week_start
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY s.shift_date DESC, s.start_time DESC LIMIT 500
  `, args);
}));

function validateShift(body) {
  const { shift_date, start_time, end_time, break_minutes = 0, note } = body || {};
  if (!isValidDate(shift_date)) throw bad('Pick a valid date');
  if (parseTime(start_time) === null || parseTime(end_time) === null) throw bad('Times must be HH:MM (24-hour)');
  let minutes;
  try { minutes = shiftMinutes(start_time, end_time, break_minutes); }
  catch (e) { throw bad(e.message); }
  return { shift_date, start_time, end_time, break_minutes: Number(break_minutes) || 0, minutes, note: note || null };
}

app.post('/api/shifts', h(async (req) => {
  const staff = await getStaff(req.body?.staff_id);
  const v = validateShift(req.body);
  const ws = weekStart(v.shift_date);
  await assertWeekUnpaid(staff.id, ws);
  return one(`
    INSERT INTO shifts (staff_id, shift_date, start_time, end_time, break_minutes, minutes, rate_pence, week_start, note)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *
  `, [staff.id, v.shift_date, v.start_time, v.end_time, v.break_minutes, v.minutes, staff.rate_pence, ws, v.note]);
}));

app.put('/api/shifts/:id', h(async (req) => {
  const old = await one('SELECT * FROM shifts WHERE id = $1', [Number(req.params.id) || 0]);
  if (!old) throw new HttpError(404, 'Shift not found');
  await assertWeekUnpaid(old.staff_id, old.week_start);
  const v = validateShift(req.body);
  const ws = weekStart(v.shift_date);
  await assertWeekUnpaid(old.staff_id, ws);
  return one(`
    UPDATE shifts SET shift_date = $1, start_time = $2, end_time = $3, break_minutes = $4, minutes = $5, week_start = $6, note = $7
    WHERE id = $8 RETURNING *
  `, [v.shift_date, v.start_time, v.end_time, v.break_minutes, v.minutes, ws, v.note, old.id]);
}));

app.delete('/api/shifts/:id', h(async (req) => {
  const old = await one('SELECT * FROM shifts WHERE id = $1', [Number(req.params.id) || 0]);
  if (!old) throw new HttpError(404, 'Shift not found');
  await assertWeekUnpaid(old.staff_id, old.week_start);
  await query('DELETE FROM shifts WHERE id = $1', [old.id]);
  return { ok: true };
}));

// ---- Weeks & payments ----
app.get('/api/weeks', h((req) => weeklySummary(req.query.staff_id)));

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
  return one(`
    INSERT INTO payments (staff_id, week_start, minutes, amount_pence, paid_on, method, note)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
  `, [staff.id, ws, week.minutes, week.amount_pence, paidOn, method || null, note || null]);
}));

app.delete('/api/payments/:id', h(async (req) => {
  const rows = await query('DELETE FROM payments WHERE id = $1 RETURNING id', [Number(req.params.id) || 0]);
  if (!rows.length) throw new HttpError(404, 'Payment not found');
  return { ok: true };
}));

app.get('/api/payments', h(async (req) => {
  const { staff_id } = req.query;
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
  const [weeks, staff] = await Promise.all([
    weeklySummary(),
    query('SELECT id, name, rate_pence, active FROM staff ORDER BY name'),
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
  return {
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
