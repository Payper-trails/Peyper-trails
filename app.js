const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

  try {
    if (authMode === 'login') {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } else {
      const { error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
    }
    await checkSession();
  } catch (err) {
    $('authError').textContent = err.message || 'Something went wrong. Try again.';
    $('authError').classList.remove('hidden');
  } finally {
    $('authSubmit').disabled = false;
  }
});

$('logoutBtn').addEventListener('click', async () => {
  await sb.auth.signOut();
  currentUser = null;
  showAuthScreen();
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
    const { days, status } = nearestStatus(v);
    const color = ringColor(status);
    const daysLabel = days === null ? '—' : (days <= 0 ? 'DUE' : `${days}d`);

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
        <div class="disc-ring">
          <svg width="58" height="58"><circle cx="29" cy="29" r="25" stroke="${color}" stroke-width="4" fill="none" opacity="0.85"/></svg>
          <span class="days mono">${daysLabel}</span>
        </div>
        <div>
          <div class="disc-name">${escapeHtml(v.name)}</div>
          <div class="disc-type">${escapeHtml(v.vehicle_type)}</div>
        </div>
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
  $('vType').value = v ? v.vehicle_type : 'car';
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
