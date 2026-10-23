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
  $('signupWarn').classList.toggle('hidden', authMode !== 'signup');
});

$('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  $('authError').classList.add('hidden');
  if (authMode === 'signup' && !$('signupAck').checked) {
    $('authError').classList.remove('hidden', 'info-msg');
    $('authError').classList.add('error-msg');
    $('authError').textContent = 'Please tick the box to confirm you understand that your email is the only way back into your account.';
    return;
  }
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
        $('authError').textContent = `Almost there — we've sent a confirmation link to ${email}. Open that email and tap the link, then come back here and log in. Keep that email: it is your only way back into your account.`;
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

// ---------------- FORGOT EMAIL (help panel, nothing is looked up or stored) ----------------
$('forgotEmailBtn').addEventListener('click', () => {
  $('forgotEmailModal').classList.remove('hidden');
});
$('closeForgotEmailModal').addEventListener('click', () => {
  $('forgotEmailModal').classList.add('hidden');
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
  $('footerAccountBtn').classList.add('hidden');
  currentVehicleId = null;
  $('authScreen').classList.remove('hidden');
  $('dashScreen').classList.add('hidden');
  $('vehicleScreen').classList.add('hidden');
  $('reportsScreen').classList.add('hidden');
  $('addFab').classList.add('hidden');
  $('logoutBtn').classList.add('hidden');
  $('exportBtn').classList.add('hidden');
  $('footer').classList.add('hidden');
}

// Shows the dashboard (the grid of vehicles)
function showDashboard() {
  $('footerAccountBtn').classList.remove('hidden');
  currentVehicleId = null;
  fabMode = 'vehicle';
  $('addFab').setAttribute('aria-label', 'Add vehicle');
  $('authScreen').classList.add('hidden');
  $('vehicleScreen').classList.add('hidden');
  $('reportsScreen').classList.add('hidden');
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

// Closest thing to being due across the licence, the service (date and km/hours) and every part
function nearestStatus(vehicle) {
  const items = [];
  const add = (c) => { if (c) items.push(c); };
  add(dateCountdown(vehicle.licence_expiry));
  add(dateCountdown(vehicle.service_due_date));
  const unit = meterUnitOf(vehicle);
  if (unit !== 'none') add(meterCountdown(serviceDueMeter(vehicle), currentMeter(vehicle), unit));
  (vehicle.warranties || []).forEach(p => { const c = partCountdowns(p, vehicle); [...c.warranty, ...c.service].forEach(add); });
  const near = nearestOf(items);
  if (!near) return { days: null, status: null, label: '—' };
  return { days: near.d, status: statusFromDays(near.d), label: near.label };
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
  const angleDeg = pct * 180; // 180 = far left (plenty of time, green), 0 = far right (due, red)
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
      <path d="${arcPath(r, 180, 120)}" stroke="#3e7a52" stroke-width="11" fill="none" stroke-linecap="round" opacity="0.85"/>
      <path d="${arcPath(r, 120, 60)}" stroke="#e8832a" stroke-width="11" fill="none" opacity="0.9"/>
      <path d="${arcPath(r, 60, 0)}" stroke="#c23b3b" stroke-width="11" fill="none" stroke-linecap="round" opacity="0.85"/>
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
  'motorbike': '<svg viewBox="0 0 48 32" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"><circle cx="11" cy="22" r="5"/><circle cx="37" cy="22" r="5"/><path d="M11 22 L19 13 H28 L37 22 M19 13 L16 9 H12 M28 13 L31 9 H35 M20 18 H29 L24 22"/></svg>',
  'tractor': '<svg viewBox="0 0 48 32" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"><circle cx="14" cy="21" r="8"/><circle cx="38" cy="24" r="4.5"/><path d="M22 21 V8 H31 V15 H42 V21 H22 M36 15 V10"/></svg>',
  'solar-panels': '<svg viewBox="0 0 48 32" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"><path d="M8 6 H40 L44 20 H4 Z"/><path d="M16 6 L14 20 M24 6 V20 M32 6 L34 20 M6 13 H42"/><path d="M24 20 V27 M17 27 H31"/></svg>',
  'inverter': '<svg viewBox="0 0 48 32" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"><rect x="7" y="6" width="34" height="20" rx="2"/><path d="M11 16 Q14 9 17 16 T23 16"/><path d="M31 11 L28 17 H33 L30 22"/><path d="M13 26 V29 M35 26 V29"/></svg>',
  'coffee-machine': '<svg viewBox="0 0 48 32" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"><path d="M9 5 H35 V12 H9 Z"/><path d="M11 12 V27 H33 V12"/><path d="M17 27 V22 H27 V27"/><path d="M35 9 H39 Q42 9 42 12 V14"/><path d="M20 17 H24"/></svg>',
  'truck': '<svg viewBox="0 0 48 32" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"><path d="M3 22 V9 H27 V22 M27 13 H36 L43 19 V22 H27"/><circle cx="11" cy="24" r="3.2"/><circle cx="20" cy="24" r="3.2"/><circle cx="36" cy="24" r="3.2"/></svg>',
  other: '<svg viewBox="0 0 48 32"><circle cx="24" cy="16" r="11" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M20 13 Q20 9 24 9 Q28 9 28 13 Q28 16 24 17 V19" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><circle cx="24" cy="22" r="1.2" fill="currentColor"/></svg>',
};


function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// ---------------- PARTS: CATEGORIES & ICONS ----------------
// ---------------- ASSET TYPES ----------------
const VEHICLE_TYPES = [
  { key: 'car', label: 'Car' },
  { key: 'bakkie', label: 'Bakkie' },
  { key: 'motorbike', label: 'Motorbike' },
  { key: 'tractor', label: 'Tractor' },
  { key: 'truck', label: 'Truck' },
  { key: 'boat', label: 'Boat' },
  { key: 'trailer', label: 'Trailer' },
  { key: 'caravan', label: 'Caravan' },
  { key: 'haul-truck', label: 'Haul truck' },
  { key: 'excavator', label: 'Excavator' },
  { key: 'loader', label: 'Loader' },
  { key: 'drill-rig', label: 'Drill rig' },
  { key: 'solar-panels', label: 'Solar panels' },
  { key: 'inverter', label: 'Inverter' },
  { key: 'coffee-machine', label: 'Coffee machine' },
  { key: 'other', label: 'Other' },
];
const MACHINE_TYPES = ['solar-panels', 'inverter', 'coffee-machine'];
const HOURS_TYPES = ['haul-truck', 'excavator', 'loader', 'drill-rig', 'tractor'];

// What the "how do you track use" box starts on when a type is picked
function defaultMeterFor(type) {
  if (MACHINE_TYPES.includes(type)) return 'none';
  if (HOURS_TYPES.includes(type)) return 'hours';
  return 'km';
}

// ---------------- PARTS: CATEGORIES & ICONS ----------------
const partSvg = (inner, sw) => `<svg viewBox="0 0 48 32" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round">${inner}</svg>`;

// unit: what the item is usually measured in ('meter' = the asset's own km or hours)
const PART_CATEGORIES = [
  { key: 'battery', label: 'Battery', unit: 'time', machine: true, ph: 'e.g. Main battery', inner: '<rect x="6" y="9" width="36" height="18" rx="2"/><path d="M14 9 V6 H19 V9 M29 9 V6 H34 V9 M15 18 H21 M18 15 V21 M29 18 H35"/>' },
  { key: 'tyres', label: 'Tyres', unit: 'km', ph: 'e.g. Front left tyre', inner: '<circle cx="24" cy="16" r="12"/><circle cx="24" cy="16" r="5"/><path d="M24 4 V8 M24 24 V28 M12 16 H16 M32 16 H36"/>' },
  { key: 'brakes', label: 'Brakes', unit: 'km', ph: 'e.g. Front brake pads', inner: '<circle cx="21" cy="16" r="11"/><circle cx="21" cy="16" r="3"/><path d="M32 8 Q40 16 32 24 L29 21 Q34 16 29 11 Z"/>' },
  { key: 'shocks', label: 'Shocks', unit: 'km', ph: 'e.g. Front shock absorbers', inner: '<path d="M24 3 V8 M24 24 V29"/><rect x="20" y="8" width="8" height="16" rx="2"/><path d="M17 12 L31 14 M17 16 L31 18 M17 20 L31 22"/>' },
  { key: 'wipers', label: 'Wipers', unit: 'time', ph: 'e.g. Front wiper blades', inner: '<path d="M6 27 Q24 4 42 27"/><path d="M24 27 L34 11"/><circle cx="24" cy="27" r="2"/>' },
  { key: 'starter', label: 'Starter', unit: 'time', ph: 'e.g. Starter motor', inner: '<rect x="8" y="10" width="24" height="14" rx="3"/><path d="M32 14 H40 V20 H32 M12 10 V6 H20 V10"/>' },
  { key: 'engine', label: 'Engine', unit: 'meter', ph: 'e.g. Engine overhaul', inner: '<path d="M10 12 H18 V8 H30 V12 H36 V16 H40 V24 H36 V26 H12 V22 H8 V14 Z"/>' },
  { key: 'oil', label: 'Oil & fluids', unit: 'liters', ph: 'e.g. Engine oil', inner: '<path d="M24 4 C24 4 12 16 12 22 A12 8 0 0 0 36 22 C36 16 24 4 24 4 Z"/><path d="M19 22 Q19 25 23 26"/>' },
  { key: 'filters', label: 'Filters', unit: 'meter', machine: true, ph: 'e.g. Oil filter', inner: '<rect x="14" y="6" width="20" height="20" rx="3"/><path d="M14 12 H34 M14 18 H34 M20 26 V29 M28 26 V29"/>' },
  { key: 'hydraulics', label: 'Hydraulics', unit: 'liters', ph: 'e.g. Boom cylinder', inner: '<rect x="6" y="11" width="22" height="10" rx="2"/><path d="M28 16 H42 M42 12 V20 M6 16 H3"/>' },
  { key: 'electrical', label: 'Electrical', unit: 'time', machine: true, ph: 'e.g. Alternator', inner: '<path d="M26 3 L13 18 H23 L21 29 L35 13 H25 Z"/>' },
  { key: 'other', label: 'Other', unit: 'time', machine: true, ph: 'e.g. Aircon compressor', inner: '<circle cx="24" cy="16" r="11"/><path d="M20 13 Q20 9 24 9 Q28 9 28 13 Q28 16 24 17 V19"/><circle cx="24" cy="22" r="1.2" fill="currentColor"/>' },
];

// Categories that make no sense for a given asset type
const PART_NOT_FOR = {
  boat: ['tyres', 'wipers', 'shocks', 'brakes'],
  trailer: ['wipers', 'engine', 'oil', 'starter'],
  caravan: ['wipers', 'engine', 'oil', 'starter'],
  motorbike: ['wipers'],
  'drill-rig': ['wipers', 'shocks'],
};

function categoryOf(key) {
  return PART_CATEGORIES.find(c => c.key === key) || PART_CATEGORIES[PART_CATEGORIES.length - 1];
}
function categoriesFor(v) {
  const type = v ? v.vehicle_type : 'other';
  if (MACHINE_TYPES.includes(type)) return PART_CATEGORIES.filter(c => c.machine);
  const skip = PART_NOT_FOR[type] || [];
  return PART_CATEGORIES.filter(c => !skip.includes(c.key));
}

// How an item can be tracked (the person decides)
const TRACK_UNITS = [
  { key: 'km', label: 'Kilometers (km)', word: 'km' },
  { key: 'miles', label: 'Miles', word: 'miles' },
  { key: 'liters', label: 'Liters', word: 'liters' },
  { key: 'hours', label: 'Hours', word: 'hours' },
  { key: 'time', label: 'Time (dates only)', word: '' },
];
function trackWord(unit) {
  const u = TRACK_UNITS.find(x => x.key === unit);
  return u ? u.word : '';
}

// Size / type box that changes with the item (we can refine these per item later)
const PART_SPEC = {
  battery: { label: 'Type / capacity', ph: 'e.g. 12V 70Ah' },
  tyres: { label: 'Tyre size', ph: 'e.g. 265/65 R17', pos: true },
  brakes: { label: 'Type', ph: 'e.g. Pads, discs', pos: true },
  shocks: { label: 'Type', ph: 'e.g. Gas, oil', pos: true },
  wipers: { label: 'Blade size', ph: 'e.g. 600 mm', pos: true },
  starter: { label: 'Rating', ph: 'e.g. 12V 2.2kW' },
  engine: { label: 'Details', ph: 'e.g. Rebuilt, reman' },
  oil: { label: 'Grade', ph: 'e.g. 5W-30' },
  filters: { label: 'Filter type', ph: 'e.g. Oil, air, fuel, water' },
  hydraulics: { label: 'Fluid grade', ph: 'e.g. ISO 46' },
  electrical: { label: 'Rating', ph: 'e.g. 12V 90A' },
  other: { label: 'Details', ph: 'Anything useful' },
};
const POSITIONS = ['Front left', 'Front right', 'Rear left', 'Rear right', 'Front', 'Rear', 'Spare'];


// ---------------- WHEELS, AXLES AND POSITIONS ----------------
// Assets that have axles get a wheel layout: axles run front to back, each with 1 (single) or 2 (dual) wheels per side.
const WHEEL_TYPES = ['trailer', 'caravan', 'truck', 'haul-truck', 'tractor', 'loader'];
const WHEEL_PART_KEYS = ['tyres', 'brakes', 'shocks'];
const LAYOUT_PRESETS = {
  trailer: [{ label: 'Single axle', axles: [1] }, { label: 'Double axle', axles: [1, 1] }, { label: 'Triple axle', axles: [1, 1, 1] }],
  truck: [{ label: '4x2 (rear dual)', axles: [1, 2] }, { label: '6x4 (two rear dual axles)', axles: [1, 2, 2] }, { label: '8x4 (two front, two rear dual)', axles: [1, 1, 2, 2] }],
  other: [{ label: 'Two axles', axles: [1, 1] }],
};
function presetGroup(type) { return ['trailer', 'caravan'].includes(type) ? 'trailer' : (['truck', 'haul-truck'].includes(type) ? 'truck' : 'other'); }
function defaultLayoutFor(type) {
  const axles = { trailer: [1], caravan: [1], truck: [1, 2], 'haul-truck': [1, 2], tractor: [1, 1], loader: [1, 1] }[type] || [1, 1];
  return { axles: axles.slice(), ref: 'travel' };
}
function getLayout(v) {
  let l = v && v.wheel_layout;
  if (typeof l === 'string') { try { l = JSON.parse(l); } catch (e) { l = null; } }
  if (l && Array.isArray(l.axles) && l.axles.length) {
    return { axles: l.axles.map(n => (Number(n) === 2 ? 2 : 1)), ref: l.ref === 'hitch' ? 'hitch' : 'travel' };
  }
  return null;
}
function wheelLabel(axleIdx, side, pos) {
  return `Axle ${axleIdx + 1} · ${side === 'L' ? 'Left' : 'Right'}${pos ? ' ' + (pos === 'O' ? 'outer' : 'inner') : ''} (${axleIdx + 1}${side}${pos})`;
}
function codeFromPosition(text) {
  const m = /\((\d+[LR][OI]?)\)\s*$/.exec(text || '');
  return m ? m[1] : '';
}
function totalWheels(layout) { return layout.axles.reduce((n, w) => n + w * 2, 0); }
function layoutSummary(layout) {
  const parts = layout.axles.map((w, i) => `axle ${i + 1} ${w === 2 ? 'dual' : 'single'}`);
  return `${layout.axles.length} axle${layout.axles.length === 1 ? '' : 's'} (${parts.join(', ')}), ${totalWheels(layout)} wheels`;
}
function sideNote(layout, type) {
  if (layout.ref === 'hitch') return 'Left and right as seen from the tow hitch, looking at the trailer';
  return type === 'truck' || type === 'haul-truck' ? 'Left and right as seen by the driver, facing forward' : 'Left and right as seen when driving forward';
}

// Top-down picture, front at the top. `selectedCode` lights up one wheel; `clickable` lets people tap wheels.
function wheelDiagramSVG(layout, type, selectedCode, clickable) {
  const n = layout.axles.length;
  const leftSide = layout.ref === 'hitch' ? 'R' : 'L';
  const rightSide = layout.ref === 'hitch' ? 'L' : 'R';
  const W = 260, spacing = 58, top = 46, cx = 130;
  const H = top + (n - 1) * spacing + 20 + 34;
  const axleY = (i) => top + 20 + i * spacing;
  const towed = ['trailer', 'caravan'].includes(type);
  let s = `<svg class="wheel-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Wheel positions, front at the top">`;
  s += `<text x="${cx}" y="13" text-anchor="middle" class="wd-front">${towed ? 'TOW HITCH (FRONT)' : 'FRONT'}</text>`;
  s += `<line x1="${cx}" y1="18" x2="${cx}" y2="${top - 6}" class="wd-line"/>`;
  s += `<rect x="${cx - 26}" y="${top - 6}" width="52" height="${(n - 1) * spacing + 20 + 14 + 6}" rx="7" class="wd-body"/>`;
  s += `<text x="30" y="${top + 4}" class="wd-side">${leftSide}</text><text x="${W - 30}" y="${top + 4}" text-anchor="end" class="wd-side">${rightSide}</text>`;
  layout.axles.forEach((w, i) => {
    const y = axleY(i);
    const wheels = [];
    if (w === 2) {
      wheels.push({ x: 54, side: leftSide, pos: 'O' }, { x: 78, side: leftSide, pos: 'I' }, { x: 182, side: rightSide, pos: 'I' }, { x: 206, side: rightSide, pos: 'O' });
    } else {
      wheels.push({ x: 78, side: leftSide, pos: '' }, { x: 182, side: rightSide, pos: '' });
    }
    s += `<line x1="${wheels[0].x}" y1="${y}" x2="${wheels[wheels.length - 1].x}" y2="${y}" class="wd-axle"/>`;
    s += `<text x="8" y="${y + 4}" class="wd-axle-no">A${i + 1}</text>`;
    wheels.forEach(wh => {
      const code = `${i + 1}${wh.side}${wh.pos}`;
      const label = wheelLabel(i, wh.side, wh.pos);
      const sel = code === selectedCode;
      s += `<g class="wd-wheel${sel ? ' sel' : ''}${clickable ? ' tap' : ''}" ${clickable ? `data-code="${code}" data-label="${label}" role="button" tabindex="0" aria-label="${label}"` : ''}>`;
      s += `<rect x="${wh.x - 10}" y="${y - 17}" width="20" height="34" rx="4"/><text x="${wh.x}" y="${y + 3}" text-anchor="middle">${code}</text></g>`;
    });
  });
  s += '</svg>';
  return s;
}

// ---------------- SMALL HELPERS ----------------
function meterUnitOf(v) {
  if (!v) return 'km';
  return ['hours', 'none', 'miles'].includes(v.meter_unit) ? v.meter_unit : 'km';
}
const UNIT_SHORT = { km: 'km', miles: 'mi', hours: 'hrs', none: '' };
const UNIT_WORD = { km: 'km', miles: 'miles', hours: 'hours', none: '' };
function unitShort(unit) { return unit in UNIT_SHORT ? UNIT_SHORT[unit] : 'km'; }
function unitWord(unit) { return unit in UNIT_WORD ? UNIT_WORD[unit] : 'km'; }
function hasNum(x) { return x !== null && x !== undefined && x !== ''; }
function fmtNum(x) { return Number(x).toLocaleString('en-ZA'); }
function numOrNull(s) { return s === '' || s === null || s === undefined ? null : Number(s); }
function todayStr() { return new Date().toLocaleDateString('en-CA'); }
function prettyType(t) { return (t || 'other').replace(/-/g, ' '); }
function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function currentMeter(v) {
  const unit = meterUnitOf(v);
  if (unit === 'none') return null;
  const val = unit === 'hours' ? v.current_hours : v.current_km;
  return hasNum(val) ? Number(val) : null;
}
function serviceDueMeter(v) {
  const unit = meterUnitOf(v);
  if (unit === 'none') return null;
  const val = unit === 'hours' ? v.service_due_hours : v.service_due_km;
  return hasNum(val) ? Number(val) : null;
}

// Warranty end = invoice date + warranty months (keeps the day, trims to month length)
function addMonthsISO(iso, months) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m || !isFinite(months)) return '';
  let y = +m[1];
  let mo = +m[2] - 1 + Number(months);
  y += Math.floor(mo / 12);
  mo = ((mo % 12) + 12) % 12;
  const d = Math.min(+m[3], new Date(y, mo + 1, 0).getDate());
  return `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ---------------- MEASURING A PART (feeds the dial) ----------------
// Every countdown is turned into "days-equivalent" so one dial can compare dates with km, miles, hours and liters.
// Being inside the "near" amount below counts as 30 days (due soon); being past the number counts as due.
const NEAR_LIMIT = { km: 1000, miles: 600, hours: 50, liters: 50 };

function daysText(d) { return d <= 0 ? 'DUE' : `${d} days left`; }

// Current reading in the part's own unit: the asset's meter when the units match, otherwise the number typed on the part
function currentFor(p, v) {
  const pu = p.tracking_unit || 'km';
  if (pu === 'time') return null;
  if (pu === meterUnitOf(v)) return currentMeter(v);
  return hasNum(p.current_value) ? Number(p.current_value) : null;
}

// Countdown to a km / miles / hours / liters number
function meterCountdown(target, current, unit) {
  if (!hasNum(target) || current === null || !(unit in NEAR_LIMIT)) return null;
  const remaining = Number(target) - current;
  const d = remaining <= 0 ? 0 : Math.min(365, Math.max(1, Math.round(remaining / NEAR_LIMIT[unit] * 30)));
  return { remaining, unit, d, meter: true, label: remaining <= 0 ? 'DUE' : `${fmtNum(Math.round(remaining))} ${trackWord(unit)} left` };
}
function remainingNote(c) {
  if (!c) return '';
  const n = fmtNum(Math.round(Math.abs(c.remaining)));
  return c.remaining <= 0 ? `overdue by ${n} ${trackWord(c.unit)}` : `${n} ${trackWord(c.unit)} left`;
}
function dateCountdown(iso) {
  const d = daysUntil(iso);
  return d === null ? null : { d, meter: false, label: daysText(d) };
}
// A replaced part counts for nothing
function partCountdowns(p, v) {
  if (p.retired_date) return { warranty: [], service: [] };
  const pu = p.tracking_unit || 'km';
  const cur = currentFor(p, v);
  return {
    warranty: [dateCountdown(p.expiry_date), pu !== 'time' ? meterCountdown(p.expiry_km, cur, pu) : null].filter(Boolean),
    service: [dateCountdown(p.next_service_date), pu !== 'time' ? meterCountdown(p.next_service_value, cur, pu) : null].filter(Boolean),
  };
}
function nearestOf(list) { return list.length ? list.reduce((x, y) => (y.d < x.d ? y : x)) : null; }
function partWarrantyDays(p, v) { const n = nearestOf(partCountdowns(p, v).warranty); return n ? n.d : null; }
function partServiceDays(p, v) { const n = nearestOf(partCountdowns(p, v).service); return n ? n.d : null; }
function partDaysList(p, v) { const c = partCountdowns(p, v); return [...c.warranty, ...c.service].map(x => x.d); }

// "Service at 95,000 km" row, with how much is left
function serviceAtRow(v) {
  const unit = meterUnitOf(v);
  const dueAt = serviceDueMeter(v);
  if (unit === 'none' || dueAt === null) return '';
  const note = remainingNote(meterCountdown(dueAt, currentMeter(v), unit));
  return `<div class="disc-row"><span class="k">Service at</span><span class="v">${fmtNum(dueAt)} ${unitShort(unit)}${note ? `<br><span class="left-note">${note}</span>` : ''}</span></div>`;
}

// ---------------- FILES: PHOTOS & INVOICES ----------------
const BUCKET = 'asset-files';
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const urlCache = {}; // storage path -> { url, until }

function friendlyStorageError(err) {
  const msg = (err && err.message) || 'Upload failed';
  if (/bucket not found/i.test(msg)) return 'File storage is not switched on yet. Please run the database update (schema_v4_part_details.sql) first.';
  if (/row-level security|not authorized|unauthorized/i.test(msg)) return 'You are not allowed to upload here. Please log out and back in, then try again.';
  return msg;
}

// Shrinks a photo so it uploads fast and does not use up free storage
async function prepareImage(file, maxDim, quality) {
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e1) {
    try { bmp = await createImageBitmap(file); }
    catch (e2) { throw new Error('That picture type can\'t be read. Please use a JPG or PNG picture.'); }
  }
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise(res => canvas.toBlob(b => res(b), 'image/jpeg', quality));
  if (!blob) throw new Error('That picture could not be prepared. Please try another one.');
  return blob;
}

async function uploadFile(path, blob, contentType) {
  const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType, upsert: false });
  if (error) throw new Error(friendlyStorageError(error));
}

async function removeFiles(paths) {
  const list = (paths || []).filter(Boolean);
  if (!list.length) return;
  try { await sb.storage.from(BUCKET).remove(list); } catch (e) { console.error(e); }
}

// Fills in <img data-photo> and <a data-file> with short-lived private links
async function hydrateFiles(root) {
  const scope = root || document;
  const els = [...scope.querySelectorAll('[data-photo], [data-file]')];
  if (!els.length) return;
  const pathOf = (el) => el.dataset.photo || el.dataset.file;
  const now = Date.now();
  const need = [...new Set(els.map(pathOf).filter(p => p && !(urlCache[p] && urlCache[p].until > now)))];
  if (need.length) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(need, 3600);
    if (error) { console.error(error); return; }
    (data || []).forEach(item => {
      if (item.signedUrl) urlCache[item.path] = { url: item.signedUrl, until: now + 50 * 60 * 1000 };
    });
  }
  els.forEach(el => {
    const hit = urlCache[pathOf(el)];
    if (!hit) return;
    if (el.tagName === 'IMG') el.src = hit.url; else el.href = hit.url;
  });
}

// ---------------- DASHBOARD CARDS ----------------
function renderGrid() {
  const grid = $('vehicleGrid');
  const empty = $('emptyState');
  grid.innerHTML = '';

  const totalParts = vehiclesCache.reduce((n, v) => n + (v.warranties || []).length, 0);
  $('nextStepHint').classList.toggle('hidden', !(vehiclesCache.length > 0 && totalParts === 0));
  if (fabMode === 'vehicle') $('addFab').classList.toggle('hidden', vehiclesCache.length === 0);
  $('dashTools').classList.toggle('hidden', vehiclesCache.length === 0);

  if (vehiclesCache.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  vehiclesCache.forEach(v => {
    const { days, label } = nearestStatus(v);
    const daysLabel = label;
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
      ${v.photo_path ? `<div class="asset-photo"><img data-photo="${escapeHtml(v.photo_path)}" alt=""></div>` : ''}
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
        ${v.licence_expiry ? `<div class="disc-row"><span class="k">Licence</span><span class="v">${fmtDate(v.licence_expiry)} ${tagHtml(licStatus)}</span></div>` : ''}
        ${v.service_due_date ? `<div class="disc-row"><span class="k">Service due</span><span class="v">${fmtDate(v.service_due_date)} ${tagHtml(svcStatus)}</span></div>` : ''}
        ${serviceAtRow(v)}
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
  hydrateFiles(grid);
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
  if (e.state && e.state.reports) { showReports(false); return; }
  const id = e.state && e.state.vehicleId;
  if (id && vehiclesCache.find(v => v.id === id)) {
    openVehiclePage(id, false);
  } else {
    showDashboard();
  }
});

// Official online licence renewal (South Africa). Opens in a new tab: we never store anyone's NATIS login.
const RENEW_PRESETS = { za: 'https://www.enatis.com', uk: 'https://www.gov.uk/vehicle-tax' };
function renewUrlFor(v) { return (v && v.licence_url) || RENEW_PRESETS.za; }

function partNearestDays(p, v) {
  const list = partDaysList(p, v);
  return list.length ? Math.min(...list) : Infinity;
}

function daysBetween(fromIso, toIso) {
  const f = new Date(fromIso + 'T00:00:00'), t = new Date(toIso + 'T00:00:00');
  return Math.round((t - f) / 86400000);
}

// How long a replaced part lasted: days, and distance/hours/liters if both readings were entered
function lifeOf(p) {
  const days = p.retired_date && p.installation_date ? daysBetween(p.installation_date, p.retired_date) : null;
  const tu = p.tracking_unit || 'km';
  const dist = tu !== 'time' && hasNum(p.installed_value) && hasNum(p.retired_value) && Number(p.retired_value) >= Number(p.installed_value)
    ? Number(p.retired_value) - Number(p.installed_value) : null;
  return { days: days !== null && days >= 0 ? days : null, dist, unit: tu };
}

function partCardHtml(p, v) {
  const cat = categoryOf(p.category);
  const tu = p.tracking_unit || 'km';
  const word = trackWord(tu);
  const retired = !!p.retired_date;
  const wStatus = statusFromDays(partWarrantyDays(p, v));
  const sStatus = statusFromDays(partServiceDays(p, v));
  const wLine = [p.expiry_date ? fmtDate(p.expiry_date) : '', hasNum(p.expiry_km) && word ? `${fmtNum(p.expiry_km)} ${word}` : ''].filter(Boolean).join(' · ');
  const sLine = [p.next_service_date ? fmtDate(p.next_service_date) : '', hasNum(p.next_service_value) && word ? `${fmtNum(p.next_service_value)} ${word}` : ''].filter(Boolean).join(' · ');
  const life = lifeOf(p);
  const cd = partCountdowns(p, v);
  const wNote = remainingNote(cd.warranty.find(x => x.meter));
  const sNote = remainingNote(cd.service.find(x => x.meter));
  const manualReading = tu !== 'time' && tu !== meterUnitOf(v) && hasNum(p.current_value);
  const lifeLine = [life.days !== null ? `${fmtNum(life.days)} days` : '', life.dist !== null && word ? `${fmtNum(life.dist)} ${word}` : ''].filter(Boolean).join(' · ');
  const rows = [
    p.installation_date ? `<div class="disc-row"><span class="k">Installed</span><span class="v">${fmtDate(p.installation_date)}</span></div>` : '',
    p.invoice_number ? `<div class="disc-row"><span class="k">Invoice no.</span><span class="v">${escapeHtml(p.invoice_number)}</span></div>` : '',
    wLine ? `<div class="disc-row"><span class="k">Warranty ends</span><span class="v">${wLine}${wNote ? `<br><span class="left-note">${wNote}</span>` : ''}</span></div>` : '',
    !retired && sLine ? `<div class="disc-row"><span class="k">Next service</span><span class="v">${sLine}${sNote ? `<br><span class="left-note">${sNote}</span>` : ''}</span></div>` : '',
    !retired && manualReading ? `<div class="disc-row"><span class="k">Reading now</span><span class="v">${fmtNum(p.current_value)} ${word}</span></div>` : '',
    retired ? `<div class="disc-row"><span class="k">Replaced</span><span class="v">${fmtDate(p.retired_date)}</span></div>` : '',
    retired && lifeLine ? `<div class="disc-row"><span class="k">Lasted</span><span class="v">${lifeLine}</span></div>` : '',
  ].join('');
  const sub = [p.brand ? escapeHtml(p.brand) : '', p.spec ? escapeHtml(p.spec) : '', p.position ? escapeHtml(p.position) : '', escapeHtml(cat.label)].filter(Boolean).join(' · ');
  const tags = retired
    ? '<span class="tag tag-neutral">Replaced</span>' + (p.invoice_path ? '<span class="tag tag-neutral">Invoice saved</span>' : '')
    : tagHtml(wStatus, 'Warranty') + tagHtml(sStatus, 'Service') + (p.invoice_path ? '<span class="tag tag-neutral">Invoice saved</span>' : '');

  return `
    <div class="part-card${retired ? ' part-retired' : ''}" role="button" tabindex="0" data-part="${p.id}">
      <div class="part-top">
        <span class="part-icon">${partSvg(cat.inner, 2.5)}</span>
        <div>
          <div class="part-name">${escapeHtml(p.item_name)}</div>
          <div class="part-cat">${sub}</div>
        </div>
      </div>
      <div class="part-tags">${tags}</div>
      <div class="disc-rows">${rows || '<div class="part-notes">No dates set yet. Tap to add them.</div>'}</div>
      ${p.notes ? `<div class="part-notes">${escapeHtml(p.notes)}</div>` : ''}
    </div>`;
}

function renderVehiclePage() {
  const v = vehiclesCache.find(x => x.id === currentVehicleId);
  if (!v) return;
  const unit = meterUnitOf(v);
  const { days, label } = nearestStatus(v);
  const daysLabel = label;
  const cur = currentMeter(v);
  const dueAt = serviceDueMeter(v);
  const licStatus = statusFromDays(daysUntil(v.licence_expiry));
  const svcStatus = statusFromDays(daysUntil(v.service_due_date));
  const isRoad = !MACHINE_TYPES.includes(v.vehicle_type) && !['boat', 'drill-rig'].includes(v.vehicle_type);

  $('vehicleHeader').innerHTML = `
    <div class="disc-card vehicle-head">
      ${v.photo_path ? `<div class="asset-photo asset-photo-big"><img data-photo="${escapeHtml(v.photo_path)}" alt=""></div>` : ''}
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
        ${unit !== 'none' ? `<div class="disc-row"><span class="k">${unit === 'hours' ? 'Hour meter' : 'Odometer'}</span><span class="v">${cur !== null ? fmtNum(cur) + ' ' + unitShort(unit) : '—'}</span></div>` : ''}
        ${getLayout(v) ? `<div class="disc-row"><span class="k">Wheels</span><span class="v" style="font-family:'Inter',sans-serif; font-weight:500; text-align:right;">${totalWheels(getLayout(v))} on ${getLayout(v).axles.length} axle${getLayout(v).axles.length === 1 ? '' : 's'}</span></div>` : ''}
        ${v.licence_expiry ? `<div class="disc-row"><span class="k">Licence</span><span class="v">${fmtDate(v.licence_expiry)} ${tagHtml(licStatus)}</span></div>` : ''}
        ${v.service_due_date ? `<div class="disc-row"><span class="k">Service due</span><span class="v">${fmtDate(v.service_due_date)} ${tagHtml(svcStatus)}</span></div>` : ''}
        ${serviceAtRow(v)}
        ${v.notes ? `<div class="disc-row"><span class="k">Notes</span><span class="v" style="font-family:'Inter',sans-serif; font-weight:500; text-align:right;">${escapeHtml(v.notes)}</span></div>` : ''}
      </div>
      <div class="vehicle-actions">
        <button class="btn-primary" id="editVehicleBtn">Edit asset info</button>
        ${unit !== 'none' ? '<button class="btn-outline-dark" id="readingLogBtn">Reading log</button>' : ''}
        <button class="btn-outline-dark" id="shareBtn">Share</button>
      </div>
      ${isRoad ? `<a class="renew-link" id="renewLink" href="${escapeHtml(renewUrlFor(v))}" target="_blank" rel="noopener noreferrer">Renew licence online &rarr;</a>` : ''}
    </div>
  `;
  $('editVehicleBtn').addEventListener('click', () => openModal(v.id));
  if ($('readingLogBtn')) $('readingLogBtn').addEventListener('click', () => openReadingLog(v.id));
  $('shareBtn').addEventListener('click', () => openShare(v.id));

  const parts = (v.warranties || []).slice().sort((a, b) => (!!a.retired_date - !!b.retired_date) || (partNearestDays(a, v) - partNearestDays(b, v)));
  const grid = $('partsGrid');
  grid.innerHTML = parts.map(p => partCardHtml(p, v)).join('');
  $('partsEmpty').classList.toggle('hidden', parts.length > 0);
  $('partsTitle').classList.toggle('hidden', parts.length === 0);
  if (fabMode === 'part') $('addFab').classList.toggle('hidden', parts.length === 0);

  grid.querySelectorAll('[data-part]').forEach(card => {
    card.addEventListener('click', () => openPartModal(card.dataset.part));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openPartModal(card.dataset.part);
      }
    });
  });
  hydrateFiles($('vehicleScreen'));
}

// The round + button: adds an asset on the dashboard, adds a part on an asset page
function addByFab() {
  if (fabMode === 'part' && currentVehicleId) openPartModal(null);
  else openModal(null);
}
$('addFab').addEventListener('click', addByFab);
$('firstAssetBtn').addEventListener('click', () => openModal(null));
$('firstPartBtn').addEventListener('click', () => openPartModal(null));

// Small "i" buttons open a short explanation under the field
document.addEventListener('click', (e) => {
  const b = e.target.closest('.info-btn');
  if (!b) return;
  const el = $(b.dataset.hint);
  if (el) el.classList.toggle('hidden');
});

// ---------------- MODAL: ADD/EDIT PART ----------------
let partTouched = { unit: false, expiry: false, installedValue: false };
let wheelPos = '';   // chosen wheel position text, e.g. 'Axle 2 · Left outer (2LO)'
let pendingInvoice = null;   // { blob, type, ext } chosen but not yet uploaded
let removeInvoice = false;

function renderCategoryPicker(v, selected) {
  let cats = categoriesFor(v);
  if (selected && !cats.find(c => c.key === selected)) cats = cats.concat([categoryOf(selected)]);
  $('partCategoryPicker').innerHTML = cats.map(c => `
    <button type="button" class="type-btn" data-category="${c.key}">
      ${partSvg(c.inner, 2)}
      <span>${c.label}</span>
    </button>
  `).join('');
  $('partCategoryPicker').querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => setPartCategory(btn.dataset.category));
  });
}

function defaultUnitFor(cat, v) {
  if (cat.unit === 'meter') {
    const mu = meterUnitOf(v);
    return mu === 'none' ? 'time' : mu;
  }
  return cat.unit;
}

function setPartCategory(key, fromUser = true) {
  const v = vehiclesCache.find(x => x.id === currentVehicleId);
  const cat = categoryOf(key);
  $('pCategory').value = cat.key;
  $('partCategoryPicker').querySelectorAll('.type-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.category === cat.key);
  });
  $('pName').placeholder = cat.ph;
  const spec = PART_SPEC[cat.key] || PART_SPEC.other;
  $('pSpecLabel').textContent = `${spec.label} (optional)`;
  $('pSpec').placeholder = spec.ph;
  const layout = getLayout(v);
  const useWheel = !!layout && WHEEL_PART_KEYS.includes(cat.key);
  $('fWheel').classList.toggle('hidden', !useWheel);
  $('fPosition').classList.toggle('hidden', !spec.pos || useWheel);
  if (useWheel) renderWheelPicker();
  const battery = cat.key === 'battery';
  $('pSupplierLabelText').textContent = battery ? 'Supplier number (engraved number on your battery)' : 'Supplier / part number (optional)';
  $('hSupplier').textContent = battery
    ? 'The number your supplier engraved on the battery. Look on the top or side of the battery, usually near the terminals.'
    : 'The supplier\'s part number or serial number for this item, if it has one. You can usually find it on the item or on the invoice.';
  $('fEngraved').classList.toggle('hidden', !battery);
  if (fromUser && !partTouched.unit) {
    $('pTrackUnit').value = defaultUnitFor(cat, v);
    applyTrackUnit();
  }
}

function renderWheelPicker() {
  const v = vehiclesCache.find(x => x.id === currentVehicleId);
  const layout = getLayout(v);
  if (!layout) return;
  $('wheelPick').innerHTML = wheelDiagramSVG(layout, v.vehicle_type, codeFromPosition(wheelPos), true);
  $('wheelSel').textContent = wheelPos ? `Selected: ${wheelPos}` : 'Tap the wheel on the picture.';
  $('wheelRefNote').textContent = sideNote(layout, v.vehicle_type);
}
$('wheelPick').addEventListener('click', (e) => {
  const g = e.target.closest('[data-code]');
  if (!g) return;
  wheelPos = g.dataset.label;
  renderWheelPicker();
});
$('wheelPick').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const g = e.target.closest('[data-code]');
  if (!g) return;
  e.preventDefault();
  wheelPos = g.dataset.label;
  renderWheelPicker();
});
$('wheelSpareBtn').addEventListener('click', () => { wheelPos = 'Spare'; renderWheelPicker(); });
$('wheelClearBtn').addEventListener('click', () => { wheelPos = ''; renderWheelPicker(); });

function applyTrackUnit() {
  const u = $('pTrackUnit').value;
  const word = trackWord(u);
  const show = u !== 'time';
  $('fWarrantyValue').classList.toggle('hidden', !show);
  $('fServiceValue').classList.toggle('hidden', !show);
  $('fInstalledValue').classList.toggle('hidden', !show);
  $('fRetiredValue').classList.toggle('hidden', !show);
  $('pWarrantyValueLabel').textContent = `Warranty ends at (${word})`;
  $('pServiceValueLabel').textContent = `Next service at (${word})`;
  $('pInstalledValueLabel').textContent = `Reading when installed (${word})`;
  $('pRetiredValueLabel').textContent = `Reading when replaced (${word})`;
  const vv = vehiclesCache.find(x => x.id === currentVehicleId);
  const auto = show && vv && u === meterUnitOf(vv);
  $('fCurrentValue').classList.toggle('hidden', !show || auto);
  $('pCurrentValueLabel').textContent = `Current reading (${word})`;
  $('curAutoNote').classList.toggle('hidden', !auto);
  if (auto) {
    const cm = currentMeter(vv);
    $('curAutoNote').textContent = cm !== null
      ? `We use the asset's own reading (${fmtNum(cm)} ${word}) for the countdown, so there is nothing to type. It updates whenever you update the asset's reading.`
      : `We use the asset's own reading for the countdown. Add the asset's current reading and the countdown starts.`;
  }
  // New part measured in the asset's own unit: start the "installed at" box on the asset's current reading
  if (!partTouched.installedValue && !$('partId').value) {
    const v = vehiclesCache.find(x => x.id === currentVehicleId);
    const cur = v ? currentMeter(v) : null;
    $('pInstalledValue').value = show && v && u === meterUnitOf(v) && cur !== null ? cur : '';
  }
}

function refreshBrandList() {
  const brands = new Set();
  vehiclesCache.forEach(v => (v.warranties || []).forEach(p => { if (p.brand) brands.add(p.brand); }));
  $('brandList').innerHTML = [...brands].sort().map(b => `<option value="${escapeHtml(b)}"></option>`).join('');
}

function autoWarrantyEnd() {
  if (partTouched.expiry) return;
  const months = numOrNull($('pWarrantyMonths').value);
  const end = months !== null && $('pInvoiceDate').value ? addMonthsISO($('pInvoiceDate').value, months) : '';
  if (end) $('pWarrantyDate').value = end;
}

function showInvoiceState(p) {
  const has = p && p.invoice_path && !removeInvoice;
  $('invoiceCurrent').classList.toggle('hidden', !has);
  if (has) {
    const a = $('invoiceLink');
    a.dataset.file = p.invoice_path;
    a.removeAttribute('href');
    hydrateFiles($('invoiceCurrent'));
  }
}

function openPartModal(partId) {
  const v = vehiclesCache.find(x => x.id === currentVehicleId);
  if (!v) return;
  const p = partId ? (v.warranties || []).find(x => x.id === partId) : null;

  partTouched = { unit: !!p, expiry: false, installedValue: !!p };
  pendingInvoice = null;
  removeInvoice = false;
  refreshBrandList();
  renderCategoryPicker(v, p ? p.category : null);

  $('partId').value = p ? p.id : '';
  $('pName').value = p ? p.item_name : '';
  $('pBrand').value = p ? (p.brand || '') : '';
  $('pSpec').value = p ? (p.spec || '') : '';
  $('pPosition').value = p ? (p.position || '') : '';
  wheelPos = p ? (p.position || '') : '';
  $('pInstalledValue').value = p && hasNum(p.installed_value) ? p.installed_value : '';
  $('pCurrentValue').value = p && hasNum(p.current_value) ? p.current_value : '';
  $('pRetiredDate').value = p ? (p.retired_date || '') : '';
  $('pRetiredValue').value = p && hasNum(p.retired_value) ? p.retired_value : '';
  $('pSupplier').value = p ? (p.supplier_number || '') : '';
  $('pEngraved').value = p ? (p.engraved_date || '') : '';
  $('pManufactured').value = p ? (p.manufacturing_date || '') : '';
  $('pInstalled').value = p ? (p.installation_date || '') : '';
  $('pInvoiceNo').value = p ? (p.invoice_number || '') : '';
  $('pInvoiceDate').value = p ? (p.invoice_date || '') : '';
  $('pWarrantyMonths').value = p && hasNum(p.warranty_months) ? p.warranty_months : '';
  $('pWarrantyDate').value = p ? (p.expiry_date || '') : '';
  $('pWarrantyValue').value = p && hasNum(p.expiry_km) ? p.expiry_km : '';
  $('pServiceDate').value = p ? (p.next_service_date || '') : '';
  $('pServiceValue').value = p && hasNum(p.next_service_value) ? p.next_service_value : '';
  $('pNotes').value = p ? (p.notes || '') : '';
  $('pInvoiceFile').value = '';
  $('invoiceFileMsg').textContent = '';
  $('invoiceFileMsg').className = 'file-msg';

  setPartCategory(p && p.category ? p.category : 'other', false);
  if (p) {
    $('pTrackUnit').value = p.tracking_unit || 'km';
    // If the saved end date differs from invoice date + months, the person typed it: do not overwrite it
    const calc = p.invoice_date && hasNum(p.warranty_months) ? addMonthsISO(p.invoice_date, p.warranty_months) : '';
    partTouched.expiry = !!(p.expiry_date && calc !== p.expiry_date);
  } else {
    $('pTrackUnit').value = defaultUnitFor(categoryOf('other'), v);
    // pick the first category shown so the form always starts with a real choice
    const first = categoriesFor(v)[0];
    setPartCategory(first.key, true);
  }
  applyTrackUnit();
  showInvoiceState(p);
  document.querySelectorAll('#partModal .field-hint').forEach(h => h.classList.add('hidden'));
  $('partModalTitle').textContent = p ? 'Edit part' : 'Add part';
  $('deletePartBtn').classList.toggle('hidden', !p);
  $('partModal').classList.remove('hidden');
  $('partModal').querySelector('.modal').scrollTop = 0;
}

function closePartModal() {
  $('partModal').classList.add('hidden');
}
$('closePartModal').addEventListener('click', closePartModal);
$('pTrackUnit').addEventListener('change', () => { partTouched.unit = true; applyTrackUnit(); });
$('pInstalledValue').addEventListener('input', () => { partTouched.installedValue = true; });
$('pInvoiceDate').addEventListener('change', autoWarrantyEnd);
$('pWarrantyMonths').addEventListener('input', autoWarrantyEnd);
$('pWarrantyDate').addEventListener('input', () => { partTouched.expiry = true; });
$('removeInvoiceBtn').addEventListener('click', () => {
  removeInvoice = true;
  $('invoiceCurrent').classList.add('hidden');
});

$('pInvoiceFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  const msg = $('invoiceFileMsg');
  pendingInvoice = null;
  msg.className = 'file-msg';
  msg.textContent = '';
  if (!f) return;
  try {
    if (f.type === 'application/pdf') {
      if (f.size > MAX_FILE_BYTES) throw new Error('That PDF is bigger than 5 MB. Please take a photo of the invoice instead.');
      pendingInvoice = { blob: f, type: 'application/pdf', ext: 'pdf' };
    } else if (f.type.startsWith('image/')) {
      const blob = await prepareImage(f, 1800, 0.8);
      if (blob.size > MAX_FILE_BYTES) throw new Error('That picture is too large. Please try a smaller one.');
      pendingInvoice = { blob, type: 'image/jpeg', ext: 'jpg' };
    } else {
      throw new Error('Please choose a photo or a PDF of the invoice.');
    }
    msg.textContent = `Ready to save: ${f.name}`;
  } catch (err) {
    e.target.value = '';
    msg.className = 'file-msg file-msg-bad';
    msg.textContent = err.message;
  }
});

$('partForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = vehiclesCache.find(x => x.id === currentVehicleId);
  if (!v) return;
  const existingId = $('partId').value || null;
  const existing = existingId ? (v.warranties || []).find(x => x.id === existingId) : null;
  const id = existingId || uuid();

  const invoiceDate = $('pInvoiceDate').value || null;
  const months = numOrNull($('pWarrantyMonths').value);
  let expiry = $('pWarrantyDate').value || null;
  if (!expiry && invoiceDate && months !== null) expiry = addMonthsISO(invoiceDate, months) || null;

  const payload = {
    vehicle_id: v.id,
    user_id: currentUser.id,
    item_name: $('pName').value.trim(),
    category: $('pCategory').value || 'other',
    brand: $('pBrand').value.trim() || null,
    spec: $('pSpec').value.trim() || null,
    position: $('pPosition').value || null,
    installed_value: numOrNull($('pInstalledValue').value),
    current_value: $('fCurrentValue').classList.contains('hidden') ? null : numOrNull($('pCurrentValue').value),
    retired_date: $('pRetiredDate').value || null,
    retired_value: numOrNull($('pRetiredValue').value),
    supplier_number: $('pSupplier').value.trim() || null,
    engraved_date: $('pEngraved').value || null,
    manufacturing_date: $('pManufactured').value || null,
    installation_date: $('pInstalled').value || null,
    invoice_number: $('pInvoiceNo').value.trim() || null,
    invoice_date: invoiceDate,
    warranty_months: months,
    expiry_date: expiry,
    tracking_unit: $('pTrackUnit').value,
    expiry_km: numOrNull($('pWarrantyValue').value),
    next_service_date: $('pServiceDate').value || null,
    next_service_value: numOrNull($('pServiceValue').value),
    notes: $('pNotes').value.trim() || null,
  };
  if (!payload.item_name) return;
  if ($('pTrackUnit').value === 'time') { payload.expiry_km = null; payload.next_service_value = null; payload.installed_value = null; payload.retired_value = null; }
  const wheelMode = !$('fWheel').classList.contains('hidden');
  const listMode = !$('fPosition').classList.contains('hidden');
  payload.position = wheelMode ? (wheelPos || null) : (listMode ? ($('pPosition').value || null) : null);

  const saveBtn = $('partSaveBtn');
  saveBtn.disabled = true;
  let newPath = null;
  try {
    if (pendingInvoice) {
      newPath = `${currentUser.id}/invoices/${id}-${Date.now()}.${pendingInvoice.ext}`;
      await uploadFile(newPath, pendingInvoice.blob, pendingInvoice.type);
      payload.invoice_path = newPath;
    } else if (removeInvoice) {
      payload.invoice_path = null;
    }

    let error;
    if (existingId) {
      ({ error } = await sb.from('warranties').update(payload).eq('id', existingId));
    } else {
      ({ error } = await sb.from('warranties').insert({ ...payload, id }));
    }
    if (error) throw error;

    if (existing && existing.invoice_path && (newPath || removeInvoice)) await removeFiles([existing.invoice_path]);
  } catch (err) {
    if (newPath) await removeFiles([newPath]);
    saveBtn.disabled = false;
    alert(err.message || 'Could not save this part. Please try again.');
    return;
  }
  saveBtn.disabled = false;
  closePartModal();
  await loadVehicles();
});

$('deletePartBtn').addEventListener('click', async () => {
  const id = $('partId').value;
  if (!id) return;
  if (!confirm('Delete this part? This can\'t be undone.')) return;
  const v = vehiclesCache.find(x => x.id === currentVehicleId);
  const existing = v ? (v.warranties || []).find(x => x.id === id) : null;
  const { error } = await sb.from('warranties').delete().eq('id', id);
  if (error) { alert(error.message); return; }
  if (existing && existing.invoice_path) await removeFiles([existing.invoice_path]);
  closePartModal();
  await loadVehicles();
});

// ---------------- MODAL: ADD/EDIT ASSET ----------------
// ---------------- ASSET FORM: AXLES AND WHEELS ----------------
let layoutDraft = null;
let layoutTouched = false;

function applyLayoutUi(type) {
  const show = WHEEL_TYPES.includes(type);
  $('fWheelLayout').classList.toggle('hidden', !show);
  if (!show) return;
  const group = presetGroup(type);
  $('layoutPresets').innerHTML = (LAYOUT_PRESETS[group] || LAYOUT_PRESETS.other).map((p, i) => `<button type="button" class="chip" data-preset="${i}">${p.label}</button>`).join('');
  $('layoutPresets').querySelectorAll('[data-preset]').forEach(btn => btn.addEventListener('click', () => {
    layoutDraft.axles = (LAYOUT_PRESETS[group] || LAYOUT_PRESETS.other)[+btn.dataset.preset].axles.slice();
    layoutTouched = true;
    renderLayoutEditor();
  }));
  $('fSideRef').classList.toggle('hidden', group !== 'trailer');
  if (group !== 'trailer') layoutDraft.ref = 'travel';
  renderLayoutEditor();
}

function renderLayoutEditor() {
  const type = $('vType').value;
  $('vAxleCount').value = String(layoutDraft.axles.length);
  $('axleRows').innerHTML = layoutDraft.axles.map((w, i) => `
    <div class="axle-row"><span>Axle ${i + 1}${i === 0 ? ' (front)' : ''}</span>
      <select data-axle="${i}"><option value="1"${w === 1 ? ' selected' : ''}>Single wheels</option><option value="2"${w === 2 ? ' selected' : ''}>Dual wheels (double tyres)</option></select>
    </div>`).join('');
  $('axleRows').querySelectorAll('[data-axle]').forEach(sel => sel.addEventListener('change', () => {
    layoutDraft.axles[+sel.dataset.axle] = Number(sel.value) === 2 ? 2 : 1;
    layoutTouched = true;
    renderLayoutEditor();
  }));
  $('vSideRef').value = layoutDraft.ref;
  $('layoutPreview').innerHTML = wheelDiagramSVG(layoutDraft, type, '', false);
  $('layoutSummary').textContent = `${layoutSummary(layoutDraft)}. ${sideNote(layoutDraft, type)}.`;
}

$('vAxleCount').innerHTML = [1, 2, 3, 4, 5, 6].map(n => `<option value="${n}">${n}</option>`).join('');
$('vAxleCount').addEventListener('change', () => {
  const n = Number($('vAxleCount').value);
  const last = layoutDraft.axles[layoutDraft.axles.length - 1] || 1;
  while (layoutDraft.axles.length < n) layoutDraft.axles.push(last);
  layoutDraft.axles.length = n;
  layoutTouched = true;
  renderLayoutEditor();
});
$('vSideRef').addEventListener('change', () => {
  layoutDraft.ref = $('vSideRef').value === 'hitch' ? 'hitch' : 'travel';
  layoutTouched = true;
  renderLayoutEditor();
});

let meterTouched = false;
let pendingPhoto = null;   // Blob chosen but not yet uploaded
let removePhoto = false;

function buildTypePicker() {
  $('typePicker').innerHTML = VEHICLE_TYPES.map(t => `
    <button type="button" class="type-btn" data-type="${t.key}">
      ${TYPE_ICONS[t.key] || TYPE_ICONS.other}
      <span>${t.label}</span>
    </button>
  `).join('');
  $('typePicker').querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setVehicleType(btn.dataset.type);
      if (!layoutTouched) layoutDraft = defaultLayoutFor(btn.dataset.type);
      applyLayoutUi(btn.dataset.type);
      if (!$('vehicleId').value && !meterTouched) {
        $('vMeterUnit').value = defaultMeterFor(btn.dataset.type);
        applyMeterUnit();
      }
    });
  });
}

function setVehicleType(type) {
  $('vType').value = type;
  document.querySelectorAll('#typePicker .type-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === type);
  });
}

function applyRenewPlace() {
  $('fRenewUrl').classList.toggle('hidden', $('vRenewPlace').value !== 'other');
}
$('vRenewPlace').addEventListener('change', applyRenewPlace);

function applyMeterUnit() {
  const u = $('vMeterUnit').value;
  const dist = u === 'km' || u === 'miles';
  const w = u === 'miles' ? 'miles' : 'km';
  $('lServiceKm').textContent = `Next service \u2014 due at ${w} (optional)`;
  $('lCurrentKm').textContent = u === 'miles' ? 'Current odometer (miles)' : 'Current odometer (km)';
  $('fServiceKm').classList.toggle('hidden', !dist);
  $('fCurrentKm').classList.toggle('hidden', !dist);
  $('fServiceHours').classList.toggle('hidden', u !== 'hours');
  $('fCurrentHours').classList.toggle('hidden', u !== 'hours');
}
$('vMeterUnit').addEventListener('change', () => { meterTouched = true; applyMeterUnit(); });
$('closeModal').addEventListener('click', closeModal);

function showPhotoPreview(src) {
  $('vPhotoPreview').classList.toggle('hidden', !src);
  if (src) $('vPhotoPreviewImg').src = src;
  $('vPhotoRemoveBtn').classList.toggle('hidden', !src);
}

function openModal(vehicleId) {
  const v = vehicleId ? vehiclesCache.find(x => x.id === vehicleId) : null;
  meterTouched = !!v;
  const savedLayout = getLayout(v);
  layoutTouched = !!savedLayout;
  layoutDraft = savedLayout || defaultLayoutFor(v ? v.vehicle_type : 'car');
  pendingPhoto = null;
  removePhoto = false;
  $('vehicleId').value = v ? v.id : '';
  $('vName').value = v ? v.name : '';
  setVehicleType(v ? v.vehicle_type : 'car');
  $('vLicence').value = v ? (v.licence_expiry || '') : '';
  $('vMeterUnit').value = v ? meterUnitOf(v) : 'km';
  const lu = v && v.licence_url ? v.licence_url : '';
  $('vRenewPlace').value = !lu ? 'za' : (lu === RENEW_PRESETS.uk ? 'uk' : (lu === RENEW_PRESETS.za ? 'za' : 'other'));
  $('vRenewUrl').value = $('vRenewPlace').value === 'other' ? lu : '';
  applyRenewPlace();
  $('vServiceDate').value = v ? (v.service_due_date || '') : '';
  $('vServiceKm').value = v && hasNum(v.service_due_km) ? v.service_due_km : '';
  $('vCurrentKm').value = v && hasNum(v.current_km) ? v.current_km : '';
  $('vServiceHours').value = v && hasNum(v.service_due_hours) ? v.service_due_hours : '';
  $('vCurrentHours').value = v && hasNum(v.current_hours) ? v.current_hours : '';
  $('vNotes').value = v ? (v.notes || '') : '';
  $('vPhotoInput').value = '';
  $('photoMsg').textContent = '';
  $('photoMsg').className = 'file-msg';
  showPhotoPreview(null);
  if (v && v.photo_path) {
    const img = $('vPhotoPreviewImg');
    img.removeAttribute('src');
    img.dataset.photo = v.photo_path;
    $('vPhotoPreview').classList.remove('hidden');
    $('vPhotoRemoveBtn').classList.remove('hidden');
    hydrateFiles($('vPhotoPreview'));
  } else {
    delete $('vPhotoPreviewImg').dataset.photo;
  }
  applyLayoutUi($('vType').value);
  $('modalTitle').textContent = v ? 'Edit asset' : 'Add your asset';
  $('deleteVehicleBtn').classList.toggle('hidden', !v);
  applyMeterUnit();
  $('vehicleModal').classList.remove('hidden');
  $('vehicleModal').querySelector('.modal').scrollTop = 0;
}

function closeModal() {
  $('vehicleModal').classList.add('hidden');
}

$('vPhotoInput').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  const msg = $('photoMsg');
  pendingPhoto = null;
  msg.className = 'file-msg';
  msg.textContent = '';
  if (!f) return;
  try {
    if (!f.type.startsWith('image/')) throw new Error('Please choose a picture (JPG or PNG).');
    const blob = await prepareImage(f, 1280, 0.82);
    if (blob.size > MAX_FILE_BYTES) throw new Error('That picture is too large. Please try another one.');
    pendingPhoto = blob;
    removePhoto = false;
    delete $('vPhotoPreviewImg').dataset.photo;
    showPhotoPreview(URL.createObjectURL(blob));
  } catch (err) {
    e.target.value = '';
    msg.className = 'file-msg file-msg-bad';
    msg.textContent = err.message;
  }
});

$('vPhotoRemoveBtn').addEventListener('click', () => {
  pendingPhoto = null;
  removePhoto = true;
  $('vPhotoInput').value = '';
  showPhotoPreview(null);
});

$('vehicleForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const existingId = $('vehicleId').value || null;
  const existing = existingId ? vehiclesCache.find(x => x.id === existingId) : null;
  const id = existingId || uuid();

  let licenceUrl = null;
  const place = $('vRenewPlace').value;
  if (place === 'uk') licenceUrl = RENEW_PRESETS.uk;
  if (place === 'other') {
    licenceUrl = $('vRenewUrl').value.trim();
    if (!/^https:\/\/[^\s]+\.[^\s]+$/i.test(licenceUrl)) {
      alert('Please type the full website address, starting with https://');
      return;
    }
  }

  const payload = {
    user_id: currentUser.id,
    name: $('vName').value.trim(),
    vehicle_type: $('vType').value,
    licence_expiry: $('vLicence').value || null,
    licence_url: licenceUrl,
    wheel_layout: WHEEL_TYPES.includes($('vType').value) ? { axles: layoutDraft.axles, ref: layoutDraft.ref } : null,
    meter_unit: $('vMeterUnit').value,
    service_due_date: $('vServiceDate').value || null,
    service_due_km: numOrNull($('vServiceKm').value),
    current_km: numOrNull($('vCurrentKm').value),
    service_due_hours: numOrNull($('vServiceHours').value),
    current_hours: numOrNull($('vCurrentHours').value),
    notes: $('vNotes').value.trim() || null,
  };

  const saveBtn = e.target.querySelector('button[type="submit"]');
  saveBtn.disabled = true;
  let newPath = null;
  try {
    if (pendingPhoto) {
      newPath = `${currentUser.id}/photos/${id}-${Date.now()}.jpg`;
      await uploadFile(newPath, pendingPhoto, 'image/jpeg');
      payload.photo_path = newPath;
    } else if (removePhoto) {
      payload.photo_path = null;
    }
    let error;
    if (existingId) {
      ({ error } = await sb.from('vehicles').update(payload).eq('id', existingId));
    } else {
      ({ error } = await sb.from('vehicles').insert({ ...payload, id }));
    }
    if (error) throw error;
    if (existing && existing.photo_path && (newPath || removePhoto)) await removeFiles([existing.photo_path]);
  } catch (err) {
    if (newPath) await removeFiles([newPath]);
    saveBtn.disabled = false;
    alert(err.message || 'Could not save. Please try again.');
    return;
  }
  saveBtn.disabled = false;
  closeModal();
  await loadVehicles();
});

$('deleteVehicleBtn').addEventListener('click', async () => {
  const id = $('vehicleId').value;
  if (!id) return;
  if (!confirm('Delete this asset with all its parts, invoices and readings? This can\'t be undone.')) return;
  const v = vehiclesCache.find(x => x.id === id);
  const files = v ? [v.photo_path, ...(v.warranties || []).map(p => p.invoice_path)] : [];
  const { error } = await sb.from('vehicles').delete().eq('id', id);
  if (error) { alert(error.message); return; }
  await removeFiles(files);
  closeModal();
  const wasOnVehiclePage = history.state && history.state.vehicleId;
  currentVehicleId = null;
  showDashboard();
  if (wasOnVehiclePage) history.back();
  await loadVehicles();
});

// ---------------- SHARE AN ASSET (WhatsApp / email / copy) ----------------
function buildShareText(v) {
  const unit = meterUnitOf(v);
  const cur = currentMeter(v);
  const lines = [];
  lines.push(`*${v.name}* (${prettyType(v.vehicle_type)}) - shared from Peyper-Trails`);
  if (cur !== null) lines.push(`${unit === 'hours' ? 'Hour meter' : 'Odometer'}: ${fmtNum(cur)} ${unitShort(unit)}`);
  if (getLayout(v)) lines.push(`Wheels: ${layoutSummary(getLayout(v))}. ${sideNote(getLayout(v), v.vehicle_type)}.`);
  if (v.licence_expiry) lines.push(`Licence expires: ${fmtDate(v.licence_expiry)}`);
  if (v.service_due_date) lines.push(`Next service: ${fmtDate(v.service_due_date)}`);
  const dueAt = serviceDueMeter(v);
  if (dueAt !== null) lines.push(`Service due at: ${fmtNum(dueAt)} ${unitShort(unit)}`);
  if (v.notes) lines.push(`Notes: ${v.notes}`);

  const parts = (v.warranties || []).slice().sort((a, b) => partNearestDays(a, v) - partNearestDays(b, v));
  if (parts.length) {
    lines.push('');
    lines.push('*Parts*');
    parts.forEach(p => {
      const cat = categoryOf(p.category);
      const word = trackWord(p.tracking_unit || 'km');
      lines.push('');
      lines.push(`- ${p.item_name} (${cat.label})`);
      const add = (label, val) => { if (val) lines.push(`   ${label}: ${val}`); };
      add('Brand', p.brand);
      add('Size / type', p.spec);
      add('Position', p.position);
      add('Supplier no.', p.supplier_number);
      add('Engraved date', p.engraved_date ? fmtDate(p.engraved_date) : '');
      add('Manufactured', p.manufacturing_date ? fmtDate(p.manufacturing_date) : '');
      add('Installed', [p.installation_date ? fmtDate(p.installation_date) : '', hasNum(p.installed_value) && word ? `at ${fmtNum(p.installed_value)} ${word}` : ''].filter(Boolean).join(' '));
      add('Invoice no.', p.invoice_number);
      add('Invoice date', p.invoice_date ? fmtDate(p.invoice_date) : '');
      add('Warranty', hasNum(p.warranty_months) ? `${p.warranty_months} months` : '');
      add('Warranty ends', [p.expiry_date ? fmtDate(p.expiry_date) : '', hasNum(p.expiry_km) && word ? `${fmtNum(p.expiry_km)} ${word}` : ''].filter(Boolean).join(' / '));
      add('Next service', [p.next_service_date ? fmtDate(p.next_service_date) : '', hasNum(p.next_service_value) && word ? `${fmtNum(p.next_service_value)} ${word}` : ''].filter(Boolean).join(' / '));
      add('Replaced', [p.retired_date ? fmtDate(p.retired_date) : '', hasNum(p.retired_value) && word ? `at ${fmtNum(p.retired_value)} ${word}` : ''].filter(Boolean).join(' '));
      add('Invoice on file', p.invoice_path ? 'Yes' : '');
      add('Notes', p.notes);
    });
  }
  return lines.join('\n');
}

let shareFileList = [];
let shareToken = 0;

async function prepareShareFiles(v) {
  const token = ++shareToken;
  const btn = $('shareFiles');
  shareFileList = [];
  const paths = [v.photo_path, ...(v.warranties || []).map(p => p.invoice_path)].filter(Boolean).slice(0, 10);
  if (!paths.length || !navigator.canShare) { btn.classList.add('hidden'); return; }
  btn.classList.remove('hidden');
  btn.disabled = true;
  btn.textContent = 'Getting files ready…';
  const safe = v.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'asset';
  const files = [];
  for (const path of paths) {
    try {
      const { data, error } = await sb.storage.from(BUCKET).download(path);
      if (error || !data) continue;
      const ext = (path.split('.').pop() || 'jpg').toLowerCase();
      files.push(new File([data], `${safe}-${files.length + 1}.${ext}`, { type: data.type || (ext === 'pdf' ? 'application/pdf' : 'image/jpeg') }));
    } catch (e) { console.error(e); }
  }
  if (token !== shareToken) return; // the window was closed or reopened meanwhile
  shareFileList = files;
  if (!files.length || !navigator.canShare({ files })) { btn.classList.add('hidden'); return; }
  btn.disabled = false;
  btn.textContent = `Send with ${files.length} file${files.length === 1 ? '' : 's'}`;
}

function openShare(vehicleId) {
  const v = vehiclesCache.find(x => x.id === vehicleId);
  if (!v) return;
  prepareShareFiles(v);
  const text = buildShareText(v);
  $('shareText').value = text;
  $('shareWhatsApp').href = 'https://wa.me/?text=' + encodeURIComponent(text);
  $('shareEmail').href = 'mailto:?subject=' + encodeURIComponent(`${v.name} - Peyper-Trails`) + '&body=' + encodeURIComponent(text.replace(/\*/g, ''));
  $('shareNative').classList.toggle('hidden', !navigator.share);
  $('shareCopyMsg').textContent = '';
  $('shareModal').classList.remove('hidden');
}
$('closeShare').addEventListener('click', () => { shareToken++; $('shareModal').classList.add('hidden'); });
$('shareFiles').addEventListener('click', async () => {
  try {
    await navigator.share({ files: shareFileList, text: $('shareText').value.replace(/\*/g, '') });
  } catch (err) {
    if (err && err.name !== 'AbortError') {
      $('shareCopyMsg').textContent = 'This phone could not attach the files. Use WhatsApp or Email to send the text instead.';
    }
  }
});
$('shareCopy').addEventListener('click', async () => {
  const t = $('shareText').value;
  try {
    await navigator.clipboard.writeText(t);
  } catch (err) {
    $('shareText').select();
    document.execCommand('copy');
  }
  $('shareCopyMsg').textContent = 'Copied. You can paste it anywhere.';
});
$('shareNative').addEventListener('click', async () => {
  try { await navigator.share({ text: $('shareText').value.replace(/\*/g, '') }); } catch (err) { /* cancelled */ }
});

// ---------------- READING LOG ----------------
let readingsCache = []; // readings for the vehicle shown in the open log, newest first

async function openReadingLog(vehicleId) {
  const v = vehiclesCache.find(x => x.id === vehicleId);
  if (!v) return;
  const unit = meterUnitOf(v);
  $('readingVehicleId').value = v.id;
  $('readingLogFor').textContent = `${v.name} — readings in ${unitWord(unit)}`;
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


// ---------------- BRAND REPORTS ----------------
function showReports(push = true) {
  if (push) history.pushState({ reports: true }, '');
  currentVehicleId = null;
  $('dashScreen').classList.add('hidden');
  $('vehicleScreen').classList.add('hidden');
  $('reportsScreen').classList.remove('hidden');
  $('addFab').classList.add('hidden');
  window.scrollTo(0, 0);
  buildReport();
}
$('reportsBtn').addEventListener('click', () => showReports(true));
$('reportsBack').addEventListener('click', () => {
  if (history.state && history.state.reports) history.back(); else showDashboard();
});
$('reportCategory').addEventListener('change', buildReport);

function avg(nums) { return nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : null; }

function buildReport() {
  const all = [];
  vehiclesCache.forEach(v => (v.warranties || []).forEach(p => all.push({ p, v })));

  const sel = $('reportCategory');
  const keep = sel.value || 'all';
  const present = PART_CATEGORIES.filter(c => all.some(x => (x.p.category || 'other') === c.key));
  sel.innerHTML = '<option value="all">All item types</option>' + present.map(c => `<option value="${c.key}">${escapeHtml(c.label)}</option>`).join('');
  sel.value = present.some(c => c.key === keep) ? keep : 'all';

  const body = $('reportBody');
  if (all.length === 0) {
    body.innerHTML = '<p class="help-text">No parts yet. Add parts to your assets and they will show up here.</p>';
    return;
  }
  const cats = sel.value === 'all' ? present : present.filter(c => c.key === sel.value);
  body.innerHTML = cats.map(c => {
    const inCat = all.filter(x => (x.p.category || 'other') === c.key);
    const groups = new Map();
    inCat.forEach(x => {
      const name = (x.p.brand || '').trim();
      const key = name.toLowerCase() || '\u0000';
      if (!groups.has(key)) groups.set(key, { name: name || 'No brand', list: [] });
      groups.get(key).list.push(x);
    });
    const rows = [...groups.values()].map(g => {
      const lives = g.list.map(x => lifeOf(x.p));
      const days = lives.map(l => l.days).filter(d => d !== null);
      const months = g.list.map(x => x.p.warranty_months).filter(hasNum).map(Number);
      const byUnit = {};
      lives.forEach(l => { if (l.dist !== null) (byUnit[l.unit] = byUnit[l.unit] || []).push(l.dist); });
      const replaced = g.list.filter(x => x.p.retired_date).length;
      const lastedParts = [];
      if (days.length) lastedParts.push(`${fmtNum(Math.round(avg(days)))} days`);
      Object.keys(byUnit).forEach(u => lastedParts.push(`${fmtNum(Math.round(avg(byUnit[u])))} ${trackWord(u)}`));
      return {
        name: g.name, count: g.list.length, replaced,
        warranty: months.length ? `${Math.round(avg(months))} months` : '—',
        lasted: lastedParts.length ? lastedParts.join(' · ') : '—',
        score: days.length ? avg(days) : -1,
      };
    }).sort((x, y) => (y.score - x.score) || (y.count - x.count));
    return `
      <div class="report-block">
        <h3 class="report-title"><span class="part-icon">${partSvg(c.inner, 2.5)}</span>${escapeHtml(c.label)}</h3>
        <div class="table-scroll">
          <table class="report-table">
            <thead><tr><th>Brand</th><th>Parts</th><th>Avg warranty</th><th>Avg lasted</th></tr></thead>
            <tbody>${rows.map(r => `<tr><td>${escapeHtml(r.name)}</td><td>${r.count}${r.replaced ? ` <span class="muted">(${r.replaced} replaced)</span>` : ''}</td><td>${r.warranty}</td><td>${r.lasted}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`;
  }).join('');
}

function downloadCsv(filename, rows) {
  const csv = rows.map(row => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('exportPartsBtn').addEventListener('click', () => {
  const rows = [['Asset', 'Asset type', 'Item type', 'Name', 'Brand', 'Size / type', 'Position', 'Supplier number', 'Engraved date', 'Manufacturing date', 'Installation date', 'Installed at', 'Invoice number', 'Invoice date', 'Warranty months', 'Warranty ends', 'Tracked by', 'Warranty ends at', 'Next service date', 'Next service at', 'Replaced on', 'Replaced at', 'Lasted days', 'Lasted distance / hours / liters', 'Invoice on file', 'Notes']];
  vehiclesCache.forEach(v => (v.warranties || []).forEach(p => {
    const life = lifeOf(p);
    rows.push([v.name, prettyType(v.vehicle_type), categoryOf(p.category).label, p.item_name, p.brand, p.spec, p.position, p.supplier_number, p.engraved_date, p.manufacturing_date, p.installation_date, p.installed_value, p.invoice_number, p.invoice_date, p.warranty_months, p.expiry_date, p.tracking_unit, p.expiry_km, p.next_service_date, p.next_service_value, p.retired_date, p.retired_value, life.days, life.dist, p.invoice_path ? 'Yes' : 'No', p.notes]);
  }));
  if (rows.length === 1) { alert('There are no parts to export yet.'); return; }
  downloadCsv(`peyper-trails-parts-${todayStr()}.csv`, rows);
});

// ---------------- GOOGLE SIGN-IN (switched on from config.js once Supabase is set up) ----------------
const GOOGLE_ON = typeof GOOGLE_LOGIN_ENABLED !== 'undefined' && GOOGLE_LOGIN_ENABLED === true;
$('googleBtnWrap').classList.toggle('hidden', !GOOGLE_ON);
$('googleBtn').addEventListener('click', async () => {
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
  if (error) {
    $('authError').textContent = error.message;
    $('authError').classList.remove('hidden');
  }
});

// ---------------- HELP & QUESTIONS (FAQ + optional AI helper) ----------------
let faqData = null;
async function loadFaq() {
  if (faqData) return faqData;
  try {
    const r = await fetch('faq.json', { cache: 'no-cache' });
    faqData = r.ok ? await r.json() : [];
  } catch (e) {
    faqData = [];
  }
  return faqData;
}

function renderFaq(term) {
  const t = (term || '').trim().toLowerCase();
  const list = (faqData || []).filter(x => !t || x.q.toLowerCase().includes(t) || x.a.toLowerCase().includes(t));
  $('faqList').innerHTML = list.length
    ? list.map(x => `<details class="faq-item"><summary>${escapeHtml(x.q)}</summary><div class="faq-answer">${escapeHtml(x.a)}</div></details>`).join('')
    : '<p class="help-text">No matching question. Try other words, or ask the helper below.</p>';
}

async function openHelp() {
  $('forgotEmailModal').classList.add('hidden');
  $('helpModal').classList.remove('hidden');
  $('helpSearch').value = '';
  await loadFaq();
  renderFaq('');
}
['helpBtn', 'authHelpBtn', 'footerHelpBtn', 'forgotEmailHelpBtn'].forEach(id => $(id).addEventListener('click', openHelp));
$('closeHelp').addEventListener('click', () => $('helpModal').classList.add('hidden'));
$('helpSearch').addEventListener('input', () => renderFaq($('helpSearch').value));

$('askForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('askInput').value.trim();
  if (q.length < 3) return;
  const out = $('askAnswer');
  const btn = $('askBtn');
  btn.disabled = true;
  out.className = 'ask-answer';
  out.textContent = 'Thinking…';
  try {
    const r = await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q }) });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.answer) {
      out.textContent = data.answer;
    } else if (r.status === 503 || r.status === 404) {
      out.textContent = 'The AI helper is not switched on yet. Please browse the questions above.';
    } else if (r.status === 429) {
      out.textContent = 'The helper has answered a lot of questions today. Please browse the questions above or try again tomorrow.';
    } else {
      out.textContent = 'Sorry, the helper could not answer that. Please browse the questions above.';
    }
  } catch (err) {
    out.textContent = 'Could not reach the helper. Please browse the questions above.';
  }
  btn.disabled = false;
});


// ---------------- MY ACCOUNT & BACKUP ----------------
function showFooterAccount() { $('footerAccountBtn').classList.toggle('hidden', !currentUser); }
function openAccount() {
  $('accountEmail').textContent = currentUser && currentUser.email ? currentUser.email : '';
  ['changeEmailMsg', 'changePasswordMsg', 'backupMsg'].forEach(id => { $(id).textContent = ''; $(id).className = 'file-msg'; });
  $('newEmailInput').value = '';
  $('newPasswordInput').value = '';
  $('accountModal').classList.remove('hidden');
}
function accountMsg(id, text, bad) { $(id).className = 'file-msg' + (bad ? ' file-msg-bad' : ''); $(id).textContent = text; }
$('footerAccountBtn').addEventListener('click', openAccount);
$('closeAccount').addEventListener('click', () => $('accountModal').classList.add('hidden'));

$('changeEmailBtn').addEventListener('click', async () => {
  const email = $('newEmailInput').value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { accountMsg('changeEmailMsg', 'Please type a full email address.', true); return; }
  $('changeEmailBtn').disabled = true;
  const { error } = await sb.auth.updateUser({ email });
  $('changeEmailBtn').disabled = false;
  if (error) { accountMsg('changeEmailMsg', error.message, true); return; }
  accountMsg('changeEmailMsg', `We sent a confirmation link to ${email}. Your login only changes after you open that link. You may also get a link at your old address: confirm both.`);
});

$('changePasswordBtn').addEventListener('click', async () => {
  const pw = $('newPasswordInput').value;
  if (pw.length < 8) { accountMsg('changePasswordMsg', 'Please use at least 8 characters.', true); return; }
  $('changePasswordBtn').disabled = true;
  const { error } = await sb.auth.updateUser({ password: pw });
  $('changePasswordBtn').disabled = false;
  if (error) { accountMsg('changePasswordMsg', error.message, true); return; }
  $('newPasswordInput').value = '';
  accountMsg('changePasswordMsg', 'Password changed.');
});

$('backupBtn').addEventListener('click', async () => {
  $('backupBtn').disabled = true;
  try {
    const readings = await fetchAllReadings();
    const backup = {
      app: 'Peyper-Trails',
      saved_on: new Date().toISOString(),
      note: 'Assets, parts and readings. Photos and invoice files are not included.',
      assets: vehiclesCache.map(v => ({ ...v, user_id: undefined, parts: (v.warranties || []).map(p => ({ ...p, user_id: undefined })), warranties: undefined })),
      readings: readings.map(r => ({ ...r, user_id: undefined })),
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `peyper-trails-backup-${todayStr()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    accountMsg('backupMsg', `Backup saved: ${backup.assets.length} asset${backup.assets.length === 1 ? '' : 's'} and ${backup.readings.length} reading${backup.readings.length === 1 ? '' : 's'}.`);
  } catch (err) {
    accountMsg('backupMsg', err.message || 'Could not make the backup. Try again.', true);
  }
  $('backupBtn').disabled = false;
});

// ---------------- INIT ----------------
$('pPosition').innerHTML = '<option value="">Not set</option>' + POSITIONS.map(p => `<option value="${p}">${p}</option>`).join('');
buildTypePicker();
checkSession();
