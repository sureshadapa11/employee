// Pure date/time helpers. Dates are 'YYYY-MM-DD' strings, times are 'HH:MM' (24h).

const WEEK_START_DAY = 2; // 0=Sun, 1=Mon, 2=Tue

function parseTime(t) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(t || ''));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function isValidDate(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d || ''))) return false;
  const dt = new Date(d + 'T00:00:00Z');
  return !isNaN(dt) && dt.toISOString().slice(0, 10) === d;
}

// Minutes worked. If end <= start the shift crosses midnight into the next day.
// Equal start and end means a full 24-hour shift.
function shiftMinutes(start, end, breakMinutes = 0) {
  const s = parseTime(start);
  const e = parseTime(end);
  if (s === null || e === null) throw new Error('Times must be HH:MM (24-hour)');
  let mins = e - s;
  if (mins <= 0) mins += 24 * 60;
  const brk = Number(breakMinutes) || 0;
  if (brk < 0 || brk >= mins) throw new Error('Break must be less than the shift length');
  return mins - brk;
}

function crossesMidnight(start, end) {
  return parseTime(end) <= parseTime(start);
}

function addDays(date, n) {
  const dt = new Date(date + 'T00:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

// The Tuesday that starts the week containing `date`.
function weekStart(date) {
  const day = new Date(date + 'T00:00:00Z').getUTCDay();
  return addDays(date, -((day - WEEK_START_DAY + 7) % 7));
}

function weekEnd(date) {
  return addDays(weekStart(date), 6);
}

module.exports = { parseTime, isValidDate, shiftMinutes, crossesMidnight, addDays, weekStart, weekEnd };
