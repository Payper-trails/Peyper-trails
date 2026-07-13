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
let warrantiesDraft = []; // warranties being edited in the open modal (not yet saved)

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
  $('authScreen').classList.remove('hidden');
  $('dashScreen').classList.add('hidden');
  $('addFab').classList.add('hidden');
  $('logoutBtn').classList.add('hidden');
  $('footer').classList.add('hidden');
}

function showDashboard() {
  $('authScreen').classList.add('hidden');
  $('dashScreen').classList.remove('hidden');
  $('addFab').classList.remove('hidden');
  $('logoutBtn').classList.remove('hidden');
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

function nearestStatus(vehicle) {
  const candidates = [];
  const lic = daysUntil(vehicle.licence_expiry);
  if (lic !== null) candidates.push(lic);
  const svc = daysUntil(vehicle.service_due_date);
  if (svc !== null) candidates.push(svc);
  (vehicle.warranties || []).forEach(w => {
    const wd = daysUntil(w.expiry_date);
    if (wd !== null) candidates.push(wd);
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

    const licStatus = statusFromDays(daysUntil(v.licence_expiry));
    const svcStatus = statusFromDays(daysUntil(v.service_due_date));

    const warrantyRows = (v.warranties || []).map(w => {
      const wStatus = statusFromDays(daysUntil(w.expiry_date));
      return `<div class="disc-row"><span class="k">${escapeHtml(w.item_name)}</span><span class="v">${fmtDate(w.expiry_date)} ${tagHtml(wStatus)}</span></div>`;
    }).join('');

    const card = document.createElement('div');
    card.className = 'disc-card';
    card.innerHTML = `
      <div class="disc-head">
        <div class="speedo-gauge">${speedoGaugeSVG(days)}</div>
        <div class="speedo-readout">${daysLabel}</div>
        <div class="disc-name-row">
          <span class="disc-type-icon">${TYPE_ICONS[v.vehicle_type] || TYPE_ICONS.other}</span>
          <div class="disc-name">${escapeHtml(v.name)}</div>
        </div>
        <div class="disc-type">${escapeHtml(v.vehicle_type)}</div>
      </div>
      <div class="disc-rows">
        <div class="disc-row"><span class="k">Licence</span><span class="v">${fmtDate(v.licence_expiry)} ${tagHtml(licStatus)}</span></div>
        ${v.service_due_date ? `<div class="disc-row"><span class="k">Service due</span><span class="v">${fmtDate(v.service_due_date)} ${tagHtml(svcStatus)}</span></div>` : ''}
        ${v.service_due_km ? `<div class="disc-row"><span class="k">Service at</span><span class="v">${Number(v.service_due_km).toLocaleString()} km</span></div>` : ''}
        ${warrantyRows}
      </div>
      <div class="disc-actions">
        <button class="link-btn" data-edit="${v.id}">Edit</button>
      </div>
    `;
    grid.appendChild(card);
  });

  grid.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => openModal(btn.dataset.edit));
  });
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

// ---------------- MODAL: ADD/EDIT VEHICLE ----------------
$('addFab').addEventListener('click', () => openModal(null));
$('closeModal').addEventListener('click', closeModal);

function openModal(vehicleId) {
  const v = vehicleId ? vehiclesCache.find(x => x.id === vehicleId) : null;
  $('vehicleId').value = v ? v.id : '';
  $('vName').value = v ? v.name : '';
  setVehicleType(v ? v.vehicle_type : 'car');
  $('vLicence').value = v ? (v.licence_expiry || '') : '';
  $('vServiceDate').value = v ? (v.service_due_date || '') : '';
  $('vServiceKm').value = v ? (v.service_due_km || '') : '';
  $('vCurrentKm').value = v ? (v.current_km || '') : '';
  $('vNotes').value = v ? (v.notes || '') : '';
  $('modalTitle').textContent = v ? 'Edit vehicle' : 'Add vehicle';
  $('deleteVehicleBtn').classList.toggle('hidden', !v);

  warrantiesDraft = v && v.warranties ? v.warranties.map(w => ({...w})) : [];
  renderWarrantyDraft();

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

$('addWarrantyBtn').addEventListener('click', () => {
  warrantiesDraft.push({ id: null, item_name: '', expiry_date: '', expiry_km: '', notes: '' });
  renderWarrantyDraft();
});

function renderWarrantyDraft() {
  const list = $('warrantyList');
  list.innerHTML = '';
  warrantiesDraft.forEach((w, idx) => {
    const row = document.createElement('div');
    row.style.marginBottom = '10px';
    row.innerHTML = `
      <div style="display:flex; gap:8px; align-items:flex-end;">
        <div style="flex:1;">
          <input type="text" placeholder="e.g. Full vehicle warranty, New tyres" value="${escapeHtml(w.item_name)}" data-w-field="item_name" data-w-idx="${idx}">
        </div>
        <button type="button" class="remove-x" data-w-remove="${idx}">&times;</button>
      </div>
      <div style="display:flex; gap:8px; margin-top:6px;">
        <input type="date" value="${w.expiry_date || ''}" data-w-field="expiry_date" data-w-idx="${idx}" style="flex:1;">
        <input type="number" placeholder="Expiry km (optional)" value="${w.expiry_km || ''}" data-w-field="expiry_km" data-w-idx="${idx}" style="flex:1;">
      </div>
    `;
    list.appendChild(row);
  });

  list.querySelectorAll('[data-w-field]').forEach(input => {
    input.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.wIdx);
      const field = e.target.dataset.wField;
      warrantiesDraft[idx][field] = e.target.value;
    });
  });
  list.querySelectorAll('[data-w-remove]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.wRemove);
      warrantiesDraft.splice(idx, 1);
      renderWarrantyDraft();
    });
  });
}

$('vehicleForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('vehicleId').value || null;

  const payload = {
    user_id: currentUser.id,
    name: $('vName').value.trim(),
    vehicle_type: $('vType').value,
    licence_expiry: $('vLicence').value || null,
    service_due_date: $('vServiceDate').value || null,
    service_due_km: $('vServiceKm').value ? Number($('vServiceKm').value) : null,
    current_km: $('vCurrentKm').value ? Number($('vCurrentKm').value) : null,
    notes: $('vNotes').value.trim() || null,
  };

  let vehicleId = id;
  if (id) {
    const { error } = await sb.from('vehicles').update(payload).eq('id', id);
    if (error) { alert(error.message); return; }
  } else {
    const { data, error } = await sb.from('vehicles').insert(payload).select().single();
    if (error) { alert(error.message); return; }
    vehicleId = data.id;
  }

  // Sync warranties: delete removed, upsert current draft
  const { data: existingWarranties } = await sb.from('warranties').select('id').eq('vehicle_id', vehicleId);
  const existingIds = (existingWarranties || []).map(w => w.id);
  const keptIds = warrantiesDraft.filter(w => w.id).map(w => w.id);
  const toDelete = existingIds.filter(eid => !keptIds.includes(eid));
  if (toDelete.length) {
    await sb.from('warranties').delete().in('id', toDelete);
  }

  for (const w of warrantiesDraft) {
    if (!w.item_name || !w.item_name.trim()) continue;
    const wPayload = {
      vehicle_id: vehicleId,
      user_id: currentUser.id,
      item_name: w.item_name.trim(),
      expiry_date: w.expiry_date || null,
      expiry_km: w.expiry_km ? Number(w.expiry_km) : null,
      notes: w.notes || null,
    };
    if (w.id) {
      await sb.from('warranties').update(wPayload).eq('id', w.id);
    } else {
      await sb.from('warranties').insert(wPayload);
    }
  }

  closeModal();
  await loadVehicles();
});

$('deleteVehicleBtn').addEventListener('click', async () => {
  const id = $('vehicleId').value;
  if (!id) return;
  if (!confirm('Delete this vehicle and all its warranty records? This can\'t be undone.')) return;
  const { error } = await sb.from('vehicles').delete().eq('id', id);
  if (error) { alert(error.message); return; }
  closeModal();
  await loadVehicles();
});

// ---------------- INIT ----------------
checkSession();
