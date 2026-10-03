const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const { db, hashPassword, verifyPassword } = require('./lib/db');
const { isValidDate, parseTime, shiftMinutes, weekStart, weekEnd } = require('./lib/time');

const app = express();
const PORT = process.env.PORT || 3000;
const CURRENCY = process.env.CURRENCY || '£';

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 12 },
}));
app.use(express.static(path.join(__dirname, 'public')));

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);

// Wraps handlers so thrown errors become JSON responses.
const h = (fn) => (req, res, next) => {
  try { const out = fn(req, res); if (out !== undefined) res.json(out); }
  catch (err) { next(err); }
};

function requireAdmin(req, res, next) {
  if (req.session.adminId) return next();
  res.status(401).json({ error: 'Not logged in' });
}

const toPence = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw bad('Rate must be a positive number');
  return Math.round(n * 100);
};

function getStaff(id) {
  const s = db.prepare('SELECT * FROM staff WHERE id = ?').get(Number(id));
  if (!s) throw new HttpError(404, 'Staff not found');
  return s;
}

function weekPayment(staffId, ws) {
  return db.prepare('SELECT * FROM payments WHERE staff_id = ? AND week_start = ?').get(staffId, ws);
}

function assertWeekUnpaid(staffId, ws) {
  if (weekPayment(staffId, ws)) {
    throw bad(`Week starting ${ws} is already paid. Undo the payment first to change its hours.`);
  }
}

// Weekly totals for one staff member (or everyone), newest week first.
function weeklySummary(staffId) {
  const rows = db.prepare(`
    SELECT s.staff_id, st.name, s.week_start,
           COUNT(*) AS shift_count,
           SUM(s.minutes) AS minutes,
           CAST(SUM(ROUND(s.minutes * s.rate_pence / 60.0)) AS INTEGER) AS amount_pence,
           p.id AS payment_id, p.amount_pence AS paid_pence, p.paid_on, p.method, p.note AS payment_note
    FROM shifts s
    JOIN staff st ON st.id = s.staff_id
    LEFT JOIN payments p ON p.staff_id = s.staff_id AND p.week_start = s.week_start
    ${staffId ? 'WHERE s.staff_id = ?' : ''}
    GROUP BY s.staff_id, s.week_start
    ORDER BY s.week_start DESC, st.name
  `).all(...(staffId ? [Number(staffId)] : []));
  return rows.map((r) => ({
    ...r,
    week_end: weekEnd(r.week_start),
    paid: r.payment_id != null,
  }));
}

// ---- Auth ----
app.post('/api/login', h((req) => {
  const { username, password } = req.body || {};
  const admin = db.prepare('SELECT * FROM admin WHERE username = ?').get(String(username || ''));
  if (!admin || !verifyPassword(password || '', admin.password_hash)) {
    throw new HttpError(401, 'Wrong username or password');
  }
  req.session.adminId = admin.id;
  return { username: admin.username };
}));

app.post('/api/logout', h((req) => { req.session.destroy(() => {}); return { ok: true }; }));

app.get('/api/me', requireAdmin, h((req) => {
  const a = db.prepare('SELECT username FROM admin WHERE id = ?').get(req.session.adminId);
  return { username: a.username, currency: CURRENCY };
}));

app.post('/api/change-password', requireAdmin, h((req) => {
  const { current, next } = req.body || {};
  const a = db.prepare('SELECT * FROM admin WHERE id = ?').get(req.session.adminId);
  if (!verifyPassword(current || '', a.password_hash)) throw bad('Current password is wrong');
  if (!next || String(next).length < 6) throw bad('New password must be at least 6 characters');
  db.prepare('UPDATE admin SET password_hash = ? WHERE id = ?').run(hashPassword(String(next)), a.id);
  return { ok: true };
}));

app.use('/api', requireAdmin);

// ---- Staff ----
app.get('/api/staff', h(() => db.prepare('SELECT * FROM staff ORDER BY active DESC, name').all()));

app.post('/api/staff', h((req) => {
  const { name, phone, rate } = req.body || {};
  if (!name || !String(name).trim()) throw bad('Name is required');
  const r = db.prepare('INSERT INTO staff (name, phone, rate_pence) VALUES (?, ?, ?)')
    .run(String(name).trim(), phone || null, toPence(rate));
  return getStaff(r.lastInsertRowid);
}));

app.put('/api/staff/:id', h((req) => {
  const s = getStaff(req.params.id);
  const { name, phone, rate, active } = req.body || {};
  if (name !== undefined && !String(name).trim()) throw bad('Name is required');
  db.prepare('UPDATE staff SET name = ?, phone = ?, rate_pence = ?, active = ? WHERE id = ?').run(
    name !== undefined ? String(name).trim() : s.name,
    phone !== undefined ? (phone || null) : s.phone,
    rate !== undefined ? toPence(rate) : s.rate_pence,
    active !== undefined ? (active ? 1 : 0) : s.active,
    s.id,
  );
  return getStaff(s.id);
}));

// ---- Shifts ----
app.get('/api/shifts', h((req) => {
  const { staff_id, week_start } = req.query;
  const where = [];
  const args = [];
  if (staff_id) { where.push('s.staff_id = ?'); args.push(Number(staff_id)); }
  if (week_start) {
    if (!isValidDate(week_start)) throw bad('Invalid week');
    where.push('s.week_start = ?'); args.push(weekStart(week_start));
  }
  return db.prepare(`
    SELECT s.*, st.name, (p.id IS NOT NULL) AS paid
    FROM shifts s JOIN staff st ON st.id = s.staff_id
    LEFT JOIN payments p ON p.staff_id = s.staff_id AND p.week_start = s.week_start
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY s.shift_date DESC, s.start_time DESC LIMIT 500
  `).all(...args);
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

app.post('/api/shifts', h((req) => {
  const staff = getStaff(req.body?.staff_id);
  const v = validateShift(req.body);
  const ws = weekStart(v.shift_date);
  assertWeekUnpaid(staff.id, ws);
  const r = db.prepare(`
    INSERT INTO shifts (staff_id, shift_date, start_time, end_time, break_minutes, minutes, rate_pence, week_start, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(staff.id, v.shift_date, v.start_time, v.end_time, v.break_minutes, v.minutes, staff.rate_pence, ws, v.note);
  return db.prepare('SELECT * FROM shifts WHERE id = ?').get(r.lastInsertRowid);
}));

app.put('/api/shifts/:id', h((req) => {
  const old = db.prepare('SELECT * FROM shifts WHERE id = ?').get(Number(req.params.id));
  if (!old) throw new HttpError(404, 'Shift not found');
  assertWeekUnpaid(old.staff_id, old.week_start);
  const v = validateShift(req.body);
  const ws = weekStart(v.shift_date);
  assertWeekUnpaid(old.staff_id, ws);
  db.prepare(`
    UPDATE shifts SET shift_date = ?, start_time = ?, end_time = ?, break_minutes = ?, minutes = ?, week_start = ?, note = ?
    WHERE id = ?
  `).run(v.shift_date, v.start_time, v.end_time, v.break_minutes, v.minutes, ws, v.note, old.id);
  return db.prepare('SELECT * FROM shifts WHERE id = ?').get(old.id);
}));

app.delete('/api/shifts/:id', h((req) => {
  const old = db.prepare('SELECT * FROM shifts WHERE id = ?').get(Number(req.params.id));
  if (!old) throw new HttpError(404, 'Shift not found');
  assertWeekUnpaid(old.staff_id, old.week_start);
  db.prepare('DELETE FROM shifts WHERE id = ?').run(old.id);
  return { ok: true };
}));

// ---- Weeks & payments ----
app.get('/api/weeks', h((req) => weeklySummary(req.query.staff_id)));

app.post('/api/payments', h((req) => {
  const { staff_id, week_start, paid_on, method, note } = req.body || {};
  const staff = getStaff(staff_id);
  if (!isValidDate(week_start)) throw bad('Invalid week');
  const ws = weekStart(week_start);
  if (weekPayment(staff.id, ws)) throw bad(`Week starting ${ws} is already paid`);
  const paidOn = paid_on || new Date().toISOString().slice(0, 10);
  if (!isValidDate(paidOn)) throw bad('Invalid payment date');
  const week = weeklySummary(staff.id).find((w) => w.week_start === ws);
  if (!week) throw bad('No hours recorded for that week');
  const r = db.prepare(`
    INSERT INTO payments (staff_id, week_start, minutes, amount_pence, paid_on, method, note)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(staff.id, ws, week.minutes, week.amount_pence, paidOn, method || null, note || null);
  return db.prepare('SELECT * FROM payments WHERE id = ?').get(r.lastInsertRowid);
}));

app.delete('/api/payments/:id', h((req) => {
  const r = db.prepare('DELETE FROM payments WHERE id = ?').run(Number(req.params.id));
  if (!r.changes) throw new HttpError(404, 'Payment not found');
  return { ok: true };
}));

app.get('/api/payments', h((req) => {
  const { staff_id } = req.query;
  return db.prepare(`
    SELECT p.*, st.name FROM payments p JOIN staff st ON st.id = p.staff_id
    ${staff_id ? 'WHERE p.staff_id = ?' : ''}
    ORDER BY p.paid_on DESC, p.id DESC
  `).all(...(staff_id ? [Number(staff_id)] : [])).map((p) => ({ ...p, week_end: weekEnd(p.week_start) }));
}));

app.get('/api/dashboard', h(() => {
  const thisWeek = weekStart(new Date().toISOString().slice(0, 10));
  const weeks = weeklySummary();
  const perStaff = db.prepare('SELECT id, name, rate_pence, active FROM staff ORDER BY name').all().map((s) => {
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
    };
  });
  const total = (k) => perStaff.reduce((t, s) => t + s[k], 0);
  return {
    week_start: thisWeek,
    week_end: weekEnd(thisWeek),
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

app.listen(PORT, () => console.log(`Employee hours app running on http://localhost:${PORT}`));
