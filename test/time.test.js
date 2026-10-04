const test = require('node:test');
const assert = require('node:assert');
const { shiftMinutes, weekStart, weekEnd, isValidDate } = require('../lib/time');

test('same-day shift', () => {
  assert.strictEqual(shiftMinutes('09:00', '17:30'), 510);
});

test('overnight shift crosses midnight', () => {
  assert.strictEqual(shiftMinutes('22:00', '06:00'), 480);
  assert.strictEqual(shiftMinutes('23:45', '00:15'), 30);
});

test('equal start and end is 24 hours', () => {
  assert.strictEqual(shiftMinutes('08:00', '08:00'), 1440);
});

test('break is deducted', () => {
  assert.strictEqual(shiftMinutes('09:00', '17:00', 30), 450);
  assert.throws(() => shiftMinutes('09:00', '10:00', 60));
});

test('invalid times rejected', () => {
  assert.throws(() => shiftMinutes('24:00', '01:00'));
  assert.throws(() => shiftMinutes('9:00', '17:00'));
});

test('week starts on Wednesday and ends Tuesday', () => {
  // 2026-09-30 is a Wednesday
  assert.strictEqual(weekStart('2026-09-30'), '2026-09-30');
  assert.strictEqual(weekStart('2026-10-03'), '2026-09-30'); // Saturday
  assert.strictEqual(weekStart('2026-10-06'), '2026-09-30'); // Tuesday = last day
  assert.strictEqual(weekStart('2026-10-07'), '2026-10-07'); // next Wednesday
  assert.strictEqual(weekStart('2026-09-29'), '2026-09-23'); // previous Tuesday
  assert.strictEqual(weekEnd('2026-10-01'), '2026-10-06');
});

test('date validation', () => {
  assert.ok(isValidDate('2026-02-28'));
  assert.ok(!isValidDate('2026-02-30'));
  assert.ok(!isValidDate('03/10/2026'));
});

test('payday is the Tuesday two weeks after the week ends', () => {
  const { payday } = require('../lib/time');
  assert.strictEqual(payday('2026-09-09'), '2026-09-29'); // Wed 9 – Tue 15 Sep → Tue 29 Sep
  assert.strictEqual(payday('2026-09-16'), '2026-10-06'); // Wed 16 – Tue 22 Sep → Tue 6 Oct
  assert.strictEqual(payday('2026-09-23'), '2026-10-13'); // Wed 23 – Tue 29 Sep → Tue 13 Oct
});

test('due week moves on the day after payday', () => {
  const { dueWeek } = require('../lib/time');
  assert.strictEqual(dueWeek('2026-09-29'), '2026-09-09'); // payday itself
  assert.strictEqual(dueWeek('2026-09-30'), '2026-09-16'); // next day → paid Tue 6 Oct
  assert.strictEqual(dueWeek('2026-10-04'), '2026-09-16'); // Sun 4 Oct → paid Tue 6 Oct
  assert.strictEqual(dueWeek('2026-10-06'), '2026-09-16');
  assert.strictEqual(dueWeek('2026-10-07'), '2026-09-23'); // → paid Tue 13 Oct
});
