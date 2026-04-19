import { initializeApp }        from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, where, serverTimestamp, Timestamp, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
const app  = initializeApp({ apiKey:"AIzaSyCKQneulIrm9KWuOg69f29nFo6TGz2PF4w", authDomain:"salo-sa-antipolo.firebaseapp.com", projectId:"salo-sa-antipolo", storageBucket:"salo-sa-antipolo.firebasestorage.app", messagingSenderId:"60032898501", appId:"1:60032898501:web:3a4e663fee4ccd2adae7ac" });
const auth = getAuth(app);
const db   = getFirestore(app);

// ── Auth guard ──
onAuthStateChanged(auth, async user => {
  if (!user) { window.location.href = 'admin-login.html'; return; }
  const snap = await getDoc(doc(db, 'Users', user.uid));
  if (!snap.exists() || snap.data().role !== 'admin') {
    await signOut(auth); window.location.href = 'admin-login.html'; return;
  }
  const name = snap.data().name || user.email;
  document.getElementById('userNameSidebar').textContent = name;
  document.getElementById('topbarName').textContent = name;
  document.getElementById('userAvatarSidebar').textContent = name[0].toUpperCase();
  document.getElementById('userAvatarTop').textContent = name[0].toUpperCase();

  loadMenu();
  loadStaff();
  initClearTablesModal();

  onSnapshot(query(collection(db,'Users'), where('status','==','pending')), snap => {
    const count = snap.size;
    const badge = document.getElementById('staffBadge');
    if (badge) { badge.textContent = count; badge.style.display = count > 0 ? 'inline-flex' : 'none'; }
  });
});

document.getElementById('logoutBtn').onclick = async () => {
  await signOut(auth); window.location.href = 'admin-login.html';
};

// ── Helpers ──
function escapeHtml(s){ return (s+'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function capitalize(s){ return s ? s[0].toUpperCase()+s.slice(1) : ''; }

// ── Date ──
const d = new Date();
document.getElementById('pageDate').textContent = d.toLocaleDateString('en-PH',{weekday:'long',year:'numeric',month:'long',day:'numeric'});

// ── Toast ──
const toast = document.getElementById('toast'), toastMsg = document.getElementById('toastMsg');
const showToast = m => { toastMsg.textContent=m; toast.classList.add('show'); setTimeout(()=>toast.classList.remove('show'),3000); };

// ── Confirm Modal ──
function showConfirm({ title, message, okLabel = 'Confirm', okClass = 'gold', onOk }) {
  document.getElementById('confirmModalTitle').textContent = title;
  document.getElementById('confirmModalMsg').textContent = message;
  const okBtn = document.getElementById('confirmModalOk');
  okBtn.textContent = okLabel;
  okBtn.className = 'btn-sm ' + okClass;
  document.getElementById('confirmModal').classList.add('show');

  const newOk = okBtn.cloneNode(true);
  okBtn.parentNode.replaceChild(newOk, okBtn);

  const close = () => document.getElementById('confirmModal').classList.remove('show');
  newOk.onclick = () => { close(); onOk(); };
  document.getElementById('confirmModalCancel').onclick = close;
  document.getElementById('confirmModalClose').onclick = close;
}

// ── Sidebar nav ──
const sidebar   = document.getElementById('sidebar');
const overlay   = document.getElementById('overlay');
const hamburger = document.getElementById('hamburger');
hamburger.onclick = () => { sidebar.classList.toggle('open'); overlay.classList.toggle('show'); };
overlay.onclick   = () => { sidebar.classList.remove('open'); overlay.classList.remove('show'); };

const navItems  = document.querySelectorAll('.nav-item');
const views     = document.querySelectorAll('.view');
const pageTitleEl = document.getElementById('pageTitle');
const titles = { overview:'Overview', orders:'Live Orders', tables:'Tables', menu:'Menu', billing:'Billing', staff:'Staff', reports:'Reports' };

function switchView(v) {
  navItems.forEach(n => n.classList.toggle('active', n.dataset.view === v));
  views.forEach(el => el.classList.toggle('active', el.id === `view-${v}`));
  pageTitleEl.textContent = titles[v] || v;
  sidebar.classList.remove('open'); overlay.classList.remove('show');
  if (v === 'staff') loadStaff();
}

navItems.forEach(n => n.addEventListener('click', e => { e.preventDefault(); switchView(n.dataset.view); }));
document.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => switchView(b.dataset.goto)));

// ── LIVE ORDERS real-time ──
let allOrders = [];
const ordersRef = collection(db, 'orders');
let activeFilter = 'all';
let billingFilter = 'all';

onSnapshot(query(ordersRef, orderBy('createdAt','desc')), snap => {
  allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderOverview();
  renderOrders();
  renderBilling();
  renderReports();
  updateOrderBadge();
  // Also re-render tables so live order statuses stay in sync
  renderTablesGrid();
  if (document.getElementById('view-reports').classList.contains('active')) {
    renderMonthlyReport();
  }
});

function updateOrderBadge() {
  const active = allOrders.filter(o => ['pending','preparing'].includes(o.status)).length;
  const badge = document.getElementById('ordersBadge');
  badge.textContent = active;
  badge.style.display = active > 0 ? 'inline-flex' : 'none';
}

// ── Overview ──
function renderOverview() {
  const active = allOrders.filter(o => ['pending','preparing','served'].includes(o.status));
  document.getElementById('statActiveOrders').textContent = active.length;
  document.getElementById('statOrdersSub').textContent = `${allOrders.filter(o=>o.status==='pending').length} pending · ${allOrders.filter(o=>o.status==='preparing').length} preparing`;

  const occupied = [...new Set(active.map(o => o.tableNumber))].length;
  document.getElementById('statTablesOcc').textContent = occupied;

  const today = new Date(); today.setHours(0,0,0,0);
  const paidToday = allOrders.filter(o => o.status === 'paid' && o.createdAt?.toDate() >= today);
  const rev = paidToday.reduce((s,o) => s + (o.total||0), 0);
  document.getElementById('statRevenue').textContent = `₱${rev.toLocaleString('en-PH',{minimumFractionDigits:2})}`;
  document.getElementById('statRevSub').textContent = `${paidToday.length} paid orders today`;

  renderRecentOrders(allOrders.slice(0, 6));
  renderOverviewTableGrid(active);
}

function renderRecentOrders(orders) {
  const tbody = document.getElementById('recentOrdersBody');
  if (!orders.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty-row">No orders yet.</td></tr>'; return; }
  tbody.innerHTML = orders.map(o => `
    <tr>
      <td class="mono">#${o.id.slice(-5).toUpperCase()}</td>
      <td>Table ${o.tableNumber||'—'}</td>
      <td>${o.waiterName||'—'}</td>
      <td>${(o.items||[]).length} items</td>
      <td>₱${(o.total||0).toLocaleString('en-PH',{minimumFractionDigits:2})}</td>
      <td><span class="status-badge ${o.status}">${capitalize(o.status||'unknown')}</span></td>
    </tr>`).join('');
}

function renderOverviewTableGrid(activeOrders) {
  const grid = document.getElementById('overviewTableGrid');
  const occupied = {};
  activeOrders.forEach(o => { if (o.tableNumber) occupied[o.tableNumber] = o.status; });
  const tables = tableDocsList.length ? tableDocsList : Array.from({length:10},(_,i)=>({tableNumber:i+1}));
  grid.innerHTML = tables.map(t => {
    const n = t.tableNumber;
    const st = occupied[n] || tableStatuses[n]?.status || 'free';
    const normSt = st === 'available' ? 'free' : st;
    const label = t.name || `${n}`;
    return `<div class="mini-table ${normSt}"><span class="mini-table-num">${escapeHtml(label)}</span><span class="mini-table-st">${normSt==='free'?'Free':capitalize(normSt)}</span></div>`;
  }).join('');
}

// ── Live Orders — search ──
const orderSearch = document.getElementById('orderSearch');
orderSearch.addEventListener('input', renderOrders);

// ── Live Orders — filter tabs ──
document.querySelectorAll('.ftab[data-status]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.ftab[data-status]').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  activeFilter = b.dataset.status;
  renderOrders();
}));

async function updateOrderStatus(id, status) {
  await updateDoc(doc(db, 'orders', id), { status, updatedAt: serverTimestamp() });
  showToast(`Order updated to "${status}"`);
}

// ═══════════════════════════════════════════════════════════════════
// LIVE ORDERS — Enhanced Design
// ═══════════════════════════════════════════════════════════════════
function renderOrders() {
  const grid = document.getElementById('ordersGrid');

  let filtered = allOrders;
  if (activeFilter !== 'all') filtered = filtered.filter(o => o.status === activeFilter);

  const q = orderSearch.value.trim().toLowerCase();
  if (q) filtered = filtered.filter(o =>
    String(o.tableNumber).includes(q) || (o.waiterName || '').toLowerCase().includes(q)
  );

  if (!filtered.length) {
    grid.innerHTML = `
      <div class="orders-empty-state">
        <div class="orders-empty-icon">🍽️</div>
        <div class="orders-empty-title">No orders found</div>
        <div class="orders-empty-sub">Orders will appear here in real-time</div>
      </div>`;
    return;
  }

  const activeOrders    = filtered.filter(o => ['pending', 'preparing'].includes(o.status));
  const servedOrders    = filtered.filter(o => o.status === 'served');
  const paidOrders      = filtered.filter(o => o.status === 'paid');
  const cancelledOrders = filtered.filter(o => o.status === 'cancelled');

  const STATUS_META = {
    pending:   { color: '#F59E0B', bg: 'rgba(245,158,11,0.1)',  border: 'rgba(245,158,11,0.25)',  label: 'Pending',   dot: '#F59E0B' },
    preparing: { color: '#60A5FA', bg: 'rgba(96,165,250,0.1)',  border: 'rgba(96,165,250,0.25)',  label: 'Preparing', dot: '#60A5FA' },
    served:    { color: '#34D399', bg: 'rgba(52,211,153,0.1)',  border: 'rgba(52,211,153,0.25)',  label: 'Served',    dot: '#34D399' },
    paid:      { color: '#9CA3AF', bg: 'rgba(156,163,175,0.07)', border: 'rgba(156,163,175,0.15)', label: 'Paid',      dot: '#9CA3AF' },
    cancelled: { color: '#F87171', bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.2)',  label: 'Cancelled', dot: '#F87171' },
  };

  const STRIPE_GRADIENT = {
    pending:   'linear-gradient(90deg, #F59E0B, #FBBF24)',
    preparing: 'linear-gradient(90deg, #3B82F6, #60A5FA)',
    served:    'linear-gradient(90deg, #10B981, #34D399)',
    paid:      'linear-gradient(90deg, #6B7280, #9CA3AF)',
    cancelled: 'linear-gradient(90deg, #EF4444, #F87171)',
  };

  const statusPill = (status) => {
    const m = STATUS_META[status] || { color: '#888', bg: 'rgba(136,136,136,0.1)', border: 'rgba(136,136,136,0.2)', label: capitalize(status), dot: '#888' };
    return `<span style="
      display:inline-flex;align-items:center;gap:5px;
      background:${m.bg};border:1px solid ${m.border};
      color:${m.color};border-radius:100px;
      font-size:10px;font-weight:700;letter-spacing:0.08em;
      padding:3px 10px;text-transform:uppercase;">
      <span style="width:5px;height:5px;border-radius:50%;background:${m.dot};flex-shrink:0;
        box-shadow:0 0 6px ${m.dot};animation:pulseDot 2s ease-in-out infinite;"></span>
      ${m.label}
    </span>`;
  };

  const sectionHeader = (icon, label, count, color, addTopGap = false) => `
    <div class="orders-section-header" style="margin-top:${addTopGap ? '32px' : '0'};">
      <div class="orders-section-icon" style="background:${color}15;color:${color};">${icon}</div>
      <span class="orders-section-label" style="color:${color};">${label}</span>
      <span class="orders-section-count">${count} order${count !== 1 ? 's' : ''}</span>
      <div class="orders-section-line" style="background:${color}25;"></div>
    </div>`;

  const emptySection = (msg) => `
    <div class="orders-section-empty">${msg}</div>`;

  const buildCard = (o, sectionType) => {
    const isActive = sectionType === 'active';
    const isServed = sectionType === 'served';
    const m = STATUS_META[o.status] || STATUS_META.paid;

    const items = (o.items || []).map(it => `
      <div class="order-item-row">
        <div class="order-item-left">
          <span class="order-item-qty">${it.qty}×</span>
          <span class="order-item-name">${escapeHtml(it.name)}</span>
        </div>
        <span class="order-item-price">₱${((it.price || 0) * it.qty).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
      </div>`).join('');

    const ts = o.createdAt?.toDate
      ? o.createdAt.toDate().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })
      : '—';

    const timeSince = o.createdAt?.toDate ? getTimeSince(o.createdAt.toDate()) : '';

    // elapsed time indicator for active orders
    const elapsedBadge = isActive ? `
      <div class="order-elapsed">
        <span class="order-elapsed-icon">⏱</span>
        <span>${timeSince}</span>
      </div>` : '';

    const lockBadge = !isActive ? `
      <span class="order-lock-badge">🔒 Locked</span>` : '';

    let actionBlock = '';

    if (isActive) {
      const nextMap = { pending: ['preparing','Mark as Preparing'], preparing: ['served','Mark as Served'] };
      const [nextStatus, nextLabel] = nextMap[o.status] || [];
      actionBlock = `
        <div class="order-actions">
          ${nextStatus ? `<button class="order-btn-primary" onclick="window._updateStatus('${o.id}','${nextStatus}')">${nextLabel}</button>` : ''}
          <div class="order-actions-row">
            <button class="order-btn-secondary" onclick="window._editOrder('${o.id}')">✏ Edit</button>
            <button class="order-btn-secondary" onclick="window._showReceipt('${o.id}')">🧾 Receipt</button>
          </div>
          <button class="order-btn-cancel" onclick="window._updateStatus('${o.id}','cancelled')">✕ Cancel Order</button>
        </div>`;
    } else if (isServed) {
      actionBlock = `
        <div class="order-actions">
          <button class="order-btn-pay" onclick="window._updateStatus('${o.id}','paid')">✓ Mark as Paid</button>
          <button class="order-btn-secondary" onclick="window._showReceipt('${o.id}')">🧾 Receipt</button>
        </div>`;
    } else {
      actionBlock = `
        <div class="order-actions">
          <button class="order-btn-secondary full" onclick="window._showReceipt('${o.id}')">🧾 View Receipt</button>
        </div>`;
    }

    const dimmed = (sectionType === 'paid' || sectionType === 'cancelled') ? 'order-card-dimmed' : '';

    return `
      <div class="order-card-v2 ${dimmed}" style="--card-accent:${m.color};--card-border:${m.border};">
        <div class="order-card-stripe" style="background:${STRIPE_GRADIENT[o.status] || '#444'};"></div>
        <div class="order-card-inner">

          <!-- Header row -->
          <div class="order-card-header">
            <div class="order-card-id-row">
              <span class="order-card-id">#${o.id.slice(-5).toUpperCase()}</span>
              ${statusPill(o.status)}
              ${lockBadge}
            </div>
            <div class="order-card-time-col">
              <span class="order-card-time">${ts}</span>
              ${elapsedBadge}
            </div>
          </div>

          <!-- Table + waiter -->
          <div class="order-card-meta">
            <div class="order-meta-table">
              <span class="order-meta-label">Table</span>
              <span class="order-meta-value">${o.tableNumber || '?'}</span>
            </div>
            <div class="order-meta-divider"></div>
            <div class="order-meta-waiter">
              <span class="order-meta-label">Waiter</span>
              <span class="order-meta-value">${escapeHtml(o.waiterName || 'Unknown')}</span>
            </div>
          </div>

          <!-- Items -->
          <div class="order-items-list">
            ${items}
          </div>

          ${o.note ? `<div class="order-note">📝 ${escapeHtml(o.note)}</div>` : ''}

          <!-- Total -->
          <div class="order-total-row">
            <span class="order-total-label">Total</span>
            <span class="order-total-val">₱${(o.total || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
          </div>

          ${actionBlock}
        </div>
      </div>`;
  };

  let html = '';
  html += sectionHeader('⏳', 'Active Orders', activeOrders.length, '#F59E0B', false);
  html += activeOrders.length
    ? activeOrders.map(o => buildCard(o, 'active')).join('')
    : emptySection('No active orders right now.');

  html += sectionHeader('✅', 'Served — Awaiting Payment', servedOrders.length, '#34D399', true);
  html += servedOrders.length
    ? servedOrders.map(o => buildCard(o, 'served')).join('')
    : emptySection('No orders awaiting payment.');

  html += sectionHeader('🔒', 'Paid Orders', paidOrders.length, '#9CA3AF', true);
  html += paidOrders.length
    ? paidOrders.map(o => buildCard(o, 'paid')).join('')
    : emptySection('No paid orders yet.');

  if (cancelledOrders.length && (activeFilter === 'all' || activeFilter === 'cancelled')) {
    html += sectionHeader('✕', 'Cancelled', cancelledOrders.length, '#F87171', true);
    html += cancelledOrders.map(o => buildCard(o, 'cancelled')).join('');
  }

  grid.innerHTML = html;
}

function getTimeSince(date) {
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}

window._updateStatus = updateOrderStatus;

// ── Tables view ──
let tableStatuses = {};
let tableDocsList = [];

onSnapshot(collection(db, 'tables'), snap => {
  tableStatuses = {};
  tableDocsList = [];
  snap.forEach(d => {
    const data = d.data();
    const rawNum = data.tableNumber
      ? parseInt(data.tableNumber)
      : parseInt(d.id.replace('table_', ''));
    const num = isNaN(rawNum) ? null : rawNum;
    if (!num) return;
    if (tableStatuses[num]) {
      if (!data.tableNumber) return;
    }
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
  const sub = document.getElementById('statTablesSub');
  if (sub) sub.textContent = `of ${tableDocsList.length} tables`;
  const toolbar = document.querySelector('#view-tables .panel-title--small');
  if (toolbar) toolbar.textContent = `${tableDocsList.length} Tables · Drag to rearrange status`;
}

const STATUS_CFG = {
  free:       { icon: '🪑', label: 'Free',       textColor: '#5e5e5e' },
  reserved:   { icon: '📋', label: 'Reserved',   textColor: '#c9973a' },
  'walk-in':  { icon: '🍽️', label: 'Walk-in',    textColor: '#e8c07a' },
  pending:    { icon: '⏳', label: 'Pending',    textColor: '#F59E0B' },
  preparing:  { icon: '👨‍🍳', label: 'Preparing',  textColor: '#60A5FA' },
  served:     { icon: '✅', label: 'Served',     textColor: '#34D399' },
  billed:     { icon: '💰', label: 'Billed',     textColor: '#9b59b6' },
};

// ═══════════════════════════════════════════════════════════════════
// TABLES — with live order sync fix
// ═══════════════════════════════════════════════════════════════════
function renderTablesGrid() {
  const grid = document.getElementById('tablesGrid');
  if (!grid) return;

  // Build a live-order status map keyed by tableNumber
  const liveOrderStatus = {};
  const liveOrderWaiter = {};
  allOrders.forEach(o => {
    if (!o.tableNumber) return;
    const n = o.tableNumber;
    const priority = { pending: 3, preparing: 2, served: 1 };
    if (priority[o.status] !== undefined) {
      if (!liveOrderStatus[n] || priority[o.status] > priority[liveOrderStatus[n]]) {
        liveOrderStatus[n] = o.status;
        liveOrderWaiter[n] = o.waiterName || null;
      }
    }
  });

  const cards = tableDocsList.map(entry => {
    const n    = entry.tableNumber;
    const data = tableStatuses[n];

    // Live orders ALWAYS win over stored status
    const rawSt = liveOrderStatus[n]
      ? liveOrderStatus[n]
      : ((data?.status || 'free').toLowerCase().trim());
    const st = rawSt === 'available' ? 'free' : rawSt;

    const cfg       = STATUS_CFG[st] || STATUS_CFG.free;
    const waiter    = liveOrderWaiter[n] || data?.waiterName || null;
    const guestName = data?.reservation?.guestName || null;
    const resTime   = data?.reservation?.time || null;
    const label     = data?.name ? data.name : `Table ${n}`;
    const cap       = data?.capacity ? `· ${data.capacity} seats` : '';
    const isOccupied = !!liveOrderStatus[n];

    return `
      <div class="table-card ${st}">
        <div class="table-card-num" style="color:${cfg.textColor}">${escapeHtml(label)}</div>
        ${cap ? `<div class="table-card-info muted" style="font-size:11px;margin-top:-6px;">${escapeHtml(cap)}</div>` : ''}
        <div class="table-card-icon">${cfg.icon}</div>
        <div class="table-card-status">
          <span class="status-badge ${st}" style="color:${cfg.textColor};border-color:${cfg.textColor}33;background:${cfg.textColor}18">
            ${cfg.label}
          </span>
        </div>
        ${isOccupied ? `
          <div class="table-card-info" style="color:${cfg.textColor};font-weight:500;">
            👤 ${escapeHtml(waiter || '—')}
          </div>
          <div class="table-card-info" style="color:${cfg.textColor};font-size:11px;opacity:0.7;">
            Active order · locked
          </div>
        ` : st === 'reserved' ? `
          <div class="table-card-info" style="color:${cfg.textColor};font-weight:500;">
            👤 ${escapeHtml(guestName || '—')}
          </div>
          <div class="table-card-info" style="color:${cfg.textColor};">
            🕐 ${escapeHtml(resTime || '—')}
          </div>
          <button class="btn-sm" style="margin-top:6px;border-color:rgba(192,57,43,0.4);color:#e07070;width:100%;"
            onclick="window._removeReservation(${n})">
            ✕ Remove Reservation
          </button>
        ` : st === 'free' ? `
          <div class="table-card-info muted">No waiter assigned</div>
          <button class="btn-sm gold" style="margin-top:6px;width:100%;"
            onclick="window._openReserveModal(${n})">
            + Reserve
          </button>
        ` : `
          <div class="table-card-info" style="color:${cfg.textColor}">
            ${waiter ? `👤 ${escapeHtml(waiter)}` : 'No waiter assigned'}
          </div>
        `}
        <div style="display:flex;gap:6px;margin-top:4px;">
          <button class="btn-sm" style="flex:1;" onclick="window._openEditTableModal(${n})">Edit</button>
          <button class="btn-sm danger" onclick="window._deleteTable(${n})" title="Delete table">✕</button>
        </div>
      </div>`;
  });

  cards.push(`
    <div class="table-card free add-table-card" onclick="window._openAddTableModal()"
         style="cursor:pointer;border-style:dashed;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;opacity:0.65;transition:opacity .2s;">
      <div style="font-size:32px;">＋</div>
      <div style="font-size:13px;font-weight:600;color:var(--text-muted);">Add Table</div>
    </div>`);

  grid.innerHTML = cards.join('');
}

window._openAddTableModal = () => openTableModal('add');

// ════════════════════════════════════════
// ── TABLE ADD / EDIT / DELETE MODAL ──
// ════════════════════════════════════════
let tableModalMode = 'add';
let tableModalTarget = null;

function openTableModal(mode, tableNum = null) {
  tableModalMode = mode;
  tableModalTarget = tableNum;

  const modal    = document.getElementById('tableModal');
  const title    = document.getElementById('tableModalTitle');
  const numInput = document.getElementById('tableModalNumber');
  const nameInput= document.getElementById('tableModalName');
  const capInput = document.getElementById('tableModalCapacity');
  const numRow   = document.getElementById('tableModalNumberRow');

  if (mode === 'add') {
    title.textContent = 'Add New Table';
    numRow.style.display = '';
    const existing = tableDocsList.map(t => t.tableNumber);
    let next = 1;
    while (existing.includes(next)) next++;
    numInput.value = next;
    nameInput.value = '';
    capInput.value  = '';
  } else {
    title.textContent = 'Edit Table';
    numRow.style.display = 'none';
    const data = tableStatuses[tableNum];
    nameInput.value = data?.name || '';
    capInput.value  = data?.capacity || '';
  }

  modal.classList.add('show');
  nameInput.focus();
}

window._openEditTableModal = (n) => openTableModal('edit', n);

document.getElementById('tableModalClose').onclick =
document.getElementById('tableModalCancel').onclick = () => {
  document.getElementById('tableModal').classList.remove('show');
};

document.getElementById('tableModal').onclick = e => {
  if (e.target === document.getElementById('tableModal'))
    document.getElementById('tableModal').classList.remove('show');
};

document.getElementById('tableModalSave').onclick = async () => {
  const numInput  = document.getElementById('tableModalNumber');
  const nameInput = document.getElementById('tableModalName');
  const capInput  = document.getElementById('tableModalCapacity');
  const btn       = document.getElementById('tableModalSave');

  const name     = nameInput.value.trim();
  const capacity = capInput.value ? parseInt(capInput.value) : null;

  if (tableModalMode === 'add') {
    const num = parseInt(numInput.value);
    if (!num || num < 1) { showToast('⚠ Enter a valid table number.'); return; }
    if (tableStatuses[num]) { showToast(`⚠ Table ${num} already exists.`); return; }

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await setDoc(doc(db, 'tables', `table_${num}`), {
        tableNumber: num, name: name || null, capacity: capacity || null,
        status: 'free', reservation: null, waiterId: null, waiterName: null,
        lastUpdated: serverTimestamp()
      });
      showToast(`✓ Table ${num} added.`);
      document.getElementById('tableModal').classList.remove('show');
    } catch(err) {
      showToast('❌ Failed to add table.'); console.error(err);
    } finally {
      btn.disabled = false; btn.textContent = 'Save';
    }
  } else {
    const data = tableStatuses[tableModalTarget];
    if (!data) { showToast('Table not found.'); return; }
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await updateDoc(doc(db, 'tables', data.docId), {
        name: name || null, capacity: capacity || null, lastUpdated: serverTimestamp()
      });
      showToast(`✓ Table ${tableModalTarget} updated.`);
      document.getElementById('tableModal').classList.remove('show');
    } catch(err) {
      showToast('❌ Failed to update table.'); console.error(err);
    } finally {
      btn.disabled = false; btn.textContent = 'Save';
    }
  }
};

window._deleteTable = async (tableNum) => {
  const data = tableStatuses[tableNum];
  if (!data) return;
  const label = data.name ? `"${data.name}" (Table ${tableNum})` : `Table ${tableNum}`;
  const rawSt = (data.status || 'free').toLowerCase();
  const isActive = !['free','reserved'].includes(rawSt);
  const warnMsg = isActive
    ? `⚠ Table ${tableNum} currently has active guests/orders. Deleting it will remove the table entry but NOT cancel orders.`
    : '';

  showConfirm({
    title: `Delete ${label}`,
    message: `Are you sure you want to permanently delete ${label}? ${warnMsg} This cannot be undone.`,
    okLabel: 'Delete', okClass: 'danger',
    onOk: async () => {
      try {
        await deleteDoc(doc(db, 'tables', data.docId));
        showToast(`✓ ${label} deleted.`);
      } catch(err) {
        showToast('❌ Failed to delete table.'); console.error(err);
      }
    }
  });
};

// ── Reserve Modal ──
let reserveTargetTable = null;

window._openReserveModal = (tableNum) => {
  reserveTargetTable = tableNum;
  document.getElementById('reserveTableLabel').textContent = `Reserve Table ${tableNum}`;
  document.getElementById('reserveGuestName').value = '';
  document.getElementById('reserveHour').value   = '7';
  document.getElementById('reserveMinute').value = '00';
  document.getElementById('reserveAmPm').value   = 'PM';
  document.getElementById('reserveModal').classList.add('show');
};
document.getElementById('reserveModalCancel').onclick = () => {
  document.getElementById('reserveModal').classList.remove('show');
  reserveTargetTable = null;
};
document.getElementById('reserveModal').onclick = (e) => {
  if (e.target === document.getElementById('reserveModal')) {
    document.getElementById('reserveModal').classList.remove('show');
    reserveTargetTable = null;
  }
};

document.getElementById('reserveModalConfirm').onclick = async () => {
  const guestName = document.getElementById('reserveGuestName').value.trim();
  const hour   = document.getElementById('reserveHour').value;
  const minute = document.getElementById('reserveMinute').value;
  const ampm   = document.getElementById('reserveAmPm').value;
  const time   = `${hour}:${minute} ${ampm}`;

  if (!guestName) { showToast('⚠ Please enter the guest name.'); return; }

  const data = tableStatuses[reserveTargetTable];
  if (!data) { showToast('Table not found.'); return; }

  const btn = document.getElementById('reserveModalConfirm');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await updateDoc(doc(db, 'tables', data.docId), {
      status: 'reserved', reservation: { guestName, time },
      waiterId: null, waiterName: null, lastUpdated: serverTimestamp()
    });
    showToast(`✓ Table ${reserveTargetTable} reserved for ${guestName} at ${time}`);
    document.getElementById('reserveModal').classList.remove('show');
    reserveTargetTable = null;
  } catch(err) {
    showToast('❌ Failed to save reservation.'); console.error(err);
  } finally {
    btn.disabled = false; btn.textContent = 'Confirm Reservation';
  }
};

window._removeReservation = async (tableNum) => {
  if (!confirm(`Remove reservation for Table ${tableNum}?`)) return;
  const data = tableStatuses[tableNum];
  if (!data) return;
  try {
    await updateDoc(doc(db, 'tables', data.docId), {
      status: 'free', reservation: null, lastUpdated: serverTimestamp()
    });
    showToast(`✓ Reservation for Table ${tableNum} removed.`);
  } catch(err) {
    showToast('❌ Failed to remove reservation.'); console.error(err);
  }
};

// ═══════════════════════════════════════════════════════════════════
// Clear All Tables modal
// ═══════════════════════════════════════════════════════════════════
function initClearTablesModal() {
  const modal      = document.getElementById('clearTablesModal');
  const openBtn    = document.getElementById('clearAllTablesBtn');
  const closeBtn   = document.getElementById('clearTablesModalClose');
  const cancelBtn  = document.getElementById('clearTablesModalCancel');
  const confirmBtn = document.getElementById('clearTablesModalConfirm');

  if (!modal || !openBtn) return;

  openBtn.onclick   = () => modal.classList.add('show');
  closeBtn.onclick  = () => modal.classList.remove('show');
  cancelBtn.onclick = () => modal.classList.remove('show');
  modal.onclick = e => { if (e.target === modal) modal.classList.remove('show'); };

  confirmBtn.onclick = async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Clearing…';
    try {
      const snap = await getDocs(collection(db, 'tables'));
      await Promise.all(snap.docs.map(d =>
        updateDoc(d.ref, {
          status: 'free', reservation: null,
          waiterId: null, waiterName: null, lastUpdated: serverTimestamp()
        })
      ));
      const active = allOrders.filter(o => ['pending','preparing','served'].includes(o.status));
      await Promise.all(active.map(o =>
        updateDoc(doc(db, 'orders', o.id), { status: 'paid', updatedAt: serverTimestamp() })
      ));
      modal.classList.remove('show');
      showToast('✓ All tables cleared.');
    } catch(err) {
      showToast('❌ Failed to clear tables.'); console.error(err);
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Yes, Clear All Tables';
    }
  };
}

// ═══════════════════════════════════════════════════════════════════
// ── MENU (with Image Upload) ──
// ═══════════════════════════════════════════════════════════════════
let menuItems = [], editMenuId = null;
let menuCatFilter = 'all';
let menuSearchQuery = '';
let pendingImageFile = null;
let currentImageUrl  = null;

async function loadMenu() {
  const snap = await getDocs(collection(db,'menu'));
  menuItems = snap.docs.map(d=>({id:d.id,...d.data()}));
  buildMenuCategoryTabs();
  renderMenuGrid();
}

document.getElementById('menuSearch').addEventListener('input', e => {
  menuSearchQuery = e.target.value.trim().toLowerCase();
  renderMenuGrid();
});

function buildMenuCategoryTabs() {
  const cats = [...new Set(menuItems.map(m=>m.category||'Other'))];
  const tabs = document.getElementById('menuCategoryTabs');
  tabs.innerHTML = `<button class="ftab active" data-cat="all">All</button>` +
    cats.map(c=>`<button class="ftab" data-cat="${c}">${c}</button>`).join('');
  tabs.querySelectorAll('.ftab').forEach(b=>b.addEventListener('click',()=>{
    tabs.querySelectorAll('.ftab').forEach(x=>x.classList.remove('active'));
    b.classList.add('active'); menuCatFilter=b.dataset.cat; renderMenuGrid();
  }));
}

const TIME_RESTRICTED = {
  'Bento sa Salo': { start: 11, end: 15 },
};

function isTimeAvailable(category) {
  const rule = TIME_RESTRICTED[category];
  if (!rule) return null;
  const now = new Date();
  const h = now.getHours() + now.getMinutes() / 60;
  return h >= rule.start && h < rule.end;
}

function timeWindowLabel(category) {
  const rule = TIME_RESTRICTED[category];
  if (!rule) return '';
  const fmt = h => {
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hr = h > 12 ? h - 12 : (h === 0 ? 12 : h);
    return `${hr}:00 ${ampm}`;
  };
  return `${fmt(rule.start)} – ${fmt(rule.end)} only`;
}

function renderMenuGrid() {
  const grid = document.getElementById('menuGrid');
  let items = menuCatFilter === 'all' ? menuItems : menuItems.filter(m => (m.category || 'Other') === menuCatFilter);
  if (menuSearchQuery) {
    items = items.filter(m =>
      (m.name || '').toLowerCase().includes(menuSearchQuery) ||
      (m.description || '').toLowerCase().includes(menuSearchQuery) ||
      (m.category || '').toLowerCase().includes(menuSearchQuery)
    );
  }
  if (!items.length) { grid.innerHTML = '<div class="empty-state">No items found.</div>'; return; }

  grid.innerHTML = items.map(m => {
    const sold = allOrders.reduce((s, o) => {
      (o.items || []).forEach(it => { if ((it.name || '') === (m.name || '')) s += (it.qty || 0); });
      return s;
    }, 0);
    const quota = m.quota || null;
    const remaining = quota !== null ? Math.max(0, quota - sold) : null;
    const soldBadge = quota !== null
      ? `<div class="menu-card-sold">Sold: ${sold} &nbsp;·&nbsp; Remaining: ${remaining}</div>`
      : '';

    const timeOk = isTimeAvailable(m.category);
    const isAvailable = timeOk !== null
      ? timeOk
      : (quota !== null ? remaining > 0 : m.available !== false);

    let bannerClass, bannerText;
    if (timeOk === false) {
      bannerClass = 'off';
      bannerText  = `Not available &nbsp;·&nbsp; ${timeWindowLabel(m.category)}`;
    } else if (timeOk === true) {
      bannerClass = 'on';
      bannerText  = `Available &nbsp;·&nbsp; ${timeWindowLabel(m.category)}`;
    } else if (quota !== null) {
      bannerClass = remaining <= 0 ? 'off' : 'on';
      bannerText  = remaining <= 0 ? 'Quota reached' : `Quota: ${remaining} / ${quota} remaining`;
    } else {
      bannerClass = m.available === false ? 'off' : 'on';
      bannerText  = m.available === false ? 'Unavailable' : 'Available';
    }

    return `
    <div class="menu-card ${!isAvailable ? 'unavailable' : ''}">
      <div class="menu-card-img-placeholder" id="img-slot-${m.id}">🍽️</div>
      <div class="menu-avail-banner ${bannerClass}">
        <span class="menu-avail-banner-dot"></span>
        ${bannerText}
      </div>
      <div class="menu-card-body">
        <div class="menu-card-cat">${escapeHtml(m.category || 'Other')}</div>
        <div class="menu-card-name">${escapeHtml(m.name || '—')}</div>
        <div class="menu-card-desc">${escapeHtml(m.description || '')}</div>
        ${soldBadge}
      </div>
      <div class="menu-card-footer">
        <span class="menu-card-price">₱${(m.price || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
        <div class="menu-card-actions">
          <button class="btn-sm" onclick="window._editMenu('${m.id}')">Edit</button>
          <button class="btn-sm danger" onclick="window._deleteMenu('${m.id}')">Del</button>
        </div>
      </div>
    </div>`;
  }).join('');

  items.forEach((m, i) => {
    if (!m.imageUrl) return;
    setTimeout(() => {
      const slot = document.getElementById(`img-slot-${m.id}`);
      if (!slot) return;
      const img = document.createElement('img');
      img.className = 'menu-card-img';
      img.alt = m.name || '';
      img.onerror = () => { img.style.display = 'none'; slot.style.display = 'flex'; };
      img.onload  = () => { slot.style.display = 'none'; };
      slot.parentNode.insertBefore(img, slot);
      img.src = m.imageUrl;
    }, i * 30);
  });
}

// ── Image Upload Zone ──
const imgUploadZone   = document.getElementById('imgUploadZone');
const imgPreview      = document.getElementById('imgPreview');
const imgIconWrap     = document.getElementById('imgIconWrap');
const imgHint         = document.getElementById('imgHint');
const imgSub          = document.getElementById('imgSub');
const imgStripName    = document.getElementById('imgStripName');
const imgRemoveBtn    = document.getElementById('imgRemoveBtn');
const menuItemImageIn = document.getElementById('menuItemImage');
const imgProgress     = document.getElementById('imgUploadProgress');
const imgBar          = document.getElementById('imgUploadBar');

function showImagePreview(url, filename) {
  imgPreview.src = url;
  imgPreview.classList.add('visible');
  imgUploadZone.classList.add('has-img');
  imgIconWrap.style.display = 'none';
  imgHint.style.display = 'none';
  imgSub.style.display = 'none';
  if (filename) imgStripName.textContent = filename;
}

function clearImagePreview() {
  imgPreview.src = '';
  imgPreview.classList.remove('visible');
  imgUploadZone.classList.remove('has-img');
  imgIconWrap.style.display = '';
  imgHint.style.display = '';
  imgSub.style.display = '';
  imgStripName.textContent = '';
  menuItemImageIn.value = '';
  pendingImageFile = null;
  currentImageUrl  = null;
}

imgUploadZone.addEventListener('click', e => {
  if (e.target === imgRemoveBtn) return;
  menuItemImageIn.click();
});

imgUploadZone.addEventListener('dragover', e => { e.preventDefault(); imgUploadZone.classList.add('drag-over'); });
imgUploadZone.addEventListener('dragleave', () => imgUploadZone.classList.remove('drag-over'));
imgUploadZone.addEventListener('drop', e => {
  e.preventDefault();
  imgUploadZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleImageFile(file);
});

menuItemImageIn.addEventListener('change', () => {
  if (menuItemImageIn.files[0]) handleImageFile(menuItemImageIn.files[0]);
});

imgRemoveBtn.addEventListener('click', e => {
  e.stopPropagation();
  clearImagePreview();
});

function handleImageFile(file) {
  if (!file.type.startsWith('image/')) { showToast('Please select an image file.'); return; }
  if (file.size > 2 * 1024 * 1024) { showToast('Image must be under 2 MB.'); return; }
  pendingImageFile = file;
  const reader = new FileReader();
  reader.onload = e => showImagePreview(e.target.result, file.name);
  reader.readAsDataURL(file);
}

function compressImageToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = e => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX = 800;
        let w = img.width, h = img.height;
        if (w > h && w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
        else if (h > MAX)     { w = Math.round(w * MAX / h); h = MAX; }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        let quality = 0.8;
        let base64 = canvas.toDataURL('image/jpeg', quality);
        while (base64.length > 700_000 && quality > 0.3) {
          quality -= 0.1;
          base64 = canvas.toDataURL('image/jpeg', quality);
        }
        imgProgress.style.display = 'block';
        imgBar.style.width = '0%';
        let pct = 0;
        const iv = setInterval(() => {
          pct = Math.min(pct + 20, 100);
          imgBar.style.width = pct + '%';
          if (pct >= 100) {
            clearInterval(iv);
            setTimeout(() => { imgProgress.style.display = 'none'; imgBar.style.width = '0%'; }, 400);
          }
        }, 60);
        resolve(base64);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

document.getElementById('addMenuItemBtn').onclick = () => {
  editMenuId = null;
  document.getElementById('menuModalTitle').textContent = 'Add Menu Item';
  ['menuItemName','menuItemPrice','menuItemCategory','menuItemDesc'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('menuItemAvail').value = 'true';
  clearImagePreview();
  document.getElementById('menuModal').classList.add('show');
};

window._editMenu = id => {
  const item = menuItems.find(m=>m.id===id); if(!item)return;
  editMenuId = id;
  document.getElementById('menuModalTitle').textContent = 'Edit Menu Item';
  document.getElementById('menuItemName').value     = item.name||'';
  document.getElementById('menuItemPrice').value    = item.price||'';
  document.getElementById('menuItemCategory').value = item.category||'';
  document.getElementById('menuItemDesc').value     = item.description||'';
  document.getElementById('menuItemAvail').value    = item.available===false ? 'false' : 'true';
  clearImagePreview();
  if (item.imageUrl) {
    currentImageUrl = item.imageUrl;
    showImagePreview(item.imageUrl, 'Current photo');
  }
  document.getElementById('menuModal').classList.add('show');
};

window._deleteMenu = async id => {
  if(!confirm('Delete this menu item?')) return;
  await deleteDoc(doc(db,'menu',id));
  await loadMenu(); showToast('Item deleted.');
};

document.getElementById('menuModalClose').onclick  = () => { document.getElementById('menuModal').classList.remove('show'); clearImagePreview(); };
document.getElementById('menuModalCancel').onclick = () => { document.getElementById('menuModal').classList.remove('show'); clearImagePreview(); };

document.getElementById('menuModalSave').onclick = async () => {
  const name        = document.getElementById('menuItemName').value.trim();
  const price       = parseFloat(document.getElementById('menuItemPrice').value) || 0;
  const category    = document.getElementById('menuItemCategory').value.trim();
  const description = document.getElementById('menuItemDesc').value.trim();
  const available   = document.getElementById('menuItemAvail').value === 'true';

  if (!name) { showToast('Please enter a name.'); return; }

  const saveBtn = document.getElementById('menuModalSave');
  saveBtn.disabled = true; saveBtn.textContent = 'Saving…';

  try {
    let imageUrl = currentImageUrl || null;
    if (pendingImageFile) {
      showToast('Processing image…');
      imageUrl = await compressImageToBase64(pendingImageFile);
    }
    const data = { name, price, category, description, available, imageUrl };
    if (editMenuId) {
      await updateDoc(doc(db,'menu',editMenuId), data);
    } else {
      await addDoc(collection(db,'menu'), { ...data, createdAt: serverTimestamp() });
    }
    document.getElementById('menuModal').classList.remove('show');
    clearImagePreview();
    await loadMenu();
    showToast(editMenuId ? 'Item updated.' : 'Item added.');
  } catch(e) {
    console.error(e);
    showToast('Failed to save item: ' + e.message);
  } finally {
    saveBtn.disabled = false; saveBtn.textContent = 'Save Item';
  }
};

// ── Billing ──
document.querySelectorAll('.ftab[data-bstatus]').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.ftab[data-bstatus]').forEach(x=>x.classList.remove('active'));
  b.classList.add('active'); billingFilter=b.dataset.bstatus; renderBilling();
}));

function renderBilling() {
  let orders = [...allOrders];
  if(billingFilter==='unpaid') orders=orders.filter(o=>o.status!=='paid'&&o.status!=='cancelled');
  else if(billingFilter==='paid') orders=orders.filter(o=>o.status==='paid');

  const today=new Date(); today.setHours(0,0,0,0);
  const todayTotal=allOrders.filter(o=>o.status==='paid'&&o.createdAt?.toDate()>=today).reduce((s,o)=>s+(o.total||0),0);
  document.getElementById('billingTodayTotal').textContent=`₱${todayTotal.toLocaleString('en-PH',{minimumFractionDigits:2})}`;

  const tbody=document.getElementById('billingTableBody');
  if(!orders.length){tbody.innerHTML='<tr><td colspan="8" class="empty-row">No records.</td></tr>';return;}
  tbody.innerHTML=orders.map(o=>{
    const ts=o.createdAt?.toDate?o.createdAt.toDate().toLocaleString('en-PH',{dateStyle:'short',timeStyle:'short'}):'—';
    const nextStatus={pending:'preparing',preparing:'served',served:'paid'}[o.status];
    const nextLabel={pending:'→ Preparing',preparing:'→ Served',served:'✓ Paid'}[o.status]||'';
    return `<tr>
      <td class="mono">#${o.id.slice(-5).toUpperCase()}</td>
      <td>Table ${o.tableNumber||'—'}</td>
      <td>${o.waiterName||'—'}</td>
      <td>${(o.items||[]).length} items</td>
      <td><strong>₱${(o.total||0).toLocaleString('en-PH',{minimumFractionDigits:2})}</strong></td>
      <td style="white-space:nowrap">${ts}</td>
      <td><span class="status-badge ${o.status}">${capitalize(o.status||'')}</span></td>
      <td style="white-space:nowrap;display:flex;gap:6px;align-items:center;">
        ${nextStatus?`<button class="btn-sm gold" onclick="window._updateStatus('${o.id}','${nextStatus}')">${nextLabel}</button>`:'<span style="color:var(--text-muted);font-size:11px;">—</span>'}
        <button class="btn-sm" onclick="window._showReceipt('${o.id}')">Receipt</button>
      </td>
    </tr>`;
  }).join('');
}

// ── Staff ──
let staffLoading = false;
async function loadStaff() {
  if (staffLoading) { console.warn('loadStaff: already in progress, skipping'); return; }
  staffLoading = true;
  try {
    const snap = await getDocs(collection(db,'Users'));
    const staff = snap.docs.map(d=>({id:d.id,...d.data()}));
    const pending  = staff.filter(s => s.role==='waiter' && s.status==='pending');
    const approved = staff.filter(s => s.status==='approved' || s.role==='admin' || !s.status || s.status==='');
    const rejected = staff.filter(s => s.role==='waiter' && s.status==='rejected');
    const grid = document.getElementById('staffGrid');

    let html = '';

    if (pending.length > 0) {
      html += `<div class="pending-banner">
        <div class="pending-banner-icon">🔔</div>
        <div class="pending-banner-text">
          <strong>${pending.length} pending registration${pending.length>1?'s':''}</strong> awaiting your approval
        </div>
      </div>`;
      html += `<div class="staff-section-label">⏳ Pending Approval</div>`;
      html += pending.map(s => `
        <div class="staff-card pending-card">
          <div class="staff-avatar pending-avatar">${(s.name||s.email||'?')[0].toUpperCase()}</div>
          <div class="staff-info">
            <div class="staff-name">${s.name||'—'}</div>
            <div class="staff-email">${s.email||'—'}</div>
            <div class="staff-meta">${s.phone||''}</div>
            <span class="status-badge pending-badge">Pending Review</span>
          </div>
          <div class="staff-actions">
            <button class="btn-sm gold" onclick="window._approveStaff('${s.id}','${escapeHtml(s.name||'')}')">✓ Approve</button>
            <button class="btn-sm danger" onclick="window._rejectStaff('${s.id}','${escapeHtml(s.name||'')}')">✗ Reject</button>
          </div>
        </div>`).join('');
    }

    if (approved.length > 0) {
      html += `<div class="staff-section-label">✅ Active Staff</div>`;
      html += approved.map(s => `
        <div class="staff-card">
          <div class="staff-avatar">${(s.name||s.email||'?')[0].toUpperCase()}</div>
          <div class="staff-info">
            <div class="staff-name">${s.name||'—'}</div>
            <div class="staff-email">${s.email||'—'}</div>
            <span class="status-badge ${s.role}">${capitalize(s.role||'unknown')}</span>
          </div>
          ${s.role==='waiter'?`<div class="staff-actions"><button class="btn-sm danger" onclick="window._rejectStaff('${s.id}','${escapeHtml(s.name||'')}')">Suspend</button></div>`:''}
        </div>`).join('');
    }

    if (rejected.length > 0) {
      html += `<div class="staff-section-label" style="color:var(--red)">❌ Rejected / Suspended</div>`;
      html += rejected.map(s => `
        <div class="staff-card" style="opacity:0.55">
          <div class="staff-avatar" style="background:var(--red-dim);border-color:rgba(192,57,43,0.3);color:var(--red)">${(s.name||s.email||'?')[0].toUpperCase()}</div>
          <div class="staff-info">
            <div class="staff-name">${s.name||'—'}</div>
            <div class="staff-email">${s.email||'—'}</div>
            <span class="status-badge" style="color:var(--red);background:var(--red-dim)">Rejected</span>
          </div>
          <div class="staff-actions"><button class="btn-sm gold" onclick="window._approveStaff('${s.id}','${escapeHtml(s.name||'')}')">Re-approve</button></div>
        </div>`).join('');
    }

    if (!staff.length) html = '<div class="empty-state">No staff accounts found.</div>';
    else if (!html) html = '<div class="empty-state">No staff matched any category — check console.</div>';
    grid.innerHTML = html;

    const staffBadge = document.getElementById('staffBadge');
    if (staffBadge) { staffBadge.textContent = pending.length; staffBadge.style.display = pending.length > 0 ? 'inline-flex' : 'none'; }
  } catch(e) {
    console.error('loadStaff error:', e);
    document.getElementById('staffGrid').innerHTML = `<div class="empty-state">Failed to load staff: ${e.message}</div>`;
  } finally {
    staffLoading = false;
  }
}

window._approveStaff = (uid, name) => {
  showConfirm({
    title: 'Approve Staff',
    message: `Approve ${name||'this waiter'} and grant them access to the system?`,
    okLabel: '✓ Approve', okClass: 'gold',
    onOk: async () => {
      try {
        await updateDoc(doc(db,'Users',uid), {
          status: 'approved', approvedAt: serverTimestamp(),
          approvedBy: (document.getElementById('userNameSidebar').textContent || 'Admin')
        });
        showToast(`✅ ${name||'Waiter'} has been approved.`);
        loadStaff();
      } catch(e) { console.error(e); showToast('Failed to approve. Try again.'); }
    }
  });
};

window._rejectStaff = (uid, name) => {
  showConfirm({
    title: 'Reject / Suspend Staff',
    message: `Reject or suspend ${name||'this waiter'}? They will not be able to log in.`,
    okLabel: '✗ Reject', okClass: 'danger',
    onOk: async () => {
      try {
        await updateDoc(doc(db,'Users',uid), { status: 'rejected', rejectedAt: serverTimestamp() });
        showToast(`❌ ${name||'Waiter'} has been rejected.`);
        loadStaff();
      } catch(e) { console.error(e); showToast('Failed to reject. Try again.'); }
    }
  });
};

// ── Reports ──
function renderReports() {
  const today=new Date(); today.setHours(0,0,0,0);
  const paidToday=allOrders.filter(o=>o.status==='paid'&&o.createdAt?.toDate()>=today);
  const rev=paidToday.reduce((s,o)=>s+(o.total||0),0);
  document.getElementById('rptTodayRev').textContent=`₱${rev.toLocaleString('en-PH',{minimumFractionDigits:2})}`;
  document.getElementById('rptOrdersToday').textContent=paidToday.length;
  document.getElementById('rptAvgOrder').textContent=paidToday.length?`₱${(rev/paidToday.length).toFixed(2)}`:'—';

  const tblCount={};
  allOrders.forEach(o=>{if(o.tableNumber)tblCount[o.tableNumber]=(tblCount[o.tableNumber]||0)+1;});
  const topT=Object.entries(tblCount).sort((a,b)=>b[1]-a[1])[0];
  document.getElementById('rptTopTable').textContent=topT?`Table ${topT[0]}`:'—';

  const itemCount={};
  allOrders.forEach(o=>(o.items||[]).forEach(it=>{
    const k=it.name||'?';
    if(!itemCount[k])itemCount[k]={name:k,category:it.category||'—',orders:0,revenue:0};
    itemCount[k].orders+=(it.qty||1);
    itemCount[k].revenue+=((it.price||0)*(it.qty||1));
  }));
  const sorted=Object.values(itemCount).sort((a,b)=>b.orders-a.orders).slice(0,10);
  const tbody=document.getElementById('topItemsBody');
  tbody.innerHTML=sorted.length?sorted.map(it=>`
    <tr>
      <td>${it.name}</td><td>${it.category}</td>
      <td>${it.orders}</td>
      <td>₱${it.revenue.toLocaleString('en-PH',{minimumFractionDigits:2})}</td>
    </tr>`).join(''):'<tr><td colspan="4" class="empty-row">No data yet.</td></tr>';

  const statuses=['pending','preparing','served','paid','cancelled'];
  const counts={};statuses.forEach(s=>counts[s]=0);
  allOrders.forEach(o=>{if(counts[o.status]!==undefined)counts[o.status]++;});
  const max=Math.max(...Object.values(counts),1);
  document.getElementById('statusChart').innerHTML=statuses.map(s=>`
    <div class="bar-row">
      <span class="bar-label">${capitalize(s)}</span>
      <div class="bar-track"><div class="bar-fill ${s}" style="width:${(counts[s]/max)*100}%"></div></div>
      <span class="bar-count">${counts[s]}</span>
    </div>`).join('');

  renderMonthlyReport();
  renderDailySalesReport();
  renderSalesCalendar();
}

// ── Order edit / receipt ──
let editingOrderId = null;

window._editOrder = id => {
  const o = allOrders.find(x=>x.id===id);
  if(!o){ showToast('Order not found'); return; }

  if (['served','paid'].includes(o.status)) {
    showToast('🔒 This order is locked and cannot be edited.');
    return;
  }

  editingOrderId = id;
  const body = document.getElementById('orderModalBody');
  const items = (o.items||[]).map((it,idx)=>`
    <div class="form-row" data-idx="${idx}">
      <div class="form-group"><label>Item</label><input type="text" value="${escapeHtml(it.name)}" disabled></div>
      <div class="form-group"><label>Price</label><input type="number" value="${it.price||0}" disabled></div>
      <div class="form-group"><label>Qty (1–20)</label><input type="number" class="edit-qty" value="${Math.min(it.qty||1,20)}" min="1" max="20"></div>
    </div>`).join('');
  body.innerHTML = `<div style="max-height:360px;overflow:auto;">${items}</div>` +
    `<div style="margin-top:12px;text-align:right">Current total: <strong>₱${(o.total||0).toLocaleString('en-PH',{minimumFractionDigits:2})}</strong></div>`;
  document.getElementById('orderModal').classList.add('show');
};

async function saveOrderEdits(){
  if(!editingOrderId){ showToast('No order selected'); return; }

  const order = allOrders.find(o => o.id === editingOrderId);
  if (order && ['served','paid'].includes(order.status)) {
    showToast('🔒 Served orders cannot be edited.');
    document.getElementById('orderModal').classList.remove('show');
    return;
  }

  const modal = document.getElementById('orderModalBody');
  const rows = modal.querySelectorAll('.form-row');
  const items = [];
  let capped = false;

  rows.forEach(r=>{
    const name  = r.querySelector('input[type="text"]').value;
    const price = parseFloat(r.querySelector('input[type="number"]').value)||0;
    const qtyInput = r.querySelector('.edit-qty');
    let qty = parseInt(qtyInput.value)||0;

    if (qty > 20) { qty = 20; qtyInput.value = 20; capped = true; }
    if (qty < 1)  qty = 0;
    if (qty > 0) items.push({ name, price, qty });
  });

  if (capped) {
    showToast('⚠ Quantity capped at 20 per item. Please review and save again.');
    return;
  }

  const total = items.reduce((s,i)=>s+((i.price||0)*(i.qty||0)),0);
  try{
    await updateDoc(doc(db,'orders',editingOrderId), { items, total, updatedAt: serverTimestamp() });
    document.getElementById('orderModal').classList.remove('show');
    showToast('Order updated');
  }catch(e){ console.error(e); showToast('Failed to update order'); }
}

window._showReceipt = id => {
  const o = allOrders.find(x=>x.id===id);
  if(!o){ showToast('Order not found'); return; }
  const body = document.getElementById('receiptModalBody');
  const items = (o.items||[]).map(it=>`<div style="display:flex;justify-content:space-between;padding:6px 0;"><div>${escapeHtml(it.name)} × ${it.qty}</div><div>₱${((it.price||0)*(it.qty||0)).toLocaleString('en-PH',{minimumFractionDigits:2})}</div></div>`).join('');
  const ts = o.createdAt?.toDate?o.createdAt.toDate().toLocaleString('en-PH'):'—';
  body.innerHTML = `<div><strong>Order ${'#'+o.id.slice(-5).toUpperCase()}</strong><div style="color:var(--text-muted);font-size:12px">${ts}</div><hr></div>${items}<hr><div style="text-align:right;font-size:16px">Total: <strong>₱${(o.total||0).toLocaleString('en-PH',{minimumFractionDigits:2})}</strong></div>`;
  document.getElementById('receiptModal').classList.add('show');
};

window._toggleTable = async tableNum => {
  const id = String(tableNum);
  const current = tableStatuses[id] && tableStatuses[id].manualStatus;
  const next = current==='occupied' ? 'free' : 'occupied';
  try{
    await setDoc(doc(db,'tables',id), { manualStatus: next, updatedAt: serverTimestamp() }, { merge: true });
    showToast(`Table ${tableNum} set to ${next}`);
    const snap = await getDoc(doc(db,'tables',id)); if(snap.exists()) tableStatuses[id]=snap.data();
    renderTablesGrid();
  }catch(e){ console.error(e); showToast('Failed to update table'); }
};

// Modal controls
document.getElementById('orderModalClose').onclick   = ()=>document.getElementById('orderModal').classList.remove('show');
document.getElementById('orderModalCancel').onclick  = ()=>document.getElementById('orderModal').classList.remove('show');
document.getElementById('orderModalSave').onclick    = saveOrderEdits;
document.getElementById('receiptModalClose').onclick = ()=>document.getElementById('receiptModal').classList.remove('show');
document.getElementById('receiptModalClose2').onclick= ()=>document.getElementById('receiptModal').classList.remove('show');
document.getElementById('receiptPrint').onclick      = ()=>{ window.print(); };

// ── Auto-refresh menu grid every minute ──
setInterval(() => { if (menuItems.length) renderMenuGrid(); }, 60 * 1000);

// ══════════════════════════════════════════════════════
// MONTHLY REPORT
// ══════════════════════════════════════════════════════
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
let mChart = null;

(function initMonthlySelectors() {
  const now = new Date();
  const monthSel = document.getElementById('monthSelect');
  const yearSel  = document.getElementById('yearSelect');
  if (!monthSel || !yearSel) return;

  MONTH_NAMES.forEach((m, i) => {
    const opt = document.createElement('option');
    opt.value = i; opt.textContent = m;
    if (i === now.getMonth()) opt.selected = true;
    monthSel.appendChild(opt);
  });

  for (let y = now.getFullYear(); y >= now.getFullYear() - 2; y--) {
    const opt = document.createElement('option');
    opt.value = y; opt.textContent = y;
    if (y === now.getFullYear()) opt.selected = true;
    yearSel.appendChild(opt);
  }

  monthSel.addEventListener('change', renderMonthlyReport);
  yearSel.addEventListener('change',  renderMonthlyReport);
  setTimeout(renderMonthlyReport, 1500);
})();

function renderMonthlyReport() {
  const monthSel = document.getElementById('monthSelect');
  const yearSel  = document.getElementById('yearSelect');
  if (!monthSel || !yearSel) return;

  const month = parseInt(monthSel.value);
  const year  = parseInt(yearSel.value);

  const monthOrders = allOrders.filter(o => {
    if (!o.createdAt?.toDate) return false;
    const d = o.createdAt.toDate();
    return d.getFullYear() === year && d.getMonth() === month;
  });

  const paidOrders = monthOrders.filter(o => o.status === 'paid');
  const rev        = paidOrders.reduce((s, o) => s + (o.total || 0), 0);
  const avg        = paidOrders.length ? rev / paidOrders.length : 0;
  const uniqueTables = [...new Set(monthOrders.filter(o => o.tableNumber).map(o => o.tableNumber))];
  const cancelledCount = monthOrders.filter(o => o.status === 'cancelled').length;
  const mLabel = `${MONTH_NAMES[month]} ${year}`;

  document.getElementById('mRev').textContent      = `₱${rev.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
  document.getElementById('mRevSub').textContent   = `${paidOrders.length} paid order${paidOrders.length !== 1 ? 's' : ''}`;
  document.getElementById('mOrders').textContent   = monthOrders.length || '0';
  document.getElementById('mOrdersSub').textContent= `${paidOrders.length} paid · ${cancelledCount} cancelled`;
  document.getElementById('mAvg').textContent      = paidOrders.length ? `₱${avg.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '—';
  document.getElementById('mTables').textContent   = uniqueTables.length || '0';
  document.getElementById('mTopItemsMonth').textContent = mLabel;
  document.getElementById('mChartLabel').textContent    = mLabel;

  const itemMap = {};
  monthOrders.forEach(o => (o.items || []).forEach(it => {
    const k = it.name || '?';
    if (!itemMap[k]) itemMap[k] = { name: k, category: it.category || '—', qty: 0, revenue: 0 };
    itemMap[k].qty     += (it.qty || 1);
    itemMap[k].revenue += (it.price || 0) * (it.qty || 1);
  }));
  const topItems = Object.values(itemMap).sort((a, b) => b.qty - a.qty).slice(0, 10);

  document.getElementById('mTopItemsBody').innerHTML = topItems.length
    ? topItems.map((it, i) => `
        <tr>
          <td style="color:var(--text-muted);font-size:11px;">${i + 1}</td>
          <td style="font-weight:600;color:var(--white);">${escapeHtml(it.name)}</td>
          <td><span class="status-badge" style="background:var(--gold-dim);color:var(--gold);font-size:9px;">${escapeHtml(it.category)}</span></td>
          <td>${it.qty}</td>
          <td style="color:var(--gold-light);">₱${it.revenue.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
        </tr>`).join('')
    : '<tr><td colspan="5" class="empty-row">No orders this month.</td></tr>';

  const tableCount = {};
  monthOrders.forEach(o => {
    if (!o.tableNumber) return;
    const n = o.tableNumber;
    if (!tableCount[n]) tableCount[n] = { orders: 0, revenue: 0 };
    tableCount[n].orders++;
    tableCount[n].revenue += (o.total || 0);
  });
  const sortedTables = Object.entries(tableCount).sort((a, b) => b[1].orders - a[1].orders);
  const maxOrders    = sortedTables.length ? sortedTables[0][1].orders : 1;

  document.getElementById('mTableActivity').innerHTML = sortedTables.length
    ? sortedTables.map(([num, data]) => `
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <span style="font-size:12px;font-weight:600;color:var(--white);">Table ${num}</span>
            <span style="font-size:11px;color:var(--text-muted);">${data.orders} order${data.orders !== 1 ? 's' : ''} · ₱${data.revenue.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
          </div>
          <div style="height:7px;background:var(--black-mid);border-radius:100px;overflow:hidden;">
            <div style="height:100%;width:${(data.orders / maxOrders) * 100}%;background:var(--gold);border-radius:100px;transition:width 0.5s cubic-bezier(0.16,1,0.3,1);min-width:3px;"></div>
          </div>
        </div>`).join('')
    : '<div style="color:var(--text-muted);font-size:13px;padding:16px 0;text-align:center;">No table data this month.</div>';

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dailyRev = Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1;
    return paidOrders
      .filter(o => o.createdAt.toDate().getDate() === day)
      .reduce((s, o) => s + (o.total || 0), 0);
  });
  const labels = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const canvas = document.getElementById('mRevenueChart');
  if (!canvas) return;

  if (mChart) { mChart.destroy(); mChart = null; }

  function drawMChart() {
    if (typeof Chart === 'undefined') {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';
      s.onload = drawMChart;
      document.head.appendChild(s);
      return;
    }
    mChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Revenue (₱)',
          data: dailyRev,
          backgroundColor: 'rgba(201,151,58,0.35)',
          borderColor: '#c9973a',
          borderWidth: 1,
          borderRadius: 4,
          borderSkipped: false,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: ctx => `Day ${ctx[0].label}`,
              label: ctx => `₱${ctx.parsed.y.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
            },
            backgroundColor: '#141414', borderColor: '#2a2a2a', borderWidth: 1,
            titleColor: '#f5f0e8', bodyColor: '#c9973a', padding: 10,
          }
        },
        scales: {
          x: {
            ticks: { color: '#5e5e5e', font: { size: 10 }, autoSkip: true, maxTicksLimit: 16 },
            grid: { color: 'rgba(42,42,42,0.5)' },
          },
          y: {
            ticks: { color: '#5e5e5e', font: { size: 10 }, callback: v => v === 0 ? '₱0' : `₱${v.toLocaleString('en-PH')}` },
            grid: { color: 'rgba(42,42,42,0.5)' },
            beginAtZero: true,
          }
        }
      }
    });
  }
  drawMChart();
}

// ── Daily Sales Report ──
function renderDailySalesReport() {
  const container = document.getElementById('dailySalesReport');
  if (!container) return;

  const dayMap = {};
  allOrders.forEach(o => {
    if (!o.createdAt?.toDate) return;
    const d = o.createdAt.toDate();
    const key = d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: '2-digit' });
    if (!dayMap[key]) dayMap[key] = { date: d, label: key, orders: 0, revenue: 0, paid: 0 };
    dayMap[key].orders++;
    if (o.status === 'paid') { dayMap[key].revenue += (o.total || 0); dayMap[key].paid++; }
  });

  const rows = Object.values(dayMap).sort((a, b) => b.date - a.date);

  if (!rows.length) { container.innerHTML = '<div class="empty-state">No sales data yet.</div>'; return; }

  container.innerHTML = `
    <div class="table-wrap" style="max-height:400px;">
      <table class="data-table">
        <thead>
          <tr>
            <th>Date</th><th>Total Orders</th><th>Paid Orders</th><th>Revenue</th><th>Avg. Order Value</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td style="font-weight:600;color:var(--off-white);">${r.label}</td>
              <td>${r.orders}</td>
              <td>${r.paid}</td>
              <td style="color:var(--gold-light);font-weight:600;">₱${r.revenue.toLocaleString('en-PH',{minimumFractionDigits:2})}</td>
              <td>${r.paid ? '₱' + (r.revenue / r.paid).toLocaleString('en-PH',{minimumFractionDigits:2}) : '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// ══════════════════════════════════════════════════════
// SALES CALENDAR
// ══════════════════════════════════════════════════════
let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth();
let calSelectedDay = null;

function buildCalDayMap(year, month) {
  const map = {};
  allOrders.forEach(o => {
    if (!o.createdAt?.toDate) return;
    const d = o.createdAt.toDate();
    if (d.getFullYear() !== year || d.getMonth() !== month) return;
    const day = d.getDate();
    if (!map[day]) map[day] = { orders: [], revenue: 0, paid: 0 };
    map[day].orders.push(o);
    if (o.status === 'paid') { map[day].revenue += (o.total || 0); map[day].paid++; }
  });
  return map;
}

function renderSalesCalendar() {
  const titleEl = document.getElementById('calTitle');
  const grid    = document.getElementById('calGrid');
  if (!titleEl || !grid) return;

  titleEl.textContent = `${MONTH_NAMES[calMonth]} ${calYear}`;
  const dayMap = buildCalDayMap(calYear, calMonth);
  const firstDow = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today = new Date();
  const isThisMonth = today.getFullYear() === calYear && today.getMonth() === calMonth;
  const DOWS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  let html = DOWS.map(d => `<div class="cal-dow-cell">${d}</div>`).join('');
  for (let i = 0; i < firstDow; i++) html += `<div class="cal-day-cell empty"></div>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const data = dayMap[d];
    const isToday  = isThisMonth && today.getDate() === d;
    const isSel    = calSelectedDay === d;
    const hasSales = !!data;
    const cls = ['cal-day-cell', isToday ? 'today' : '', isSel ? 'selected' : '', !hasSales ? 'no-sale' : ''].filter(Boolean).join(' ');
    const revHtml = data ? `<div class="cal-day-rev">₱${data.revenue >= 1000 ? (data.revenue/1000).toFixed(1)+'k' : data.revenue.toLocaleString()}</div>` : '';
    const cntHtml = data ? `<div class="cal-day-cnt">${data.orders.length} orders</div>` : '';
    const onclick = hasSales ? `window._calSelectDay(${d})` : '';
    html += `<div class="${cls}" ${onclick ? `onclick="${onclick}"` : ''}>
      <div class="cal-day-num">${d}</div>${revHtml}${cntHtml}
    </div>`;
  }

  const totalCells = firstDow + daysInMonth;
  const trailing = (7 - totalCells % 7) % 7;
  for (let i = 0; i < trailing; i++) html += `<div class="cal-day-cell empty"></div>`;
  grid.innerHTML = html;

  if (calSelectedDay) renderCalDetail(calSelectedDay, dayMap);
}

window._calSelectDay = d => { calSelectedDay = d; renderSalesCalendar(); };

function renderCalDetail(d, dayMap) {
  const panel = document.getElementById('calDetail');
  if (!panel) return;
  const data = dayMap[d];
  if (!data) { panel.innerHTML = '<div class="empty-state">No sales this day.</div>'; return; }

  const dateLabel = new Date(calYear, calMonth, d).toLocaleDateString('en-PH', { weekday:'long', month:'long', day:'numeric', year:'numeric' });
  const avg = data.paid ? data.revenue / data.paid : 0;
  const sorted = [...data.orders].sort((a, b) => (b.total||0) - (a.total||0));

  panel.innerHTML = `
    <div style="font-size:13px;font-weight:600;color:var(--white);">${dateLabel}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
      <div class="cal-detail-stat"><div class="cal-detail-stat-label">Revenue</div><div class="cal-detail-stat-val" style="color:var(--gold-light);">₱${data.revenue.toLocaleString('en-PH',{minimumFractionDigits:2})}</div></div>
      <div class="cal-detail-stat"><div class="cal-detail-stat-label">Orders</div><div class="cal-detail-stat-val">${data.orders.length}</div></div>
      <div class="cal-detail-stat"><div class="cal-detail-stat-label">Paid</div><div class="cal-detail-stat-val">${data.paid}</div></div>
      <div class="cal-detail-stat"><div class="cal-detail-stat-label">Avg value</div><div class="cal-detail-stat-val">${data.paid ? '₱'+(avg).toLocaleString('en-PH',{minimumFractionDigits:2}) : '—'}</div></div>
    </div>
    <div style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">All orders</div>
    <div style="display:flex;flex-direction:column;gap:6px;max-height:320px;overflow-y:auto;">
      ${sorted.map(o => {
        const ts = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}) : '—';
        return `<div style="background:var(--black-mid);border-radius:8px;padding:9px 12px;display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <div>
            <div class="mono" style="font-size:11px;">#${o.id.slice(-5).toUpperCase()}</div>
            <div style="font-size:11px;color:var(--text-muted);">Table ${o.tableNumber||'?'} · ${o.waiterName||'—'} · ${ts}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:12px;font-weight:600;color:var(--white);">₱${(o.total||0).toLocaleString('en-PH',{minimumFractionDigits:2})}</div>
            <span class="status-badge ${o.status}" style="font-size:9px;">${o.status}</span>
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

document.getElementById('calPrevBtn').onclick = () => {
  calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
  calSelectedDay = null; renderSalesCalendar();
};
document.getElementById('calNextBtn').onclick = () => {
  calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
  calSelectedDay = null; renderSalesCalendar();
};

document.getElementById('removeReserveCancel2').onclick =
document.getElementById('removeReserveCancel').onclick = () => {
  document.getElementById('removeReserveModal').classList.remove('show');
};