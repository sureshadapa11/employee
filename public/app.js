// ---------- helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let CURRENCY = '£';
let staffList = [];

const money = (pence) => CURRENCY + ((pence || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hours = (mins) => {
  mins = mins || 0;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
};
const decimalHours = (mins) => ((mins || 0) / 60).toFixed(2);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00Z');
  return `${DAYS[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })} ${d.getUTCFullYear()}`;
};
const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekStart = (iso) => addDays(iso, -((new Date(iso + 'T00:00:00Z').getUTCDay() - 2 + 7) % 7)); // Tuesday
const weekLabel = (ws) => `${fmtDate(ws)} – ${fmtDate(addDays(ws, 6))}`;
const parseTime = (t) => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') { showLogin(); throw new Error('Not logged in'); }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

const formData = (form) => Object.fromEntries(new FormData(form).entries());

// ---------- auth ----------
function showLogin() {
  $('#app-view').classList.add('hidden');
  $('#login-view').classList.remove('hidden');
}

async function showApp() {
  $('#login-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  await loadStaff();
  showView('dashboard');
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    await api('/login', { method: 'POST', body: formData(e.target) });
    const me = await api('/me');
    CURRENCY = me.currency;
    e.target.reset();
    showApp();
  } catch (err) { $('#login-error').textContent = err.message; }
});

$('#logout').addEventListener('click', async () => {
  await api('/logout', { method: 'POST' }).catch(() => {});
  showLogin();
});

// ---------- navigation ----------
const loaders = {
  dashboard: loadDashboard,
  hours: loadHours,
  weeks: loadWeeks,
  payments: loadPayments,
  staff: renderStaff,
  settings: () => {},
};

function showView(name) {
  $$('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  $$('main > section').forEach((s) => s.classList.toggle('hidden', s.dataset.view !== name));
  loaders[name]();
}
$('#nav').addEventListener('click', (e) => { if (e.target.dataset.view) showView(e.target.dataset.view); });

// ---------- staff ----------
async function loadStaff() {
  staffList = await api('/staff');
  const active = staffList.filter((s) => s.active);
  const opts = (list) => list.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  const shiftSel = $('#shift-form [name=staff_id]');
  const prev = shiftSel.value;
  shiftSel.innerHTML = active.length ? opts(active) : '<option value="">Add staff first</option>';
  if (prev && active.some((s) => String(s.id) === prev)) shiftSel.value = prev;
  for (const id of ['#weeks-staff', '#payments-staff']) {
    const sel = $(id); const v = sel.value;
    sel.innerHTML = '<option value="">All staff</option>' + opts(staffList);
    sel.value = v;
  }
}

function renderStaff() {
  const rows = staffList.map((s) => `
    <tr>
      <td>${esc(s.name)}</td>
      <td>${esc(s.phone || '')}</td>
      <td class="num">${money(s.rate_pence)}/h</td>
      <td>${s.active ? '<span class="badge paid">Active</span>' : '<span class="badge unpaid">Inactive</span>'}</td>
      <td class="num">
        <button class="btn small" data-edit="${s.id}">Edit</button>
        <button class="btn small ghost" data-toggle="${s.id}">${s.active ? 'Deactivate' : 'Activate'}</button>
      </td>
    </tr>`).join('');
  $('#staff-table').innerHTML = `
    <thead><tr><th>Name</th><th>Phone</th><th class="num">Rate</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5" class="empty">No staff yet. Add your first staff member above.</td></tr>'}</tbody>`;
}

function resetStaffForm() {
  const f = $('#staff-form');
  f.reset(); f.id.value = '';
  $('#staff-submit').textContent = 'Add staff';
  $('#staff-cancel').classList.add('hidden');
  $('#staff-error').textContent = '';
}

$('#staff-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = formData(e.target);
  try {
    if (data.id) await api('/staff/' + data.id, { method: 'PUT', body: data });
    else await api('/staff', { method: 'POST', body: data });
    resetStaffForm();
    await loadStaff(); renderStaff();
  } catch (err) { $('#staff-error').textContent = err.message; }
});
$('#staff-cancel').addEventListener('click', resetStaffForm);

$('#staff-table').addEventListener('click', async (e) => {
  const editId = e.target.dataset.edit;
  const toggleId = e.target.dataset.toggle;
  if (editId) {
    const s = staffList.find((x) => String(x.id) === editId);
    const f = $('#staff-form');
    f.id.value = s.id; f.name.value = s.name; f.phone.value = s.phone || ''; f.rate.value = (s.rate_pence / 100).toFixed(2);
    $('#staff-submit').textContent = 'Save changes';
    $('#staff-cancel').classList.remove('hidden');
    f.scrollIntoView({ behavior: 'smooth' });
  }
  if (toggleId) {
    const s = staffList.find((x) => String(x.id) === toggleId);
    await api('/staff/' + s.id, { method: 'PUT', body: { active: !s.active } });
    await loadStaff(); renderStaff();
  }
});

// ---------- dashboard ----------
async function loadDashboard() {
  const d = await api('/dashboard');
  $('#dash-week').textContent = weekLabel(d.week_start);
  const t = d.totals;
  $('#dash-stats').innerHTML = [
    ['Hours this week', hours(t.this_week_minutes)],
    ['Pay this week', money(t.this_week_pence)],
    ['Unpaid (owed)', money(t.unpaid_pence)],
    ['Paid (all time)', money(t.paid_pence)],
    ['Hours (all time)', hours(t.total_minutes)],
  ].map(([l, v]) => `<div class="stat"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('');
  const rows = d.staff.map((s) => `
    <tr>
      <td>${esc(s.name)}${s.active ? '' : ' <span class="muted">(inactive)</span>'}</td>
      <td class="num">${money(s.rate_pence)}</td>
      <td class="num">${hours(s.this_week_minutes)}</td>
      <td class="num">${money(s.this_week_pence)}</td>
      <td class="num">${hours(s.total_minutes)}</td>
      <td class="num">${money(s.paid_pence)}</td>
      <td class="num">${s.unpaid_pence ? `<span class="badge unpaid">${money(s.unpaid_pence)}</span> <span class="muted">${s.unpaid_weeks} wk</span>` : '<span class="badge paid">Nothing owed</span>'}</td>
    </tr>`).join('');
  $('#dash-table').innerHTML = `
    <thead><tr><th>Staff</th><th class="num">Rate/h</th><th class="num">Hours this wk</th><th class="num">Pay this wk</th>
      <th class="num">Total hours</th><th class="num">Total paid</th><th class="num">Unpaid</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7" class="empty">No staff yet.</td></tr>'}</tbody>
    ${d.staff.length ? `<tfoot><tr><td>Total</td><td></td><td class="num">${hours(t.this_week_minutes)}</td><td class="num">${money(t.this_week_pence)}</td>
      <td class="num">${hours(t.total_minutes)}</td><td class="num">${money(t.paid_pence)}</td><td class="num">${money(t.unpaid_pence)}</td></tr></tfoot>` : ''}`;
}

// ---------- hours ----------
let hoursWeek = weekStart(today());

// Auto-insert the colon so "2200" becomes "22:00".
$$('input.time').forEach((inp) => inp.addEventListener('input', () => {
  const digits = inp.value.replace(/\D/g, '').slice(0, 4);
  inp.value = digits.length > 2 ? digits.slice(0, 2) + ':' + digits.slice(2) : digits;
  updatePreview();
}));
['shift_date', 'break_minutes'].forEach((n) => $(`#shift-form [name=${n}]`).addEventListener('input', updatePreview));
$('#shift-form [name=staff_id]').addEventListener('change', loadHoursTable);
$('#shift-form [name=shift_date]').addEventListener('change', (e) => {
  if (e.target.value) { hoursWeek = weekStart(e.target.value); loadHoursTable(); }
});

function updatePreview() {
  const f = $('#shift-form');
  const s = parseTime(f.start_time.value);
  const en = parseTime(f.end_time.value);
  const out = $('#shift-preview');
  if (s === null || en === null) { out.textContent = ''; return; }
  let mins = en - s;
  const overnight = mins <= 0;
  if (overnight) mins += 1440;
  mins -= Number(f.break_minutes.value) || 0;
  if (mins <= 0) { out.textContent = 'Break is longer than the shift'; return; }
  let text = `= ${hours(mins)} (${decimalHours(mins)} h)`;
  if (overnight && f.shift_date.value) text += ` · overnight, ends ${fmtDate(addDays(f.shift_date.value, 1))} ${f.end_time.value}`;
  const staff = staffList.find((x) => String(x.id) === f.staff_id.value);
  if (staff) text += ` · ${money(Math.round(mins * staff.rate_pence / 60))}`;
  if (f.shift_date.value) text += ` · counts in week ${weekLabel(weekStart(f.shift_date.value))}`;
  out.textContent = text;
}

async function loadHours() {
  const f = $('#shift-form');
  if (!f.shift_date.value) f.shift_date.value = today();
  await loadHoursTable();
}

async function loadHoursTable() {
  const staffId = $('#shift-form [name=staff_id]').value;
  $('#hours-week').textContent = weekLabel(hoursWeek);
  if (!staffId) { $('#hours-table').innerHTML = '<tbody><tr><td class="empty">Add staff first.</td></tr></tbody>'; return; }
  const shifts = await api(`/shifts?staff_id=${staffId}&week_start=${hoursWeek}`);
  shifts.sort((a, b) => (a.shift_date + a.start_time).localeCompare(b.shift_date + b.start_time));
  const total = shifts.reduce((t, s) => t + s.minutes, 0);
  const pay = shifts.reduce((t, s) => t + Math.round(s.minutes * s.rate_pence / 60), 0);
  const paid = shifts.some((s) => s.paid);
  const rows = shifts.map((s) => `
    <tr>
      <td>${fmtDate(s.shift_date)}</td>
      <td>${s.start_time} → ${s.end_time} ${s.end_time <= s.start_time ? '<span class="badge night">+1 day</span>' : ''}</td>
      <td class="num">${s.break_minutes ? s.break_minutes + 'm' : '–'}</td>
      <td class="num">${hours(s.minutes)}</td>
      <td class="num">${money(Math.round(s.minutes * s.rate_pence / 60))}</td>
      <td>${esc(s.note || '')}</td>
      <td class="num">${s.paid ? '<span class="badge paid">Paid</span>' : `
        <button class="btn small" data-edit='${esc(JSON.stringify(s))}'>Edit</button>
        <button class="btn small ghost danger" data-del="${s.id}">Delete</button>`}</td>
    </tr>`).join('');
  $('#hours-table').innerHTML = `
    <thead><tr><th>Date</th><th>Time</th><th class="num">Break</th><th class="num">Hours</th><th class="num">Pay</th><th>Note</th><th></th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7" class="empty">No shifts this week.</td></tr>'}</tbody>
    ${shifts.length ? `<tfoot><tr><td colspan="3">Week total ${paid ? '<span class="badge paid">Paid</span>' : '<span class="badge unpaid">Unpaid</span>'}</td>
      <td class="num">${hours(total)}</td><td class="num">${money(pay)}</td><td colspan="2"></td></tr></tfoot>` : ''}`;
}

$('#hours-prev').addEventListener('click', () => { hoursWeek = addDays(hoursWeek, -7); loadHoursTable(); });
$('#hours-next').addEventListener('click', () => { hoursWeek = addDays(hoursWeek, 7); loadHoursTable(); });

function resetShiftForm() {
  const f = $('#shift-form');
  const keepStaff = f.staff_id.value;
  const keepDate = f.shift_date.value;
  f.reset();
  f.id.value = '';
  f.staff_id.value = keepStaff;
  f.shift_date.value = keepDate || today();
  f.staff_id.disabled = false;
  $('#shift-submit').textContent = 'Save shift';
  $('#shift-cancel').classList.add('hidden');
  $('#shift-error').textContent = '';
  updatePreview();
}

$('#shift-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  f.staff_id.disabled = false;
  const data = formData(f);
  $('#shift-error').textContent = '';
  try {
    if (data.id) await api('/shifts/' + data.id, { method: 'PUT', body: data });
    else await api('/shifts', { method: 'POST', body: data });
    hoursWeek = weekStart(data.shift_date);
    resetShiftForm();
    // Next shift is usually the following day.
    f.shift_date.value = addDays(data.shift_date, 1);
    await loadHoursTable();
  } catch (err) { $('#shift-error').textContent = err.message; }
});
$('#shift-cancel').addEventListener('click', resetShiftForm);

$('#hours-table').addEventListener('click', async (e) => {
  if (e.target.dataset.edit) {
    const s = JSON.parse(e.target.dataset.edit);
    const f = $('#shift-form');
    f.id.value = s.id; f.staff_id.value = s.staff_id; f.staff_id.disabled = true;
    f.shift_date.value = s.shift_date; f.start_time.value = s.start_time; f.end_time.value = s.end_time;
    f.break_minutes.value = s.break_minutes; f.note.value = s.note || '';
    $('#shift-submit').textContent = 'Save changes';
    $('#shift-cancel').classList.remove('hidden');
    updatePreview();
    f.scrollIntoView({ behavior: 'smooth' });
  }
  if (e.target.dataset.del && confirm('Delete this shift?')) {
    try { await api('/shifts/' + e.target.dataset.del, { method: 'DELETE' }); await loadHoursTable(); }
    catch (err) { alert(err.message); }
  }
});

// ---------- weeks ----------
let weeksData = [];

async function loadWeeks() {
  const staffId = $('#weeks-staff').value;
  weeksData = await api('/weeks' + (staffId ? `?staff_id=${staffId}` : ''));
  renderWeeks();
}

function renderWeeks() {
  const status = $('#weeks-status').value;
  const list = weeksData.filter((w) => !status || (status === 'paid') === w.paid);
  const rows = list.map((w, i) => `
    <tr>
      <td>${weekLabel(w.week_start)}</td>
      <td>${esc(w.name)}</td>
      <td class="num">${w.shift_count}</td>
      <td class="num">${hours(w.minutes)}</td>
      <td class="num">${money(w.paid ? w.paid_pence : w.amount_pence)}</td>
      <td>${w.paid ? `<span class="badge paid">Paid ${fmtDate(w.paid_on)}</span>` : '<span class="badge unpaid">Unpaid</span>'}</td>
      <td class="num">
        <button class="btn small ghost" data-detail="${i}">Shifts</button>
        ${w.paid ? '' : `<button class="btn small primary" data-pay="${i}">Mark paid</button>`}
      </td>
    </tr>
    <tr class="detail-row hidden" id="detail-${i}"><td colspan="7"></td></tr>`).join('');
  const sum = (k) => list.reduce((t, w) => t + (w[k] || 0), 0);
  const unpaidTotal = list.filter((w) => !w.paid).reduce((t, w) => t + w.amount_pence, 0);
  $('#weeks-table').innerHTML = `
    <thead><tr><th>Week (Tue–Mon)</th><th>Staff</th><th class="num">Shifts</th><th class="num">Hours</th><th class="num">Amount</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7" class="empty">No weeks to show.</td></tr>'}</tbody>
    ${list.length ? `<tfoot><tr><td colspan="3">Total · unpaid ${money(unpaidTotal)}</td><td class="num">${hours(sum('minutes'))}</td>
      <td class="num">${money(list.reduce((t, w) => t + (w.paid ? w.paid_pence : w.amount_pence), 0))}</td><td colspan="2"></td></tr></tfoot>` : ''}`;
}

$('#weeks-staff').addEventListener('change', loadWeeks);
$('#weeks-status').addEventListener('change', renderWeeks);

$('#weeks-table').addEventListener('click', async (e) => {
  const di = e.target.dataset.detail;
  if (di !== undefined) {
    const row = $('#detail-' + di);
    if (!row.classList.contains('hidden')) { row.classList.add('hidden'); return; }
    const w = weeksData[di];
    const shifts = await api(`/shifts?staff_id=${w.staff_id}&week_start=${w.week_start}`);
    shifts.sort((a, b) => (a.shift_date + a.start_time).localeCompare(b.shift_date + b.start_time));
    row.firstElementChild.innerHTML = shifts.map((s) =>
      `${fmtDate(s.shift_date)}: ${s.start_time} → ${s.end_time}${s.end_time <= s.start_time ? ' (+1 day)' : ''}` +
      `${s.break_minutes ? `, break ${s.break_minutes}m` : ''} = <strong>${hours(s.minutes)}</strong>` +
      `${s.note ? ` – ${esc(s.note)}` : ''}`).join('<br>');
    row.classList.remove('hidden');
  }
  const pi = e.target.dataset.pay;
  if (pi !== undefined) openPayDialog(weeksData[pi]);
});

function openPayDialog(w) {
  const f = $('#pay-form');
  f.reset();
  f.staff_id.value = w.staff_id;
  f.week_start.value = w.week_start;
  f.paid_on.value = today();
  $('#pay-error').textContent = '';
  $('#pay-summary').innerHTML = `<strong>${esc(w.name)}</strong><br>${weekLabel(w.week_start)}<br>${hours(w.minutes)} · <strong>${money(w.amount_pence)}</strong>`;
  $('#pay-dialog').showModal();
}

$('#pay-form').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'confirm') return;
  e.preventDefault();
  try {
    await api('/payments', { method: 'POST', body: formData(e.target) });
    $('#pay-dialog').close();
    await loadWeeks();
  } catch (err) { $('#pay-error').textContent = err.message; }
});

// ---------- payments ----------
async function loadPayments() {
  const staffId = $('#payments-staff').value;
  const [payments, weeks] = await Promise.all([
    api('/payments' + (staffId ? `?staff_id=${staffId}` : '')),
    api('/weeks' + (staffId ? `?staff_id=${staffId}` : '')),
  ]);
  const paidTotal = payments.reduce((t, p) => t + p.amount_pence, 0);
  const unpaid = weeks.filter((w) => !w.paid);
  $('#payments-stats').innerHTML = [
    ['Total paid', money(paidTotal)],
    ['Payments made', payments.length],
    ['Still owed', money(unpaid.reduce((t, w) => t + w.amount_pence, 0))],
    ['Unpaid weeks', unpaid.length],
  ].map(([l, v]) => `<div class="stat"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('');
  const rows = payments.map((p) => `
    <tr>
      <td>${fmtDate(p.paid_on)}</td>
      <td>${esc(p.name)}</td>
      <td>${weekLabel(p.week_start)}</td>
      <td class="num">${hours(p.minutes)}</td>
      <td class="num">${money(p.amount_pence)}</td>
      <td>${esc(p.method || '')}</td>
      <td>${esc(p.note || '')}</td>
      <td class="num"><button class="btn small ghost danger" data-undo="${p.id}">Undo</button></td>
    </tr>`).join('');
  $('#payments-table').innerHTML = `
    <thead><tr><th>Paid on</th><th>Staff</th><th>Week</th><th class="num">Hours</th><th class="num">Amount</th><th>Method</th><th>Note</th><th></th></tr></thead>
    <tbody>${rows || '<tr><td colspan="8" class="empty">No payments yet.</td></tr>'}</tbody>
    ${payments.length ? `<tfoot><tr><td colspan="4">Total</td><td class="num">${money(paidTotal)}</td><td colspan="3"></td></tr></tfoot>` : ''}`;
}
$('#payments-staff').addEventListener('change', loadPayments);

$('#payments-table').addEventListener('click', async (e) => {
  if (e.target.dataset.undo && confirm('Undo this payment? The week will go back to Unpaid.')) {
    await api('/payments/' + e.target.dataset.undo, { method: 'DELETE' });
    loadPayments();
  }
});

// ---------- settings ----------
$('#pw-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#pw-msg');
  try {
    await api('/change-password', { method: 'POST', body: formData(e.target) });
    e.target.reset();
    msg.style.color = 'var(--paid)'; msg.textContent = 'Password updated.';
  } catch (err) { msg.style.color = ''; msg.textContent = err.message; }
});

// ---------- start ----------
api('/me').then((me) => { CURRENCY = me.currency; showApp(); }).catch(() => showLogin());
