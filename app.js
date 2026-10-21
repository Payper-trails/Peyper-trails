// Custom storage: if "keep me logged in" is unchecked, the session lives only
// in sessionStorage (cleared when the browser closes) instead of localStorage.
const PERSIST_FLAG = 'peyper_persist';
const authStorage = {
  getItem: (key) => {
    const store = localStorage.getItem(PERSIST_FLAG) === 'false' ? sessionStorage : localStorage;
    return store.getItem(key);
  },
  setItem: (key, value) => {
    const store = localStorage.getItem(PERSIST_FLAG) === 'false' ? sessionStorage : localStorage;
    store.setItem(key, value);
  },
  removeItem: (key) => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  },
};

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storage: authStorage, persistSession: true, autoRefreshToken: true },
});

let currentUser = null;
let vehiclesCache = [];
let currentVehicleId = null; // the vehicle whose page is open (null = dashboard)
let fabMode = 'vehicle'; // what the round + button adds: 'vehicle' or 'part'

const $ = (id) => document.getElementById(id);

// ---------------- AUTH ----------------
let authMode = 'login'; // or 'signup'

$('authToggleBtn').addEventListener('click', () => {
  authMode = authMode === 'login' ? 'signup' : 'login';
  $('authTitle').textContent = authMode === 'login' ? 'Log in' : 'Sign up';
  $('authSubmit').textContent = authMode === 'login' ? 'Log in' : 'Create account';
  $('authToggleText').textContent = authMode === 'login' ? "Don't have an account?" : "Already have an account?";
  $('authToggleBtn').textContent = authMode === 'login' ? 'Sign up' : 'Log in';
  $('authError').classList.add('hidden');
});

$('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  $('authError').classList.add('hidden');
  $('authSubmit').disabled = true;

  // Set BEFORE calling auth, so the session gets written to the right storage
  localStorage.setItem(PERSIST_FLAG, $('keepLoggedIn').checked ? 'true' : 'false');

  try {
    if (authMode === 'login') {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      offerToSavePassword(email, password);
      await checkSession();
    } else {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      if (data.session) {
        // Email confirmation is off — logged in immediately
        offerToSavePassword(email, password);
        await checkSession();
      } else {
        // Email confirmation required — tell the person clearly what to do next
        $('authError').classList.remove('hidden');
        $('authError').classList.remove('error-msg');
        $('authError').classList.add('info-msg');
        $('authError').textContent = `Almost there — we've sent a confirmation link to ${email}. Open that email and tap the link, then come back here and log in.`;
      }
    }
  } catch (err) {
    $('authError').classList.remove('info-msg');
    $('authError').classList.add('error-msg');
    if ((err.message || '').toLowerCase().includes('email not confirmed')) {
      $('authError').innerHTML = `Your email isn't confirmed yet. <button type="button" id="resendConfirmBtn" class="link-btn-plain" style="color:inherit;">Resend confirmation email</button>`;
      $('authError').classList.remove('hidden');
      $('resendConfirmBtn').addEventListener('click', async () => {
        $('resendConfirmBtn').disabled = true;
        $('resendConfirmBtn').textContent = 'Sending...';
        try {
          const { error: resendError } = await sb.auth.resend({ type: 'signup', email });
          if (resendError) throw resendError;
          $('authError').classList.remove('error-msg');
          $('authError').classList.add('info-msg');
          $('authError').textContent = `Confirmation email resent to ${email}. Check your inbox.`;
        } catch (resendErr) {
          $('resendConfirmBtn').disabled = false;
          $('resendConfirmBtn').textContent = 'Resend confirmation email';
          alert(resendErr.message || 'Could not resend — try again in a moment.');
        }
      });
      return;
    }
    $('authError').textContent = err.message || 'Something went wrong. Try again.';
    $('authError').classList.remove('hidden');
  } finally {
    $('authSubmit').disabled = false;
  }
});

// Prompts the browser's built-in "Save password?" popup (Chrome, Edge, etc.)
function offerToSavePassword(email, password) {
  if (window.PasswordCredential) {
    const cred = new PasswordCredential({ id: email, password, name: email });
    navigator.credentials.store(cred).catch(() => {});
  }
}

$('logoutBtn').addEventListener('click', async () => {
  await sb.auth.signOut();
  currentUser = null;
  showAuthScreen();
});

// ---------------- PASSWORD VISIBILITY TOGGLES ----------------
function wireupPasswordToggle(inputId, btnId) {
  const btn = $(btnId);
  const input = $(inputId);
  btn.addEventListener('click', () => {
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    btn.textContent = showing ? 'Show' : 'Hide';
  });
}
wireupPasswordToggle('authPassword', 'togglePassword');
wireupPasswordToggle('newPasswordInput', 'toggleNewPassword');

// ---------------- FORGOT PASSWORD ----------------
$('forgotPasswordBtn').addEventListener('click', () => {
  $('forgotEmail').value = $('authEmail').value.trim();
  $('forgotMsg').classList.add('hidden');
  $('forgotModal').classList.remove('hidden');
});
$('closeForgotModal').addEventListener('click', () => {
  $('forgotModal').classList.add('hidden');
});

$('forgotForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('forgotEmail').value.trim();
  $('forgotSubmit').disabled = true;
  try {
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) throw error;
    $('forgotMsg').className = 'info-msg';
    $('forgotMsg').textContent = `Check ${email} for a password reset link.`;
  } catch (err) {
    $('forgotMsg').className = 'error-msg';
    $('forgotMsg').textContent = err.message || 'Something went wrong. Try again.';
  } finally {
    $('forgotSubmit').disabled = false;
  }
});

// ---------------- SET NEW PASSWORD (after clicking reset link) ----------------
// Supabase fires this event when the person arrives via a password-reset link
sb.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') {
    $('authScreen').classList.add('hidden');
    $('newPasswordModal').classList.remove('hidden');
  }
});

$('newPasswordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = $('newPasswordInput').value;
  $('newPasswordSubmit').disabled = true;
  try {
    const { error } = await sb.auth.updateUser({ password });
    if (error) throw error;
    $('newPasswordModal').classList.add('hidden');
    await checkSession();
  } catch (err) {
    $('newPasswordMsg').className = 'error-msg';
    $('newPasswordMsg').classList.remove('hidden');
    $('newPasswordMsg').textContent = err.message || 'Something went wrong. Try again.';
  } finally {
    $('newPasswordSubmit').disabled = false;
  }
});

async function checkSession() {
  const { data: { session } } = await sb.auth.getSession();
  if (session && session.user) {
    currentUser = session.user;
    showDashboard();
    await loadVehicles();
  } else {
    showAuthScreen();
  }
}

function showAuthScreen() {
  currentVehicleId = null;
  $('authScreen').classList.remove('hidden');
  $('dashScreen').classList.add('hidden');
  $('vehicleScreen').classList.add('hidden');
  $('addFab').classList.add('hidden');
  $('logoutBtn').classList.add('hidden');
  $('exportBtn').classList.add('hidden');
  $('footer').classList.add('hidden');
}

// Shows the dashboard (the grid of vehicles)
function showDashboard() {
  currentVehicleId = null;
  fabMode = 'vehicle';
  $('addFab').setAttribute('aria-label', 'Add vehicle');
  $('authScreen').classList.add('hidden');
  $('vehicleScreen').classList.add('hidden');
  $('dashScreen').classList.remove('hidden');
  $('addFab').classList.remove('hidden');
  $('logoutBtn').classList.remove('hidden');
  $('exportBtn').classList.remove('hidden');
  $('footer').classList.remove('hidden');
}

// ---------------- LOAD & RENDER ----------------
async function loadVehicles() {
  const { data: vehicles, error } = await sb
    .from('vehicles')
    .select('*, warranties(*)')
    .order('created_at', { ascending: true });

  if (error) {
    console.error(error);
    return;
  }
  vehiclesCache = vehicles || [];
  renderGrid();
  if (currentVehicleId) {
    if (vehiclesCache.find(v => v.id === currentVehicleId)) {
      renderVehiclePage();
    } else {
      showDashboard();
    }
  }
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0,0,0,0);
  const target = new Date(dateStr);
  target.setHours(0,0,0,0);
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

function statusFromDays(days) {
  if (days === null) return null;
  if (days <= 0) return 'overdue';
  if (days <= 30) return 'soon';
  return 'ok';
}

// Soonest due date across the licence, the service, and every part's warranty and service
function nearestStatus(vehicle) {
  const candidates = [];
  const add = (dateStr) => {
    const d = daysUntil(dateStr);
    if (d !== null) candidates.push(d);
  };
  add(vehicle.licence_expiry);
  add(vehicle.service_due_date);
  (vehicle.warranties || []).forEach(p => {
    add(p.expiry_date);
    add(p.next_service_date);
  });
  if (candidates.length === 0) return { days: null, status: null };
  const min = Math.min(...candidates);
  return { days: min, status: statusFromDays(min) };
}

function ringColor(status) {
  if (status === 'overdue') return '#c23b3b';
  if (status === 'soon') return '#d99a1f';
  if (status === 'ok') return '#3e7a52';
  return 'rgba(28,28,26,0.15)';
}

// Builds a vintage speedometer-style gauge: red zone (overdue/danger) on the left,
// through amber, to green (plenty of time) on the right — needle points accordingly.
function speedoGaugeSVG(days) {
  const MAX_DAYS = 90;
  const cx = 75, cy = 74, r = 60;
  const hasData = days !== null;
  const clamped = hasData ? Math.max(0, Math.min(MAX_DAYS, days)) : MAX_DAYS / 2;
  const pct = clamped / MAX_DAYS;
  const angleDeg = 180 - pct * 180; // 180 = far left (danger), 0 = far right (safe)
  const angleRad = (angleDeg * Math.PI) / 180;

  const pt = (radius, deg) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + radius * Math.cos(rad), cy - radius * Math.sin(rad)];
  };
  const arcPath = (radius, fromDeg, toDeg) => {
    const [x1, y1] = pt(radius, fromDeg);
    const [x2, y2] = pt(radius, toDeg);
    return `M ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2}`;
  };

  const ticks = [0, 30, 60, 90, 120, 150, 180].map(deg => {
    const [x1, y1] = pt(r + 2, deg);
    const [x2, y2] = pt(r - 7, deg);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(28,28,26,0.35)" stroke-width="2"/>`;
  }).join('');

  const needleColor = hasData ? '#1c1c1a' : 'rgba(28,28,26,0.25)';
  const [nx, ny] = pt(r - 16, angleDeg);

  return `
    <svg viewBox="0 0 150 82">
      <path d="${arcPath(r, 180, 120)}" stroke="#c23b3b" stroke-width="11" fill="none" stroke-linecap="round" opacity="0.85"/>
      <path d="${arcPath(r, 120, 60)}" stroke="#d99a1f" stroke-width="11" fill="none" opacity="0.85"/>
      <path d="${arcPath(r, 60, 0)}" stroke="#3e7a52" stroke-width="11" fill="none" stroke-linecap="round" opacity="0.85"/>
      ${ticks}
      <line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" stroke="${needleColor}" stroke-width="3" stroke-linecap="round"/>
      <circle cx="${cx}" cy="${cy}" r="6" fill="${needleColor}"/>
      <circle cx="${cx}" cy="${cy}" r="2.5" fill="#eae3cd"/>
    </svg>
  `;
}

function tagHtml(status, label) {
  if (!status) return '';
  const cls = status === 'overdue' ? 'tag-overdue' : status === 'soon' ? 'tag-soon' : 'tag-ok';
  const text = status === 'overdue' ? 'Overdue' : status === 'soon' ? 'Due soon' : 'OK';
  return `<span class="tag ${cls}">${label ? label + ': ' : ''}${text}</span>`;
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Small icon versions matching the type-picker in the Add Vehicle modal
const TYPE_ICONS = {
  car: '<svg viewBox="0 0 48 32"><path d="M4 22 L8 12 Q10 9 14 9 H34 Q38 9 40 12 L44 22 M4 22 H44 M4 22 V25 H8 V22 M40 22 V25 H44 V22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><circle cx="13" cy="24" r="3.5" fill="none" stroke="currentColor" stroke-width="2.5"/><circle cx="35" cy="24" r="3.5" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>',
  bakkie: '<svg viewBox="0 0 48 32"><path d="M3 22 L6 13 Q8 10 12 10 H24 V22 M24 13 H27 V22 M4 22 H44 V16 H33 L27 13 M4 22 V25 H8 V22 M40 22 V25 H44 V22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><circle cx="12" cy="24" r="3.5" fill="none" stroke="currentColor" stroke-width="2.5"/><circle cx="36" cy="24" r="3.5" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>',
  boat: '<svg viewBox="0 0 48 32"><path d="M6 20 L42 20 L37 27 H11 Z" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><path d="M24 20 V5 M24 5 L34 13 H24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/></svg>',
  trailer: '<svg viewBox="0 0 48 32"><path d="M2 15 H10 M10 10 H38 V22 H10 Z" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><circle cx="18" cy="24" r="3.5" fill="none" stroke="currentColor" stroke-width="2.5"/><circle cx="30" cy="24" r="3.5" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>',
  caravan: '<svg viewBox="0 0 48 32"><path d="M4 22 L4 12 Q4 9 8 9 H40 Q44 9 44 13 V22 Z" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><rect x="12" y="13" width="10" height="6" fill="none" stroke="currentColor" stroke-width="2.5"/><circle cx="14" cy="24" r="3.5" fill="none" stroke="currentColor" stroke-width="2.5"/><circle cx="34" cy="24" r="3.5" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>',
  'haul-truck': '<svg viewBox="0 0 48 32"><path d="M2 22 L2 14 L14 8 L20 14 V22 M20 22 H44 V17 H20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><circle cx="9" cy="24" r="4" fill="none" stroke="currentColor" stroke-width="2.5"/><circle cx="36" cy="24" r="4" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>',
  excavator: '<svg viewBox="0 0 48 32"><path d="M4 24 H20 M6 24 L6 18 Q6 15 9 15 H17 Q20 15 20 18 V24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><path d="M15 15 L28 8 L34 10 L26 20 L18 18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/></svg>',
  loader: '<svg viewBox="0 0 48 32"><path d="M14 24 H30 Q33 24 33 21 V15 Q33 12 30 12 H20 V24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><path d="M20 18 L8 20 L6 26 H14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><circle cx="18" cy="26" r="3" fill="none" stroke="currentColor" stroke-width="2.5"/><circle cx="29" cy="26" r="3" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>',
  'drill-rig': '<svg viewBox="0 0 48 32"><path d="M24 4 V26 M18 26 H30 M14 26 H34" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><path d="M18 26 L24 8 L30 26" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/></svg>',
  other: '<svg viewBox="0 0 48 32"><circle cx="24" cy="16" r="11" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M20 13 Q20 9 24 9 Q28 9 28 13 Q28 16 24 17 V19" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><circle cx="24" cy="22" r="1.2" fill="currentColor"/></svg>',
};


function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// ---------------- PARTS: CATEGORIES & ICONS ----------------
const partSvg = (inner, sw) => `<svg viewBox="0 0 48 32" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round">${inner}</svg>`;

const PART_CATEGORIES = [
  { key: 'battery', label: 'Battery', inner: '<rect x="6" y="9" width="36" height="18" rx="2"/><path d="M14 9 V6 H19 V9 M29 9 V6 H34 V9 M15 18 H21 M18 15 V21 M29 18 H35"/>' },
  { key: 'tyres', label: 'Tyres', inner: '<circle cx="24" cy="16" r="12"/><circle cx="24" cy="16" r="5"/><path d="M24 4 V8 M24 24 V28 M12 16 H16 M32 16 H36"/>' },
  { key: 'brakes', label: 'Brakes', inner: '<circle cx="21" cy="16" r="11"/><circle cx="21" cy="16" r="3"/><path d="M32 8 Q40 16 32 24 L29 21 Q34 16 29 11 Z"/>' },
  { key: 'engine', label: 'Engine', inner: '<path d="M10 12 H18 V8 H30 V12 H36 V16 H40 V24 H36 V26 H12 V22 H8 V14 Z"/>' },
  { key: 'filters', label: 'Filters', inner: '<rect x="14" y="6" width="20" height="20" rx="3"/><path d="M14 12 H34 M14 18 H34 M20 26 V29 M28 26 V29"/>' },
  { key: 'hydraulics', label: 'Hydraulics', inner: '<rect x="6" y="11" width="22" height="10" rx="2"/><path d="M28 16 H42 M42 12 V20 M6 16 H3"/>' },
  { key: 'electrical', label: 'Electrical', inner: '<path d="M26 3 L13 18 H23 L21 29 L35 13 H25 Z"/>' },
  { key: 'other', label: 'Other', inner: '<circle cx="24" cy="16" r="11"/><path d="M20 13 Q20 9 24 9 Q28 9 28 13 Q28 16 24 17 V19"/><circle cx="24" cy="22" r="1.2" fill="currentColor"/>' },
];

function categoryOf(key) {
  return PART_CATEGORIES.find(c => c.key === key) || PART_CATEGORIES[PART_CATEGORIES.length - 1];
}

// ---------------- SMALL HELPERS ----------------
function meterUnitOf(v) { return v && v.meter_unit === 'hours' ? 'hours' : 'km'; }
function unitShort(unit) { return unit === 'hours' ? 'hrs' : 'km'; }
function hasNum(x) { return x !== null && x !== undefined && x !== ''; }
function fmtNum(x) { return Number(x).toLocaleString('en-ZA'); }
function numOrNull(s) { return s === '' || s === null || s === undefined ? null : Number(s); }
function todayStr() { return new Date().toLocaleDateString('en-CA'); }
function prettyType(t) { return (t || 'other').replace(/-/g, ' '); }

function currentMeter(v) {
  const val = meterUnitOf(v) === 'hours' ? v.current_hours : v.current_km;
  return hasNum(val) ? Number(val) : null;
}
function serviceDueMeter(v) {
  const val = meterUnitOf(v) === 'hours' ? v.service_due_hours : v.service_due_km;
  return hasNum(val) ? Number(val) : null;
}

// ---------------- DASHBOARD CARDS ----------------
function renderGrid() {
  const grid = $('vehicleGrid');
  const empty = $('emptyState');
  grid.innerHTML = '';

  if (vehiclesCache.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  vehiclesCache.forEach(v => {
    const { days } = nearestStatus(v);
    const daysLabel = days === null ? '—' : (days <= 0 ? 'DUE' : `${days} days left`);
    const unit = meterUnitOf(v);
    const licStatus = statusFromDays(daysUntil(v.licence_expiry));
    const svcStatus = statusFromDays(daysUntil(v.service_due_date));
    const dueAt = serviceDueMeter(v);
    const partsCount = (v.warranties || []).length;

    const card = document.createElement('div');
    card.className = 'disc-card disc-card-tap';
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    card.dataset.open = v.id;
    card.innerHTML = `
      <div class="disc-head">
        <div class="speedo-gauge">${speedoGaugeSVG(days)}</div>
        <div class="speedo-readout">${daysLabel}</div>
        <div class="disc-name-row">
          <span class="disc-type-icon">${TYPE_ICONS[v.vehicle_type] || TYPE_ICONS.other}</span>
          <div class="disc-name">${escapeHtml(v.name)}</div>
        </div>
        <div class="disc-type">${escapeHtml(prettyType(v.vehicle_type))}</div>
      </div>
      <div class="disc-rows">
        <div class="disc-row"><span class="k">Licence</span><span class="v">${fmtDate(v.licence_expiry)} ${tagHtml(licStatus)}</span></div>
        ${v.service_due_date ? `<div class="disc-row"><span class="k">Service due</span><span class="v">${fmtDate(v.service_due_date)} ${tagHtml(svcStatus)}</span></div>` : ''}
        ${dueAt !== null ? `<div class="disc-row"><span class="k">Service at</span><span class="v">${fmtNum(dueAt)} ${unitShort(unit)}</span></div>` : ''}
        <div class="disc-row"><span class="k">Parts tracked</span><span class="v">${partsCount}</span></div>
      </div>
      <div class="disc-actions">
        <span class="open-hint">Open &rarr;</span>
      </div>
    `;
    grid.appendChild(card);
  });

  grid.querySelectorAll('[data-open]').forEach(card => {
    card.addEventListener('click', () => openVehiclePage(card.dataset.open));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openVehiclePage(card.dataset.open);
      }
    });
  });
}

// ---------------- VEHICLE PAGE ----------------
function openVehiclePage(id, push = true) {
  const v = vehiclesCache.find(x => x.id === id);
  if (!v) return;
  currentVehicleId = id;
  if (push) history.pushState({ vehicleId: id }, '');
  $('dashScreen').classList.add('hidden');
  $('vehicleScreen').classList.remove('hidden');
  fabMode = 'part';
  $('addFab').setAttribute('aria-label', 'Add part');
  window.scrollTo(0, 0);
  renderVehiclePage();
}

$('backBtn').addEventListener('click', () => {
  if (history.state && history.state.vehicleId) {
    history.back(); // the popstate handler below shows the dashboard
  } else {
    showDashboard();
  }
});

window.addEventListener('popstate', (e) => {
  if (!currentUser) return;
  const id = e.state && e.state.vehicleId;
  if (id && vehiclesCache.find(v => v.id === id)) {
    openVehiclePage(id, false);
  } else {
    showDashboard();
  }
});

// Soonest due date (warranty end or next service) for a part, in days — used to sort the parts list
function partNearestDays(p) {
  const list = [daysUntil(p.expiry_date), daysUntil(p.next_service_date)].filter(d => d !== null);
  return list.length ? Math.min(...list) : Infinity;
}

function renderVehiclePage() {
  const v = vehiclesCache.find(x => x.id === currentVehicleId);
  if (!v) return;
  const unit = meterUnitOf(v);
  const { days } = nearestStatus(v);
  const daysLabel = days === null ? '—' : (days <= 0 ? 'DUE' : `${days} days left`);
  const cur = currentMeter(v);
  const dueAt = serviceDueMeter(v);
  const licStatus = statusFromDays(daysUntil(v.licence_expiry));
  const svcStatus = statusFromDays(daysUntil(v.service_due_date));

  $('vehicleHeader').innerHTML = `
    <div class="disc-card vehicle-head">
      <div class="disc-head">
        <div class="speedo-gauge">${speedoGaugeSVG(days)}</div>
        <div class="speedo-readout">${daysLabel}</div>
        <div class="disc-name-row">
          <span class="disc-type-icon">${TYPE_ICONS[v.vehicle_type] || TYPE_ICONS.other}</span>
          <div class="disc-name">${escapeHtml(v.name)}</div>
        </div>
        <div class="disc-type">${escapeHtml(prettyType(v.vehicle_type))}</div>
      </div>
      <div class="disc-rows">
        <div class="disc-row"><span class="k">${unit === 'hours' ? 'Hour meter' : 'Odometer'}</span><span class="v">${cur !== null ? fmtNum(cur) + ' ' + unitShort(unit) : '—'}</span></div>
        <div class="disc-row"><span class="k">Licence</span><span class="v">${fmtDate(v.licence_expiry)} ${tagHtml(licStatus)}</span></div>
        ${v.service_due_date ? `<div class="disc-row"><span class="k">Service due</span><span class="v">${fmtDate(v.service_due_date)} ${tagHtml(svcStatus)}</span></div>` : ''}
        ${dueAt !== null ? `<div class="disc-row"><span class="k">Service at</span><span class="v">${fmtNum(dueAt)} ${unitShort(unit)}</span></div>` : ''}
        ${v.notes ? `<div class="disc-row"><span class="k">Notes</span><span class="v" style="font-family:'Inter',sans-serif; font-weight:500; text-align:right;">${escapeHtml(v.notes)}</span></div>` : ''}
      </div>
      <div class="vehicle-actions">
        <button class="btn-primary" id="editVehicleBtn">Edit vehicle info</button>
        <button class="btn-outline-dark" id="readingLogBtn">Reading log</button>
      </div>
    </div>
  `;
  $('editVehicleBtn').addEventListener('click', () => openModal(v.id));
  $('readingLogBtn').addEventListener('click', () => openReadingLog(v.id));

  const parts = (v.warranties || []).slice().sort((a, b) => partNearestDays(a) - partNearestDays(b));
  const grid = $('partsGrid');
  grid.innerHTML = '';
  $('partsEmpty').classList.toggle('hidden', parts.length > 0);

  parts.forEach(p => {
    const cat = categoryOf(p.category);
    const wStatus = statusFromDays(daysUntil(p.expiry_date));
    const sStatus = statusFromDays(daysUntil(p.next_service_date));
    const hasWarranty = p.expiry_date || hasNum(p.expiry_km);
    const hasService = p.next_service_date || hasNum(p.next_service_value);

    const card = document.createElement('div');
    card.className = 'part-card';
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    card.dataset.part = p.id;
    card.innerHTML = `
      <div class="part-top">
        <span class="part-icon">${partSvg(cat.inner, 2.5)}</span>
        <div>
          <div class="part-name">${escapeHtml(p.item_name)}</div>
          <div class="part-cat">${escapeHtml(cat.label)}</div>
        </div>
      </div>
      <div class="part-tags">${tagHtml(wStatus, 'Warranty')}${tagHtml(sStatus, 'Service')}</div>
      <div class="disc-rows">
        ${hasWarranty ? `<div class="disc-row"><span class="k">Warranty ends</span><span class="v">${p.expiry_date ? fmtDate(p.expiry_date) : ''}${p.expiry_date && hasNum(p.expiry_km) ? ' · ' : ''}${hasNum(p.expiry_km) ? fmtNum(p.expiry_km) + ' ' + unitShort(unit) : ''}</span></div>` : ''}
        ${hasService ? `<div class="disc-row"><span class="k">Next service</span><span class="v">${p.next_service_date ? fmtDate(p.next_service_date) : ''}${p.next_service_date && hasNum(p.next_service_value) ? ' · ' : ''}${hasNum(p.next_service_value) ? fmtNum(p.next_service_value) + ' ' + unitShort(unit) : ''}</span></div>` : ''}
        ${!hasWarranty && !hasService ? '<div class="part-notes">No dates set yet. Tap to add them.</div>' : ''}
      </div>
      ${p.notes ? `<div class="part-notes">${escapeHtml(p.notes)}</div>` : ''}
    `;
    grid.appendChild(card);
  });

  grid.querySelectorAll('[data-part]').forEach(card => {
    card.addEventListener('click', () => openPartModal(card.dataset.part));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openPartModal(card.dataset.part);
      }
    });
  });
}

// The round + button: adds a vehicle on the dashboard, adds a part on a vehicle page
$('addFab').addEventListener('click', () => {
  if (fabMode === 'part' && currentVehicleId) openPartModal(null);
  else openModal(null);
});

// ---------------- MODAL: ADD/EDIT PART ----------------
function buildCategoryPicker() {
  $('partCategoryPicker').innerHTML = PART_CATEGORIES.map(c => `
    <button type="button" class="type-btn" data-category="${c.key}">
      ${partSvg(c.inner, 2)}
      <span>${c.label}</span>
    </button>
  `).join('');
  $('partCategoryPicker').querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => setPartCategory(btn.dataset.category));
  });
}

function setPartCategory(key) {
  $('pCategory').value = key;
  $('partCategoryPicker').querySelectorAll('.type-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.category === key);
  });
}

function openPartModal(partId) {
  const v = vehiclesCache.find(x => x.id === currentVehicleId);
  if (!v) return;
  const p = partId ? (v.warranties || []).find(x => x.id === partId) : null;
  const unit = unitShort(meterUnitOf(v));

  $('partId').value = p ? p.id : '';
  $('pName').value = p ? p.item_name : '';
  setPartCategory(p && p.category ? p.category : 'other');
  $('pWarrantyDate').value = p ? (p.expiry_date || '') : '';
  $('pWarrantyValue').value = p && hasNum(p.expiry_km) ? p.expiry_km : '';
  $('pServiceDate').value = p ? (p.next_service_date || '') : '';
  $('pServiceValue').value = p && hasNum(p.next_service_value) ? p.next_service_value : '';
  $('pNotes').value = p ? (p.notes || '') : '';
  $('pWarrantyValueLabel').textContent = `Warranty expires at ${unit} (optional)`;
  $('pServiceValueLabel').textContent = `Next service at ${unit} (optional)`;
  $('partModalTitle').textContent = p ? 'Edit part' : 'Add part';
  $('deletePartBtn').classList.toggle('hidden', !p);
  $('partModal').classList.remove('hidden');
}

function closePartModal() {
  $('partModal').classList.add('hidden');
}
$('closePartModal').addEventListener('click', closePartModal);

$('partForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentVehicleId) return;
  const id = $('partId').value || null;
  const payload = {
    vehicle_id: currentVehicleId,
    user_id: currentUser.id,
    item_name: $('pName').value.trim(),
    category: $('pCategory').value || 'other',
    expiry_date: $('pWarrantyDate').value || null,
    expiry_km: numOrNull($('pWarrantyValue').value),
    next_service_date: $('pServiceDate').value || null,
    next_service_value: numOrNull($('pServiceValue').value),
    notes: $('pNotes').value.trim() || null,
  };
  if (!payload.item_name) return;

  $('partSaveBtn').disabled = true;
  const { error } = id
    ? await sb.from('warranties').update(payload).eq('id', id)
    : await sb.from('warranties').insert(payload);
  $('partSaveBtn').disabled = false;
  if (error) { alert(error.message); return; }

  closePartModal();
  await loadVehicles();
});

$('deletePartBtn').addEventListener('click', async () => {
  const id = $('partId').value;
  if (!id) return;
  if (!confirm('Delete this part? This can\'t be undone.')) return;
  const { error } = await sb.from('warranties').delete().eq('id', id);
  if (error) { alert(error.message); return; }
  closePartModal();
  await loadVehicles();
});

// ---------------- MODAL: ADD/EDIT VEHICLE ----------------
$('closeModal').addEventListener('click', closeModal);

function applyMeterUnit() {
  const hours = $('vMeterUnit').value === 'hours';
  $('fServiceKm').classList.toggle('hidden', hours);
  $('fCurrentKm').classList.toggle('hidden', hours);
  $('fServiceHours').classList.toggle('hidden', !hours);
  $('fCurrentHours').classList.toggle('hidden', !hours);
}
$('vMeterUnit').addEventListener('change', applyMeterUnit);

function openModal(vehicleId) {
  const v = vehicleId ? vehiclesCache.find(x => x.id === vehicleId) : null;
  $('vehicleId').value = v ? v.id : '';
  $('vName').value = v ? v.name : '';
  setVehicleType(v ? v.vehicle_type : 'car');
  $('vLicence').value = v ? (v.licence_expiry || '') : '';
  $('vMeterUnit').value = v ? meterUnitOf(v) : 'km';
  $('vServiceDate').value = v ? (v.service_due_date || '') : '';
  $('vServiceKm').value = v && hasNum(v.service_due_km) ? v.service_due_km : '';
  $('vCurrentKm').value = v && hasNum(v.current_km) ? v.current_km : '';
  $('vServiceHours').value = v && hasNum(v.service_due_hours) ? v.service_due_hours : '';
  $('vCurrentHours').value = v && hasNum(v.current_hours) ? v.current_hours : '';
  $('vNotes').value = v ? (v.notes || '') : '';
  $('modalTitle').textContent = v ? 'Edit vehicle' : 'Add vehicle';
  $('deleteVehicleBtn').classList.toggle('hidden', !v);
  applyMeterUnit();
  $('vehicleModal').classList.remove('hidden');
}

function setVehicleType(type) {
  $('vType').value = type;
  document.querySelectorAll('#typePicker .type-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === type);
  });
}

document.querySelectorAll('#typePicker .type-btn').forEach(btn => {
  btn.addEventListener('click', () => setVehicleType(btn.dataset.type));
});

function closeModal() {
  $('vehicleModal').classList.add('hidden');
}

$('vehicleForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('vehicleId').value || null;

  const payload = {
    user_id: currentUser.id,
    name: $('vName').value.trim(),
    vehicle_type: $('vType').value,
    licence_expiry: $('vLicence').value || null,
    meter_unit: $('vMeterUnit').value,
    service_due_date: $('vServiceDate').value || null,
    service_due_km: numOrNull($('vServiceKm').value),
    current_km: numOrNull($('vCurrentKm').value),
    service_due_hours: numOrNull($('vServiceHours').value),
    current_hours: numOrNull($('vCurrentHours').value),
    notes: $('vNotes').value.trim() || null,
  };

  if (id) {
    const { error } = await sb.from('vehicles').update(payload).eq('id', id);
    if (error) { alert(error.message); return; }
  } else {
    const { error } = await sb.from('vehicles').insert(payload);
    if (error) { alert(error.message); return; }
  }

  closeModal();
  await loadVehicles();
});

$('deleteVehicleBtn').addEventListener('click', async () => {
  const id = $('vehicleId').value;
  if (!id) return;
  if (!confirm('Delete this vehicle with all its parts and readings? This can\'t be undone.')) return;
  const { error } = await sb.from('vehicles').delete().eq('id', id);
  if (error) { alert(error.message); return; }
  closeModal();
  const wasOnVehiclePage = history.state && history.state.vehicleId;
  currentVehicleId = null;
  showDashboard();
  if (wasOnVehiclePage) history.back();
  await loadVehicles();
});

// ---------------- READING LOG ----------------
let readingsCache = []; // readings for the vehicle shown in the open log, newest first

async function openReadingLog(vehicleId) {
  const v = vehiclesCache.find(x => x.id === vehicleId);
  if (!v) return;
  const unit = meterUnitOf(v);
  $('readingVehicleId').value = v.id;
  $('readingLogFor').textContent = `${v.name} — readings in ${unit === 'hours' ? 'hours' : 'km'}`;
  $('readingLabel').textContent = `Reading (${unitShort(unit)})`;
  $('readingValue').value = '';
  $('readingDate').value = todayStr();
  $('readingRecordedBy').value = '';
  $('readingMsg').classList.add('hidden');
  $('readingList').innerHTML = '<p class="part-notes" style="color:rgba(234,227,205,0.5);">Loading…</p>';
  $('readingLogModal').classList.remove('hidden');
  await loadReadings(v.id);
}

async function loadReadings(vehicleId) {
  const { data, error } = await sb
    .from('meter_readings')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .order('reading_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) {
    $('readingList').innerHTML = `<div class="error-msg">${escapeHtml(error.message)}</div>`;
    return;
  }
  readingsCache = data || [];
  renderReadingList();
}

function renderReadingList() {
  const list = $('readingList');
  if (readingsCache.length === 0) {
    list.innerHTML = '<p style="color:rgba(234,227,205,0.5); font-size:0.9rem;">No readings yet. Add the first one above.</p>';
    return;
  }
  list.innerHTML = readingsCache.map(r => `
    <div class="reading-item">
      <div class="reading-top">
        <span class="reading-value">${fmtNum(r.reading_value)} ${unitShort(r.reading_unit)}</span>
        <span class="reading-date">${fmtDate(r.reading_date)}</span>
      </div>
      <div class="reading-meta">${r.recorded_by ? escapeHtml(r.recorded_by) : 'No name recorded'} · ${escapeHtml(r.source || 'manual')}</div>
      ${r.flagged ? `<div class="reading-flag">⚠ Flagged: ${escapeHtml(r.flag_reason || 'Needs checking')}</div>` : ''}
    </div>
  `).join('');
}

$('closeReadingLog').addEventListener('click', () => {
  $('readingLogModal').classList.add('hidden');
});

$('readingForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = vehiclesCache.find(x => x.id === $('readingVehicleId').value);
  if (!v) return;
  const unit = meterUnitOf(v);
  const value = Number($('readingValue').value);
  const date = $('readingDate').value;
  if (!isFinite(value) || value < 0 || !date) return;

  // Compare with the latest reading on or before this date (list is newest first)
  const prior = readingsCache.find(r => r.reading_date <= date);
  let flagged = false;
  let reason = null;
  if (prior) {
    const prev = Number(prior.reading_value);
    if (value < prev) {
      flagged = true;
      reason = `Lower than the previous reading (${fmtNum(prev)} on ${fmtDate(prior.reading_date)})`;
    } else if (prev > 0 && value > prev * 1.5) {
      flagged = true;
      reason = `More than 1.5 times the previous reading (${fmtNum(prev)} on ${fmtDate(prior.reading_date)})`;
    }
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  const { error } = await sb.from('meter_readings').insert({
    vehicle_id: v.id,
    user_id: currentUser.id,
    reading_value: value,
    reading_unit: unit,
    reading_date: date,
    source: 'manual',
    recorded_by: $('readingRecordedBy').value.trim() || null,
    flagged,
    flag_reason: reason,
  });
  if (error) {
    submitBtn.disabled = false;
    alert(error.message);
    return;
  }

  // Keep the vehicle's current meter in step, unless this is a back-dated entry
  const latestDate = readingsCache.length ? readingsCache[0].reading_date : '';
  if (date >= latestDate) {
    const field = unit === 'hours' ? 'current_hours' : 'current_km';
    const { error: updErr } = await sb.from('vehicles').update({ [field]: value }).eq('id', v.id);
    if (updErr) console.error(updErr);
  }

  $('readingValue').value = '';
  $('readingRecordedBy').value = '';
  const msg = $('readingMsg');
  msg.className = flagged ? 'error-msg' : 'info-msg';
  msg.textContent = flagged
    ? `Saved, but flagged for checking: ${reason}. It stays in the log.`
    : 'Reading saved.';
  submitBtn.disabled = false;

  await loadReadings(v.id);
  await loadVehicles();
});

// ---------------- EXPORT READINGS (CSV) ----------------
async function fetchAllReadings() {
  const all = [];
  const size = 1000; // Supabase returns at most 1000 rows per request, so fetch in pages
  for (let from = 0; ; from += size) {
    const { data, error } = await sb
      .from('meter_readings')
      .select('*')
      .order('reading_date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + size - 1);
    if (error) throw error;
    all.push(...data);
    if (data.length < size) break;
  }
  return all;
}

function csvCell(val) {
  let s = val === null || val === undefined ? '' : String(val);
  // Stop spreadsheet programs from running text that starts like a formula
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

$('exportBtn').addEventListener('click', async () => {
  const btn = $('exportBtn');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Exporting…';
  try {
    const readings = await fetchAllReadings();
    if (readings.length === 0) {
      alert('There are no readings to export yet.');
      return;
    }
    const byId = {};
    vehiclesCache.forEach(v => { byId[v.id] = v; });
    const header = ['Asset', 'Type', 'Reading', 'Unit', 'Date', 'Source', 'Recorded By', 'Flagged', 'Flag Reason'];
    const rows = readings.map(r => {
      const v = byId[r.vehicle_id];
      return [
        v ? v.name : 'Unknown asset',
        v ? prettyType(v.vehicle_type) : '',
        r.reading_value,
        r.reading_unit,
        r.reading_date,
        r.source,
        r.recorded_by || '',
        r.flagged ? 'Yes' : 'No',
        r.flag_reason || '',
      ];
    });
    const csv = [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `peyper-trails-readings-${todayStr()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    alert(err.message || 'Could not export. Try again in a moment.');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
});

// ---------------- INIT ----------------
buildCategoryPicker();
checkSession();
