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

## Hosting (Vercel + Neon Postgres)

The app runs on Vercel as an Express function; files in `public/` are served by Vercel's CDN.
Data lives in a Neon Postgres database added from the Vercel Marketplace (Storage tab), which sets `DATABASE_URL`.
Tables and the first admin user are created automatically on the first request.

First login: **admin / admin123**. A banner asks you to change it until you do.

## Run locally

Requires **Node.js 22+**.

```bash
npm install
vercel link        # once
vercel env pull    # writes DATABASE_URL and SESSION_SECRET to .env.local
npm start          # http://localhost:3000
```

## Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | – | Postgres connection string (set by the Neon integration) |
| `SESSION_SECRET` | random locally, **required** in production | Signs the login cookie |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / `admin123` | First admin account (first run only) |
| `CURRENCY` | `£` | Currency symbol |
| `APP_TIMEZONE` | `Europe/London` | Time zone used for "today" and "this week" |
| `PORT` | `3000` | Local HTTP port |
| `PAY_OFFSET_DAYS` | `14` | Days from week start to payday |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | – | Phone push notifications (generate with `npx web-push generate-vapid-keys`) |
| `CRON_SECRET` | – | Protects `/api/cron/daily` (payday, overdue and missing-hours reminders, run by Vercel Cron at 08:00 UTC) |

Failed logins are limited to 10 per IP address per 15 minutes.

## Tests

```bash
npm test
```

## Project layout

```
server.js        Express API + static files
lib/db.js        Postgres schema, admin account
lib/time.js      Shift length, overnight handling, Wednesday week start
public/          Frontend (vanilla HTML/CSS/JS)
test/            Unit tests for time calculations
```
