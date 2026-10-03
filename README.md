# Employee – Staff Hours & Pay

A small web app for recording staff working hours, calculating weekly pay, and tracking which weeks have been paid.

## Features

- **24-hour shifts**: enter `From` / `To` in 24h format (type `2200`, it becomes `22:00`).
- **Overnight shifts**: if `To` is earlier than `From`, the shift crosses midnight (e.g. `22:00 → 06:00` = 8h). Same start and end = 24h.
- **Breaks**: optional unpaid break minutes, deducted from the shift.
- **Week runs Wednesday → Tuesday.** A shift belongs to the week of the day it *started*.
- **Hourly rate per staff.** The rate is saved with each shift, so changing a rate later doesn't change past weeks.
- **Weekly totals**: hours and amount per staff per week, marked **Paid** or **Unpaid**.
- **Payments**: mark a week paid (date, method, note). Paid weeks are locked; undo the payment to edit them.
- **Payment history** and a **dashboard** with this week's hours/pay, total paid and total still owed.
- Single admin login (you enter hours for everyone).
- Mobile-first UI: bottom tab bar, bottom sheets, large touch targets, light/dark mode. No branding.

## Run it

Requires **Node.js 22.13+** (uses the built-in `node:sqlite`, no native modules).

```bash
npm install
npm start
```

Open http://localhost:3000 and log in with **admin / admin123**, then change the password under **Settings**.

## Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `ADMIN_USERNAME` | `admin` | Admin username (first run only) |
| `ADMIN_PASSWORD` | `admin123` | Admin password (first run only) |
| `SESSION_SECRET` | random | Set this in production so logins survive restarts |
| `CURRENCY` | `£` | Currency symbol shown in the app |
| `DB_PATH` | `data/employee.db` | SQLite database file |

## Tests

```bash
npm test
```

## Project layout

```
server.js        Express API + static files
lib/db.js        SQLite schema, admin account
lib/time.js      Shift length, overnight handling, Wednesday week start
public/          Frontend (vanilla HTML/CSS/JS)
test/            Unit tests for time calculations
```
