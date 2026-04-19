import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, setDoc, onSnapshot, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app = initializeApp({ apiKey: "AIzaSyCKQneulIrm9KWuOg69f29nFo6TGz2PF4w", authDomain: "salo-sa-antipolo.firebaseapp.com", projectId: "salo-sa-antipolo", storageBucket: "salo-sa-antipolo.firebasestorage.app", messagingSenderId: "60032898501", appId: "1:60032898501:web:3a4e663fee4ccd2adae7ac" });
const auth = getAuth(app);
const db = getFirestore(app);

function escapeHtml(s) { return (s + '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }

// === TOAST ===
let showToast = m => console.log(m);
if (document.getElementById('toast') && document.getElementById('toastMsg')) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toastMsg');
  showToast = m => { toastMsg.textContent = m; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 3000); };
}

// === AUTH ===
onAuthStateChanged(auth, async user => {
  if (!user) { window.location.href = 'admin-login.html'; return; }
  const snap = await getDoc(doc(db, 'Users', user.uid));
  if (!snap.exists() || snap.data().role !== 'admin') {
    await signOut(auth); window.location.href = 'admin-login.html'; return;
  }
  const name = snap.data().name || user.email;
  if (document.getElementById('userNameSidebar')) document.getElementById('userNameSidebar').textContent = name;
  if (document.getElementById('topbarName')) document.getElementById('topbarName').textContent = name;
  if (document.getElementById('userAvatarSidebar')) document.getElementById('userAvatarSidebar').textContent = name[0].toUpperCase();
  if (document.getElementById('userAvatarTop')) document.getElementById('userAvatarTop').textContent = name[0].toUpperCase();
  
  // Load all data after auth verification
  loadInitialData();
});

if (document.getElementById('logoutBtn')) {
  document.getElementById('logoutBtn').onclick = async () => {
    try { await signOut(auth); window.location.href = 'admin-login.html'; }
    catch (e) { window.location.href = 'admin-login.html'; }
  };
}

// === PAGE DATE ===
if (document.getElementById('pageDate')) {
  const d = new Date();
  document.getElementById('pageDate').textContent = d.toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

// === SIDEBAR TOGGLE ===
const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('overlay');
const hamburger = document.getElementById('hamburger');
if (hamburger) hamburger.onclick = () => { sidebar.classList.toggle('open'); overlay.classList.toggle('show'); };
if (overlay) overlay.onclick = () => { sidebar.classList.remove('open'); overlay.classList.remove('show'); };

// === ROUTING (SPA) ===
const views = document.querySelectorAll('.view');
const navItems = document.querySelectorAll('.nav-item');
const pageTitle = document.getElementById('pageTitle');

function showView(viewName) {
  views.forEach(v => v.classList.remove('active'));
  navItems.forEach(n => n.classList.remove('active'));
  const view = document.getElementById('view-' + viewName);
  const nav = document.querySelector(`.nav-item[data-view="${viewName}"]`);
  if (view) view.classList.add('active');
  if (nav) nav.classList.add('active');
  if (pageTitle) pageTitle.textContent = capitalize(viewName);
  const titles = { overview: 'Overview', orders: 'Live Orders', tables: 'Tables', menu: 'Menu', billing: 'Billing', staff: 'Staff', reports: 'Reports' };
  if (pageTitle) pageTitle.textContent = titles[viewName] || capitalize(viewName);
  sidebar.classList.remove('open');
  overlay.classList.remove('show');
  setTimeout(() => { if(window.lucide) lucide.createIcons(); }, 50);
}

function handleRoute() {
  const hash = window.location.hash.slice(1) || 'overview';
  showView(hash);
}

window.addEventListener('hashchange', handleRoute);
handleRoute();

navItems.forEach(n => {
  n.addEventListener('click', (e) => {
    const view = n.dataset.view;
    if (view) { e.preventDefault(); window.location.hash = view; }
  });
});

// === GLOBAL DATA ===
let allOrders = [];
let allStaff = [];

// === INITIAL DATA LOAD ===
async function loadInitialData() {
  try {
    // Load orders
    const ordersSnap = await getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc')));
    allOrders = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    updateOrdersBadge();
    renderOrders();
    renderBilling();
    updateOverviewStats();
    renderRecentOrders();

    // Load tables
    const tablesSnap = await getDocs(collection(db, 'tables'));
    tablesSnap.forEach(d => {
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
    renderOverviewTableGrid();
    updateOverviewStats();

    // Load menu
    const menuSnap = await getDocs(collection(db, 'menu'));
    menuItems = menuSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderMenuGrid();
    const cats = [...new Set(menuItems.map(m => m.category).filter(Boolean))];
    const tabContainer = document.getElementById('menuCategoryTabs');
    if (tabContainer) {
      tabContainer.innerHTML = '<button class="ftab active" data-cat="all">All</button>' + 
        cats.map(c => `<button class="ftab" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('');
      tabContainer.querySelectorAll('.ftab').forEach(btn => btn.addEventListener('click', () => {
        tabContainer.querySelectorAll('.ftab').forEach(x => x.classList.remove('active'));
        btn.classList.add('active');
        menuCatFilter = btn.dataset.cat;
        renderMenuGrid();
      }));
    }

    // Load staff
    const staffSnap = await getDocs(collection(db, 'Users'));
    allStaff = staffSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(s => s.role === 'staff' || s.role === 'waiter');
    renderStaffGrid();

    // Render reports
    renderReports();

  } catch (err) {
    console.error('Error loading initial data:', err);
    showToast('Error loading data');
  }
}

// === ORDERS BADGE ===
function updateOrdersBadge() {
  const active = allOrders.filter(o => ['pending', 'preparing'].includes(o.status)).length;
  const badge = document.getElementById('ordersBadge');
  if (badge) { badge.textContent = active; badge.style.display = active > 0 ? 'inline-flex' : 'none'; }
}

// === ORDERS VIEW ===
let activeFilter = 'all';
const orderSearchInput = document.getElementById('orderSearch');

function renderOrders() {
  const grid = document.getElementById('ordersGrid');
  if (!grid) return;
  let filtered = allOrders;
  if (activeFilter !== 'all') filtered = filtered.filter(o => o.status === activeFilter);
  const q = orderSearchInput?.value?.trim().toLowerCase() || '';
  if (q) filtered = filtered.filter(o => String(o.tableNumber).includes(q) || (o.waiterName || '').toLowerCase().includes(q));
  if (!filtered.length) { grid.innerHTML = '<div class="empty-state">No orders found.</div>'; return; }
  grid.innerHTML = filtered.map(o => {
    const items = (o.items || []).map(it => `<li>${it.name} × ${it.qty} <span>₱${((it.price || 0) * it.qty).toLocaleString()}</span></li>`).join('');
    const ts = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }) : '—';
    const nextStatus = { pending: 'preparing', preparing: 'served', served: 'paid' }[o.status];
    const nextLabel = { pending: 'Mark Preparing', preparing: 'Mark Served', served: 'Mark Paid' }[o.status] || '';
    return `
      <div class="order-card ${o.status}">
        <div class="order-card-head">
          <div><span class="order-id mono">#${o.id.slice(-5).toUpperCase()}</span><span class="status-badge ${o.status}">${capitalize(o.status || '')}</span></div>
          <span class="order-time">${ts}</span>
        </div>
        <div class="order-meta">Table <strong>${o.tableNumber || '?'}</strong> · ${o.waiterName || 'Unknown'}</div>
        <ul class="order-items">${items}</ul>
        <div class="order-total">Total: <strong>₱${(o.total || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</strong></div>
        <div class="order-card-actions-row">
          <div class="order-card-actions-top">
            ${nextStatus ? `<button class="btn-sm gold" onclick="window._updateStatus('${o.id}','${nextStatus}')">${nextLabel}</button>` : ''}
            <button class="btn-sm" onclick="window._showReceipt('${o.id}')">Receipt</button>
          </div>
          ${o.status !== 'paid' ? `<button class="btn-sm danger" onclick="window._updateStatus('${o.id}','cancelled')">Cancel</button>` : ''}
        </div>
      </div>`;
  }).join('');
}

window._updateStatus = async (id, status) => {
  await updateDoc(doc(db, 'orders', id), { status, updatedAt: serverTimestamp() });
  showToast(`Order updated to "${status}"`);
};

window._showReceipt = id => {
  const o = allOrders.find(x => x.id === id);
  if (!o) { showToast('Order not found'); return; }
  const modal = document.getElementById('receiptModal');
  const body = document.getElementById('receiptModalBody');
  if (!modal || !body) return;
  const items = (o.items || []).map(it => `<div style="display:flex;justify-content:space-between;padding:6px 0;"><div>${escapeHtml(it.name)} × ${it.qty}</div><div>₱${((it.price || 0) * (it.qty || 0)).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div></div>`).join('');
  const ts = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString('en-PH') : '—';
  body.innerHTML = `<div><strong>Order #${o.id.slice(-5).toUpperCase()}</strong><div style="color:var(--text-muted);font-size:12px">${ts}</div><hr></div>${items}<hr><div style="text-align:right;font-size:16px">Total: <strong>₱${(o.total || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</strong></div>`;
  modal.classList.add('show');
};

// Orders filter tabs
document.querySelectorAll('.ftab[data-status]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.ftab[data-status]').forEach(x => x.classList.remove('active'));
  b.classList.add('active'); activeFilter = b.dataset.status; renderOrders();
}));
if (orderSearchInput) orderSearchInput.addEventListener('input', renderOrders);

// Receipt modal close
if (document.getElementById('receiptModalClose')) document.getElementById('receiptModalClose').onclick = () => document.getElementById('receiptModal').classList.remove('show');
if (document.getElementById('receiptModalClose2')) document.getElementById('receiptModalClose2').onclick = () => document.getElementById('receiptModal').classList.remove('show');

// === TABLES VIEW ===
let tableStatuses = {};
let tableDocsList = [];

const STATUS_CFG = {
  free: { icon: 'armchair', label: 'Free', textColor: '#5e5e5e' },
  reserved: { icon: 'calendar-check', label: 'Reserved', textColor: '#c9973a' },
  'walk-in': { icon: 'users', label: 'Walk-in', textColor: '#e8c07a' },
  pending: { icon: 'clock', label: 'Pending', textColor: '#f39c12' },
  preparing: { icon: 'chef-hat', label: 'Preparing', textColor: '#3498db' },
  served: { icon: 'check-circle', label: 'Served', textColor: '#2ecc71' },
  billed: { icon: 'banknote', label: 'Billed', textColor: '#9b59b6' },
};

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
        <div class="table-card-status"><span class="status-badge ${st}" style="color:${cfg.textColor};border-color:${cfg.textColor}33;background:${cfg.textColor}18">${cfg.label}</span></div>
        ${st === 'reserved' ? `
          <div class="table-card-info" style="color:${cfg.textColor};font-weight:500;">👤 ${escapeHtml(guestName || '—')}</div>
          <div class="table-card-info" style="color:${cfg.textColor};">🕐 ${escapeHtml(resTime || '—')}</div>
          <button class="btn-sm" style="margin-top:6px;border-color:rgba(192,57,43,0.4);color:#e07070;width:100%;" onclick="window._removeReservation(${n})">✕ Remove</button>
        ` : st === 'free' ? `
          <div class="table-card-info muted">No waiter assigned</div>
          <button class="btn-sm gold" style="margin-top:6px;width:100%;" onclick="window._openReserveModal(${n})">+ Reserve</button>
        ` : `
          <div class="table-card-info" style="color:${cfg.textColor}">${waiter ? `👤 ${escapeHtml(waiter)}` : 'No waiter assigned'}</div>
        `}
        <div style="display:flex;gap:6px;margin-top:4px;">
          <button class="btn-sm" style="flex:1;" onclick="window._openEditTableModal(${n})">✏️</button>
          <button class="btn-sm danger" onclick="window._deleteTable(${n})">🗑️</button>
        </div>
      </div>`;
  });
  cards.push(`<div class="table-card free add-table-card" onclick="window._openAddTableModal()" style="cursor:pointer;border-style:dashed;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;opacity:0.65;"><i data-lucide="plus" style="font-size:32px;"></i><div style="font-size:13px;font-weight:600;color:var(--text-muted);">Add Table</div></div>`);
  grid.innerHTML = cards.join('');
  setTimeout(() => { if (window.lucide) lucide.createIcons(); }, 100);
}

function updateTableCountStat() {
  const toolbar = document.getElementById('tablesToolbarTitle');
  if (toolbar) toolbar.textContent = `${tableDocsList.length} Tables`;
}

// Table modals
let tableModalMode = 'add';
let tableModalTarget = null;
window._openAddTableModal = () => openTableModal('add');
window._openEditTableModal = (n) => openTableModal('edit', n);

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

if (document.getElementById('tableModalClose')) document.getElementById('tableModalClose').onclick = () => document.getElementById('tableModal').classList.remove('show');
if (document.getElementById('tableModalCancel')) document.getElementById('tableModalCancel').onclick = () => document.getElementById('tableModal').classList.remove('show');
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
        await setDoc(doc(db, 'tables', `table_${num}`), { tableNumber: num, name: name || null, capacity: capacity || null, status: 'free', reservation: null, waiterId: null, waiterName: null, lastUpdated: serverTimestamp() });
        showToast(`Table ${num} added.`);
        document.getElementById('tableModal').classList.remove('show');
      } catch (err) { showToast('Failed to add table.'); console.error(err); }
      finally { btn.disabled = false; btn.textContent = 'Save'; }
    } else {
      const data = tableStatuses[tableModalTarget];
      if (!data) { showToast('Table not found.'); return; }
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        await updateDoc(doc(db, 'tables', data.docId), { name: name || null, capacity: capacity || null, lastUpdated: serverTimestamp() };
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
  try { await deleteDoc(doc(db, 'tables', data.docId)); showToast(`${label} deleted.`); }
  catch (err) { showToast('Failed to delete table.'); console.error(err); }
};

// Reserve modal
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

if (document.getElementById('reserveModalCancel')) document.getElementById('reserveModalCancel').onclick = () => { document.getElementById('reserveModal').classList.remove('show'); reserveTargetTable = null; };
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
      await updateDoc(doc(db, 'tables', data.docId), { status: 'reserved', reservation: { guestName, time }, waiterId: null, waiterName: null, lastUpdated: serverTimestamp() });
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
  try { await updateDoc(doc(db, 'tables', data.docId), { status: 'free', reservation: null, lastUpdated: serverTimestamp() }; showToast(`Reservation for Table ${tableNum} removed.`); }
  catch (err) { showToast('Failed to remove reservation.'); console.error(err); }
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

// === MENU VIEW ===
let menuItems = [];
let editMenuId = null;
let menuCatFilter = 'all';
let menuSearchQuery = '';
let pendingImageFile = null;

function renderMenuGrid() {
  const grid = document.getElementById('menuGrid');
  if (!grid) return;
  let filtered = menuItems;
  if (menuCatFilter !== 'all') filtered = filtered.filter(m => m.category === menuCatFilter);
  if (menuSearchQuery) filtered = filtered.filter(m => (m.name || '').toLowerCase().includes(menuSearchQuery));
  if (!filtered.length) { grid.innerHTML = '<div class="empty-state">No menu items found.</div>'; return; }
  grid.innerHTML = filtered.map(m => {
    const imgHtml = m.imageUrl ? `<img class="menu-card-img" src="${escapeHtml(m.imageUrl)}" alt="${escapeHtml(m.name)}"/>` : `<div class="menu-card-img-placeholder">🍽️</div>`;
    const availClass = m.available ? 'on' : 'off';
    const availLabel = m.available ? 'Available' : 'Unavailable';
    return `
      <div class="menu-card ${m.available ? '' : 'unavailable'}">
        ${imgHtml}
        <div class="menu-avail-banner ${availClass}"><span class="menu-avail-banner-dot"></span>${availLabel}</div>
        <div class="menu-card-body">
          <div class="menu-card-cat">${escapeHtml(m.category || '')}</div>
          <div class="menu-card-name">${escapeHtml(m.name)}</div>
          <div class="menu-card-desc">${escapeHtml(m.description || '')}</div>
        </div>
        <div class="menu-card-footer">
          <div class="menu-card-price">₱${(m.price || 0).toLocaleString()}</div>
          <div class="menu-card-actions">
            <button class="btn-sm" onclick="window._editMenuItem('${m.id}')">✏️</button>
            <button class="btn-sm danger" onclick="window._deleteMenuItem('${m.id}')">🗑️</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

// Menu modals
if (document.getElementById('addMenuItemBtn')) document.getElementById('addMenuItemBtn').onclick = () => openMenuModal();
const menuSearchInput = document.getElementById('menuSearch');
if (menuSearchInput) menuSearchInput.addEventListener('input', () => { menuSearchQuery = menuSearchInput.value.toLowerCase(); renderMenuGrid(); });

function openMenuModal(id = null) {
  editMenuId = id;
  const modal = document.getElementById('menuModal');
  const title = document.getElementById('menuModalTitle');
  if (!modal) return;
  if (id) {
    const item = menuItems.find(m => m.id === id);
    title.textContent = 'Edit Menu Item';
    document.getElementById('menuItemName').value = item?.name || '';
    document.getElementById('menuItemPrice').value = item?.price || '';
    document.getElementById('menuItemCategory').value = item?.category || '';
    document.getElementById('menuItemDesc').value = item?.description || '';
    document.getElementById('menuItemAvail').value = item?.available ? 'true' : 'false';
  } else {
    title.textContent = 'Add Menu Item';
    document.getElementById('menuItemName').value = '';
    document.getElementById('menuItemPrice').value = '';
    document.getElementById('menuItemCategory').value = '';
    document.getElementById('menuItemDesc').value = '';
    document.getElementById('menuItemAvail').value = 'true';
  }
  modal.classList.add('show');
}

window._editMenuItem = openMenuModal;

window._deleteMenuItem = async (id) => {
  if (!confirm('Delete this menu item?')) return;
  try { await deleteDoc(doc(db, 'menu', id)); showToast('Menu item deleted.'); }
  catch (err) { showToast('Failed to delete.'); console.error(err); }
};

if (document.getElementById('menuModalClose')) document.getElementById('menuModalClose').onclick = () => { document.getElementById('menuModal').classList.remove('show'); editMenuId = null; };
if (document.getElementById('menuModalCancel')) document.getElementById('menuModalCancel').onclick = () => { document.getElementById('menuModal').classList.remove('show'); editMenuId = null; };
if (document.getElementById('menuModalSave')) {
  document.getElementById('menuModalSave').onclick = async () => {
    const name = document.getElementById('menuItemName').value.trim();
    const price = parseFloat(document.getElementById('menuItemPrice').value) || 0;
    const category = document.getElementById('menuItemCategory').value.trim();
    const description = document.getElementById('menuItemDesc').value.trim();
    const available = document.getElementById('menuItemAvail').value === 'true';
    if (!name) { showToast('Enter item name.'); return; }
    const btn = document.getElementById('menuModalSave');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      if (editMenuId) {
        await updateDoc(doc(db, 'menu', editMenuId), { name, price, category, description, available, lastUpdated: serverTimestamp() };
        showToast('Menu item updated.');
      } else {
        await addDoc(collection(db, 'menu'), { name, price, category, description, available, createdAt: serverTimestamp() });
        showToast('Menu item added.');
      }
      document.getElementById('menuModal').classList.remove('show');
    } catch (err) { showToast('Failed to save.'); console.error(err); }
    finally { btn.disabled = false; btn.textContent = 'Save Item'; }
  };
}

// === BILLING VIEW ===
let billingFilter = 'all';
function renderBilling() {
  const tbody = document.getElementById('billingTableBody');
  if (!tbody) return;
  let filtered = allOrders.filter(o => o.status === 'paid' || o.status === 'served');
  if (billingFilter !== 'all') filtered = filtered.filter(o => o.status === billingFilter);
  let total = filtered.reduce((sum, o) => sum + (o.total || 0), 0);
  document.getElementById('billingTodayTotal').textContent = `₱${total.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
  if (!filtered.length) { tbody.innerHTML = '<tr><td colspan="7" class="empty-row">No orders found.</td></tr>'; return; }
  tbody.innerHTML = filtered.map(o => {
    const items = (o.items || []).length;
    const ts = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString('en-PH') : '—';
    return `<tr class="row-clickable" onclick="window._showReceipt('${o.id}')">
      <td><span class="mono">#${o.id.slice(-5).toUpperCase()}</span></td>
      <td>${o.tableNumber || '?'}</td>
      <td>${o.waiterName || '—'}</td>
      <td>${items} items</td>
      <td><span class="mono">₱${(o.total || 0).toLocaleString()}</span></td>
      <td>${ts}</td>
      <td><span class="status-badge ${o.status}">${capitalize(o.status)}</span></td>
    </tr>`;
  }).join('');
}

document.querySelectorAll('.ftab[data-bstatus]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.ftab[data-bstatus]').forEach(x => x.classList.remove('active'));
  b.classList.add('active'); billingFilter = b.dataset.bstatus; renderBilling();
}));

// === REPORTS VIEW ===
let selectedMonth = new Date().getMonth();
let selectedYear = new Date().getFullYear();

function renderReports() {
  if (!allOrders.length) {
    document.getElementById('rptMonthRev').textContent = '—';
    document.getElementById('rptMonthOrders').textContent = '—';
    document.getElementById('rptMonthAvg').textContent = '—';
    return;
  }
  
  const monthOrders = allOrders.filter(o => {
    if (!o.createdAt?.toDate) return false;
    const d = o.createdAt.toDate();
    return d.getMonth() === selectedMonth && d.getFullYear() === selectedYear;
  });
  
  const totalRevenue = monthOrders.reduce((sum, o) => sum + (o.total || 0), 0);
  const avgPerOrder = monthOrders.length ? totalRevenue / monthOrders.length : 0;
  
  document.getElementById('rptMonthRev').textContent = `₱${totalRevenue.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
  document.getElementById('rptMonthOrders').textContent = monthOrders.length;
  document.getElementById('rptMonthAvg').textContent = `₱${avgPerOrder.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
  
  // Render calendar
  renderSalesCalendar(monthOrders);
}

function renderSalesCalendar(monthOrders) {
  const grid = document.getElementById('calGrid');
  if (!grid) return;
  
  const firstDay = new Date(selectedYear, selectedMonth, 1).getDay();
  const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
  const today = new Date();
  
  let html = '';
  for (let i = 0; i < firstDay; i++) {
    html += '<div class="cal-day-cell empty"></div>';
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const dayOrders = monthOrders.filter(o => {
      const d = o.createdAt?.toDate();
      return d && d.getDate() === day;
    });
    const revenue = dayOrders.reduce((sum, o) => sum + (o.total || 0), 0);
    const isToday = today.getDate() === day && today.getMonth() === selectedMonth && today.getFullYear() === selectedYear;
    html += `<div class="cal-day-cell ${revenue > 0 ? '' : 'no-sale'} ${isToday ? 'today' : ''}" onclick="window._selectDay(${day})">
      <div class="cal-day-num">${day}</div>
      ${revenue > 0 ? `<div class="cal-day-rev">₱${revenue.toLocaleString()}</div><div class="cal-day-cnt">${dayOrders.length} orders</div>` : ''}
    </div>`;
  }
  grid.innerHTML = html;
}

function renderStaffGrid() {
  const grid = document.getElementById('staffGrid');
  if (!grid) return;
  if (!allStaff.length) { grid.innerHTML = '<div class="empty-state">No staff accounts yet.</div>'; return; }
  grid.innerHTML = allStaff.map(s => `
    <div class="staff-card">
      <div class="staff-avatar">${(s.name || s.email || '?')[0].toUpperCase()}</div>
      <div class="staff-info">
        <div class="staff-name">${escapeHtml(s.name || s.email)}</div>
        <div class="staff-email">${escapeHtml(s.email)}</div>
        <div class="staff-meta">
          <span class="staff-role-badge">${s.role}</span>
          <span class="staff-meta-dot"></span>
        </div>
      </div>
      <div class="staff-actions">
        <button class="btn-sm danger" onclick="window._deleteStaff('${s.id}')">Remove</button>
      </div>
    </div>
  `).join('');
}

window._deleteStaff = async (id) => {
  if (!confirm('Remove this staff account?')) return;
  try {
    await deleteDoc(doc(db, 'Users', id));
    showToast('Staff removed.');
  } catch (err) { showToast('Failed to remove.'); console.error(err); }
};

renderReports();

// === OVERVIEW STATS ===
function updateOverviewStats() {
  const activeOrders = allOrders.filter(o => ['pending', 'preparing'].includes(o.status)).length;
  document.getElementById('statActiveOrders').textContent = activeOrders;
  document.getElementById('statOrdersSub').textContent = `${activeOrders} active order${activeOrders !== 1 ? 's' : ''}`;
  const occupied = Object.values(tableStatuses).filter(t => t.status !== 'free').length;
  document.getElementById('statTablesOcc').textContent = `${occupied}/${tableDocsList.length}`;
  document.getElementById('statTablesSub').textContent = `of ${tableDocsList.length} tables`;
  const todayPaid = allOrders.filter(o => o.status === 'paid' && o.createdAt?.toDate?.toDateString() === new Date().toDateString());
  const revenue = todayPaid.reduce((sum, o) => sum + (o.total || 0), 0);
  document.getElementById('statRevenue').textContent = `₱${revenue.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
  document.getElementById('statRevSub').textContent = `${todayPaid.length} paid order${todayPaid.length !== 1 ? 's' : ''} today`;
}

// Recent orders on overview
function renderRecentOrders() {
  const tbody = document.getElementById('recentOrdersBody');
  if (!tbody) return;
  const recent = allOrders.slice(0, 5);
  if (!recent.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty-row">No orders yet.</td></tr>'; return; }
  tbody.innerHTML = recent.map(o => {
    const items = (o.items || []).length;
    return `<tr>
      <td><span class="mono">#${o.id.slice(-5).toUpperCase()}</span></td>
      <td>${o.tableNumber || '?'}</td>
      <td>${o.waiterName || '—'}</td>
      <td>${items} items</td>
      <td><span class="mono">₱${(o.total || 0).toLocaleString()}</span></td>
      <td><span class="status-badge ${o.status}">${capitalize(o.status)}</span></td>
    </tr>`;
  }).join('');
}

// Overview table grid
function renderOverviewTableGrid() {
  const grid = document.getElementById('overviewTableGrid');
  if (!grid) return;
  grid.innerHTML = tableDocsList.map(t => {
    const data = tableStatuses[t.tableNumber];
    const st = (data?.status || 'free');
    return `<div class="mini-table ${st}"><div class="mini-table-num">${t.tableNumber}</div><div class="mini-table-st">${st}</div></div>`;
  }).join('');
}

// === REAL-TIME LISTENERS ===
onSnapshot(query(collection(db, 'orders'), orderBy('createdAt', 'desc')), snap => {
  allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  updateOrdersBadge();
  renderOrders();
  renderBilling();
  updateOverviewStats();
  renderRecentOrders();
  renderReports();
});

onSnapshot(collection(db, 'tables'), snap => {
  tableStatuses = {};
  tableDocsList = [];
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
  renderOverviewTableGrid();
  updateOverviewStats();
});

onSnapshot(collection(db, 'menu'), snap => {
  menuItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderMenuGrid();
  const cats = [...new Set(menuItems.map(m => m.category).filter(Boolean))];
  const tabContainer = document.getElementById('menuCategoryTabs');
  if (tabContainer) {
    tabContainer.innerHTML = '<button class="ftab active" data-cat="all">All</button>' + 
      cats.map(c => `<button class="ftab" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('');
    tabContainer.querySelectorAll('.ftab').forEach(btn => btn.addEventListener('click', () => {
      tabContainer.querySelectorAll('.ftab').forEach(x => x.classList.remove('active'));
      btn.classList.add('active');
      menuCatFilter = btn.dataset.cat;
      renderMenuGrid();
    }));
  }
});

onSnapshot(collection(db, 'Users'), snap => {
  allStaff = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(s => s.role === 'staff' || s.role === 'waiter');
  renderStaffGrid();
});