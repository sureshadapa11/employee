const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

// Neon's HTTP driver: one round trip per query, no connection pool to manage,
// which suits serverless functions.
let _sql = null;
function sql() {
  if (!_sql) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
}

// Run a parameterised query ($1, $2, ...) and return all rows.
const query = (text, params = []) => sql().query(text, params);
const one = async (text, params) => (await query(text, params))[0];

const DEFAULT_PASSWORD = 'admin123';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  const test = crypto.scryptSync(String(password), salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

// Dates and times are stored as 'YYYY-MM-DD' / 'HH:MM' text so they never
// shift with the server's time zone.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS admin (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE
  )`,
  `CREATE TABLE IF NOT EXISTS staff (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    rate_pence INTEGER NOT NULL CHECK (rate_pence >= 0),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  // rate_pence is copied from staff at entry time so later rate changes
  // don't alter past weeks.
  `CREATE TABLE IF NOT EXISTS shifts (
    id SERIAL PRIMARY KEY,
    staff_id INTEGER NOT NULL REFERENCES staff(id),
    shift_date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    break_minutes INTEGER NOT NULL DEFAULT 0,
    minutes INTEGER NOT NULL,
    rate_pence INTEGER NOT NULL,
    week_start TEXT NOT NULL,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  'CREATE INDEX IF NOT EXISTS idx_shifts_staff_week ON shifts(staff_id, week_start)',
  `CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    staff_id INTEGER NOT NULL REFERENCES staff(id),
    week_start TEXT NOT NULL,
    minutes INTEGER NOT NULL,
    amount_pence INTEGER NOT NULL,
    paid_on TEXT NOT NULL,
    method TEXT,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (staff_id, week_start)
  )`,
  `CREATE TABLE IF NOT EXISTS login_failures (
    ip TEXT NOT NULL,
    at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  'CREATE INDEX IF NOT EXISTS idx_login_failures_ip ON login_failures(ip, at)',
  // The admin table holds every login. role 'admin' has full access;
  // role 'staff' is linked to one staff member and can only view their own hours.
  "ALTER TABLE admin ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin'",
  'ALTER TABLE admin ADD COLUMN IF NOT EXISTS staff_id INTEGER REFERENCES staff(id)',
  'ALTER TABLE admin ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()',
  // Which login entered the shift (null for shifts entered before logins existed).
  'ALTER TABLE shifts ADD COLUMN IF NOT EXISTS created_by INTEGER',
  // A staff member's message asking an admin to correct the shift.
  'ALTER TABLE shifts ADD COLUMN IF NOT EXISTS staff_note TEXT',
  'ALTER TABLE shifts ADD COLUMN IF NOT EXISTS staff_note_at TIMESTAMPTZ',
];

// Create tables and the first admin once per server instance.
let ready = null;
function ensureSchema() {
  if (!ready) {
    ready = (async () => {
      for (const stmt of SCHEMA) await query(stmt);
      const exists = await one('SELECT 1 FROM admin LIMIT 1');
      if (!exists) {
        const username = process.env.ADMIN_USERNAME || 'admin';
        const password = process.env.ADMIN_PASSWORD || DEFAULT_PASSWORD;
        await query(
          'INSERT INTO admin (username, password_hash, must_change_password) VALUES ($1, $2, $3) ON CONFLICT (username) DO NOTHING',
          [username, hashPassword(password), !process.env.ADMIN_PASSWORD],
        );
        console.log(`Created admin user "${username}".`);
      }
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

module.exports = { query, one, ensureSchema, hashPassword, verifyPassword };
