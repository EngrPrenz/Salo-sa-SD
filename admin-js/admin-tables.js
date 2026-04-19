import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, updateDoc, deleteDoc, setDoc, onSnapshot, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app = initializeApp({ apiKey: "AIzaSyCKQneulIrm9KWuOg69f29nFo6TGz2PF4w", authDomain: "salo-sa-antipolo.firebaseapp.com", projectId: "salo-sa-antipolo", storageBucket: "salo-sa-antipolo.firebasestorage.app", messagingSenderId: "60032898501", appId: "1:60032898501:web:3a4e663fee4ccd2adae7ac" });
const auth = getAuth(app);
const db = getFirestore(app);

function escapeHtml(s) { return (s + '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }

onAuthStateChanged(auth, async user => {
  if (!user) { window.location.href = '../admin-login.html'; return; }
  const snap = await getDoc(doc(db, 'Users', user.uid));
  if (!snap.exists() || snap.data().role !== 'admin') {
    await signOut(auth); window.location.href = '../admin-login.html'; return;
  }
  const name = snap.data().name || user.email;
  if (document.getElementById('userNameSidebar')) document.getElementById('userNameSidebar').textContent = name;
  if (document.getElementById('topbarName')) document.getElementById('topbarName').textContent = name;
  if (document.getElementById('userAvatarSidebar')) document.getElementById('userAvatarSidebar').textContent = name[0].toUpperCase();
  if (document.getElementById('userAvatarTop')) document.getElementById('userAvatarTop').textContent = name[0].toUpperCase();
});

if (document.getElementById('logoutBtn')) {
  document.getElementById('logoutBtn').onclick = async () => {
    try {
      await signOut(auth);
      window.location.href = '../admin-login.html';
    } catch (e) {
      console.error('Logout error:', e);
      window.location.href = '../admin-login.html';
    }
  };
}

if (document.getElementById('pageDate')) {
  const d = new Date();
  document.getElementById('pageDate').textContent = d.toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

let showToast = m => console.log(m);
if (document.getElementById('toast') && document.getElementById('toastMsg')) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toastMsg');
  showToast = m => { toastMsg.textContent = m; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 3000); };
}

const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('overlay');
const hamburger = document.getElementById('hamburger');
if (hamburger) hamburger.onclick = () => { sidebar.classList.toggle('open'); overlay.classList.toggle('show'); };
if (overlay) overlay.onclick = () => { sidebar.classList.remove('open'); overlay.classList.remove('show'); };

let tableStatuses = {};
let tableDocsList = [];
let allOrders = [];

getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc'))).then(snap => {
  allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  updateOrdersBadge();
});

onSnapshot(query(collection(db, 'orders'), orderBy('createdAt', 'desc')), snap => {
  allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  updateOrdersBadge();
});

function updateOrdersBadge() {
  const active = allOrders.filter(o => ['pending', 'preparing'].includes(o.status)).length;
  const badge = document.getElementById('ordersBadge');
  if (badge) { badge.textContent = active; badge.style.display = active > 0 ? 'inline-flex' : 'none'; }
}

const STATUS_CFG = {
  free: { icon: 'armchair', label: 'Free', textColor: '#5e5e5e' },
  reserved: { icon: 'calendar-check', label: 'Reserved', textColor: '#c9973a' },
  'walk-in': { icon: 'users', label: 'Walk-in', textColor: '#e8c07a' },
  pending: { icon: 'clock', label: 'Pending', textColor: '#f39c12' },
  preparing: { icon: 'chef-hat', label: 'Preparing', textColor: '#3498db' },
  served: { icon: 'check-circle', label: 'Served', textColor: '#2ecc71' },
  billed: { icon: 'banknote', label: 'Billed', textColor: '#9b59b6' },
};

// Load tables immediately + real-time
getDocs(collection(db, 'tables')).then(snap => {
  snap.forEach(d => {
    const data = d.data();
    const rawNum = data.tableNumber ? parseInt(data.tableNumber) : parseInt(d.id.replace('table_', ''));
    const num = isNaN(rawNum) ? null : rawNum;
    if (!num) return;
    tableStatuses[num] = { docId: d.id, ...data, tableNumber: num };
    tableDocsList.push({ docId: d.id, tableNumber: num, ...data });
  });
  tableDocsList.sort((a, b) => a.tableNumber - b.tableNumber);
  renderTablesGrid();
  updateTableCountStat();
});

onSnapshot(collection(db, 'tables'), snap => {
  tableStatuses = {};
  tableDocsList = [];
  snap.forEach(d => {
    const data = d.data();
    const rawNum = data.tableNumber ? parseInt(data.tableNumber) : parseInt(d.id.replace('table_', ''));
    const num = isNaN(rawNum) ? null : rawNum;
    if (!num) return;
    if (tableStatuses[num]) { if (!data.tableNumber) return; }
    tableStatuses[num] = { docId: d.id, ...data, tableNumber: num };
    const existIdx = tableDocsList.findIndex(t => t.tableNumber === num);
    if (existIdx !== -1) tableDocsList.splice(existIdx, 1);
    tableDocsList.push({ docId: d.id, tableNumber: num, ...data });
  });
  tableDocsList.sort((a, b) => a.tableNumber - b.tableNumber);
  renderTablesGrid();
  updateTableCountStat();
});

function updateTableCountStat() {
  const toolbar = document.getElementById('tablesToolbarTitle');
  if (toolbar) toolbar.textContent = `${tableDocsList.length} Tables`;
}

function renderTablesGrid() {
  const grid = document.getElementById('tablesGrid');
  if (!grid) return;

  const cards = tableDocsList.map(entry => {
    const n = entry.tableNumber;
    const data = tableStatuses[n];
    const rawSt = (data?.status || 'free').toLowerCase().trim();
    const st = rawSt === 'available' ? 'free' : rawSt;
    const cfg = STATUS_CFG[st] || STATUS_CFG.free;
    const waiter = data?.waiterName || null;
    const guestName = data?.reservation?.guestName || null;
    const resTime = data?.reservation?.time || null;
    const label = data?.name ? data.name : `Table ${n}`;
    const cap = data?.capacity ? `· ${data.capacity} seats` : '';

    return `
      <div class="table-card ${st}">
        <div class="table-card-num" style="color:${cfg.textColor}">${escapeHtml(label)}</div>
        ${cap ? `<div class="table-card-info muted" style="font-size:11px;margin-top:-6px;">${escapeHtml(cap)}</div>` : ''}
        <div class="table-card-icon"><i data-lucide="${cfg.icon}"></i></div>
        <div class="table-card-status">
          <span class="status-badge ${st}" style="color:${cfg.textColor};border-color:${cfg.textColor}33;background:${cfg.textColor}18">${cfg.label}</span>
        </div>
        ${st === 'reserved' ? `
          <div class="table-card-info" style="color:${cfg.textColor};font-weight:500;"><i data-lucide="user"></i> ${escapeHtml(guestName || '—')}</div>
          <div class="table-card-info" style="color:${cfg.textColor};"><i data-lucide="clock"></i> ${escapeHtml(resTime || '—')}</div>
          <button class="btn-sm" style="margin-top:6px;border-color:rgba(192,57,43,0.4);color:#e07070;width:100%;" onclick="window._removeReservation(${n})"><i data-lucide="x"></i> Remove</button>
        ` : st === 'free' ? `
          <div class="table-card-info muted">No waiter assigned</div>
          <button class="btn-sm gold" style="margin-top:6px;width:100%;" onclick="window._openReserveModal(${n})"><i data-lucide="plus"></i> Reserve</button>
        ` : `
          <div class="table-card-info" style="color:${cfg.textColor}">${waiter ? `<i data-lucide="user"></i> ${escapeHtml(waiter)}` : 'No waiter assigned'}</div>
        `}
        <div style="display:flex;gap:6px;margin-top:4px;">
          <button class="btn-sm" style="flex:1;" onclick="window._openEditTableModal(${n})"><i data-lucide="edit-3"></i></button>
          <button class="btn-sm danger" onclick="window._deleteTable(${n})" title="Delete table"><i data-lucide="trash-2"></i></button>
        </div>
      </div>`;
  });

  cards.push(`
    <div class="table-card free add-table-card" onclick="window._openAddTableModal()" style="cursor:pointer;border-style:dashed;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;opacity:0.65;transition:opacity .2s;">
      <i data-lucide="plus" style="font-size:32px;"></i>
      <div style="font-size:13px;font-weight:600;color:var(--text-muted);">Add Table</div>
    </div>`);

  grid.innerHTML = cards.join('');
  setTimeout(() => { if (window.lucide) lucide.createIcons(); }, 100);
}

window._openAddTableModal = () => openTableModal('add');

let tableModalMode = 'add';
let tableModalTarget = null;

function openTableModal(mode, tableNum = null) {
  tableModalMode = mode;
  tableModalTarget = tableNum;
  const modal = document.getElementById('tableModal');
  if (!modal) return;
  const title = document.getElementById('tableModalTitle');
  const numInput = document.getElementById('tableModalNumber');
  const nameInput = document.getElementById('tableModalName');
  const capInput = document.getElementById('tableModalCapacity');
  const numRow = document.getElementById('tableModalNumberRow');

  if (mode === 'add') {
    title.textContent = 'Add New Table';
    if (numRow) numRow.style.display = '';
    const existing = tableDocsList.map(t => t.tableNumber);
    let next = 1;
    while (existing.includes(next)) next++;
    if (numInput) numInput.value = next;
    if (nameInput) nameInput.value = '';
    if (capInput) capInput.value = '';
  } else {
    title.textContent = 'Edit Table';
    if (numRow) numRow.style.display = 'none';
    const data = tableStatuses[tableNum];
    if (nameInput) nameInput.value = data?.name || '';
    if (capInput) capInput.value = data?.capacity || '';
  }
  modal.classList.add('show');
  if (nameInput) nameInput.focus();
}

window._openEditTableModal = (n) => openTableModal('edit', n);

if (document.getElementById('tableModalClose')) {
  document.getElementById('tableModalClose').onclick = () => document.getElementById('tableModal').classList.remove('show');
}
if (document.getElementById('tableModalCancel')) {
  document.getElementById('tableModalCancel').onclick = () => document.getElementById('tableModal').classList.remove('show');
}

if (document.getElementById('tableModalSave')) {
  document.getElementById('tableModalSave').onclick = async () => {
    const nameInput = document.getElementById('tableModalName');
    const capInput = document.getElementById('tableModalCapacity');
    const btn = document.getElementById('tableModalSave');
    const name = nameInput?.value.trim();
    const capacity = capInput?.value ? parseInt(capInput.value) : null;

    if (tableModalMode === 'add') {
      const numInput = document.getElementById('tableModalNumber');
      const num = parseInt(numInput?.value);
      if (!num || num < 1) { showToast('Enter a valid table number.'); return; }
      if (tableStatuses[num]) { showToast(`Table ${num} already exists.`); return; }

      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        await setDoc(doc(db, 'tables', `table_${num}`), {
          tableNumber: num, name: name || null, capacity: capacity || null,
          status: 'free', reservation: null, waiterId: null, waiterName: null, lastUpdated: serverTimestamp()
        });
        showToast(`Table ${num} added.`);
        document.getElementById('tableModal').classList.remove('show');
      } catch (err) { showToast('Failed to add table.'); console.error(err); }
      finally { btn.disabled = false; btn.textContent = 'Save'; }
    } else {
      const data = tableStatuses[tableModalTarget];
      if (!data) { showToast('Table not found.'); return; }
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        await updateDoc(doc(db, 'tables', data.docId), { name: name || null, capacity: capacity || null, lastUpdated: serverTimestamp() });
        showToast(`Table ${tableModalTarget} updated.`);
        document.getElementById('tableModal').classList.remove('show');
      } catch (err) { showToast('Failed to update table.'); console.error(err); }
      finally { btn.disabled = false; btn.textContent = 'Save'; }
    }
  };
}

window._deleteTable = async (tableNum) => {
  const data = tableStatuses[tableNum];
  if (!data) return;
  const label = data.name ? `"${data.name}" (Table ${tableNum})` : `Table ${tableNum}`;
  if (!confirm(`Delete ${label}? This cannot be undone.`)) return;
  try {
    await deleteDoc(doc(db, 'tables', data.docId));
    showToast(`${label} deleted.`);
  } catch (err) { showToast('Failed to delete table.'); console.error(err); }
};

window._openAddTableModal = () => openTableModal('add');

// Reserve Modal
let reserveTargetTable = null;

window._openReserveModal = (tableNum) => {
  reserveTargetTable = tableNum;
  const modal = document.getElementById('reserveModal');
  if (!modal) return;
  document.getElementById('reserveTableLabel').textContent = `Reserve Table ${tableNum}`;
  if (document.getElementById('reserveGuestName')) document.getElementById('reserveGuestName').value = '';
  if (document.getElementById('reserveHour')) document.getElementById('reserveHour').value = '7';
  if (document.getElementById('reserveMinute')) document.getElementById('reserveMinute').value = '00';
  if (document.getElementById('reserveAmPm')) document.getElementById('reserveAmPm').value = 'PM';
  modal.classList.add('show');
};

if (document.getElementById('reserveModalCancel')) {
  document.getElementById('reserveModalCancel').onclick = () => { document.getElementById('reserveModal').classList.remove('show'); reserveTargetTable = null; };
}

if (document.getElementById('reserveModalConfirm')) {
  document.getElementById('reserveModalConfirm').onclick = async () => {
    const guestName = document.getElementById('reserveGuestName')?.value.trim();
    const hour = document.getElementById('reserveHour').value;
    const minute = document.getElementById('reserveMinute').value;
    const ampm = document.getElementById('reserveAmPm').value;
    const time = `${hour}:${minute} ${ampm}`;

    if (!guestName) { showToast('Please enter the guest name.'); return; }
    const data = tableStatuses[reserveTargetTable];
    if (!data) { showToast('Table not found.'); return; }

    const btn = document.getElementById('reserveModalConfirm');
    btn.disabled = true; btn.textContent = 'Saving…';

    try {
      await updateDoc(doc(db, 'tables', data.docId), {
        status: 'reserved', reservation: { guestName, time },
        waiterId: null, waiterName: null, lastUpdated: serverTimestamp()
      });
      showToast(`Table ${reserveTargetTable} reserved for ${guestName} at ${time}`);
      document.getElementById('reserveModal').classList.remove('show');
      reserveTargetTable = null;
    } catch (err) { showToast('Failed to save reservation.'); console.error(err); }
    finally { btn.disabled = false; btn.textContent = 'Confirm Reservation'; }
  };
}

window._removeReservation = async (tableNum) => {
  if (!confirm(`Remove reservation for Table ${tableNum}?`)) return;
  const data = tableStatuses[tableNum];
  if (!data) return;
  try {
    await updateDoc(doc(db, 'tables', data.docId), { status: 'free', reservation: null, lastUpdated: serverTimestamp() });
    showToast(`Reservation for Table ${tableNum} removed.`);
  } catch (err) { showToast('Failed to remove reservation.'); console.error(err); }
};

if (document.getElementById('clearAllTablesBtn')) {
  document.getElementById('clearAllTablesBtn').onclick = async () => {
    if (!confirm('Reset ALL tables to free? This cannot be undone.')) return;
    try {
      const snap = await getDocs(collection(db, 'tables'));
      await Promise.all(snap.docs.map(d => updateDoc(d.ref, { status: 'free', reservation: null, waiterId: null, waiterName: null, lastUpdated: serverTimestamp() })));
      showToast('All tables cleared.');
    } catch (err) { showToast('Failed to clear tables.'); console.error(err); }
  };
}