import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, addDoc, updateDoc, writeBatch,
  onSnapshot, query, orderBy, where, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { guardCashierPage } from './admin-js/rbac.js';

// ── Order status helpers (self-contained; mirrors waiter.js / admin-orders.js) ──
// Preparation and payment are independent axes combined into one `status` field:
//   pending(legacy)/preparing → served_unpaid / paid_unserved → served_paid, or cancelled.
const PAID_STATUSES   = ['paid_unserved', 'served_paid', 'completed'];
const SERVED_STATUSES = ['served_unpaid', 'served_paid'];
const isPaid      = o => PAID_STATUSES.includes(o?.status);
const isServed    = o => SERVED_STATUSES.includes(o?.status) || !!o?.servedAt;
const isCancelled = o => o?.status === 'cancelled';
const isUnpaid    = o => !isPaid(o) && !isCancelled(o);
// The cashier queue/badge shows every unpaid, non-cancelled order.
const belongsInCashierQueue = o => isUnpaid(o);
// Payment may only be finalized while an order is still unpaid.
const canFinalizePayment = o => isUnpaid(o);
// A paid order that has not been handed to the customer stays paid_unserved.
// This includes takeout, which the waiter completes on handoff.
const nextStatusAfterPayment = o =>
  isServed(o) ? 'served_paid'
    : 'paid_unserved';

// Firebase config
const app = initializeApp({
  apiKey: "AIzaSyCKQneulIrm9KWuOg69f29nFo6TGz2PF4w",
  authDomain: "salo-sa-antipolo.firebaseapp.com",
  projectId: "salo-sa-antipolo",
  storageBucket: "salo-sa-antipolo.firebasestorage.app",
  messagingSenderId: "60032898501",
  appId: "1:60032898501:web:3a4e663fee4ccd2adae7ac"
});

const auth = getAuth(app);
const db = getFirestore(app);
const fb = { doc, getDoc, updateDoc, addDoc, collection, query, where, orderBy, serverTimestamp, Timestamp };

// Financial constants
const VAT_RATE = 0.12;
const SERVICE_CHARGE_RATE = 0.07;
const SENIOR_DISCOUNT_RATE = 0.20;
const PWD_DISCOUNT_RATE = 0.20;

// State
let cashierData = null;
let allOrders = [];
let selectedGroup = null;  // replaces selectedOrder; holds a Group object (see groupOrdersByTable)
let paymentMethod = null;
let discountType = 'none'; // 'none', 'senior', 'pwd'
let cashTendered = 0;

// DOM helpers
const $ = id => document.getElementById(id);
const showToast = msg => {
  $('toastMsg').textContent = msg;
  $('toast').classList.add('show');
  setTimeout(() => $('toast').classList.remove('show'), 3000);
};

// An order is Takeout if the waiter app tagged it orderType: 'takeout', or
// (as a fallback for older records) it simply has no table number.
const isTakeout = order => order.orderType === 'takeout' || !order.tableNumber;

// Plain-text label used in printouts (order slip, receipt) where markup
// doesn't apply.
const orderLocationLabel = order => isTakeout(order) ? 'Takeout' : `Table ${order.tableNumber}`;

// Inner content only (icon + text, no pill wrapper) — use this when the
// parent element already provides the pill/oval styling itself, e.g. the
// order-card's own ".order-card-table.takeout" container.
const orderLocationInnerHtml = order => isTakeout(order)
  ? '<i class="fa-solid fa-bag-shopping"></i> Takeout'
  : `Table ${order.tableNumber}`;

// Self-contained pill badge (adds its own oval styling) — use this when the
// parent element (e.g. a plain detail-info-value or table cell) has no pill
// styling of its own, so only one oval ever gets drawn.
const orderLocationBadgeHtml = order => isTakeout(order)
  ? '<span class="takeout-pill"><i class="fa-solid fa-bag-shopping"></i> Takeout</span>'
  : `Table ${order.tableNumber}`;

// ══════════════════════════════════════════════════════════════
// AUTH & INITIALIZATION
// ══════════════════════════════════════════════════════════════

guardCashierPage(auth, db, fb, 'cashier.html').then(user => {
  cashierData = user;
  $('userName').textContent = user.name;
  $('userAvatar').textContent = user.name[0].toUpperCase();
  init();
});

$('logoutBtn').onclick = async () => {
  await signOut(auth);
  window.location.href = 'cashier-login.html';
};

// Theme toggle
$('themeToggle').onclick = () => {
  const current = document.documentElement.getAttribute('data-theme');
  document.documentElement.setAttribute('data-theme', current === 'light' ? 'dark' : 'light');
  localStorage.setItem('theme', current === 'light' ? 'dark' : 'light');
};

// Load saved theme
const savedTheme = localStorage.getItem('theme');
if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

// Update current date/time
function updateDateTime() {
  const now = new Date();
  $('currentDateTime').textContent = now.toLocaleString('en-PH', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
updateDateTime();
setInterval(updateDateTime, 60000);

// ══════════════════════════════════════════════════════════════
// INITIALIZATION
// ══════════════════════════════════════════════════════════════

function init() {
  setupNavigation();
  subscribeToOrders();
  
  // Setup detail panel close button with event delegation
  document.addEventListener('click', (e) => {
    // Check if clicked element or its parent is the close button
    const closeBtn = e.target.closest('#detailClose');
    if (closeBtn) {
      console.log('Close button clicked!');
      // Reset to empty state instead of closing
      selectedGroup = null;
      discountType = 'none';
      paymentMethod = null;
      cashTendered = 0;
      
      // Show empty state in detail panel
      $('detailBody').innerHTML = `
        <div class="empty-detail">
          <div class="empty-detail-icon"><i class="fa-solid fa-hand-pointer"></i></div>
          <div class="empty-detail-text">Select an order to view details and process payment</div>
        </div>
      `;
      
      renderOrders(); // Re-render to remove selected state
    }
  });
}

// ══════════════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════════════

function setupNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const viewName = item.dataset.view;
      switchView(viewName);
    });
  });
}

function switchView(viewName) {
  // Update nav active state
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === viewName);
  });

  // Hide all views
  document.querySelectorAll('.view').forEach(view => {
    view.classList.remove('active');
  });

  // Show selected view
  const targetView = $(`${viewName}View`);
  if (targetView) targetView.classList.add('active');

  // Load view-specific data
  if (viewName === 'orders') renderOrders();
  if (viewName === 'billing') renderBilling();
}

// ══════════════════════════════════════════════════════════════
// FINANCIAL CALCULATIONS
// ══════════════════════════════════════════════════════════════

function calculateFinancials(orderTotal, discount = { type: 'none' }) {
  let subtotal = orderTotal;
  let discountAmount = 0;
  let vatExempt = false;

  // Apply discount
  if (discount.type === 'senior') {
    discountAmount = subtotal * SENIOR_DISCOUNT_RATE;
    vatExempt = true;
  } else if (discount.type === 'pwd') {
    discountAmount = subtotal * PWD_DISCOUNT_RATE;
    vatExempt = true;
  }

  const afterDiscount = subtotal - discountAmount;

  // Calculate VAT
  let vatAmount = 0;
  let netAmount = afterDiscount;
  
  if (!vatExempt) {
    // VAT is already included in the price, extract it
    vatAmount = afterDiscount * VAT_RATE / (1 + VAT_RATE);
    netAmount = afterDiscount - vatAmount;
  }

  // Calculate service charge (applied to after-discount amount)
  const serviceCharge = afterDiscount * SERVICE_CHARGE_RATE;

  // Grand total
  const grandTotal = afterDiscount + serviceCharge;

  return {
    subtotal,
    discountAmount,
    discountRate: discount.type === 'senior' || discount.type === 'pwd' ? 0.20 : 0,
    vatExempt,
    netAmount,
    vatAmount,
    serviceCharge,
    grandTotal
  };
}

// ══════════════════════════════════════════════════════════════
// ORDER GROUPING
// ══════════════════════════════════════════════════════════════

/**
 * Groups unpaid dine-in orders by tableNumber into Group objects.
 * Takeout orders are never merged — each becomes its own solo group.
 *
 * Group shape:
 *   { key, tableNumber, isTakeout, orders[], combinedTotal,
 *     combinedItems[], earliestCreatedAt, highestValueSlip }
 *
 * @param {Object[]} orders - Unpaid, non-cancelled orders
 * @returns {Object[]} Array of Group objects sorted by earliestCreatedAt asc
 */
function groupOrdersByTable(orders) {
  const toMs = ts => ts?.toDate ? ts.toDate().getTime() : (ts ? new Date(ts).getTime() : 0);

  const map = new Map();
  for (const order of orders) {
    const key = isTakeout(order) ? order.id : String(order.tableNumber);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(order);
  }

  const groups = [];
  for (const [key, slips] of map.entries()) {
    // Sort slips by createdAt ascending (earliest first)
    slips.sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt));

    const combinedTotal = slips.reduce((sum, s) => sum + (s.total || 0), 0);
    const combinedItems = slips.flatMap(s => s.items || []);
    const earliestCreatedAt = slips[0].createdAt;

    // highestValueSlip: max total, ties broken by earliest createdAt (slips already sorted asc)
    const highestValueSlip = slips.reduce((best, s) => {
      if ((s.total || 0) > (best.total || 0)) return s;
      return best;
    }, slips[0]);

    groups.push({
      key,
      tableNumber: isTakeout(slips[0]) ? null : slips[0].tableNumber,
      isTakeout: isTakeout(slips[0]),
      orders: slips,
      combinedTotal,
      combinedItems,
      earliestCreatedAt,
      highestValueSlip
    });
  }

  // Sort groups by earliest slip's createdAt ascending
  groups.sort((a, b) => toMs(a.earliestCreatedAt) - toMs(b.earliestCreatedAt));
  return groups;
}

/**
 * Computes financials for a group using the grouped discount rule:
 *   - 'none'  → delegates directly to calculateFinancials(combinedTotal)
 *   - 'senior'/'pwd' → discount applies only to highestValueSlip.total (20%);
 *                      VAT exemption applies to the entire combinedTotal.
 *
 * @param {Object} group - Group object from groupOrdersByTable
 * @param {'none'|'senior'|'pwd'} discountType
 * @returns {Object} Same shape as calculateFinancials()
 */
function calculateGroupFinancials(group, discountType) {
  if (discountType === 'none' || !group.highestValueSlip || group.highestValueSlip.total === 0) {
    return calculateFinancials(group.combinedTotal, { type: discountType });
  }

  // Discount on the highest-value slip only; VAT exempt on the full combined total
  const discountBase = group.highestValueSlip.total;
  const discountAmount = discountBase * 0.20;
  const afterDiscount = group.combinedTotal - discountAmount;
  const serviceCharge = afterDiscount * SERVICE_CHARGE_RATE;
  const grandTotal = afterDiscount + serviceCharge;

  return {
    subtotal: group.combinedTotal,
    discountAmount,
    discountRate: 0.20,
    vatExempt: true,
    netAmount: afterDiscount,
    vatAmount: 0,
    serviceCharge,
    grandTotal
  };
}

// ══════════════════════════════════════════════════════════════
// ORDERS SUBSCRIPTION
// ══════════════════════════════════════════════════════════════

function subscribeToOrders() {
  let firstLoad = true;
  onSnapshot(
    query(collection(db, 'orders'), orderBy('createdAt', 'desc')),
    snapshot => {
      allOrders = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      renderOrders();
      updateOrdersBadge();

      // On the first snapshot, check if the admin "Send to Cashier" button
      // left a pre-selection request in localStorage. If so, resolve the slip
      // ID to its table group and select that group automatically, then clear.
      if (firstLoad) {
        firstLoad = false;
        const preselectId = localStorage.getItem('cashier_preselect_order');
        localStorage.removeItem('cashier_preselect_order'); // always clear immediately
        if (preselectId) {
          const queueOrders = allOrders.filter(belongsInCashierQueue);
          const groups = groupOrdersByTable(queueOrders);
          const targetGroup = groups.find(g => g.orders.some(o => o.id === preselectId));
          if (targetGroup) {
            window.selectGroup(targetGroup.key);
            // Scroll the grouped card into view after a brief paint delay
            setTimeout(() => {
              const card = document.querySelector(`.order-card[data-group-key="${targetGroup.key}"]`);
              if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 150);
          }
        }
      }
    }
  );
}

function updateOrdersBadge() {
  const queueOrders = allOrders.filter(belongsInCashierQueue);
  const groups = groupOrdersByTable(queueOrders);
  $('ordersCountBadge').textContent = groups.length;
}

// ══════════════════════════════════════════════════════════════
// ORDERS VIEW
// ══════════════════════════════════════════════════════════════

function renderOrders() {
  const searchTerm = $('orderSearch').value.toLowerCase().trim();
  
  const queueOrders = allOrders.filter(belongsInCashierQueue);
  let groups = groupOrdersByTable(queueOrders);

  // Apply search filter against each group
  if (searchTerm) {
    groups = groups.filter(g => {
      if (g.isTakeout) {
        // Takeout: match 'takeout', the order ID, or any slip's waiterName
        return 'takeout'.includes(searchTerm) ||
          g.key.toLowerCase().includes(searchTerm) ||
          g.orders.some(o => (o.waiterName || '').toLowerCase().includes(searchTerm));
      }
      // Dine-in: match tableNumber or any slip's waiterName
      return String(g.tableNumber).includes(searchTerm) ||
        g.orders.some(o => (o.waiterName || '').toLowerCase().includes(searchTerm));
    });
  }

  const container = $('ordersList');

  if (groups.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon"><i class="fa-solid fa-receipt"></i></div>
        <div class="empty-title">No pending orders</div>
        <div class="empty-text">Unpaid orders from waiters will appear here</div>
      </div>
    `;
    return;
  }

  container.innerHTML = groups.map(group => {
    const totalItemCount = group.combinedItems.length;
    const slipCount = group.orders.length;
    const timestamp = group.earliestCreatedAt?.toDate
      ? formatTimeAgo(group.earliestCreatedAt.toDate())
      : 'Unknown';
    const isSelected = selectedGroup && selectedGroup.key === group.key;
    const preview = calculateGroupFinancials(group, 'none');

    // Display ID: earliest slip's last 6 chars
    const displayId = group.orders[0].id.slice(-6).toUpperCase();

    return `
      <div class="order-card ${isSelected ? 'selected' : ''}" data-group-key="${group.key}" onclick="selectGroup('${group.key}')">
        <div class="order-card-header">
          <div class="order-card-id">#${displayId}${slipCount > 1 ? `<span class="slip-count-badge">+${slipCount - 1}</span>` : ''}</div>
          <div class="order-card-table ${group.isTakeout ? 'takeout' : ''}">${group.isTakeout ? '<i class="fa-solid fa-bag-shopping"></i> Takeout' : `Table ${group.tableNumber}`}</div>
        </div>
        <div class="order-card-body">
          <div class="order-card-total">₱${group.combinedTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
          <div class="order-card-total-note">≈ ₱${preview.grandTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })} incl. 12% VAT + 7% SC</div>
          <div class="order-card-items">${totalItemCount} item${totalItemCount !== 1 ? 's' : ''}${slipCount > 1 ? ` · ${slipCount} slips` : ''}</div>
        </div>
        <div class="order-card-footer">
          <div class="order-card-time">
            <i class="fa-solid fa-clock"></i>
            ${timestamp}
          </div>
          <div class="order-card-status">Pending Payment</div>
        </div>
      </div>
    `;
  }).join('');
}

// Search functionality
$('orderSearch').addEventListener('input', renderOrders);

function formatTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

// ══════════════════════════════════════════════════════════════
// ORDER DETAIL PANEL
// ══════════════════════════════════════════════════════════════

window.selectGroup = function(groupKey) {
  const queueOrders = allOrders.filter(belongsInCashierQueue);
  const groups = groupOrdersByTable(queueOrders);
  const group = groups.find(g => g.key === groupKey);
  if (!group) return;

  selectedGroup = group;
  discountType = 'none';
  paymentMethod = 'Cash';
  cashTendered = 0;

  renderOrderDetail(group);
  renderOrders(); // Re-render to show selected state
  
  // Show detail panel
  $('detailPanel').classList.add('active');
};

function renderOrderDetail(group) {
  const financials = calculateGroupFinancials(group, discountType);
  
  const itemsHtml = group.combinedItems.map(item => `
    <div class="detail-item">
      <div class="detail-item-info">
        <div class="detail-item-name">${escapeHtml(item.name)}</div>
        <div class="detail-item-qty">× ${item.qty}</div>
      </div>
      <div class="detail-item-price">₱${((item.price || 0) * (item.qty || 0)).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
    </div>
  `).join('');

  // Slip IDs row — shown only when there are multiple slips
  const slipIdsHtml = group.orders.length > 1
    ? `<div class="detail-info-item">
          <div class="detail-info-label">Slip IDs</div>
          <div class="detail-info-value" style="font-size:0.82rem;letter-spacing:0.03em">${group.orders.map(o => '#' + o.id.slice(-6).toUpperCase()).join(', ')}</div>
        </div>`
    : '';

  // Use the first (earliest) slip for waiter name; if slips have different waiters show them all
  const waiterNames = [...new Set(group.orders.map(o => o.waiterName).filter(Boolean))];
  const waiterDisplay = waiterNames.length ? waiterNames.join(', ') : '—';

  const earliestSlip = group.orders[0];

  $('detailBody').innerHTML = `
    <div class="detail-section">
      <div class="detail-section-title">Order Information</div>
      <div class="detail-info-grid">
        <div class="detail-info-item">
          <div class="detail-info-label">Order ID</div>
          <div class="detail-info-value">#${earliestSlip.id.slice(-6).toUpperCase()}${group.orders.length > 1 ? ` <span style="font-size:0.8rem;opacity:0.6">+${group.orders.length - 1} more</span>` : ''}</div>
        </div>
        <div class="detail-info-item">
          <div class="detail-info-label">Table</div>
          <div class="detail-info-value">${group.isTakeout ? '<span class="takeout-pill"><i class="fa-solid fa-bag-shopping"></i> Takeout</span>' : `Table ${group.tableNumber}`}</div>
        </div>
        <div class="detail-info-item">
          <div class="detail-info-label">Waiter</div>
          <div class="detail-info-value">${escapeHtml(waiterDisplay)}</div>
        </div>
        <div class="detail-info-item">
          <div class="detail-info-label">Time</div>
          <div class="detail-info-value">${earliestSlip.createdAt?.toDate ? earliestSlip.createdAt.toDate().toLocaleString('en-PH', { timeStyle: 'short' }) : '—'}</div>
        </div>
        ${slipIdsHtml}
      </div>
      ${group.orders.some(o => o.note) ? `<div class="detail-note"><strong>Note:</strong> ${group.orders.filter(o => o.note).map(o => escapeHtml(o.note)).join(' | ')}</div>` : ''}
      <div class="slip-btn-row">
        <button class="btn-slip" onclick="printGroupReceiptPreview('${group.key}')">
          <i class="fa-solid fa-receipt"></i>
          Print Receipt
        </button>
        <button class="btn-slip btn-slip-kitchen" onclick="printOrderSlip('${group.key}')">
          <i class="fa-solid fa-kitchen-set"></i>
          Kitchen Slip
        </button>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Order Items${group.orders.length > 1 ? ` <span style="font-weight:400;font-size:0.85rem;opacity:0.65">(${group.orders.length} slips combined)</span>` : ''}</div>
      ${itemsHtml}
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Discount</div>
      <div class="discount-options">
        <button class="discount-btn ${discountType === 'none' ? 'active' : ''}" onclick="setDiscount('none')">
          <i class="fa-solid fa-ban"></i>
          <span>No Discount</span>
        </button>
        <button class="discount-btn ${discountType === 'senior' ? 'active' : ''}" onclick="setDiscount('senior')">
          <i class="fa-solid fa-person-cane"></i>
          <span>Senior Citizen<br><small>20% + VAT Exempt</small></span>
        </button>
        <button class="discount-btn ${discountType === 'pwd' ? 'active' : ''}" onclick="setDiscount('pwd')">
          <i class="fa-solid fa-wheelchair"></i>
          <span>PWD<br><small>20% + VAT Exempt</small></span>
        </button>
      </div>
      ${discountType !== 'none' ? `<div style="font-size:0.8rem;opacity:0.7;margin-top:6px;padding:0 4px">Discount applies to highest-value slip (₱${(group.highestValueSlip.total || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}); VAT exemption on full combined total.</div>` : ''}
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Financial Breakdown</div>
      <div class="financial-breakdown">
        <div class="financial-row">
          <span>Combined Total</span>
          <span>₱${financials.subtotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
        </div>
        ${financials.discountAmount > 0 ? `
          <div class="financial-row discount">
            <span>Discount (${(financials.discountRate * 100).toFixed(0)}%)</span>
            <span>-₱${financials.discountAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
          </div>
        ` : ''}
        ${!financials.vatExempt ? `
          <div class="financial-row">
            <span>VAT (12%)</span>
            <span>₱${financials.vatAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
          </div>
        ` : `
          <div class="financial-row vat-exempt">
            <span>VAT Exempt</span>
            <span>₱0.00</span>
          </div>
        `}
        <div class="financial-row">
          <span>Service Charge (7%)</span>
          <span>₱${financials.serviceCharge.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
        </div>
        <div class="financial-row total">
          <span>Grand Total</span>
          <span>₱${financials.grandTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
        </div>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Payment Method</div>
      <div class="payment-method-display">
        <div class="payment-method-badge">
          <i class="fa-solid fa-money-bill-wave"></i>
          <span>Cash Payment Only</span>
        </div>
      </div>
      
      <div class="cash-input-section">
        <div class="cash-input-group">
          <label class="cash-input-label">Amount Tendered</label>
          <div class="cash-input-wrap">
            <span class="cash-input-currency">₱</span>
            <input 
              type="number" 
              class="cash-input" 
              id="cashTenderedInput" 
              placeholder="0.00" 
              step="0.01"
              min="${financials.grandTotal}"
              value="${cashTendered || ''}"
              oninput="updateCashTendered(this.value)"
            />
          </div>
          <div class="cash-quick-amounts">
            <button class="cash-quick-btn" onclick="setQuickCash(${Math.ceil(financials.grandTotal / 100) * 100})">₱${Math.ceil(financials.grandTotal / 100) * 100}</button>
            <button class="cash-quick-btn" onclick="setQuickCash(${Math.ceil(financials.grandTotal / 500) * 500})">₱${Math.ceil(financials.grandTotal / 500) * 500}</button>
            <button class="cash-quick-btn" onclick="setQuickCash(${Math.ceil(financials.grandTotal / 1000) * 1000})">₱${Math.ceil(financials.grandTotal / 1000) * 1000}</button>
          </div>
        </div>
        
        ${cashTendered >= financials.grandTotal ? `
          <div class="cash-change-display">
            <div class="cash-change-label">Change</div>
            <div class="cash-change-amount">₱${(cashTendered - financials.grandTotal).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
          </div>
        ` : cashTendered > 0 ? `
          <div class="cash-change-display insufficient">
            <div class="cash-change-label">
              <i class="fa-solid fa-triangle-exclamation"></i>
              Insufficient Amount
            </div>
            <div class="cash-change-amount">₱${(financials.grandTotal - cashTendered).toLocaleString('en-PH', { minimumFractionDigits: 2 })} short</div>
          </div>
        ` : ''}
      </div>
    </div>

    <button class="btn-primary btn-process-payment" onclick="processPayment()" ${!cashTendered || cashTendered < financials.grandTotal ? 'disabled' : ''}>
      <i class="fa-solid fa-check"></i>
      Process Payment - ₱${financials.grandTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
    </button>
  `;
}

window.setDiscount = function(type) {
  discountType = type;
  if (selectedGroup) renderOrderDetail(selectedGroup);
};

window.updateCashTendered = function(value) {
  cashTendered = parseFloat(value) || 0;
  
  // Update only the change display without re-rendering entire detail panel
  const financials = calculateGroupFinancials(selectedGroup, discountType);
  const changeDisplay = document.querySelector('.cash-change-display');
  const processBtn = document.querySelector('.btn-process-payment');
  
  if (cashTendered >= financials.grandTotal) {
    const change = cashTendered - financials.grandTotal;
    if (changeDisplay) {
      changeDisplay.className = 'cash-change-display';
      changeDisplay.innerHTML = `
        <div class="cash-change-label">Change</div>
        <div class="cash-change-amount">₱${change.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
      `;
    } else {
      // Create change display if it doesn't exist
      const cashInputSection = document.querySelector('.cash-input-section');
      const newChangeDisplay = document.createElement('div');
      newChangeDisplay.className = 'cash-change-display';
      newChangeDisplay.innerHTML = `
        <div class="cash-change-label">Change</div>
        <div class="cash-change-amount">₱${change.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
      `;
      cashInputSection.appendChild(newChangeDisplay);
    }
    // Enable button
    if (processBtn) {
      processBtn.disabled = false;
      processBtn.style.opacity = '1';
      processBtn.style.cursor = 'pointer';
    }
  } else if (cashTendered > 0) {
    const short = financials.grandTotal - cashTendered;
    if (changeDisplay) {
      changeDisplay.className = 'cash-change-display insufficient';
      changeDisplay.innerHTML = `
        <div class="cash-change-label">
          <i class="fa-solid fa-triangle-exclamation"></i>
          Insufficient Amount
        </div>
        <div class="cash-change-amount">₱${short.toLocaleString('en-PH', { minimumFractionDigits: 2 })} short</div>
      `;
    } else {
      // Create insufficient display
      const cashInputSection = document.querySelector('.cash-input-section');
      const newChangeDisplay = document.createElement('div');
      newChangeDisplay.className = 'cash-change-display insufficient';
      newChangeDisplay.innerHTML = `
        <div class="cash-change-label">
          <i class="fa-solid fa-triangle-exclamation"></i>
          Insufficient Amount
        </div>
        <div class="cash-change-amount">₱${short.toLocaleString('en-PH', { minimumFractionDigits: 2 })} short</div>
      `;
      cashInputSection.appendChild(newChangeDisplay);
    }
    // Disable button
    if (processBtn) {
      processBtn.disabled = true;
      processBtn.style.opacity = '0.45';
      processBtn.style.cursor = 'not-allowed';
    }
  } else {
    // Remove change display if amount is 0
    if (changeDisplay) {
      changeDisplay.remove();
    }
    // Disable button
    if (processBtn) {
      processBtn.disabled = true;
      processBtn.style.opacity = '0.45';
      processBtn.style.cursor = 'not-allowed';
    }
  }
};

window.setQuickCash = function(amount) {
  cashTendered = amount;
  
  // Update input field value
  const input = document.getElementById('cashTenderedInput');
  if (input) {
    input.value = amount;
  }
  
  // Update change display
  updateCashTendered(amount);
};

// ══════════════════════════════════════════════════════════════
// PAYMENT PROCESSING
// ══════════════════════════════════════════════════════════════

window.processPayment = async function() {
  if (!selectedGroup || selectedGroup.orders.length === 0) {
    showToast('⚠ No order selected');
    return;
  }

  // Guard against stale selections — re-check every slip in the group against
  // the live allOrders snapshot. If any slip is already paid or cancelled,
  // abort and refresh.
  const liveSlips = selectedGroup.orders.map(o => allOrders.find(a => a.id === o.id));
  if (liveSlips.some(s => !s || !canFinalizePayment(s))) {
    showToast('⚠ One or more orders in this group are no longer awaiting payment. Refreshing…');
    selectedGroup = null;
    renderOrders();
    return;
  }

  // Validate cash payment against combined grand total
  const financials = calculateGroupFinancials(selectedGroup, discountType);
  
  if (cashTendered < financials.grandTotal) {
    showToast('⚠ Insufficient cash tendered');
    return;
  }

  const changeAmount = cashTendered - financials.grandTotal;

  try {
    console.log('Processing payment for group:', selectedGroup.key, 'slips:', selectedGroup.orders.map(o => o.id));
    
    // Build a write batch to atomically update all slips in the group
    const batch = writeBatch(db);
    for (const liveSlip of liveSlips) {
      const slipUpdate = {
        status: nextStatusAfterPayment(liveSlip),
        paidBy: cashierData.uid,
        paymentMethod: 'Cash',
        discountType,
        grandTotal: financials.grandTotal,
        cashTendered,
        changeGiven: changeAmount
      };
      // First-write-wins: only stamp paidAt on slips that don't have it yet
      if (!liveSlip.paidAt) slipUpdate.paidAt = serverTimestamp();
      batch.update(doc(db, 'orders', liveSlip.id), slipUpdate);
    }

    // Create one payment record for the entire group
    const paymentData = {
      orderIds: selectedGroup.orders.map(o => o.id),  // all constituent slip IDs
      tableNumber: selectedGroup.tableNumber,
      waiterName: [...new Set(selectedGroup.orders.map(o => o.waiterName).filter(Boolean))].join(', ') || null,
      cashierId: cashierData.uid,
      cashierName: cashierData.name,
      paymentMethod: 'Cash',
      discountType,
      discountAmount: financials.discountAmount,
      subtotal: financials.subtotal,
      vatAmount: financials.vatAmount,
      vatExempt: financials.vatExempt,
      serviceCharge: financials.serviceCharge,
      grandTotal: financials.grandTotal,
      cashTendered,
      changeGiven: changeAmount,
      timestamp: serverTimestamp()
    };

    // Commit batch first, then write the payment record
    await batch.commit();
    console.log('Batch committed successfully for', liveSlips.length, 'slip(s)');
    await addDoc(collection(db, 'payments'), paymentData);
    console.log('Payment record created successfully');

    showToast('✅ Payment processed successfully');
    
    // Hold onto the group and payment details for receipt printing before clearing state
    const paidGroup = selectedGroup;
    const paidDiscountType = discountType;
    const paidCashTendered = cashTendered;
    const paidChangeAmount = changeAmount;

    // Reset to empty state
    selectedGroup = null;
    discountType = 'none';
    paymentMethod = 'Cash';
    cashTendered = 0;
    
    // Show empty state in detail panel
    $('detailBody').innerHTML = `
      <div class="empty-detail">
        <div class="empty-detail-icon"><i class="fa-solid fa-hand-pointer"></i></div>
        <div class="empty-detail-text">Select an order to view details and process payment</div>
      </div>
    `;
    
    renderOrders();
    
    // Auto-print receipt for the paid group
    setTimeout(() => {
      printGroupReceipt(paidGroup, paidDiscountType, financials, paidCashTendered, paidChangeAmount);
    }, 500);

  } catch (error) {
    console.error('Payment processing error:', error);
    if (error.code === 'permission-denied') {
      showToast('❌ Permission denied. Check Firebase security rules.');
    } else if (error.code === 'not-found') {
      showToast('❌ Order not found in database.');
    } else {
      showToast(`❌ Failed to process payment: ${error.message}`);
    }
    // Do NOT clear selectedGroup on error so the cashier can retry
  }
};

// ══════════════════════════════════════════════════════════════
// BILLING VIEW (READ-ONLY)
// ══════════════════════════════════════════════════════════════

function renderBilling() {
  const searchTerm = $('billingSearch').value.toLowerCase().trim();
  
  // Billing is a full ledger: every order except cancelled ones, shown with a
  // Paid / Not Paid / Completed status. (Today's Revenue below counts paid
  // orders only, so it stays accurate.)
  // Day boundaries for "today" [midnight, next midnight).
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const toDateSafe = raw => (raw && raw.toDate) ? raw.toDate() : (raw ? new Date(raw) : null);

  // An order belongs to "today" if it was paid today, or (for unpaid/legacy
  // orders with no paidAt) created today.
  const isTodayOrder = o => {
    const ts = toDateSafe(o.paidAt || o.createdAt);
    return ts && ts >= todayStart && ts < tomorrowStart;
  };

  // Billing shows only today's orders (non-cancelled). Older days are excluded
  // so the overview is a single-day view.
  const ledger = allOrders.filter(o => !isCancelled(o) && isTodayOrder(o));

  // Today's Total Revenue = grand totals of today's PAID orders. Computed over
  // the whole day's ledger so the search box never changes the figure.
  const todayRevenue = ledger
    .filter(o => isPaid(o)) // only money actually collected counts
    .reduce((sum, o) => {
      const financials = calculateFinancials(o.total || 0, { type: o.discountType || 'none' });
      return sum + financials.grandTotal;
    }, 0);

  $('todayRevenue').textContent = `₱${todayRevenue.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

  // Rows to display: today's ledger, optionally narrowed by the search box.
  let orders = ledger;
  if (searchTerm) {
    orders = ledger.filter(o =>
      String(o.tableNumber).includes(searchTerm) ||
      o.id.toLowerCase().includes(searchTerm) ||
      (o.waiterName || '').toLowerCase().includes(searchTerm)
    );
  }

  const tbody = $('billingTableBody');

  if (orders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-row">No orders today yet. Today\'s orders will appear here as they come in.</td></tr>';
    return;
  }

  tbody.innerHTML = orders.map(order => {
    const itemCount = (order.items || []).length;
    const timestamp = order.createdAt?.toDate
      ? order.createdAt.toDate().toLocaleString('en-PH', { dateStyle: 'short', timeStyle: 'short' })
      : '—';
    
    const financials = calculateFinancials(order.total || 0, { type: order.discountType || 'none' });
    
    // Billing status badge — the serving state is intentionally not shown here.
    // Orders collapse to a simple Paid / Not Paid, plus Completed, so the column
    // is easy to read at a glance.
    let statusBadge = '';
    // Completed: archived orders, plus any PAID takeout order (takeout needs no
    // serving step, so it's done once paid — covers legacy takeout orders that
    // were paid before takeout auto-completion existed). Other paid orders show
    // "Paid"; everything else "Not Paid".
    if (order.status === 'completed') {
      statusBadge = '<span class="status-badge completed" style="color:#27ae60;background:rgba(39,174,96,0.15);border-color:rgba(39,174,96,0.3)">Completed</span>';
    } else if (isPaid(order)) {
      statusBadge = '<span class="status-badge" style="color:#c9973a;background:rgba(201,151,58,0.15);border-color:rgba(201,151,58,0.3)">Paid</span>';
    } else {
      statusBadge = '<span class="status-badge" style="color:#c0392b;background:rgba(192,57,43,0.15);border-color:rgba(192,57,43,0.3)">Not Paid</span>';
    }

    return `
      <tr>
        <td class="mono">#${order.id.slice(-5).toUpperCase()}</td>
        <td>${orderLocationBadgeHtml(order)}</td>
        <td>${escapeHtml(order.waiterName || '—')}</td>
        <td>${itemCount} item${itemCount !== 1 ? 's' : ''}</td>
        <td><strong>₱${financials.grandTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</strong></td>
        <td style="white-space:nowrap">${timestamp}</td>
        <td>${statusBadge}</td>
        <td><button class="btn-sm" onclick="showBillingReceipt('${order.id}')">Receipt</button></td>
      </tr>
    `;
  }).join('');
}

// Search functionality for billing
$('billingSearch').addEventListener('input', renderBilling);

window.showBillingReceipt = function(orderId) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order) {
    showToast('⚠ Order not found');
    return;
  }

  const financials = calculateFinancials(order.total || 0, { type: order.discountType || 'none' });
  const itemsHtml = (order.items || []).map(item => `
    <div class="detail-item">
      <div class="detail-item-info">
        <div class="detail-item-name">${escapeHtml(item.name)}</div>
        <div class="detail-item-qty">× ${item.qty}</div>
      </div>
      <div class="detail-item-price">₱${((item.price || 0) * (item.qty || 0)).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
    </div>
  `).join('');

  const timestamp = order.createdAt?.toDate
    ? order.createdAt.toDate().toLocaleString('en-PH')
    : '—';

  // Reuse detail panel to show receipt
  $('detailBody').innerHTML = `
    <div class="detail-section">
      <div class="detail-section-title">Receipt</div>
      <div class="detail-info-grid">
        <div class="detail-info-item">
          <div class="detail-info-label">Order ID</div>
          <div class="detail-info-value">#${order.id.slice(-6).toUpperCase()}</div>
        </div>
        <div class="detail-info-item">
          <div class="detail-info-label">Table</div>
          <div class="detail-info-value">${orderLocationBadgeHtml(order)}</div>
        </div>
        <div class="detail-info-item">
          <div class="detail-info-label">Waiter</div>
          <div class="detail-info-value">${escapeHtml(order.waiterName || '—')}</div>
        </div>
        <div class="detail-info-item">
          <div class="detail-info-label">Date</div>
          <div class="detail-info-value">${timestamp}</div>
        </div>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Order Items</div>
      ${itemsHtml}
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Financial Breakdown</div>
      <div class="financial-breakdown">
        <div class="financial-row">
          <span>Subtotal</span>
          <span>₱${financials.subtotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
        </div>
        ${financials.discountAmount > 0 ? `
          <div class="financial-row discount">
            <span>Discount (${order.discountType === 'senior' ? 'Senior Citizen' : order.discountType === 'pwd' ? 'PWD' : 'Unknown'} - ${(financials.discountRate * 100).toFixed(0)}%)</span>
            <span>-₱${financials.discountAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
          </div>
        ` : ''}
        ${!financials.vatExempt ? `
          <div class="financial-row">
            <span>VAT (12%)</span>
            <span>₱${financials.vatAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
          </div>
        ` : `
          <div class="financial-row vat-exempt">
            <span>VAT Exempt</span>
            <span>₱0.00</span>
          </div>
        `}
        <div class="financial-row">
          <span>Service Charge (7%)</span>
          <span>₱${financials.serviceCharge.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
        </div>
        <div class="financial-row total">
          <span>Grand Total</span>
          <span>₱${financials.grandTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
        </div>
      </div>
    </div>

    ${order.cashTendered ? `
      <div class="detail-section">
        <div class="detail-section-title">Payment Information</div>
        <div class="detail-info-grid">
          <div class="detail-info-item">
            <div class="detail-info-label">Payment Method</div>
            <div class="detail-info-value">Cash</div>
          </div>
          <div class="detail-info-item">
            <div class="detail-info-label">Cash Tendered</div>
            <div class="detail-info-value">₱${order.cashTendered.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
          </div>
          <div class="detail-info-item">
            <div class="detail-info-label">Change Given</div>
            <div class="detail-info-value">₱${(order.changeGiven || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
          </div>
          <div class="detail-info-item">
            <div class="detail-info-label">Paid At</div>
            <div class="detail-info-value">${order.paidAt?.toDate ? order.paidAt.toDate().toLocaleString('en-PH', { timeStyle: 'short' }) : '—'}</div>
          </div>
        </div>
      </div>
    ` : ''}

    <button class="btn-primary" onclick="printReceipt('${order.id}')">
      <i class="fa-solid fa-print"></i>
      Print Receipt
    </button>
  `;

  $('detailPanel').classList.add('active');
};

// ══════════════════════════════════════════════════════════════
// GROUP RECEIPT PRINTING (full payment receipt — admin style)
// ══════════════════════════════════════════════════════════════

/**
 * Called from the "Print Receipt" button in the detail panel (before payment).
 * Builds a preview receipt using the current discount selection and no cash info.
 */
window.printGroupReceiptPreview = function(groupKey) {
  const queueOrders = allOrders.filter(belongsInCashierQueue);
  const groups = groupOrdersByTable(queueOrders);
  const group = groups.find(g => g.key === groupKey);
  if (!group) { showToast('⚠ Order not found'); return; }
  const financials = calculateGroupFinancials(group, discountType);
  printGroupReceipt(group, discountType, financials, 0, 0);
};

window.printGroupReceipt = async function(group, discountType, financials, cashTendered, changeAmount) {
  if (!group) return;

  const order = group.orders[0];
  const combinedItems = group.combinedItems;

  // Load logo as base64 so it works in the detached print window
  let logo = null;
  try {
    const res = await fetch('image/logo.png');
    const blob = await res.blob();
    logo = await new Promise(r => {
      const reader = new FileReader();
      reader.onload = () => r(reader.result);
      reader.readAsDataURL(blob);
    });
  } catch (e) { /* logo is optional */ }

  const timestamp = order.createdAt?.toDate
    ? order.createdAt.toDate().toLocaleString('en-PH', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
      })
    : '—';

  const waiterNames = [...new Set(group.orders.map(o => o.waiterName).filter(Boolean))].join(', ') || '—';

  const itemRows = combinedItems.map(item => `
    <tr>
      <td>${escapeHtml(item.name)}</td>
      <td style="text-align:center">${item.qty}</td>
      <td style="text-align:right">₱${((item.price || 0) * (item.qty || 0)).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
    </tr>
  `).join('');

  const printWindow = window.open('', '_blank', 'width=400,height=750');
  if (!printWindow) { showToast('❌ Allow popups to print receipts'); return; }

  printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <title>Receipt - Salo sa Antipolo</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Courier New', monospace;
      font-size: 11px;
      color: #111;
      background: #fff;
      padding: 12mm 6mm;
    }
    .rh { text-align: center; margin-bottom: 10px; }
    .logo {
      width: 56px; height: 56px;
      border-radius: 50%;
      display: block;
      margin: 0 auto 6px;
    }
    .rn { font-weight: 700; font-size: 14px; letter-spacing: 0.03em; }
    .ri { font-style: italic; color: #b8821e; }
    .ra { font-size: 9px; color: #666; margin-top: 4px; line-height: 1.5; }
    hr.s { border: none; border-top: 1px solid #111; margin: 7px 0; }
    hr.d { border: none; border-top: 1px dashed #aaa; margin: 5px 0; }
    .mr {
      display: flex; justify-content: space-between;
      font-size: 10px; padding: 2px 0;
    }
    .ml { color: #888; }
    .mv { font-weight: 700; }
    .order-id { font-weight: 700; color: #b8821e; }
    .takeout-banner {
      text-align: center;
      background: #e67e22; color: #fff;
      font-weight: 700; font-size: 11px;
      letter-spacing: 0.06em; text-transform: uppercase;
      padding: 5px 0; margin: 6px 0; border-radius: 3px;
    }
    table { width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 2px; }
    th {
      text-align: left; font-size: 8px;
      letter-spacing: .07em; text-transform: uppercase;
      color: #555; border-bottom: 1px solid #ccc; padding: 3px 0;
    }
    th:not(:first-child) { text-align: right; }
    td { padding: 4px 0; }
    tbody tr:last-child td { border-bottom: 1px dashed #ccc; }
    .tr { display: flex; justify-content: space-between; font-size: 10px; padding: 2px 0; }
    .discount-row { color: #27ae60; font-weight: 600; }
    .vat-exempt-row { color: #e67e22; font-style: italic; }
    .tg {
      display: flex; justify-content: space-between;
      font-size: 14px; font-weight: 700;
      border-top: 1.5px solid #111;
      margin-top: 6px; padding-top: 5px;
    }
    .tg span:last-child { color: #b8821e; }
    .cash-section { margin-top: 8px; }
    .ft {
      text-align: center; margin-top: 14px;
      font-size: 9px; color: #777; line-height: 1.9;
    }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <div class="rh">
    ${logo ? `<img class="logo" src="${logo}" alt=""/>` : ''}
    <div class="rn">Salo sa <span class="ri">Antipolo</span></div>
    <div class="ra">Sumulong Highway, Siete Media,<br/>Antipolo City, Rizal, Philippines, 1870</div>
  </div>
  <hr class="s"/>
  <div class="mr">
    <span class="ml">Order:</span>
    <span class="order-id">#${order.id.slice(-5).toUpperCase()}</span>
  </div>
  <div class="mr"><span class="ml">Date:</span><span>${timestamp}</span></div>
  <div class="mr">
    <span class="ml">Type:</span>
    <span style="font-weight:700${isTakeout(order) ? ';color:#b8821e' : ''}">
      ${isTakeout(order) ? '🥡 Takeout' : '🍽️ Dine-In'}
    </span>
  </div>
  ${!isTakeout(order) ? `
  <div class="mr"><span class="ml">Table:</span><span>${group.tableNumber}</span></div>` : ''}
  <div class="mr"><span class="ml">Waiter:</span><span>${escapeHtml(waiterNames)}</span></div>
  ${group.orders.some(o => o.note) ? `<div class="mr" style="margin-top:3px;"><span class="ml">Note:</span><span style="font-weight:700">${group.orders.filter(o => o.note).map(o => escapeHtml(o.note)).join(' | ')}</span></div>` : ''}
  <hr class="d"/>
  <table>
    <thead>
      <tr>
        <th>Item</th>
        <th style="text-align:center">Qty</th>
        <th style="text-align:right">Amount</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>
  <div style="margin-top:6px;">
    <div class="tr">
      <span>VAT-Excl.</span>
      <span>₱${financials.subtotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
    </div>
    ${financials.discountAmount > 0 ? `
    <div class="tr discount-row">
      <span>Discount (${discountType === 'senior' ? 'Senior' : 'PWD'} 20%)</span>
      <span>-₱${financials.discountAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
    </div>` : ''}
    ${financials.vatExempt ? `
    <div class="tr vat-exempt-row"><span>VAT Exempt</span><span>₱0.00</span></div>
    ` : `
    <div class="tr"><span>VAT (12%)</span><span>₱${financials.vatAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span></div>
    `}
    <div class="tr">
      <span>Service Charge (7%)</span>
      <span>₱${financials.serviceCharge.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
    </div>
    <div class="tg">
      <span>TOTAL</span>
      <span>₱${financials.grandTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
    </div>
  </div>
  ${cashTendered > 0 ? `
  <hr class="d" style="margin:8px 0;"/>
  <div class="cash-section">
    <div class="tr">
      <span>Cash Tendered</span>
      <span>₱${cashTendered.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
    </div>
    <div class="tr" style="font-weight:700;font-size:12px;margin-top:3px;">
      <span>Change</span>
      <span>₱${(changeAmount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
    </div>
  </div>` : ''}
  <hr class="d" style="margin-top:12px;"/>
  <div class="ft">
    Thank you for dining with us!<br/>
    Please come again 🍽️<br/>
    @salosantipolo
  </div>
</body>
</html>`);

  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 300);
};

// ══════════════════════════════════════════════════════════════
// ORDER SLIP PRINTING (kitchen copy — items & qty only, no prices)
// ══════════════════════════════════════════════════════════════

window.printOrderSlip = function(groupKey) {
  // groupKey is order.id for takeout, tableNumber string for dine-in
  const groups = groupOrdersByTable(allOrders.filter(o => belongsInCashierQueue(o)));
  const group = groups.find(g => g.key === groupKey);
  if (!group) {
    showToast('⚠ Order not found');
    return;
  }
  // Use the earliest slip as the representative order for header info,
  // but combine all items from every slip in the group.
  const order = group.orders[0];
  const combinedItems = group.combinedItems;

  const timestamp = order.createdAt?.toDate
    ? order.createdAt.toDate().toLocaleString('en-PH', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      })
    : '—';

  const itemsRows = combinedItems.map(item => `
    <tr>
      <td class="qty-col">${item.qty}×</td>
      <td>${escapeHtml(item.name)}</td>
    </tr>
  `).join('');

  const printWindow = window.open('', '_blank', 'width=380,height=600');
  if (!printWindow) {
    showToast('❌ Allow popups to print order slips');
    return;
  }

  printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <title>Order Slip - Salo sa Antipolo</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Courier New', monospace;
      font-size: 12px;
      color: #111;
      background: #fff;
      padding: 12mm 6mm;
    }
    .rh { text-align: center; margin-bottom: 10px; }
    .rn { font-weight: 700; font-size: 15px; letter-spacing: 0.04em; }
    .rs { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: 0.12em; margin-top: 3px; }
    hr.s { border: none; border-top: 2px solid #111; margin: 8px 0; }
    hr.d { border: none; border-top: 1px dashed #aaa; margin: 6px 0; }
    .mr {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      padding: 2px 0;
    }
    .ml { color: #666; }
    .mv { font-weight: 700; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
      margin-top: 6px;
    }
    td { padding: 7px 0; border-bottom: 1px dashed #ccc; }
    tbody tr:last-child td { border-bottom: none; }
    .qty-col {
      width: 42px;
      font-weight: 700;
      color: #b8821e;
    }
    .ft {
      text-align: center;
      margin-top: 16px;
      font-size: 10px;
      color: #777;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .takeout-banner {
      text-align: center;
      background: #e67e22;
      color: #fff;
      font-weight: 700;
      font-size: 13px;
      letter-spacing: 0.06em;
      padding: 6px 0;
      margin-bottom: 8px;
      border-radius: 4px;
    }
    @media print {
      body { padding: 0; }
    }
  </style>
</head>
<body>
  <div class="rh">
    <div class="rn">Salo sa Antipolo</div>
    <div class="rs">Order Slip · Kitchen Copy</div>
  </div>
  <hr class="s"/>
  ${isTakeout(order) ? `<div class="takeout-banner">🥡 TAKEOUT ORDER</div>` : ''}
  <div class="mr">
    <span class="ml">Order:</span>
    <span class="mv">#${order.id.slice(-5).toUpperCase()}</span>
  </div>
  <div class="mr"><span class="ml">${isTakeout(order) ? 'Type:' : 'Table:'}</span><span class="mv">${orderLocationLabel(order)}</span></div>
  <div class="mr"><span class="ml">Waiter:</span><span class="mv">${escapeHtml(order.waiterName || '—')}</span></div>
  <div class="mr"><span class="ml">Time:</span><span class="mv">${timestamp}</span></div>
  ${order.note ? `<div class="mr" style="margin-top:4px"><span class="ml">Note:</span><span class="mv">${escapeHtml(order.note)}</span></div>` : ''}
  <hr class="d"/>
  <table>
    <tbody>${itemsRows}</tbody>
  </table>
  <div class="ft">— End of Order —</div>
</body>
</html>`);

  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 250);
};

// ══════════════════════════════════════════════════════════════
// RECEIPT PRINTING
// ══════════════════════════════════════════════════════════════

window.printReceipt = async function(orderId) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order) {
    showToast('⚠ Order not found');
    return;
  }

  const financials = calculateFinancials(order.total || 0, { type: order.discountType || 'none' });
  
  // Try to load logo
  let logo = null;
  try {
    const res = await fetch('image/logo.png');
    const blob = await res.blob();
    logo = await new Promise(r => {
      const reader = new FileReader();
      reader.onload = () => r(reader.result);
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.log('Logo loading failed:', e);
  }

  const timestamp = order.createdAt?.toDate
    ? order.createdAt.toDate().toLocaleString('en-PH', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      })
    : '—';

  const itemsRows = (order.items || []).map(item => `
    <tr>
      <td>${escapeHtml(item.name)}</td>
      <td style="text-align:center">${item.qty}</td>
      <td style="text-align:right">₱${((item.price || 0) * (item.qty || 0)).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
    </tr>
  `).join('');

  const printWindow = window.open('', '_blank', 'width=400,height=700');
  if (!printWindow) {
    showToast('❌ Allow popups to print receipts');
    return;
  }

  printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <title>Receipt - Salo sa Antipolo</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Courier New', monospace;
      font-size: 11px;
      color: #111;
      background: #fff;
      padding: 12mm 6mm;
    }
    .rh { text-align: center; margin-bottom: 10px; }
    .logo {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      display: block;
      margin: 0 auto 6px;
    }
    .rn { font-weight: 700; font-size: 13px; }
    .ri { font-style: italic; color: #b8821e; }
    .ra { font-size: 9px; color: #666; margin-top: 4px; line-height: 1.4; }
    hr.s { border: none; border-top: 1px solid #111; margin: 7px 0; }
    hr.d { border: none; border-top: 1px dashed #aaa; margin: 5px 0; }
    .mr {
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      padding: 1px 0;
    }
    .ml { color: #888; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10px;
    }
    th {
      text-align: left;
      font-size: 8px;
      letter-spacing: .06em;
      text-transform: uppercase;
      color: #555;
      border-bottom: 1px solid #ddd;
      padding: 3px 0;
    }
    th:not(:first-child) { text-align: right; }
    td { padding: 4px 0; }
    tbody tr:last-child td { border-bottom: 1px dashed #ccc; }
    .tr {
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      padding: 2px 0;
    }
    .discount-row {
      color: #27ae60;
      font-weight: 600;
    }
    .vat-exempt-row {
      color: #e67e22;
      font-style: italic;
    }
    .tg {
      display: flex;
      justify-content: space-between;
      font-size: 13px;
      font-weight: 700;
      border-top: 1.5px solid #111;
      margin-top: 6px;
      padding-top: 5px;
    }
    .tg span:last-child { color: #b8821e; }
    .ft {
      text-align: center;
      margin-top: 14px;
      font-size: 9px;
      color: #777;
      line-height: 1.8;
    }
    @media print {
      body { padding: 0; }
    }
  </style>
</head>
<body>
  <div class="rh">
    ${logo ? `<img class="logo" src="${logo}" alt=""/>` : ''}
    <div class="rn">Salo sa <span class="ri">Antipolo</span></div>
    <div class="ra">Sumulong Highway, Siete Media,<br/>Antipolo City, Rizal, Philippines, 1870</div>
  </div>
  <hr class="s"/>
  <div class="mr">
    <span class="ml">Order:</span>
    <span style="font-weight:700;color:#b8821e">#${order.id.slice(-5).toUpperCase()}</span>
  </div>
  <div class="mr"><span class="ml">Date:</span><span>${timestamp}</span></div>
  <div class="mr"><span class="ml">${isTakeout(order) ? 'Type:' : 'Table:'}</span><span>${orderLocationLabel(order)}</span></div>
  <div class="mr"><span class="ml">Waiter:</span><span>${escapeHtml(order.waiterName || '—')}</span></div>
  <div class="mr"><span class="ml">Payment:</span><span>Cash</span></div>
  ${order.note ? `<div class="mr" style="margin-top:3px;"><span class="ml">Note:</span><span style="font-weight:700">${escapeHtml(order.note)}</span></div>` : ''}
  <hr class="d"/>
  <table>
    <thead>
      <tr>
        <th>Item</th>
        <th style="text-align:right">Qty</th>
        <th style="text-align:right">Amount</th>
      </tr>
    </thead>
    <tbody>${itemsRows}</tbody>
  </table>
  <div style="margin-top:6px;">
    <div class="tr">
      <span>Subtotal</span>
      <span>₱${financials.subtotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
    </div>
    ${financials.discountAmount > 0 ? `
      <div class="tr discount-row">
        <span>Discount (${order.discountType === 'senior' ? 'Senior' : 'PWD'} 20%)</span>
        <span>-₱${financials.discountAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
      </div>
    ` : ''}
    ${!financials.vatExempt ? `
      <div class="tr">
        <span>VAT (12%)</span>
        <span>₱${financials.vatAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
      </div>
    ` : `
      <div class="tr vat-exempt-row">
        <span>VAT Exempt</span>
        <span>₱0.00</span>
      </div>
    `}
    <div class="tr">
      <span>Service Charge (7%)</span>
      <span>₱${financials.serviceCharge.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
    </div>
    <div class="tg">
      <span>TOTAL</span>
      <span>₱${financials.grandTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
    </div>
  </div>
  ${order.cashTendered ? `
    <hr class="d" style="margin: 8px 0;"/>
    <div style="margin-top:8px;">
      <div class="tr">
        <span>Cash Tendered</span>
        <span>₱${order.cashTendered.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
      </div>
      <div class="tr" style="font-weight:700;font-size:12px;margin-top:4px;">
        <span>Change</span>
        <span>₱${(order.changeGiven || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
      </div>
    </div>
  ` : ''}
  <div class="ft">
    Thank you for dining with us!<br/>
    Please come again 🍽️<br/>
    @salosantipolo
  </div>
</body>
</html>`);

  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 250);
};

// ══════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ══════════════════════════════════════════════════════════════

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
