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

test('week starts on Tuesday', () => {
  // 2026-09-29 is a Tuesday
  assert.strictEqual(weekStart('2026-09-29'), '2026-09-29');
  assert.strictEqual(weekStart('2026-10-03'), '2026-09-29'); // Saturday
  assert.strictEqual(weekStart('2026-10-05'), '2026-09-29'); // Monday = last day
  assert.strictEqual(weekStart('2026-10-06'), '2026-10-06'); // next Tuesday
  assert.strictEqual(weekEnd('2026-09-30'), '2026-10-05');
});

test('date validation', () => {
  assert.ok(isValidDate('2026-02-28'));
  assert.ok(!isValidDate('2026-02-30'));
  assert.ok(!isValidDate('03/10/2026'));
});
