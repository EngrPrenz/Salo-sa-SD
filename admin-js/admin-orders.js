import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, addDoc,
  updateDoc, onSnapshot, query, orderBy, serverTimestamp, where,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { bootstrapAdmin } from './admin-auth.js';

const app = initializeApp({ apiKey:"AIzaSyCKQneulIrm9KWuOg69f29nFo6TGz2PF4w", authDomain:"salo-sa-antipolo.firebaseapp.com", projectId:"salo-sa-antipolo", storageBucket:"salo-sa-antipolo.firebasestorage.app", messagingSenderId:"60032898501", appId:"1:60032898501:web:3a4e663fee4ccd2adae7ac" });
const auth = getAuth(app);
const db   = getFirestore(app);

// ── Constants ──────────────────────────────────────────────────────────────────
const VAT_RATE            = 0.12;
const SERVICE_CHARGE_RATE = 0.07;
const RESTAURANT_ADDRESS  = 'Sumulong Highway, Siete Media, Antipolo City, Rizal, Philippines, 1870';

// Status flow definition
// pending → paid → preparing → served
// Any non-served/cancelled can → cancelled
const STATUS_FLOW = {
  pending:    { next: 'paid',      nextLabel: 'Mark as Paid',      btnClass: 'order-btn-pay' },
  paid:       { next: 'preparing', nextLabel: 'Send to Kitchen',   btnClass: 'order-btn-primary' },
  preparing:  { next: 'served',    nextLabel: 'Mark as Served',    btnClass: 'order-btn-primary' },
  served:     { next: null,        nextLabel: null,                 btnClass: null },
  cancelled:  { next: null,        nextLabel: null,                 btnClass: null },
};

const STATUS_META = {
  pending:   { label: 'Pending',   color: 'var(--orange)', stripe: 'var(--orange)', accent: 'var(--orange)' },
  paid:      { label: 'Paid',      color: 'var(--gold)',   stripe: 'var(--gold)',   accent: 'var(--gold)' },
  preparing: { label: 'Preparing', color: 'var(--blue)',   stripe: 'var(--blue)',   accent: 'var(--blue)' },
  served:    { label: 'Served',    color: 'var(--green)',  stripe: 'var(--green)',  accent: 'var(--green)' },
  completed: { label: 'Completed', color: '#27ae60',       stripe: '#27ae60',       accent: '#27ae60' },
  cancelled: { label: 'Cancelled', color: 'var(--red)',    stripe: 'var(--red)',    accent: 'var(--red)' },
};

// Tabs shown in the filter bar (order matters) - completed excluded (billing only)
const TABS = ['all', 'pending', 'paid', 'preparing', 'served', 'cancelled'];

// ── Helpers ────────────────────────────────────────────────────────────────────
function escapeHtml(s) { return (s+'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function capitalize(s)  { return s ? s[0].toUpperCase()+s.slice(1) : ''; }

function computeVat(total) {
  const vatAmount     = total * VAT_RATE / (1 + VAT_RATE);
  const netAmount     = total - vatAmount;
  const serviceCharge = total * SERVICE_CHARGE_RATE;
  const grandTotal    = total + serviceCharge;
  return { netAmount, vatAmount, serviceCharge, grandTotal };
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
  // Badge shows pending + preparing (need attention)
  const active = allOrders.filter(o => o.status === 'pending' || o.status === 'preparing').length;
  const badge  = document.getElementById('ordersBadge');
  if (badge) { badge.textContent = active; badge.style.display = active > 0 ? 'inline-flex' : 'none'; }
}

// ── Tab bar (with counts) ──────────────────────────────────────────────────────
function buildTabCounts() {
  // Exclude completed orders from live orders view
  const liveOrders = allOrders.filter(o => o.status !== 'completed');
  const counts = { all: liveOrders.length };
  for (const s of ['pending','paid','preparing','served','cancelled']) {
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

  // Guard: only allow valid transitions
  const flow = STATUS_FLOW[o.status];
  if (newStatus !== 'cancelled' && flow?.next !== newStatus) {
    showToast('Invalid status transition', 'error'); return;
  }

  await updateDoc(doc(db, 'orders', id), { status: newStatus, updatedAt: serverTimestamp() });

  const meta = STATUS_META[newStatus];
  showToast(`Order #${id.slice(-5).toUpperCase()} → ${meta?.label || newStatus}`,
    newStatus === 'cancelled' ? 'error' : newStatus === 'paid' || newStatus === 'served' ? 'success' : '');

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
    const ORDER_OF_STATUS = ['pending', 'paid', 'preparing', 'served', 'cancelled'];
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
    grid.innerHTML = html;
  } else {
    grid.innerHTML = filtered.map(o => orderCardHtml(o)).join('');
  }

  // Re-init lucide icons if present
  if (window.lucide) lucide.createIcons();
}

function statusIcon(status) {
  return { pending: '—', paid: '—', preparing: '—', served: '—', cancelled: '—' }[status] || '';
}

// ── Order Card HTML ────────────────────────────────────────────────────────────
function orderCardHtml(o) {
  const meta   = STATUS_META[o.status] || STATUS_META.pending;
  const flow   = STATUS_FLOW[o.status];
  const subtotal = o.total || 0;
  const { netAmount, vatAmount, serviceCharge, grandTotal } = computeVat(subtotal);

  const ts = o.createdAt?.toDate
    ? o.createdAt.toDate().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })
    : '—';
  const elapsedStr = o.createdAt?.toDate ? elapsed(o.createdAt.toDate()) : '';

  const items = (o.items || []).map(it => `
    <div class="order-item-row">
      <div class="order-item-left">
        <span class="order-item-qty">${it.qty}×</span>
        <span class="order-item-name">${escapeHtml(it.name)}</span>
      </div>
      <span class="order-item-price">₱${((it.price || 0) * it.qty).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
    </div>`).join('');

  // Payment timeline
  const paidAt = o.paidAt?.toDate
    ? o.paidAt.toDate().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })
    : null;

  // Determine if order is a new receipt / re-order flag
  const isReOrder = o.receiptIndex && o.receiptIndex > 1;

  // Action buttons
  let actionButtons = '';
  if (flow?.next) {
    actionButtons += `<button class="${flow.btnClass}" onclick="window._updateStatus('${o.id}','${flow.next}')">${flow.nextLabel}</button>`;
  }
  // Secondary row
  let secondaryButtons = '';
  if (o.status === 'cancelled') {
    // No buttons for cancelled orders
  } else if (o.status !== 'served' && o.status !== 'paid' && o.status !== 'preparing') {
    secondaryButtons += `<button class="order-btn-secondary" onclick="window._showReceipt('${o.id}')">Receipt</button>`;
    secondaryButtons += `<button class="order-btn-danger" onclick="window._cancelOrder('${o.id}')">Cancel</button>`;
  } else if (o.status === 'paid' || o.status === 'served') {
    secondaryButtons += `<button class="order-btn-secondary full" onclick="window._showReceipt('${o.id}')">View Receipt</button>`;
  }
  // No buttons for preparing

  return `
    <div class="order-card-v2" style="--card-accent:${meta.color}; --card-border:${meta.color}33;">
      <div class="order-card-stripe" style="background:${meta.stripe};"></div>
      <div class="order-card-inner">

        <!-- Header -->
        <div class="order-card-header">
          <div class="order-card-id-row">
            <span class="order-card-id">#${o.id.slice(-5).toUpperCase()}</span>
            <span class="status-badge ${o.status}">${meta.label}</span>
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
        </div>

        <!-- Items -->
        <div class="order-items-list">${items || '<div class="order-item-row order-item-empty">No items</div>'}</div>

        <!-- Note -->
        ${o.note ? `<div class="order-note">${escapeHtml(o.note)}</div>` : ''}

        <!-- Totals -->
        ${o.status === 'pending' || o.status === 'paid' ? `
        <div class="order-totals-section">
          <div class="order-totals-row">
            <span>VAT-excl.</span>
            <span>₱${netAmount.toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
          </div>
          <div class="order-totals-row">
            <span>VAT (12%)</span>
            <span>₱${vatAmount.toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
          </div>
          <div class="order-totals-row">
            <span>Service (7%)</span>
            <span>₱${serviceCharge.toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
          </div>
          <div class="order-grand-total">
            <span>GRAND TOTAL</span>
            <span style="color:${meta.color};">₱${grandTotal.toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
          </div>
        </div>` : o.status === 'cancelled' ? `
        <div class="order-cancelled-notice">Order cancelled</div>` : ''}

        <!-- Actions -->
        <div class="order-actions">
          ${actionButtons ? `<div class="order-actions-primary">${actionButtons}</div>` : ''}
          <div class="order-actions-secondary">${secondaryButtons}</div>
        </div>

      </div>
    </div>`;
}

// ── Mark as Paid: also records paidAt timestamp ────────────────────────────────
// Override to add paidAt field when marking paid
const _origUpdate = updateOrderStatus;
window._updateStatus = async (id, newStatus) => {
  const extra = newStatus === 'paid' ? { paidAt: serverTimestamp() } : {};
  const o = allOrders.find(x => x.id === id);
  if (!o) return;
  const flow = STATUS_FLOW[o.status];
  if (newStatus !== 'cancelled' && flow?.next !== newStatus) {
    showToast('Invalid status transition', 'error'); return;
  }
  await updateDoc(doc(db, 'orders', id), { status: newStatus, updatedAt: serverTimestamp(), ...extra });
  const meta = STATUS_META[newStatus];
  showToast(
    `Order #${id.slice(-5).toUpperCase()} → ${meta?.label || newStatus}`,
    newStatus === 'cancelled' ? 'error' : newStatus === 'paid' || newStatus === 'served' ? 'success' : ''
  );
  if (activeFilter !== 'all') switchTab(newStatus);
};

// ── Receipt modal ──────────────────────────────────────────────────────────────
window._showReceipt = id => {
  const o = allOrders.find(x => x.id===id); if (!o) { showToast('Order not found'); return; }
  const modal = document.getElementById('receiptModal');
  const body  = document.getElementById('receiptModalBody');
  if (!modal||!body) return;

  const { netAmount, vatAmount, serviceCharge, grandTotal } = computeVat(Number(o.total)||0);

  const items = (o.items||[]).map(it => `
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
      <div style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        ${escapeHtml(it.name)} <span style="color:var(--text-muted)">× ${it.qty}</span>
      </div>
      <div style="flex-shrink:0;margin-left:12px;font-weight:600;">
        ₱${((Number(it.price)||0)*(Number(it.qty)||0)).toLocaleString('en-PH',{minimumFractionDigits:2})}
      </div>
    </div>`).join('');

  const ts = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString('en-PH') : '—';

  body.innerHTML = `
    <div style="margin-bottom:12px;">
      <div style="font-size:15px;font-weight:700;color:var(--white)">Order #${o.id.slice(-5).toUpperCase()}</div>
      <div style="color:var(--text-muted);font-size:12px;margin-top:3px;">${ts}</div>
      <div style="color:var(--text-muted);font-size:11px;margin-top:2px;">${escapeHtml(RESTAURANT_ADDRESS)}</div>
      <div style="color:var(--text-muted);font-size:12px;margin-top:6px;">
        Table ${escapeHtml(String(o.tableNumber||'—'))} · ${escapeHtml(o.waiterName||'—')}
      </div>
    </div>
    <hr style="border:none;border-top:1px solid var(--border);margin:0 0 10px;">
    ${items}
    <hr style="border:none;border-top:1px solid var(--border);margin:12px 0 8px;">
    <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);padding:3px 0;">
      <span>VAT-excl. Amount</span><span>₱${netAmount.toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);padding:3px 0;">
      <span>VAT (12%)</span><span>₱${vatAmount.toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);padding:3px 0;">
      <span>Service Charge (7%)</span><span>₱${serviceCharge.toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
    </div>
    <hr style="border:none;border-top:1px solid var(--border);margin:8px 0;">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted)">Total</span>
      <span style="font-size:20px;font-weight:700;color:var(--gold-light);font-family:'Cormorant Garamond',serif;">
        ₱${grandTotal.toLocaleString('en-PH',{minimumFractionDigits:2})}
      </span>
    </div>`;

  body.dataset.orderId = id;
  modal.classList.add('show');
};

document.getElementById('receiptModalClose')?.addEventListener('click',  () => document.getElementById('receiptModal')?.classList.remove('show'));
document.getElementById('receiptModalClose2')?.addEventListener('click', () => document.getElementById('receiptModal')?.classList.remove('show'));
document.getElementById('receiptModal')?.addEventListener('click', e => {
  if (e.target === document.getElementById('receiptModal')) document.getElementById('receiptModal').classList.remove('show');
});

// ── Print receipt ──────────────────────────────────────────────────────────────
document.getElementById('receiptModalPrint')?.addEventListener('click', async () => {
  const body = document.getElementById('receiptModalBody');
  const id   = body?.dataset.orderId;
  const o    = id ? allOrders.find(x => x.id === id) : null;
  if (!o) { showToast('Could not find order for printing'); return; }

  let logo = null;
  try {
    const res  = await fetch('../image/logo.png');
    const blob = await res.blob();
    logo = await new Promise(r => { const rd=new FileReader(); rd.onload=()=>r(rd.result); rd.readAsDataURL(blob); });
  } catch(_) {}

  const { netAmount, vatAmount, serviceCharge, grandTotal } = computeVat(o.total||0);
  const ts = o.createdAt?.toDate
    ? o.createdAt.toDate().toLocaleString('en-PH',{year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:true})
    : '—';

  const rows = (o.items||[]).map(it =>
    `<tr>
      <td>${escapeHtml(it.name)}</td>
      <td style="text-align:center">${it.qty}</td>
      <td style="text-align:right">₱${((it.price||0)*(it.qty||0)).toLocaleString('en-PH',{minimumFractionDigits:2})}</td>
    </tr>`
  ).join('');

  const pw = window.open('','_blank','width=400,height=700');
  if (!pw) { showToast('Allow popups to print.'); return; }

  pw.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>Receipt</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/tabler-icons/2.47.0/iconfont/tabler-icons.min.css"/>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'Courier New',monospace;font-size:11px;color:#111;background:#fff;padding:12mm 6mm;}
    .rh{text-align:center;margin-bottom:10px;}
    .logo{width:52px;height:52px;border-radius:50%;display:block;margin:0 auto 6px;}
    .rn{font-weight:700;font-size:13px;}.ri{font-style:italic;color:#b8821e;}
    .ra{font-size:9px;color:#777;margin-top:3px;line-height:1.5;}
    hr.s{border:none;border-top:1px solid #111;margin:7px 0;}
    hr.d{border:none;border-top:1px dashed #aaa;margin:5px 0;}
    .mr{display:flex;justify-content:space-between;font-size:10px;padding:1px 0;}
    .ml{color:#888;}
    table{width:100%;border-collapse:collapse;font-size:10px;}
    th{text-align:left;font-size:8px;letter-spacing:.06em;text-transform:uppercase;color:#555;border-bottom:1px solid #ddd;padding:3px 0;}
    th:not(:first-child){text-align:right;}
    td{padding:4px 0;}
    tbody tr:last-child td{border-bottom:1px dashed #ccc;}
    .tr{display:flex;justify-content:space-between;font-size:10px;padding:2px 0;}
    .tg{display:flex;justify-content:space-between;font-size:13px;font-weight:700;border-top:1.5px solid #111;margin-top:6px;padding-top:5px;}
    .tg span:last-child{color:#b8821e;}
    .ft{text-align:center;margin-top:14px;font-size:9px;color:#777;line-height:1.8;}
    .social{display:flex;justify-content:center;gap:12px;margin-top:8px;}
    .social i{font-size:14px;color:#999;}
    .handle{text-align:center;font-size:9px;color:#aaa;margin-top:4px;}
    @media print{body{padding:0;}}
  </style></head><body>
  <div class="rh">
    ${logo ? `<img class="logo" src="${logo}" alt=""/>` : ''}
    <div class="rn">Salo sa <span class="ri">Antipolo</span></div>
    <div class="ra">Sumulong Highway, Siete Media,<br>Antipolo City, Rizal, Philippines, 1870</div>
  </div>
  <hr class="s"/>
  <div class="mr"><span class="ml">Order:</span><span style="font-weight:700;color:#b8821e">#${o.id.slice(-5).toUpperCase()}</span></div>
  <div class="mr"><span class="ml">Date:</span><span>${ts}</span></div>
  <div class="mr"><span class="ml">Table:</span><span>${o.tableNumber||'—'}</span></div>
  <div class="mr"><span class="ml">Waiter:</span><span>${escapeHtml(o.waiterName||'—')}</span></div>
  <hr class="d"/>
  <table>
    <thead><tr><th>Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div style="margin-top:6px;">
    <div class="tr"><span>VAT-Excl.</span><span>₱${netAmount.toLocaleString('en-PH',{minimumFractionDigits:2})}</span></div>
    <div class="tr"><span>VAT (12%)</span><span>₱${vatAmount.toLocaleString('en-PH',{minimumFractionDigits:2})}</span></div>
    <div class="tr"><span>Service Charge (7%)</span><span>₱${serviceCharge.toLocaleString('en-PH',{minimumFractionDigits:2})}</span></div>
    <div class="tg"><span>TOTAL</span><span>₱${grandTotal.toLocaleString('en-PH',{minimumFractionDigits:2})}</span></div>
  </div>
  <hr class="d" style="margin-top:12px;"/>
  <div class="ft"><strong>Thank you for dining with us!</strong><br>Please come again 😊</div>
  <div class="social">
    <i class="ti ti-brand-instagram"></i><i class="ti ti-brand-tiktok"></i><i class="ti ti-brand-facebook"></i><i class="ti ti-phone"></i><i class="ti ti-mail"></i>
  </div>
  <div class="handle">@salosaantipolo</div>
  <script>window.onload=()=>setTimeout(()=>window.print(),400);<\/script>
  </body></html>`);
  pw.document.close();
});