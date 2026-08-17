import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, addDoc,
  updateDoc, onSnapshot, query, orderBy, serverTimestamp, where,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { bootstrapAdmin } from './admin-auth.js';

// ── Order status helper (self-contained) ──
// Recognized status values; anything outside this set is bucketed as
// 'unrecognized' so stray statuses surface in the UI instead of being hidden.
const RECOGNIZED_STATUSES = ['pending', 'preparing', 'served_unpaid', 'paid_unserved', 'served_paid', 'completed', 'cancelled'];
const adminGroupOf = o => RECOGNIZED_STATUSES.includes(o?.status) ? o.status : 'unrecognized';

const app = initializeApp({ apiKey:"AIzaSyCKQneulIrm9KWuOg69f29nFo6TGz2PF4w", authDomain:"salo-sa-antipolo.firebaseapp.com", projectId:"salo-sa-antipolo", storageBucket:"salo-sa-antipolo.firebasestorage.app", messagingSenderId:"60032898501", appId:"1:60032898501:web:3a4e663fee4ccd2adae7ac" });
const auth = getAuth(app);
const db   = getFirestore(app);

// ── Constants ──────────────────────────────────────────────────────────────────
const VAT_RATE             = 0.12;
const SERVICE_CHARGE_RATE  = 0.07;
const SENIOR_DISCOUNT_RATE = 0.20;
const PWD_DISCOUNT_RATE    = 0.20;
const RESTAURANT_ADDRESS   = 'Sumulong Highway, Siete Media, Antipolo City, Rizal, Philippines, 1870';

// ── Status model ───────────────────────────────────────────────────────────────
// Preparation progress and payment are independent — an order can be paid before
// or after it's served, and served before or after it's paid. The two combine
// into a single status field:
//
//   pending → preparing → served_unpaid ─┐
//                       ↘ paid_unserved ─┴→ served_paid
//
// pending / preparing may also → cancelled.
const STATUS_ACTIONS = {
  // `pending` is a LEGACY status only. New orders now arrive already as
  // `preparing`, so the "Start Preparing" control is keyed to `pending` and
  // therefore only ever renders on legacy pending cards — never on the normal
  // flow (Req 2.1/2.2/2.3). The preparing → served_unpaid transition is
  // preserved intact (Req 2.4). "Mark as Paid" is removed from admin cards —
  // payment is processed exclusively on the Cashier page.
  pending:       [{ to: 'preparing',     label: 'Start Preparing', btnClass: 'order-btn-primary' }],
  preparing:     [],
  served_unpaid: [],
  paid_unserved: [{ to: 'served_paid',   label: 'Mark as Served', btnClass: 'order-btn-primary' }],
  served_paid:   [],
  cancelled:     [],
};

// Orders can only be cancelled before food prep has committed resources.
const CANCELLABLE_STATUSES = ['pending'];

const STATUS_META = {
  pending:       { label: 'Pending',           color: 'var(--orange)', stripe: 'var(--orange)', accent: 'var(--orange)' },
  preparing:     { label: 'Preparing',         color: 'var(--blue)',   stripe: 'var(--blue)',   accent: 'var(--blue)' },
  served_unpaid: { label: 'Served (Not Paid)', color: 'var(--purple)', stripe: 'var(--purple)', accent: 'var(--purple)' },
  served_paid:   { label: 'Served (Paid)',     color: 'var(--green)',  stripe: 'var(--green)',  accent: 'var(--green)' },
  paid_unserved: { label: 'Paid (Not Served)', color: 'var(--gold)',   stripe: 'var(--gold)',   accent: 'var(--gold)' },
  completed:     { label: 'Completed',         color: '#27ae60',       stripe: '#27ae60',       accent: '#27ae60' },
  cancelled:     { label: 'Cancelled',         color: 'var(--red)',    stripe: 'var(--red)',    accent: 'var(--red)' },
};

// Tabs shown in the filter bar (order matters) - completed excluded (billing only)
const TABS = ['all', 'pending', 'preparing', 'served_unpaid', 'served_paid', 'paid_unserved', 'cancelled'];

// ── Helpers ────────────────────────────────────────────────────────────────────
function escapeHtml(s) { return (s+'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function capitalize(s)  { return s ? s[0].toUpperCase()+s.slice(1) : ''; }

// Mirrors cashier.js's calculateFinancials exactly, so a Senior/PWD discount
// set from either Admin or the Cashier produces the same numbers everywhere.
function calculateFinancials(orderTotal, discountType = 'none') {
  const subtotal = orderTotal;
  let discountAmount = 0;
  let vatExempt = false;

  if (discountType === 'senior') {
    discountAmount = subtotal * SENIOR_DISCOUNT_RATE;
    vatExempt = true;
  } else if (discountType === 'pwd') {
    discountAmount = subtotal * PWD_DISCOUNT_RATE;
    vatExempt = true;
  }

  const afterDiscount = subtotal - discountAmount;

  let vatAmount = 0;
  let netAmount = afterDiscount;
  if (!vatExempt) {
    vatAmount = afterDiscount * VAT_RATE / (1 + VAT_RATE);
    netAmount = afterDiscount - vatAmount;
  }

  const serviceCharge = afterDiscount * SERVICE_CHARGE_RATE;
  const grandTotal    = afterDiscount + serviceCharge;

  return {
    subtotal,
    discountAmount,
    discountRate: (discountType === 'senior' || discountType === 'pwd') ? 0.20 : 0,
    vatExempt,
    netAmount,
    vatAmount,
    serviceCharge,
    grandTotal,
  };
}

function elapsed(date) {
  if (!date) return '';
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${h}h ${m}m ago`;
}

// ── State ──────────────────────────────────────────────────────────────────────
let allOrders   = [];
let activeFilter = 'all';

// ── Toast ──────────────────────────────────────────────────────────────────────
let showToast = m => console.log(m);
const toastEl    = document.getElementById('toast');
const toastMsgEl = document.getElementById('toastMsg');
if (toastEl && toastMsgEl) {
  showToast = (m, type='') => {
    toastMsgEl.textContent = m;
    toastEl.className = 'toast show' + (type ? ' toast-'+type : '');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove('show'), 3200);
  };
}

// ── Confirm Modal ──────────────────────────────────────────────────────────────
function showConfirm({ title, body, confirmLabel, confirmClass = 'gold', onConfirm }) {
  const el = document.getElementById('confirmModal');
  if (!el) { onConfirm(); return; }
  el.querySelector('.confirm-modal-title').textContent  = title;
  el.querySelector('.confirm-modal-message').textContent = body;
  const btn = el.querySelector('#confirmModalOk');
  btn.textContent  = confirmLabel;
  btn.className    = `btn-sm ${confirmClass}`;
  const close = () => el.classList.remove('show');
  btn.onclick = () => { close(); onConfirm(); };
  el.querySelector('#confirmModalCancel').onclick = close;
  el.addEventListener('click', e => { if (e.target === el) close(); }, { once: true });
  el.classList.add('show');
}

// ── Bootstrap then start ───────────────────────────────────────────────────────
bootstrapAdmin(auth, db, { doc, getDoc, signOut }, 'admin-orders.html')
  .then(() => startListeners());

function startListeners() {
  // Show skeleton cards while waiting for first snapshot
  const grid = document.getElementById('ordersGrid');
  if (grid) {
    grid.innerHTML = Array(6).fill(null).map((_,i) =>
      `<div style="border-radius:16px;aspect-ratio:1/1;background:linear-gradient(90deg,var(--black-card) 25%,var(--black-mid) 50%,var(--black-card) 75%);background-size:600px 100%;animation:shimmer 1.4s ${i*0.1}s infinite linear;border:1px solid var(--border);"></div>`
    ).join('');
  }

  onSnapshot(
    query(collection(db, 'orders'), orderBy('createdAt', 'desc')),
    snap => {
      allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderOrders();
      updateOrdersBadge();
    },
    err => {
      console.error('❌ Failed to load orders:', err);
      showToast('Error loading orders: ' + (err.message || 'Unknown error'), 'error');
    }
  );
}

// ── Badge ──────────────────────────────────────────────────────────────────────
function updateOrdersBadge() {
  // Badge shows orders that still need attention (not fully done, not cancelled)
  const active = allOrders.filter(o =>
    o.status === 'pending' || o.status === 'preparing' ||
    o.status === 'served_unpaid' || o.status === 'paid_unserved'
  ).length;
  const badge  = document.getElementById('ordersBadge');
  if (badge) { badge.textContent = active; badge.style.display = active > 0 ? 'inline-flex' : 'none'; }
}

// ── Tab bar (with counts) ──────────────────────────────────────────────────────
function buildTabCounts() {
  // Exclude completed orders from live orders view
  const liveOrders = allOrders.filter(o => o.status !== 'completed');
  const counts = { all: liveOrders.length };
  for (const s of ['pending','preparing','served_unpaid','served_paid','paid_unserved','cancelled']) {
    counts[s] = allOrders.filter(o => o.status === s).length;
  }
  return counts;
}

function refreshTabCounts() {
  const counts = buildTabCounts();
  TABS.forEach(t => {
    const tab = document.querySelector(`.ftab[data-status="${t}"]`);
    if (!tab) return;
    const pill = tab.querySelector('.tab-count');
    const n    = counts[t] || 0;
    if (pill) { pill.textContent = n; pill.style.display = n > 0 ? 'inline-flex' : 'none'; }
  });
}

function switchTab(status) {
  document.querySelectorAll('.ftab[data-status]').forEach(x => x.classList.remove('active'));
  const tab = document.querySelector(`.ftab[data-status="${status}"]`);
  if (tab) tab.classList.add('active');
  activeFilter = status;
  renderOrders();
}

document.querySelectorAll('.ftab[data-status]').forEach(b =>
  b.addEventListener('click', () => switchTab(b.dataset.status))
);

// ── Search ─────────────────────────────────────────────────────────────────────
const orderSearch = document.getElementById('orderSearch');
if (orderSearch) orderSearch.addEventListener('input', renderOrders);

// ── Status update ──────────────────────────────────────────────────────────────
async function updateOrderStatus(id, newStatus) {
  const o = allOrders.find(x => x.id === id);
  if (!o) return;

  // Guard: only allow valid transitions as defined by STATUS_ACTIONS, or a
  // cancellation from a status that's still allowed to be cancelled.
  const allowedNext = (STATUS_ACTIONS[o.status] || []).map(a => a.to);
  const isCancel = newStatus === 'cancelled' && CANCELLABLE_STATUSES.includes(o.status);
  if (!isCancel && !allowedNext.includes(newStatus)) {
    showToast('Invalid status transition', 'error'); return;
  }

  // Payment and serving are tracked independently the first time each happens,
  // regardless of which order they occur in.
  const extra = { updatedAt: serverTimestamp() };
  const becomingPaid   = (newStatus === 'paid_unserved' || newStatus === 'served_paid') && !o.paidAt;
  const becomingServed = (newStatus === 'served_unpaid' || newStatus === 'served_paid') && !o.servedAt;
  if (becomingPaid)   extra.paidAt   = serverTimestamp();
  if (becomingServed) extra.servedAt = serverTimestamp();

  // Once the kitchen marks a re-ordered ticket served again, the "new items"
  // it was carrying have now been cooked & delivered — clear them so the
  // green announcement doesn't linger on an order that's already been handled.
  const clearingNewItems = (newStatus === 'served_unpaid' || newStatus === 'served_paid') && Array.isArray(o.newItems) && o.newItems.length > 0;
  if (clearingNewItems) { extra.newItems = []; }

  await updateDoc(doc(db, 'orders', id), { status: newStatus, ...extra });

  const meta = STATUS_META[newStatus];
  const isPositive = newStatus === 'served_paid' || newStatus === 'served_unpaid' || newStatus === 'paid_unserved';
  showToast(`Order #${id.slice(-5).toUpperCase()} → ${meta?.label || newStatus}`,
    newStatus === 'cancelled' ? 'error' : isPositive ? 'success' : '');

  // Auto-switch to relevant tab for better UX
  if (activeFilter !== 'all') switchTab(newStatus);
}

window._updateStatus = updateOrderStatus;

// ── Cancel order ───────────────────────────────────────────────────────────────
window._cancelOrder = (id) => {
  showConfirm({
    title: 'Cancel Order?',
    body: `Are you sure you want to cancel order #${id.slice(-5).toUpperCase()}? This action cannot be undone.`,
    confirmLabel: 'Yes, Cancel',
    confirmClass: 'danger',
    onConfirm: () => updateOrderStatus(id, 'cancelled')
  });
};

// ── Send to Cashier ────────────────────────────────────────────────────────────
// Stores the order ID in localStorage so the Cashier page can pre-select
// and highlight that order as soon as it loads.
window._sendToCashier = (id) => {
  localStorage.setItem('cashier_preselect_order', id);
  window.open('../cashier.html', '_blank');
};

// ── Discount (Senior / PWD) ──────────────────────────────────────────────────
// Editable any time before payment is recorded; locked afterward so the
// collected amount always matches what was actually charged.
const DISCOUNT_LOCKED_STATUSES = ['paid_unserved', 'served_paid', 'cancelled'];

window._setDiscount = async (id, type) => {
  const o = allOrders.find(x => x.id === id);
  if (!o) return;
  if (DISCOUNT_LOCKED_STATUSES.includes(o.status)) return;
  try {
    await updateDoc(doc(db, 'orders', id), { discountType: type, updatedAt: serverTimestamp() });
  } catch (err) {
    showToast('Failed to update discount', 'error');
  }
};

// ── Toggle items expand ───────────────────────────────────────────────────────
window._toggleItems = function(el) {
  el.classList.toggle('expanded');
};

// ── Render orders ─────────────────────────────────────────────────────────────
function renderOrders() {
  const grid = document.getElementById('ordersGrid');
  if (!grid) return;

  refreshTabCounts();

  // Exclude completed orders from live orders view (they belong in billing)
  let filtered = allOrders.filter(o => o.status !== 'completed');
  if (activeFilter !== 'all') {
    filtered = filtered.filter(o => o.status === activeFilter);
  }

  const q = (orderSearch?.value || '').trim().toLowerCase();
  if (q) {
    filtered = filtered.filter(o =>
      String(o.tableNumber).includes(q) ||
      (o.waiterName || '').toLowerCase().includes(q) ||
      o.id.slice(-5).toLowerCase().includes(q)
    );
  }

  if (!filtered.length) {
    grid.innerHTML = `
      <div class="orders-empty-state">
        <div class="orders-empty-icon"></div>
        <div class="orders-empty-title">No orders found</div>
        <div class="orders-empty-sub">${activeFilter !== 'all' ? `No ${activeFilter} orders right now.` : 'Orders will appear here as they come in.'}</div>
      </div>`;
    return;
  }

  // Group by status for "All" view (exclude completed - billing only)
  if (activeFilter === 'all') {
    const ORDER_OF_STATUS = ['pending', 'preparing', 'served_unpaid', 'served_paid', 'paid_unserved', 'cancelled'];
    let html = '';
    for (const status of ORDER_OF_STATUS) {
      const group = filtered.filter(o => o.status === status);
      if (!group.length) continue;
      const meta = STATUS_META[status];
      html += `
        <div class="orders-section-header">
          <div class="orders-section-icon" style="background:${meta.color}22;">
            <span style="color:${meta.color};font-size:14px;">${statusIcon(status)}</span>
          </div>
          <span class="orders-section-label" style="color:${meta.color};">${meta.label}</span>
          <span class="orders-section-count">${group.length} order${group.length !== 1 ? 's' : ''}</span>
          <div class="orders-section-line" style="background:${meta.color}33;"></div>
        </div>
        ${group.map(o => orderCardHtml(o)).join('')}`;
    }
    html += unrecognizedStatusGroupHtml(filtered);
    grid.innerHTML = html;
  } else {
    grid.innerHTML = filtered.map(o => orderCardHtml(o)).join('');
  }

  // Re-init lucide icons if present
  if (window.lucide) lucide.createIcons();
}

function statusIcon(status) {
  return { pending: '—', preparing: '—', served_unpaid: '—', served_paid: '—', paid_unserved: '—', cancelled: '—' }[status] || '';
}

// Orders written with a status this app doesn't recognize (e.g. from a page
// that's still on an older status vocabulary) fall in here so they're never
// silently invisible in the "All" grouped view (Req 2.2 / 9.2). Grouping uses
// the shared `adminGroupOf` helper so every portal agrees on what counts as
// recognized. Each stray order also emits a diagnostic warning (Req 9.6).
function unrecognizedStatusGroupHtml(filtered) {
  const stray = filtered.filter(o => adminGroupOf(o) === 'unrecognized');
  if (!stray.length) return '';
  for (const o of stray) {
    console.warn(`⚠️ Order #${o.id} has an unrecognized status: "${o.status}" — grouped under "Unrecognized Status".`);
  }
  return `
    <div class="orders-section-header">
      <div class="orders-section-icon" style="background:#88888822;">
        <span style="color:#888;font-size:14px;">—</span>
      </div>
      <span class="orders-section-label" style="color:#888;">Unrecognized Status</span>
      <span class="orders-section-count">${stray.length} order${stray.length !== 1 ? 's' : ''}</span>
      <div class="orders-section-line" style="background:#88888833;"></div>
    </div>
    ${stray.map(o => orderCardHtml(o)).join('')}`;
}

// ── Order Card HTML ────────────────────────────────────────────────────────────
// Rendering modes:
//   'preparing'    — show only "order taken" info (header, meta, items). No
//                    note, no discount, no totals, no Mark as Paid.
//   'served_unpaid'— show totals (no discount row/buttons). No Mark as Paid.
//                    "Send to Cashier" button replaces direct payment action.
//   all others     — full card as before.
function orderCardHtml(o) {
  const meta   = STATUS_META[o.status] || { label: o.status || 'Unknown', color: 'var(--text-muted)', stripe: 'var(--text-muted)', accent: 'var(--text-muted)' };
  const actions = STATUS_ACTIONS[o.status] || [];
  const subtotal = o.total || 0;
  const discountType = o.discountType || 'none';
  const discountLocked = DISCOUNT_LOCKED_STATUSES.includes(o.status);
  const { discountAmount, vatExempt, netAmount, vatAmount, serviceCharge, grandTotal } = calculateFinancials(subtotal, discountType);

  // Per-status display flags
  const isPreparing    = o.status === 'preparing' || o.status === 'pending';
  const isServedUnpaid = o.status === 'served_unpaid';

  const ts = o.createdAt?.toDate
    ? o.createdAt.toDate().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })
    : '—';
  const elapsedStr = o.createdAt?.toDate ? elapsed(o.createdAt.toDate()) : '';

  // New-items indicator: set when a waiter adds more items to an order that
  // was already served (see waiter.js's served_unpaid re-order merge). Those
  // extra items still need to be cooked, but the merged ticket otherwise
  // looks identical to any other order — so we flag it, spell out exactly
  // what's new in a banner, and clear it once the kitchen marks it served
  // again (cleared in updateOrderStatus).
  const newItems = Array.isArray(o.newItems) ? o.newItems : [];
  const hasNewItems = newItems.length > 0 && o.status !== 'served_paid' && o.status !== 'cancelled';
  const newItemIdSet = new Set(newItems.map(i => i.id));

  // e.g. "2× Ice Cream, 1× Halo-Halo" — reads correctly whether an item is
  // brand new to the ticket or just more of something already ordered.
  const newItemsAnnouncement = newItems.map(i => `${i.qty}× ${escapeHtml(i.name)}`).join(', ');

  const items = (o.items || []).map(it => {
    const isNewItem = hasNewItems && newItemIdSet.has(it.id);
    return `
    <div class="order-item-row">
      <div class="order-item-left">
        ${isNewItem ? `<span class="item-new-dot" title="Added in a re-order — needs cooking"></span>` : ''}
        <span class="order-item-qty">${it.qty}×</span>
        <span class="order-item-name">${escapeHtml(it.name)}</span>
      </div>
      <span class="order-item-price">₱${((it.price || 0) * it.qty).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
    </div>`;
  }).join('');

  // Payment / serve timeline
  const paidAt = o.paidAt?.toDate
    ? o.paidAt.toDate().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })
    : null;
  const servedAt = o.servedAt?.toDate
    ? o.servedAt.toDate().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })
    : null;

  // Determine if order is a new receipt / re-order flag
  const isReOrder = o.receiptIndex && o.receiptIndex > 1;

  // Primary action buttons (progress the order — can be more than one, e.g.
  // "preparing" can go straight to Served or straight to Paid)
  let actionButtons = '';
  for (const action of actions) {
    actionButtons += `<button class="${action.btnClass}" onclick="window._updateStatus('${o.id}','${action.to}')">${action.label}</button>`;
  }

  // Secondary row: kitchen slip is always available (except once cancelled); cancel
  // is only offered while the order hasn't started preparing yet.
  // "Send to Cashier" appears on served_unpaid cards (and preparing as a hint)
  // so payment is always handled on the Cashier page.
  let secondaryButtons = '';
  if (o.status !== 'cancelled') {
    const canCancel = CANCELLABLE_STATUSES.includes(o.status);
    secondaryButtons += `<button class="order-btn-secondary${canCancel ? '' : ' full'}" onclick="window._showKitchenSlip('${o.id}')">Kitchen Slip</button>`;
    if (canCancel) {
      secondaryButtons += `<button class="order-btn-danger" onclick="window._cancelOrder('${o.id}')">Cancel</button>`;
    }
  }

  // "Send to Cashier" replaces direct payment for preparing and served_unpaid cards
  const showSendToCashier = (isPreparing || isServedUnpaid) && o.status !== 'cancelled';
  const sendToCashierBtn = showSendToCashier
    ? `<div class="order-actions-primary"><button class="order-btn-send-cashier" onclick="window._sendToCashier('${o.id}')">Send to Cashier</button></div>`
    : '';

  return `
    <div class="order-card-v2" style="--card-accent:${meta.color}; --card-border:${meta.color}33;">
      <div class="order-card-stripe" style="background:${meta.stripe};"></div>
      <div class="order-card-inner">

        <!-- Header -->
        <div class="order-card-header">
          <div class="order-card-id-row">
            <span class="order-card-id">#${o.id.slice(-5).toUpperCase()}</span>
            <span class="status-badge ${o.status}">${meta.label}</span>
            ${hasNewItems ? `<span class="new-order-badge"><span class="new-order-dot"></span>New items</span>` : ''}
            ${isReOrder ? `<span class="order-lock-badge">Re-order #${o.receiptIndex}</span>` : ''}
          </div>
          <div class="order-card-time-col">
            <span class="order-card-time">${ts}</span>
            ${elapsedStr ? `<span class="order-elapsed">${elapsedStr}</span>` : ''}
          </div>
        </div>

        <!-- Table + Waiter -->
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
          ${paidAt ? `
          <div class="order-meta-divider"></div>
          <div class="order-meta-paid-at">
            <span class="order-meta-label">Paid at</span>
            <span class="order-meta-value">${paidAt}</span>
          </div>` : ''}
          ${servedAt ? `
          <div class="order-meta-divider"></div>
          <div class="order-meta-paid-at">
            <span class="order-meta-label">Served at</span>
            <span class="order-meta-value">${servedAt}</span>
          </div>` : ''}
        </div>

        <!-- New-items announcement — spells out exactly what was just added,
             even when it's more of something already on the ticket (e.g. a
             second round of Ice Cream), so the kitchen doesn't have to guess
             from the merged item list below. -->
        ${hasNewItems ? `
        <div class="new-items-banner">
          <span class="new-items-banner-icon">🆕</span>
          <div class="new-items-banner-text"><strong>New:</strong> ${newItemsAnnouncement}</div>
        </div>` : ''}

        <!-- Items -->
        <div class="order-items-list">${items || '<div class="order-item-row order-item-empty">No items</div>'}</div>

        <!-- Note (hidden on preparing cards — not relevant for kitchen) -->
        ${!isPreparing && o.note ? `<div class="order-note">${escapeHtml(o.note)}</div>` : ''}

        <!-- Discount (hidden on preparing and served_unpaid — discount is set at cashier) -->
        ${!isPreparing && !isServedUnpaid && o.status !== 'cancelled' ? `
        <div class="order-discount-row">
          <button class="disc-btn ${discountType === 'none' ? 'active' : ''}" ${discountLocked ? 'disabled' : `onclick="window._setDiscount('${o.id}','none')"`}>None</button>
          <button class="disc-btn ${discountType === 'senior' ? 'active' : ''}" ${discountLocked ? 'disabled' : `onclick="window._setDiscount('${o.id}','senior')"`}>Senior</button>
          <button class="disc-btn ${discountType === 'pwd' ? 'active' : ''}" ${discountLocked ? 'disabled' : `onclick="window._setDiscount('${o.id}','pwd')"`}>PWD</button>
        </div>` : ''}

        <!-- Totals (hidden on preparing cards; no discount row on served_unpaid) -->
        ${isPreparing ? '' : o.status !== 'cancelled' ? `
        <div class="order-totals-section">
          ${!isServedUnpaid && discountAmount > 0 ? `
          <div class="order-totals-row" style="color:var(--green);">
            <span>Discount (${discountType === 'senior' ? 'Senior' : 'PWD'} 20%)</span>
            <span>-₱${discountAmount.toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
          </div>` : ''}
          <div class="order-totals-row">
            <span>VAT-excl.</span>
            <span>₱${netAmount.toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
          </div>
          ${!vatExempt ? `
          <div class="order-totals-row">
            <span>VAT (12%)</span>
            <span>₱${vatAmount.toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
          </div>` : `
          <div class="order-totals-row" style="color:var(--orange);font-style:italic;">
            <span>VAT Exempt</span>
            <span>₱0.00</span>
          </div>`}
          <div class="order-totals-row">
            <span>Service (7%)</span>
            <span>₱${serviceCharge.toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
          </div>
          <div class="order-grand-total">
            <span>GRAND TOTAL</span>
            <span style="color:${meta.color};">₱${grandTotal.toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
          </div>
        </div>` : `
        <div class="order-cancelled-notice">Order cancelled</div>`}

        <!-- Actions -->
        <div class="order-actions">
          ${actionButtons ? `<div class="order-actions-primary">${actionButtons}</div>` : ''}
          ${sendToCashierBtn}
          <div class="order-actions-secondary">${secondaryButtons}</div>
        </div>

      </div>
    </div>`;
}

// ── Kitchen Slip modal body renderer ──────────────────────────────────────────
// Pure render helper — takes an order object, returns an HTML string for the
// kitchen-slip modal body. No monetary values, no calculateFinancials() call.
function kitchenSlipModalBodyHtml(o) {
  const ts = o.createdAt?.toDate
    ? o.createdAt.toDate().toLocaleString('en-PH')
    : '—';

  const newItems   = Array.isArray(o.newItems) ? o.newItems : [];
  const hasNewItems = newItems.length > 0
    && o.status !== 'served_paid'
    && o.status !== 'cancelled';
  const newItemIdSet = new Set(newItems.map(i => i.id));

  // Items list — name ≥ 16px, qty ≥ 14px, dot marker on rows whose id is in newItems, no price
  const itemsHtml = (o.items || []).map(it => {
    const isNew = hasNewItems && newItemIdSet.has(it.id);
    return `
    <div style="display:flex;align-items:baseline;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
      ${isNew ? `<span style="color:var(--green);font-size:14px;flex-shrink:0;" title="New item">•</span>` : ''}
      <span style="font-size:16px;flex:1;min-width:0;word-break:break-word;">${escapeHtml(it.name)}</span>
      <span style="font-size:14px;color:var(--text-muted);flex-shrink:0;">× ${it.qty}</span>
    </div>`;
  }).join('');

  // New-items badge + announcement block — only when applicable
  const newItemsAnnouncementHtml = hasNewItems ? `
    <div style="background:rgba(46,213,115,0.12);border:1px solid rgba(46,213,115,0.35);border-radius:8px;padding:10px 12px;margin-bottom:12px;display:flex;align-items:flex-start;gap:8px;">
      <span class="new-order-badge" style="flex-shrink:0;animation:pulse 1.4s infinite;"><span class="new-order-dot"></span>New items</span>
      <div style="font-size:13px;color:var(--green);">
        ${newItems.map(i => `<div>${escapeHtml(i.name)} × ${i.qty}</div>`).join('')}
      </div>
    </div>` : '';

  // Note block — only when o.note is a non-empty string
  const noteHtml = (typeof o.note === 'string' && o.note.trim())
    ? `<div style="margin-top:12px;padding:10px 12px;background:rgba(255,255,255,0.05);border-left:3px solid var(--gold);border-radius:0 6px 6px 0;">
        <span style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--gold);">Note:</span>
        <span style="font-size:14px;color:var(--text-muted);margin-left:6px;">${escapeHtml(o.note)}</span>
      </div>`
    : '';

  return `
    <div style="margin-bottom:12px;">
      <div style="font-size:15px;font-weight:700;color:var(--white);">Order #${escapeHtml(o.id.slice(-5).toUpperCase())}</div>
      <div style="color:var(--text-muted);font-size:12px;margin-top:3px;">${ts}</div>
      <div style="color:var(--text-muted);font-size:12px;margin-top:6px;">
        Table <strong>${escapeHtml(String(o.tableNumber ?? '—'))}</strong>
        &nbsp;·&nbsp;
        ${escapeHtml(o.waiterName || '—')}
      </div>
    </div>
    <hr style="border:none;border-top:1px solid var(--border);margin:0 0 10px;">
    ${newItemsAnnouncementHtml}
    <div>${itemsHtml || '<div style="color:var(--text-muted);font-size:14px;padding:6px 0;">No items</div>'}</div>
    ${noteHtml}`;
}

// ── Kitchen Slip modal ─────────────────────────────────────────────────────────
// Requirements: 1.1, 1.2, 6.1
window._showKitchenSlip = id => {
  const o = allOrders.find(x => x.id === id); if (!o) { showToast('Order not found'); return; }
  const modal = document.getElementById('kitchenSlipModal');
  const body  = document.getElementById('kitchenSlipModalBody');
  if (!modal || !body) return;
  body.innerHTML = kitchenSlipModalBodyHtml(o);
  body.dataset.orderId = id;
  modal.classList.add('show');
};

// Requirements: 1.5, 3.1
document.getElementById('kitchenSlipModalClose')?.addEventListener('click', () => document.getElementById('kitchenSlipModal')?.classList.remove('show'));
document.getElementById('kitchenSlipModalClose2')?.addEventListener('click', () => document.getElementById('kitchenSlipModal')?.classList.remove('show'));
document.getElementById('kitchenSlipModal')?.addEventListener('click', e => {
  if (e.target === document.getElementById('kitchenSlipModal')) document.getElementById('kitchenSlipModal').classList.remove('show');
});
document.getElementById('kitchenSlipModalPrint')?.addEventListener('click', () => {
  const body = document.getElementById('kitchenSlipModalBody');
  const id   = body?.dataset.orderId;
  const o    = id ? allOrders.find(x => x.id === id) : null;
  if (!o) { showToast('Could not find order for printing'); return; }
  printKitchenSlip(o);
});


// ── Kitchen Slip print HTML ────────────────────────────────────────────────────
// Pure render helper — takes an order object and returns a complete HTML
// document string for the kitchen-slip print pop-up window.
// No monetary values are emitted: no ₱, no VAT, no service charge, no totals.
function kitchenSlipPrintHtml(o) {
  const shortId = escapeHtml(o.id.slice(-5).toUpperCase());

  const ts = o.createdAt?.toDate
    ? o.createdAt.toDate().toLocaleString('en-PH', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
      })
    : '—';

  const tableNum  = escapeHtml(String(o.tableNumber || '—'));
  const waiterName = escapeHtml(o.waiterName || '—');

  const newItemIdSet = new Set((o.newItems || []).map(i => i.id));

  const rows = (o.items || []).map(it => {
    const isNew = newItemIdSet.has(it.id);
    return `
    <tr>
      <td>${isNew ? '<span class="new-label">[NEW]</span> ' : ''}${escapeHtml(it.name)}</td>
      <td class="qty-col">${escapeHtml(String(it.qty))}</td>
    </tr>`;
  }).join('');

  const noteBlock = (o.note || '').trim()
    ? `<div class="note-block"><span class="note-label">Note:</span> ${escapeHtml(o.note)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Kitchen Slip</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: 12px;
      color: #000;
      background: #fff;
      padding: 14mm 8mm;
    }
    h1 {
      font-family: 'Courier New', Courier, monospace;
      font-size: 18px;
      font-weight: 700;
      text-align: center;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #000;
      margin-bottom: 2px;
    }
    .restaurant-name {
      text-align: center;
      font-size: 13px;
      font-weight: 600;
      color: #000;
      margin-bottom: 10px;
    }
    hr.solid  { border: none; border-top: 1.5px solid #000; margin: 7px 0; }
    hr.dashed { border: none; border-top: 1px dashed #555;  margin: 5px 0; }
    .meta-row {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      padding: 2px 0;
      color: #000;
    }
    .meta-label { color: #444; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 6px;
      font-size: 12px;
      color: #000;
    }
    thead th {
      text-align: left;
      font-size: 9px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #000;
      border-bottom: 1px solid #000;
      padding: 3px 0;
    }
    thead th.qty-col { text-align: center; width: 40px; }
    tbody td {
      padding: 5px 0;
      border-bottom: 1px dashed #aaa;
      vertical-align: top;
      color: #000;
    }
    tbody td.qty-col { text-align: center; width: 40px; }
    .new-label {
      font-weight: 700;
      font-size: 10px;
      letter-spacing: 0.04em;
      color: #000;
    }
    .note-block {
      margin-top: 10px;
      padding: 6px 8px;
      border: 1px solid #000;
      font-size: 11px;
      color: #000;
      line-height: 1.5;
    }
    .note-label { font-weight: 700; }
    @media print {
      body { padding: 0; }
    }
  </style>
</head>
<body>
  <h1>KITCHEN SLIP</h1>
  <div class="restaurant-name">Salo sa Antipolo</div>

  <hr class="solid"/>

  <div class="meta-row">
    <span class="meta-label">Order:</span>
    <span><strong>#${shortId}</strong></span>
  </div>
  <div class="meta-row">
    <span class="meta-label">Date:</span>
    <span>${ts}</span>
  </div>
  <div class="meta-row">
    <span class="meta-label">Table:</span>
    <span>${tableNum}</span>
  </div>
  <div class="meta-row">
    <span class="meta-label">Waiter:</span>
    <span>${waiterName}</span>
  </div>

  <hr class="dashed"/>

  <table>
    <thead>
      <tr>
        <th>Item</th>
        <th class="qty-col">Qty</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="2">No items</td></tr>'}
    </tbody>
  </table>

  ${noteBlock}

  <script>window.onload = () => setTimeout(() => window.print(), 400);<\/script>
</body>
</html>`;
}

// ── Print kitchen slip ─────────────────────────────────────────────────────────
// Opens a pop-up window and writes the kitchen-slip print document into it.
// Guards against malformed orders (Req 3.6) and blocked pop-ups (Req 3.5).
function printKitchenSlip(o) {
  // Validation guard — order must have id, tableNumber, and at least one item
  if (!o.id || !o.tableNumber || !(o.items?.length)) {
    showToast('Cannot print: order is missing required fields', 'error');
    return;
  }

  // Pop-up blocked guard
  const pw = window.open('', '_blank', 'width=400,height=600');
  if (!pw) { showToast('Allow pop-ups to print the kitchen slip.'); return; }

  // Success path — generate and write the print document
  pw.document.write(kitchenSlipPrintHtml(o));
  pw.document.close();
}
