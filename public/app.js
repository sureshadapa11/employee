// ---------- helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let CURRENCY = '£';
let WEEK_START_DAY = 3; // set from server
let staffList = [];
let ME = null; // the logged-in user from /api/me
const isStaff = () => ME?.role === 'staff';

// Lucide-style line icons.
const ICONS = {
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  wallet: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  arrowRight: '<path d="M5 12h14M13 5l7 7-7 7"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
};
const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
const hydrateIcons = (root = document) => $$('i[data-icon]', root).forEach((el) => { el.innerHTML = icon(el.dataset.icon); });

const money = (pence) => CURRENCY + ((pence || 0) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hours = (mins) => {
  mins = mins || 0;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
};
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const utc = (iso) => new Date(iso + 'T00:00:00Z');
const fmtDate = (iso) => {
  if (!iso) return '';
  const d = utc(iso);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};
const addDays = (iso, n) => {
  const d = utc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekStart = (iso) => addDays(iso, -((utc(iso).getUTCDay() - WEEK_START_DAY + 7) % 7));
const weekLabel = (ws) => `${fmtDate(ws)} – ${fmtDate(addDays(ws, 6))}`;
const weekName = (ws) => {
  const diff = Math.round((Date.parse(ws) - Date.parse(weekStart(today()))) / (7 * 864e5));
  if (diff === 0) return 'This week';
  if (diff === -1) return 'Last week';
  if (diff === 1) return 'Next week';
  return diff < 0 ? `${-diff} weeks ago` : `In ${diff} weeks`;
};
const parseTime = (t) => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const initials = (name) => name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
const shiftPay = (s) => Math.round(s.minutes * s.rate_pence / 60);
const statusBadge = (paid) => paid
  ? `<span class="badge paid">${icon('check')}Paid</span>`
  : `<span class="badge unpaid">${icon('clock')}Unpaid</span>`;
const emptyState = (ic, text) => `<div class="empty">${icon(ic)}<div>${text}</div></div>`;

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

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

// ---------- bottom sheet ----------
const sheet = $('#sheet');
function openSheet(html) {
  const body = $('#sheet-body');
  body.innerHTML = html;
  hydrateIcons(body);
  sheet.showModal();
  return body;
}
const closeSheet = () => sheet.close();
// Tapping the dimmed backdrop closes the sheet.
sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });

function confirmSheet({ title, message, confirmText = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const body = openSheet(`
      <div class="sheet-form">
        <h3>${esc(title)}</h3>
        <p class="muted">${esc(message)}</p>
        <div class="sheet-actions">
          <button class="btn ghost" data-r="0">Cancel</button>
          <button class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(confirmText)}</button>
        </div>
      </div>`);
    let answered = false;
    $$('[data-r]', body).forEach((b) => b.addEventListener('click', () => {
      answered = true; closeSheet(); resolve(b.dataset.r === '1');
    }));
    sheet.addEventListener('close', () => { if (!answered) resolve(false); }, { once: true });
  });
}

// ---------- auth ----------
function showLogin() {
  $('#app-view').classList.add('hidden');
  $('#login-view').classList.remove('hidden');
}

function applyMe(me) {
  ME = me;
  document.body.classList.toggle('role-admin', me.role === 'admin');
  document.body.classList.toggle('role-staff', me.role === 'staff');
  CURRENCY = me.currency;
  WEEK_START_DAY = me.week_start_day;
  $('#pw-banner').classList.toggle('hidden', !me.must_change_password);
  $('#settings-info').textContent = `Signed in as ${me.username} (${me.role === 'staff' ? 'staff' + (me.staff_name ? ', ' + me.staff_name : '') : 'admin'}). Weeks run ${DAY_NAMES[WEEK_START_DAY]} to ${DAY_NAMES[(WEEK_START_DAY + 6) % 7]}.`;
}

async function showApp() {
  $('#login-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  hoursWeek = weekStart(today());
  dashWeek = weekStart(today());
  myWeek = weekStart(today());
  if (isStaff()) selectedStaffId = 'self'; // the server always uses the staff login's own record
  else await loadStaff();
  route();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    await api('/login', { method: 'POST', body: formData(e.target) });
    applyMe(await api('/me'));
    e.target.reset();
    showApp();
  } catch (err) { $('#login-error').textContent = err.message; }
});

$('#logout').addEventListener('click', async () => {
  await api('/logout', { method: 'POST' }).catch(() => {});
  history.replaceState(null, '', location.pathname);
  ME = null;
  document.body.classList.remove('role-admin', 'role-staff');
  showLogin();
});

// ---------- navigation (hash based, so the phone's back button works) ----------
const VIEWS = {
  home: { title: 'This week', load: () => loadDashboard() },
  add: { title: 'Add hours', load: () => loadAdd() },
  weeks: { title: 'Weeks', load: () => loadWeeks() },
  payments: { title: 'Payments', load: () => loadPayments() },
  staff: { title: 'Staff', load: () => renderStaff() },
  settings: { title: 'Settings', load: () => { if (!isStaff()) loadLogins(); } },
  my: { title: 'My hours', load: () => loadMy() },
};
const STAFF_VIEWS = ['my', 'add', 'settings'];

function go(view) {
  if (location.hash === '#' + view) route();
  else location.hash = view;
}

function route() {
  if ($('#app-view').classList.contains('hidden')) return;
  if (sheet.open) closeSheet();
  const allowed = (v) => VIEWS[v] && (isStaff() ? STAFF_VIEWS.includes(v) : v !== 'my');
  const wanted = location.hash.slice(1);
  const name = allowed(wanted) ? wanted : (isStaff() ? 'my' : 'home');
  $$('#tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  $$('main > section').forEach((s) => s.classList.toggle('hidden', s.dataset.view !== name));
  $('#view-title').textContent = name === 'add' && shiftForm.elements.edit_id.value ? 'Edit shift' : VIEWS[name].title;
  window.scrollTo(0, 0);
  VIEWS[name].load();
}
window.addEventListener('hashchange', route);
$('#tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (b) go(b.dataset.view);
});
$('#open-settings').addEventListener('click', () => go('settings'));

// ---------- staff ----------
async function loadStaff() {
  staffList = await api('/staff');
  const opts = '<option value="">All staff</option>' + staffList.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  for (const id of ['#weeks-staff', '#payments-staff']) {
    const sel = $(id); const v = sel.value;
    sel.innerHTML = opts;
    sel.value = v;
  }
}

function renderStaff() {
  $('#staff-list').innerHTML = staffList.length ? staffList.map((s) => `
    <button class="item" data-staff="${s.id}">
      <span class="avatar ${s.active ? '' : 'off'}">${esc(initials(s.name))}</span>
      <span class="item-main">
        <span class="item-title">${esc(s.name)}</span>
        <span class="item-sub">${money(s.rate_pence)} per hour${s.phone ? ' · ' + esc(s.phone) : ''}</span>
      </span>
      <span class="item-end">
        ${s.active ? '' : '<span class="badge neutral">Inactive</span>'}
      </span>
      ${icon('chevronRight')}
    </button>`).join('') : emptyState('users', 'No staff yet. Add your first staff member.');
}

function openStaffSheet(s) {
  const body = openSheet(`
    <form class="sheet-form" id="staff-form" novalidate>
      <h3>${s ? 'Edit staff' : 'Add staff'}</h3>
      <label class="field"><span>Name</span><input name="name" class="input" value="${esc(s?.name || '')}" required autocomplete="off"></label>
      <label class="field"><span>Hourly rate (${esc(CURRENCY)})</span><input name="rate" class="input" type="number" inputmode="decimal" min="0" step="0.01" value="${s ? (s.rate_pence / 100).toFixed(2) : ''}" required></label>
      <label class="field"><span>Phone <em>(optional)</em></span><input name="phone" class="input" type="tel" inputmode="tel" value="${esc(s?.phone || '')}"></label>
      ${s ? '<p class="hint">A new rate applies to shifts added from now on. Past shifts keep their rate.</p>' : ''}
      <p class="error" id="staff-error" role="alert"></p>
      ${s ? `<button type="button" class="btn ghost block" id="staff-toggle">${s.active ? 'Mark as inactive' : 'Mark as active'}</button>` : ''}
      <div class="sheet-actions">
        <button type="button" class="btn ghost" id="staff-cancel">Cancel</button>
        <button type="submit" class="btn primary">${s ? 'Save' : 'Add'}</button>
      </div>
    </form>`);
  const f = $('#staff-form', body);
  $('#staff-cancel', body).addEventListener('click', closeSheet);
  $('#staff-toggle', body)?.addEventListener('click', async () => {
    await api('/staff/' + s.id, { method: 'PUT', body: { active: !s.active } });
    closeSheet(); toast(s.active ? `${s.name} marked inactive` : `${s.name} marked active`);
    await loadStaff(); renderStaff();
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = formData(f);
    if (!data.name.trim()) { $('#staff-error').textContent = 'Name is required'; return; }
    if (data.rate === '') { $('#staff-error').textContent = 'Hourly rate is required'; return; }
    try {
      if (s) await api('/staff/' + s.id, { method: 'PUT', body: data });
      else await api('/staff', { method: 'POST', body: data });
      closeSheet(); toast(s ? 'Saved' : `${data.name.trim()} added`);
      await loadStaff(); renderStaff();
    } catch (err) { $('#staff-error').textContent = err.message; }
  });
}

$('#add-staff').addEventListener('click', () => openStaffSheet(null));
$('#staff-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-staff]');
  if (b) openStaffSheet(staffList.find((x) => String(x.id) === b.dataset.staff));
});

// ---------- home ----------
let dashWeek = null;

async function loadDashboard() {
  const d = await api('/dashboard' + (dashWeek ? `?week=${dashWeek}` : ''));
  dashWeek = d.week_start;
  const name = weekName(d.week_start);
  $('#view-title').textContent = name;
  $('#dash-title').textContent = name;
  $('#dash-week').textContent = weekLabel(d.week_start);
  const t = d.totals;
  $('#dash-hours').textContent = hours(t.this_week_minutes);
  $('#dash-pay').textContent = money(t.this_week_pence);
  $('#dash-owed').textContent = money(t.unpaid_pence);
  const unpaidWeeks = d.staff.reduce((n, s) => n + s.unpaid_weeks, 0);
  $('#dash-owed-sub').textContent = unpaidWeeks ? `${unpaidWeeks} unpaid week${unpaidWeeks > 1 ? 's' : ''}` : 'All paid up';
  $('#dash-paid').textContent = money(t.paid_pence);
  $('#dash-hours-all').textContent = `${hours(t.total_minutes)} in total`;

  const shown = d.staff.filter((s) => s.active || s.this_week_minutes);
  shown.sort((a, b) => b.this_week_minutes - a.this_week_minutes || a.name.localeCompare(b.name));
  $('#dash-staff').innerHTML = shown.length ? shown.map((s) => `
    <button class="item" data-add-for="${s.id}">
      <span class="avatar">${esc(initials(s.name))}</span>
      <span class="item-main">
        <span class="item-title">${esc(s.name)}</span>
        <span class="item-sub">${s.this_week_minutes ? hours(s.this_week_minutes) : 'No hours yet'} · ${money(s.rate_pence)}/h</span>
      </span>
      <span class="item-end">
        <span class="item-amount">${money(s.this_week_pence)}</span>
        ${s.this_week_paid === null ? '' : statusBadge(s.this_week_paid)}
      </span>
    </button>`).join('')
    : emptyState('users', 'No staff yet.<br><button class="btn primary sm" data-goto="staff" style="margin-top:8px">Add staff</button>');
}

$('#dash-switch').addEventListener('click', (e) => {
  const b = e.target.closest('[data-step]');
  if (!b) return;
  const step = Number(b.dataset.step);
  dashWeek = step === 0 ? weekStart(today()) : addDays(dashWeek, step * 7);
  loadDashboard();
});

$('section[data-view="home"]').addEventListener('click', (e) => {
  const g = e.target.closest('[data-goto]');
  if (g) {
    if (g.dataset.filter !== undefined) { $('#weeks-staff').value = ''; setWeeksStatus(g.dataset.filter); }
    go(g.dataset.goto);
    return;
  }
  const a = e.target.closest('[data-add-for]');
  if (a) {
    selectedStaffId = a.dataset.addFor;
    setDate(dashWeek === weekStart(today()) ? today() : dashWeek);
    go('add');
  }
});

// ---------- add hours ----------
const shiftForm = $('#shift-form');
let selectedStaffId = null;
let hoursWeek = null;

function renderStaffChips() {
  $('#staff-chips').closest('.group').classList.toggle('hidden', isStaff());
  if (isStaff()) return;
  const active = staffList.filter((s) => s.active);
  if (!active.some((s) => String(s.id) === String(selectedStaffId))) selectedStaffId = active[0] ? String(active[0].id) : null;
  const editing = !!shiftForm.elements.edit_id.value;
  $('#staff-chips').innerHTML = active.length
    ? active.map((s) => `<button type="button" class="chip" role="radio" aria-checked="${String(s.id) === String(selectedStaffId)}" data-id="${s.id}" ${editing && String(s.id) !== String(selectedStaffId) ? 'disabled' : ''}>${esc(s.name)}</button>`).join('')
    : '<button type="button" class="btn primary sm" data-goto-staff>Add staff first</button>';
}

$('#staff-chips').addEventListener('click', (e) => {
  if (e.target.closest('[data-goto-staff]')) { go('staff'); return; }
  const c = e.target.closest('.chip');
  if (!c || c.disabled) return;
  selectedStaffId = c.dataset.id;
  renderStaffChips(); updatePreview(); loadHoursList();
});

function setDate(iso) {
  shiftForm.elements.shift_date.value = iso;
  $$('#date-quick button').forEach((b) => b.classList.toggle('active', addDays(today(), Number(b.dataset.days)) === iso));
  if (iso && weekStart(iso) !== hoursWeek) { hoursWeek = weekStart(iso); loadHoursList(); }
  updatePreview();
}
$('#date-quick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-days]');
  if (b) setDate(addDays(today(), Number(b.dataset.days)));
});
shiftForm.elements.shift_date.addEventListener('change', (e) => setDate(e.target.value));

function setBreak(mins) {
  mins = Math.max(0, Math.min(600, mins));
  shiftForm.elements.break_minutes.value = mins;
  $('#break-out').textContent = mins >= 60 ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m` : `${mins} min`;
  updatePreview();
}
$('.stepper').addEventListener('click', (e) => {
  const b = e.target.closest('[data-break]');
  if (b) setBreak(Number(shiftForm.elements.break_minutes.value) + Number(b.dataset.break));
});

// Auto-insert the colon so "2200" becomes "22:00"; jump to "To" once "From" is complete.
$$('input.time').forEach((inp) => {
  inp.addEventListener('input', () => {
    const digits = inp.value.replace(/\D/g, '').slice(0, 4);
    inp.value = digits.length > 2 ? digits.slice(0, 2) + ':' + digits.slice(2) : digits;
    if (inp.name === 'start_time' && digits.length === 4 && parseTime(inp.value) !== null) shiftForm.elements.end_time.focus();
    updatePreview();
  });
  inp.addEventListener('focus', () => inp.select());
});

function updatePreview() {
  const f = shiftForm.elements;
  const s = parseTime(f.start_time.value);
  const en = parseTime(f.end_time.value);
  const out = $('#shift-preview');
  out.classList.remove('warn');
  if (s === null || en === null) {
    const bad = (f.start_time.value.length === 5 && s === null) || (f.end_time.value.length === 5 && en === null);
    if (bad) {
      out.classList.add('warn');
      out.innerHTML = `<div class="preview-main">${icon('alert')} Use 24-hour time, 00:00 to 23:59</div>`;
    } else {
      out.innerHTML = '<div class="preview-main">--</div><div class="preview-sub">Enter start and end times</div>';
    }
    return;
  }
  let mins = en - s;
  const overnight = mins <= 0;
  if (overnight) mins += 1440;
  mins -= Number(f.break_minutes.value) || 0;
  if (mins <= 0) {
    out.classList.add('warn');
    out.innerHTML = `<div class="preview-main">${icon('alert')} Break is longer than the shift</div>`;
    return;
  }
  const staff = staffList.find((x) => String(x.id) === String(selectedStaffId));
  const pay = staff ? `<small>${money(Math.round(mins * staff.rate_pence / 60))}</small>` : '';
  const parts = [];
  if (overnight && f.shift_date.value) parts.push(`<span class="badge night">${icon('moon')}Overnight</span> ends ${fmtDate(addDays(f.shift_date.value, 1))}, ${esc(f.end_time.value)}`);
  if (f.shift_date.value) parts.push(`Counts in week ${weekLabel(weekStart(f.shift_date.value))}`);
  out.innerHTML = `<div class="preview-main">${hours(mins)} ${pay}</div><div class="preview-sub">${parts.join('<br>')}</div>`;
}

async function loadAdd() {
  if (!shiftForm.elements.shift_date.value) setDate(today());
  renderStaffChips();
  setBreak(Number(shiftForm.elements.break_minutes.value) || 0);
  await loadHoursList();
}

async function loadHoursList() {
  $('#hours-title').textContent = weekName(hoursWeek);
  $('#hours-week').textContent = weekLabel(hoursWeek);
  if (!selectedStaffId) { $('#hours-list').innerHTML = ''; $('#hours-summary').innerHTML = ''; return; }
  const showMoney = !isStaff();
  const shifts = showMoney
    ? await api(`/shifts?staff_id=${selectedStaffId}&week_start=${hoursWeek}`)
    : (await api(`/my?week=${hoursWeek}`)).shifts;
  shifts.sort((a, b) => (a.shift_date + a.start_time).localeCompare(b.shift_date + b.start_time));
  const total = shifts.reduce((t, s) => t + s.minutes, 0);
  const pay = shifts.reduce((t, s) => t + shiftPay(s), 0);
  const paid = shifts.some((s) => s.paid);
  const staff = staffList.find((x) => String(x.id) === String(selectedStaffId));
  const who = isStaff() ? (ME.staff_name || 'You') : (staff?.name || '');
  $('#hours-summary').innerHTML = shifts.length ? `
    <div class="summary-bar">
      <span>${esc(who)} · <strong>${hours(total)}</strong></span>
      <span>${showMoney ? `<strong>${money(pay)}</strong> ` : ''}${statusBadge(paid)}</span>
    </div>` : '';
  $('#hours-list').innerHTML = shifts.length ? shifts.map((s) => {
    const d = utc(s.shift_date);
    return `
    <div class="item">
      <div class="date-block"><div class="d">${DAYS[d.getUTCDay()]}</div><div class="n">${d.getUTCDate()}</div></div>
      <div class="item-main">
        <span class="item-title">${s.start_time} – ${s.end_time} ${s.end_time <= s.start_time ? `<span class="badge night">${icon('moon')}+1 day</span>` : ''}</span>
        <span class="item-sub">${hours(s.minutes)}${s.break_minutes ? ` · ${s.break_minutes}m break` : ''}${showMoney ? ' · ' + money(shiftPay(s)) : ''}${s.note ? ' · ' + esc(s.note) : ''}${showMoney && s.created_by_role === 'staff' ? ' · added by ' + esc(s.created_by_name) : ''}</span>
      </div>
      ${s.paid ? '' : `<div class="item-actions">
        <button class="icon-btn" data-edit='${esc(JSON.stringify(s))}' aria-label="Edit shift">${icon('pencil')}</button>
        <button class="icon-btn danger" data-del="${s.id}" aria-label="Delete shift">${icon('trash')}</button>
      </div>`}
    </div>`;
  }).join('') : emptyState('calendar', isStaff() ? 'No shifts in this week yet.' : `No shifts for ${esc(staff?.name || 'this person')} in this week.`);
}

$('#hours-switch').addEventListener('click', (e) => {
  const b = e.target.closest('[data-step]');
  if (b) { hoursWeek = addDays(hoursWeek, Number(b.dataset.step) * 7); loadHoursList(); }
});

function resetShiftForm() {
  const f = shiftForm.elements;
  f.edit_id.value = '';
  f.start_time.value = '';
  f.end_time.value = '';
  f.note.value = '';
  setBreak(0);
  $('#shift-submit').textContent = 'Save shift';
  $('#shift-cancel').classList.add('hidden');
  $('#shift-error').textContent = '';
  $('#view-title').textContent = 'Add hours';
  renderStaffChips();
  updatePreview();
}

shiftForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = shiftForm.elements;
  $('#shift-error').textContent = '';
  if (!selectedStaffId) { $('#shift-error').textContent = 'Add a staff member first'; return; }
  if (!f.shift_date.value) { $('#shift-error').textContent = 'Pick a date'; return; }
  if (parseTime(f.start_time.value) === null || parseTime(f.end_time.value) === null) {
    $('#shift-error').textContent = 'Enter From and To as 24-hour times, e.g. 09:00 and 17:30';
    return;
  }
  const data = { ...formData(shiftForm), staff_id: selectedStaffId };
  const btn = $('#shift-submit');
  btn.disabled = true;
  try {
    const editing = !!data.edit_id;
    if (editing) await api('/shifts/' + data.edit_id, { method: 'PUT', body: data });
    else await api('/shifts', { method: 'POST', body: data });
    hoursWeek = weekStart(data.shift_date);
    resetShiftForm();
    toast(editing ? 'Shift updated' : 'Shift saved');
    // The next shift is usually the following day.
    if (!editing) setDate(addDays(data.shift_date, 1));
    await loadHoursList();
  } catch (err) { $('#shift-error').textContent = err.message; }
  finally { btn.disabled = false; }
});
$('#shift-cancel').addEventListener('click', resetShiftForm);

$('#hours-list').addEventListener('click', async (e) => {
  const edit = e.target.closest('[data-edit]');
  const del = e.target.closest('[data-del]');
  if (edit) {
    const s = JSON.parse(edit.dataset.edit);
    const f = shiftForm.elements;
    f.edit_id.value = s.id;
    if (!isStaff()) selectedStaffId = String(s.staff_id);
    renderStaffChips();
    f.start_time.value = s.start_time; f.end_time.value = s.end_time;
    f.note.value = s.note || '';
    setBreak(s.break_minutes);
    setDate(s.shift_date);
    $('#shift-submit').textContent = 'Save changes';
    $('#shift-cancel').classList.remove('hidden');
    $('#view-title').textContent = 'Edit shift';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (del && await confirmSheet({ title: 'Delete shift?', message: 'This shift will be removed from the week.', confirmText: 'Delete', danger: true })) {
    try { await api('/shifts/' + del.dataset.del, { method: 'DELETE' }); toast('Shift deleted'); await loadHoursList(); }
    catch (err) { toast(err.message); }
  }
});

// ---------- weeks ----------
let weeksData = [];
let weeksStatus = 'unpaid';

function setWeeksStatus(st) {
  weeksStatus = st;
  $$('#weeks-status button').forEach((b) => b.classList.toggle('active', b.dataset.status === st));
}

async function loadWeeks() {
  const staffId = $('#weeks-staff').value;
  weeksData = await api('/weeks' + (staffId ? `?staff_id=${staffId}` : ''));
  renderWeeks();
}

function renderWeeks() {
  const list = weeksData.filter((w) => !weeksStatus || (weeksStatus === 'paid') === w.paid);
  const amount = (w) => (w.paid ? w.paid_pence : w.amount_pence);
  const total = list.reduce((t, w) => t + amount(w), 0);
  const mins = list.reduce((t, w) => t + w.minutes, 0);
  $('#weeks-total').innerHTML = list.length ? `
    <div class="summary-bar">
      <span>${list.length} week${list.length > 1 ? 's' : ''} · ${hours(mins)}</span>
      <strong>${weeksStatus === 'unpaid' ? 'Owed ' : ''}${money(total)}</strong>
    </div>` : '';
  const msg = { unpaid: 'Nothing owed. All weeks are paid.', paid: 'No paid weeks yet.', '': 'No hours recorded yet.' }[weeksStatus];
  $('#weeks-list').innerHTML = list.length ? list.map((w) => {
    const i = weeksData.indexOf(w);
    return `
    <div class="item week-card">
      <div class="row">
        <span class="avatar">${esc(initials(w.name))}</span>
        <span class="item-main">
          <span class="item-title">${esc(w.name)}</span>
          <span class="item-sub">${weekLabel(w.week_start)}</span>
        </span>
        <span class="item-end">
          <span class="item-amount">${money(amount(w))}</span>
          ${statusBadge(w.paid)}
        </span>
      </div>
      <div class="item-sub">${hours(w.minutes)} · ${w.shift_count} shift${w.shift_count > 1 ? 's' : ''}${w.paid ? ` · paid ${fmtDate(w.paid_on)}${w.method ? ' by ' + esc(w.method.toLowerCase()) : ''}` : ''}</div>
      <div class="details hidden" id="detail-${i}"></div>
      <div class="card-actions" ${w.paid ? 'style="grid-template-columns:1fr"' : ''}>
        <button class="btn ghost sm" data-detail="${i}">${icon('list')} Shifts</button>
        ${w.paid ? '' : `<button class="btn success sm" data-pay="${i}">${icon('check')} Mark paid</button>`}
      </div>
    </div>`;
  }).join('') : emptyState(weeksStatus === 'unpaid' ? 'check' : 'calendar', msg);
}

$('#weeks-staff').addEventListener('change', loadWeeks);
$('#weeks-status').addEventListener('click', (e) => {
  const b = e.target.closest('[data-status]');
  if (b) { setWeeksStatus(b.dataset.status); renderWeeks(); }
});

$('#weeks-list').addEventListener('click', async (e) => {
  const det = e.target.closest('[data-detail]');
  if (det) {
    const box = $('#detail-' + det.dataset.detail);
    if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return; }
    const w = weeksData[det.dataset.detail];
    const shifts = await api(`/shifts?staff_id=${w.staff_id}&week_start=${w.week_start}`);
    shifts.sort((a, b) => (a.shift_date + a.start_time).localeCompare(b.shift_date + b.start_time));
    box.innerHTML = shifts.map((s) => `
      <div class="line">
        <span>${fmtDate(s.shift_date)} · ${s.start_time}–${s.end_time}${s.end_time <= s.start_time ? ' (+1)' : ''}${s.break_minutes ? ` · ${s.break_minutes}m break` : ''}</span>
        <strong>${hours(s.minutes)}</strong>
      </div>`).join('');
    box.classList.remove('hidden');
  }
  const pay = e.target.closest('[data-pay]');
  if (pay) openPaySheet(weeksData[pay.dataset.pay]);
});

function openPaySheet(w) {
  const body = openSheet(`
    <form class="sheet-form" id="pay-form" novalidate>
      <h3>Mark week as paid</h3>
      <div class="sheet-summary">
        <div>
          <div class="item-title">${esc(w.name)}</div>
          <div class="item-sub">${weekLabel(w.week_start)}</div>
          <div class="item-sub">${hours(w.minutes)}</div>
        </div>
        <div class="big">${money(w.amount_pence)}</div>
      </div>
      <label class="field"><span>Paid on</span><input name="paid_on" type="date" class="input" value="${today()}" required></label>
      <div class="field">
        <span>Method</span>
        <div class="segmented" id="pay-method">
          <button type="button" data-m="Cash" class="active">Cash</button>
          <button type="button" data-m="Bank transfer">Bank</button>
          <button type="button" data-m="Other">Other</button>
        </div>
      </div>
      <label class="field"><span>Note <em>(optional)</em></span><input name="note" class="input" maxlength="200"></label>
      <p class="error" id="pay-error" role="alert"></p>
      <div class="sheet-actions">
        <button type="button" class="btn ghost" id="pay-cancel">Cancel</button>
        <button type="submit" class="btn success">${icon('check')} Paid</button>
      </div>
    </form>`);
  let method = 'Cash';
  $('#pay-method', body).addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    method = b.dataset.m;
    $$('#pay-method button', body).forEach((x) => x.classList.toggle('active', x === b));
  });
  $('#pay-cancel', body).addEventListener('click', closeSheet);
  $('#pay-form', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/payments', { method: 'POST', body: { ...formData(e.target), method, staff_id: w.staff_id, week_start: w.week_start } });
      closeSheet();
      toast(`${money(w.amount_pence)} paid to ${w.name}`);
      await loadWeeks();
    } catch (err) { $('#pay-error').textContent = err.message; }
  });
}

// ---------- payments ----------
async function loadPayments() {
  const staffId = $('#payments-staff').value;
  const q = staffId ? `?staff_id=${staffId}` : '';
  const [payments, weeks] = await Promise.all([api('/payments' + q), api('/weeks' + q)]);
  const paidTotal = payments.reduce((t, p) => t + p.amount_pence, 0);
  const unpaid = weeks.filter((w) => !w.paid);
  const owed = unpaid.reduce((t, w) => t + w.amount_pence, 0);
  $('#payments-stats').innerHTML = `
    <div class="stat"><span class="stat-label"><span class="dot paid"></span>Total paid</span><span class="stat-value">${money(paidTotal)}</span><span class="stat-sub">${payments.length} payment${payments.length === 1 ? '' : 's'}</span></div>
    <button class="stat" id="pay-owed"><span class="stat-label"><span class="dot unpaid"></span>Still owed</span><span class="stat-value">${money(owed)}</span><span class="stat-sub">${unpaid.length} unpaid week${unpaid.length === 1 ? '' : 's'}</span></button>`;
  $('#payments-list').innerHTML = payments.length ? payments.map((p) => `
    <div class="item">
      <span class="avatar">${esc(initials(p.name))}</span>
      <span class="item-main">
        <span class="item-title">${esc(p.name)} · ${money(p.amount_pence)}</span>
        <span class="item-sub">${fmtDate(p.paid_on)}${p.method ? ' · ' + esc(p.method) : ''} · ${hours(p.minutes)}</span>
        <span class="item-sub">Week ${weekLabel(p.week_start)}${p.note ? ' · ' + esc(p.note) : ''}</span>
      </span>
      <button class="icon-btn" data-undo="${p.id}" aria-label="Undo payment">${icon('undo')}</button>
    </div>`).join('') : emptyState('wallet', 'No payments yet.');
}
$('#payments-staff').addEventListener('change', loadPayments);
$('#payments-stats').addEventListener('click', (e) => {
  if (e.target.closest('#pay-owed')) {
    $('#weeks-staff').value = $('#payments-staff').value;
    setWeeksStatus('unpaid');
    go('weeks');
  }
});

$('#payments-list').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-undo]');
  if (b && await confirmSheet({ title: 'Undo payment?', message: 'The week goes back to Unpaid and its shifts can be edited again.', confirmText: 'Undo payment', danger: true })) {
    await api('/payments/' + b.dataset.undo, { method: 'DELETE' });
    toast('Payment undone');
    loadPayments();
  }
});

// ---------- my hours (staff logins) ----------
let myWeek = null;

async function loadMy() {
  const d = await api(`/my?week=${myWeek}`);
  myWeek = d.week_start;
  const name = weekName(d.week_start);
  $('#view-title').textContent = 'My hours';
  $('#my-title').textContent = name;
  $('#my-week').textContent = weekLabel(d.week_start);
  $('#my-hours').textContent = hours(d.total_minutes);
  $('#my-status').innerHTML = d.paid === null ? '' : statusBadge(d.paid).replace('class="badge', 'class="badge lg');
  $('#my-shifts').innerHTML = d.shifts.length ? d.shifts.map((s) => {
    const dt = utc(s.shift_date);
    return `
    <div class="item">
      <div class="date-block"><div class="d">${DAYS[dt.getUTCDay()]}</div><div class="n">${dt.getUTCDate()}</div></div>
      <div class="item-main">
        <span class="item-title">${s.start_time} – ${s.end_time} ${s.end_time <= s.start_time ? `<span class="badge night">${icon('moon')}+1 day</span>` : ''}</span>
        <span class="item-sub">${hours(s.minutes)}${s.break_minutes ? ` · ${s.break_minutes}m break` : ''}${s.note ? ' · ' + esc(s.note) : ''}</span>
      </div>
    </div>`;
  }).join('') : emptyState('calendar', 'No shifts in this week. Tap Add hours to enter one.');
  $('#my-weeks').innerHTML = d.weeks.length ? d.weeks.map((w) => `
    <button class="item" data-week="${w.week_start}">
      <span class="item-main">
        <span class="item-title">${weekName(w.week_start)}</span>
        <span class="item-sub">${weekLabel(w.week_start)} · ${w.shift_count} shift${w.shift_count > 1 ? 's' : ''}</span>
      </span>
      <span class="item-end">
        <span class="item-amount">${hours(w.minutes)}</span>
        ${statusBadge(w.paid)}
      </span>
    </button>`).join('') : emptyState('clock', 'No hours recorded yet.');
}

$('#my-switch').addEventListener('click', (e) => {
  const b = e.target.closest('[data-step]');
  if (!b) return;
  const step = Number(b.dataset.step);
  myWeek = step === 0 ? weekStart(today()) : addDays(myWeek, step * 7);
  loadMy();
});
$('#my-weeks').addEventListener('click', (e) => {
  const b = e.target.closest('[data-week]');
  if (b) { myWeek = b.dataset.week; loadMy(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
});

// ---------- logins (admins) ----------
let loginsData = [];

async function loadLogins() {
  [loginsData] = await Promise.all([api('/users'), loadStaff()]);
  $('#logins-list').innerHTML = loginsData.map((u) => `
    <div class="item">
      <span class="avatar ${u.role === 'admin' ? '' : 'off'}">${esc(initials(u.username))}</span>
      <span class="item-main">
        <span class="item-title">${esc(u.username)}${u.username === ME.username ? ' <span class="badge neutral">You</span>' : ''}</span>
        <span class="item-sub">${u.role === 'admin' ? 'Admin · full access' : 'Staff · ' + esc(u.staff_name || '')}</span>
      </span>
      <div class="item-actions">
        <button class="icon-btn" data-reset="${u.id}" aria-label="Reset password for ${esc(u.username)}">${icon('key')}</button>
        ${u.username === ME.username ? '' : `<button class="icon-btn danger" data-remove="${u.id}" aria-label="Remove login ${esc(u.username)}">${icon('trash')}</button>`}
      </div>
    </div>`).join('');
}

function openLoginSheet() {
  const taken = new Set(loginsData.filter((u) => u.staff_id).map((u) => u.staff_id));
  const free = staffList.filter((s) => s.active && !taken.has(s.id));
  const body = openSheet(`
    <form class="sheet-form" id="login-form-new" novalidate>
      <h3>Add login</h3>
      <div class="segmented" id="login-role">
        <button type="button" data-role="staff" class="active">Staff</button>
        <button type="button" data-role="admin">Admin</button>
      </div>
      <p class="hint" id="login-role-hint">Staff can add their own hours and see their own hours. No pay or rates.</p>
      <label class="field" id="login-staff-field"><span>Staff member</span>
        <select name="staff_id" class="input select">${free.length ? free.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('') : '<option value="">Everyone already has a login</option>'}</select>
      </label>
      <label class="field"><span>Username</span><input name="username" class="input" autocapitalize="none" autocomplete="off" spellcheck="false" required></label>
      <label class="field"><span>Password (min 8 characters)</span><input name="password" class="input" type="text" autocomplete="off" minlength="8" required></label>
      <p class="error" id="login-new-error" role="alert"></p>
      <div class="sheet-actions">
        <button type="button" class="btn ghost" id="login-cancel">Cancel</button>
        <button type="submit" class="btn primary">Create</button>
      </div>
    </form>`);
  let role = 'staff';
  const f = $('#login-form-new', body);
  // Suggest a username from the staff member's first name.
  const suggest = () => {
    const s = staffList.find((x) => String(x.id) === f.elements.staff_id.value);
    if (role === 'staff' && s && !f.elements.username.dataset.touched) f.elements.username.value = s.name.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9._-]/g, '');
  };
  suggest();
  f.elements.staff_id.addEventListener('change', suggest);
  f.elements.username.addEventListener('input', () => { f.elements.username.dataset.touched = '1'; });
  $('#login-role', body).addEventListener('click', (e) => {
    const b = e.target.closest('[data-role]');
    if (!b) return;
    role = b.dataset.role;
    $('#login-role button', body).forEach((x) => x.classList.toggle('active', x === b));
    $('#login-staff-field', body).classList.toggle('hidden', role !== 'staff');
    $('#login-role-hint', body).textContent = role === 'admin'
      ? 'Admins have full access: all staff, hours, pay, payments and logins.'
      : 'Staff can add their own hours and see their own hours. No pay or rates.';
  });
  $('#login-cancel', body).addEventListener('click', closeSheet);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = { ...formData(f), role };
    try {
      await api('/users', { method: 'POST', body: data });
      closeSheet();
      toast(`Login created: ${data.username.trim().toLowerCase()}`);
      loadLogins();
    } catch (err) { $('#login-new-error').textContent = err.message; }
  });
}
$('#add-login').addEventListener('click', openLoginSheet);

$('#logins-list').addEventListener('click', async (e) => {
  const reset = e.target.closest('[data-reset]');
  const remove = e.target.closest('[data-remove]');
  if (reset) {
    const u = loginsData.find((x) => String(x.id) === reset.dataset.reset);
    const body = openSheet(`
      <form class="sheet-form" id="reset-form" novalidate>
        <h3>Reset password</h3>
        <p class="muted">New password for <strong>${esc(u.username)}</strong>. Give it to them; they can change it in Settings.</p>
        <label class="field"><span>New password (min 8 characters)</span><input name="password" class="input" type="text" autocomplete="off" minlength="8" required></label>
        <p class="error" id="reset-error" role="alert"></p>
        <div class="sheet-actions">
          <button type="button" class="btn ghost" id="reset-cancel">Cancel</button>
          <button type="submit" class="btn primary">Save</button>
        </div>
      </form>`);
    $('#reset-cancel', body).addEventListener('click', closeSheet);
    $('#reset-form', body).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        await api('/users/' + u.id, { method: 'PUT', body: formData(ev.target) });
        closeSheet(); toast(`Password reset for ${u.username}`);
      } catch (err) { $('#reset-error').textContent = err.message; }
    });
  }
  if (remove) {
    const u = loginsData.find((x) => String(x.id) === remove.dataset.remove);
    if (await confirmSheet({ title: 'Remove login?', message: `${u.username} will no longer be able to sign in. Their hours stay saved.`, confirmText: 'Remove', danger: true })) {
      try { await api('/users/' + u.id, { method: 'DELETE' }); toast('Login removed'); loadLogins(); }
      catch (err) { toast(err.message); }
    }
  }
});

// ---------- settings ----------
$('#pw-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#pw-msg');
  msg.textContent = '';
  try {
    await api('/change-password', { method: 'POST', body: formData(e.target) });
    e.target.reset();
    $('#pw-banner').classList.add('hidden');
    toast('Password updated');
  } catch (err) { msg.textContent = err.message; }
});

// ---------- start ----------
hydrateIcons();
api('/me').then((me) => { applyMe(me); showApp(); }).catch(() => showLogin());
