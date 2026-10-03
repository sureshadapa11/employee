const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'employee.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS admin (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS staff (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    rate_pence INTEGER NOT NULL CHECK (rate_pence >= 0),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- rate_pence is copied from staff at entry time so later rate changes
  -- don't alter past weeks.
  CREATE TABLE IF NOT EXISTS shifts (
    id INTEGER PRIMARY KEY,
    staff_id INTEGER NOT NULL REFERENCES staff(id),
    shift_date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    break_minutes INTEGER NOT NULL DEFAULT 0,
    minutes INTEGER NOT NULL,
    rate_pence INTEGER NOT NULL,
    week_start TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_shifts_staff_week ON shifts(staff_id, week_start);

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY,
    staff_id INTEGER NOT NULL REFERENCES staff(id),
    week_start TEXT NOT NULL,
    minutes INTEGER NOT NULL,
    amount_pence INTEGER NOT NULL,
    paid_on TEXT NOT NULL,
    method TEXT,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (staff_id, week_start)
  );
`);

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

// Create the admin account on first run.
if (!db.prepare('SELECT 1 FROM admin LIMIT 1').get()) {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  db.prepare('INSERT INTO admin (username, password_hash) VALUES (?, ?)').run(username, hashPassword(password));
  console.log(`Created admin user "${username}".${process.env.ADMIN_PASSWORD ? '' : ' Default password is admin123 - change it after logging in.'}`);
}

module.exports = { db, hashPassword, verifyPassword };
