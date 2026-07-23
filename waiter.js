import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, addDoc, updateDoc,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
// ── Order status helpers (self-contained; mirrors cashier.js / admin-orders.js) ──
// Preparation and payment are independent axes combined into one `status` field.
// Legacy `pending` is tolerated for pre-existing orders.
const STATUS = Object.freeze({
  PENDING: 'pending',
  PREPARING: 'preparing',
  SERVED_UNPAID: 'served_unpaid',
  PAID_UNSERVED: 'paid_unserved',
  SERVED_PAID: 'served_paid',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
});
const PAID_STATUSES   = ['paid_unserved', 'served_paid', 'completed'];
const SERVED_STATUSES = ['served_unpaid', 'served_paid'];
const isPaid      = o => PAID_STATUSES.includes(o?.status);
const isServed    = o => SERVED_STATUSES.includes(o?.status) || !!o?.servedAt;
const isCancelled = o => o?.status === 'cancelled';
const isUnpaid    = o => !isPaid(o) && !isCancelled(o);
const isTakeout   = o => o?.orderType === 'takeout' || !o?.tableNumber;
// A waiter's order-slip panel lists only their own orders that still need to be
// served — i.e. not yet served (excludes served_unpaid / served_paid), and not
// completed or cancelled. So it shows preparing/pending and paid-but-unserved
// (paid_unserved) orders only.
const belongsInWaiterSlips = (o, wId) =>
  o?.waiterId === wId &&
  !isServed(o) &&
  o?.status !== 'completed' &&
  o?.status !== 'cancelled';
// The Served button shows for any order still awaiting serving — not yet served
// and not completed/cancelled. Covers preparing/legacy pending (→ served_unpaid)
// and paid_unserved (→ served_paid).
const canServeOrder = o =>
  !isServed(o) && o?.status !== 'completed' && o?.status !== 'cancelled';
// Takeout must be paid before the waiter can hand it to the customer.
const shouldShowServedButton = o => canServeOrder(o) && (!isTakeout(o) || isPaid(o));
const nextStatusAfterServed = o =>
  isTakeout(o) && isPaid(o) ? STATUS.COMPLETED
    : isPaid(o) ? STATUS.SERVED_PAID
    : STATUS.SERVED_UNPAID;
// First-write-wins: never overwrite an existing servedAt timestamp.
const servedAtUpdate = (order, ts) => order?.servedAt ? {} : { servedAt: ts };

const app  = initializeApp({ apiKey:"AIzaSyCKQneulIrm9KWuOg69f29nFo6TGz2PF4w", authDomain:"salo-sa-antipolo.firebaseapp.com", projectId:"salo-sa-antipolo", storageBucket:"salo-sa-antipolo.firebasestorage.app", messagingSenderId:"60032898501", appId:"1:60032898501:web:3a4e663fee4ccd2adae7ac" });
const auth = getAuth(app);
const db   = getFirestore(app);

const $ = id => document.getElementById(id);
const showToast = m => { $('toastMsg').textContent=m; $('toast').classList.add('show'); setTimeout(()=>$('toast').classList.remove('show'),3000); };

// ── Theme toggle (light / dark) — shared behaviour with the cashier portal ──
const savedTheme = localStorage.getItem('theme');
if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
$('themeToggle').onclick = () => {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
};

// ── State ──
let waiterName = '', waiterId = '', menuItems = [], cart = {}, selectedTable = null, activeCat = 'all';
let allOrders = [];
let selectedSlipOrderId = null; // id of the order slip currently shown in the detail view
let menuOrderCounts = {};
let tablesData = {};
let pendingOccupyTable = null;
let pendingWalkinTable = null;
let menuPage = 1;
let currentOrderType = null; // 'dine-in' | 'takeout' | null
const ITEMS_PER_PAGE_DESKTOP = 14;
const ITEMS_PER_PAGE_MEDIUM  = 10;
const ITEMS_PER_PAGE_TABLET  = 6;
const getItemsPerPage = () => {
  const w = window.innerWidth;
  if (w <= 768)  return ITEMS_PER_PAGE_TABLET;
  if (w <= 1024) return ITEMS_PER_PAGE_MEDIUM;
  return ITEMS_PER_PAGE_DESKTOP;
};

window.addEventListener('resize', () => { menuPage = 1; renderMenuGrid(); });

// ── Bento time-window helpers ──
const BENTO_WINDOW = { start: 11, end: 15 }; // 11:00 AM – 3:00 PM
function isBentoItem(name = '') { return name.toLowerCase().includes('bento'); }
function isBentoWindowOpen() {
  const now = new Date();
  const h = now.getHours() + now.getMinutes() / 60;
  return h >= BENTO_WINDOW.start && h < BENTO_WINDOW.end;
}

// ── Auth guard ──
onAuthStateChanged(auth, async user => {
  if (!user) { window.location.href = 'waiter-login.html'; return; }
  const snap = await getDoc(doc(db, 'Users', user.uid));
  if (!snap.exists()) { await signOut(auth); window.location.href = 'waiter-login.html'; return; }
  const data = snap.data();
  if (data.role !== 'waiter') { await signOut(auth); window.location.href = 'waiter-login.html'; return; }
  if (data.status === 'pending') {
    await signOut(auth);
    alert('⏳ Your account is pending admin approval.');
    window.location.href = 'waiter-login.html'; return;
  }
  if (data.status === 'rejected') {
    await signOut(auth);
    alert('❌ Your registration was declined. Please contact the manager.');
    window.location.href = 'waiter-login.html'; return;
  }
  waiterName = data.name || user.email;
  waiterId   = user.uid;
  $('waiterAvatar').textContent = waiterName[0].toUpperCase();
  init();
});

$('logoutBtn').onclick = async () => { await signOut(auth); window.location.href = 'waiter-login.html'; };

// ── ORDER NOW BUTTON & ORDER TYPE SELECTION ──
function showOrderTypeModal() {
  const modal = $('orderTypeModal');
  if (!modal) {
    console.error('Order Type Modal element not found');
    showToast('❌ Unable to display order type selection');
    return;
  }
  modal.classList.add('show');
}

const orderNowBtn = $('orderNowBtn');
if (orderNowBtn) {
  orderNowBtn.onclick = () => { showOrderTypeModal(); };
} else {
  console.error('Order Now button element not found');
}

// Close the modal without selecting an order type. Guards against a missing
// modal node so the interaction logs an error and shows a toast instead of
// throwing, leaving the entry screen usable for a retry.
const orderTypeModalClose = $('orderTypeModalClose');
if (orderTypeModalClose) {
  orderTypeModalClose.onclick = () => {
    const modal = $('orderTypeModal');
    if (!modal) {
      console.error('Order Type Modal element not found on close');
      showToast('❌ Unable to close order type selection');
      return;
    }
    modal.classList.remove('show');
  };
} else {
  console.error('Order Type Modal close button element not found');
}

// Guarantee a clean entry-screen state on every page load.
// There is no in-progress order persistence (no localStorage by design), so a
// browser refresh always discards any partial order. This makes that behavior
// explicit in code rather than relying only on the static HTML defaults:
// show the Order Now entry screen, hide the order-taking step, and reset the
// order-type/session state and step pills so the waiter never lands in a
// broken/partial state after a refresh (see design: "Browser refresh during
// order taking").
function ensureEntryScreenState() {
  currentOrderType = null;
  selectedTable = null;

  const entry = $('orderEntry');
  const tables = $('stepTables');
  const order = $('stepOrder');
  if (entry)  entry.classList.remove('hidden');
  if (tables) tables.classList.remove('hidden', 'out-left');
  if (order)  order.classList.remove('visible', 'in');

  updateStepIndicator();
  updateOrderTypeTabs();
  pill1Active(); pill2Reset(); pill3Reset();
}

async function init() {
  ensureEntryScreenState();
  loadMenu();

onSnapshot(query(collection(db, 'orders'), orderBy('createdAt', 'desc')), snap => {
    allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    calculateMenuOrderCounts();
    renderTables();
    updateCustomerLeftButton();
    // The order-slip panel derives entirely from the live snapshot, so a new
    // order (Req 6.3) or a status change on an existing one (Req 6.4) refreshes
    // the panel automatically on the next callback.
    renderOrderSlips();
  });

  onSnapshot(collection(db, 'tables'), snap => {
    tablesData = {};
    tablesList = [];
    snap.docs.forEach(d => {
      const data = d.data();
      const rawNum = data.tableNumber
        ? parseInt(data.tableNumber)
        : parseInt(d.id.replace('table_', ''));
      const num = isNaN(rawNum) ? null : rawNum;
      if (!num) return;
      if (tablesData[num] && !data.tableNumber) return;
      tablesData[num] = { docId: d.id, ...data, tableNumber: num };
      const existIdx = tablesList.findIndex(t => t.tableNumber === num);
      if (existIdx !== -1) tablesList.splice(existIdx, 1);
      tablesList.push({ docId: d.id, tableNumber: num, ...data });
    });
    tablesList.sort((a, b) => a.tableNumber - b.tableNumber);
    renderTables();
  });
}

function calculateMenuOrderCounts() {
  menuOrderCounts = {};
  const todayStr = new Date().toISOString().slice(0, 10);
  allOrders.filter(o => {
    if (!['pending', 'preparing', 'served_unpaid', 'paid_unserved', 'served_paid'].includes(o.status)) return false;
    const orderDate = o.createdAt?.toDate
      ? o.createdAt.toDate().toISOString().slice(0, 10)
      : null;
    return orderDate === todayStr;
  }).forEach(o => {
    (o.items || []).forEach(item => {
      const key = item.name || item.id;
      if (!menuOrderCounts[key]) menuOrderCounts[key] = { served: 0 };
      menuOrderCounts[key].served += Number(item.qty) || 0;
    });
  });
}

function getReservationMinutes(timeStr) {
  const match = timeStr?.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return null;
  let hour = parseInt(match[1]) % 12;
  if (match[3].toUpperCase() === 'PM') hour += 12;
  return hour * 60 + parseInt(match[2]);
}

// ── TABLE RENDERING ──
let tablesList = [];

function renderTables() {
  const orderOccupied = {};
  // A table stays occupied while its order is live — anything not completed or
  // cancelled (preparing, served_unpaid, paid_unserved, served_paid).
  allOrders.filter(o => o.status !== 'completed' && o.status !== 'cancelled').forEach(o => {
    if (o.tableNumber) orderOccupied[o.tableNumber] = { 
      status: o.status, 
      waiterName: o.waiterName, 
      waiterId: o.waiterId,
      orderId: o.id 
    };
  });

  const grid = $('tablesGrid');

  if (!tablesList.length) {
    grid.innerHTML = '<div style="color:var(--text-muted);font-size:14px;padding:32px;grid-column:1/-1;text-align:center;">No tables configured yet.</div>';
    return;
  }

  grid.innerHTML = tablesList.map(entry => {
    const n = entry.tableNumber;
    const orderInfo         = orderOccupied[n];
    const tableDoc          = tablesData[n];
    const isWalkIn          = !orderInfo && tableDoc && tableDoc.status === 'walk-in';
    const isWalkInYours     = isWalkIn && tableDoc.waiterId === waiterId;
    const isReserved        = !orderInfo && tableDoc && tableDoc.status === 'reserved';
    const isOccupiedNoOrder = !orderInfo && tableDoc && tableDoc.status === 'occupied';
    const isOccupiedYours   = isOccupiedNoOrder && tableDoc.waiterId === waiterId;
    const isYours           = orderInfo && orderInfo.waiterId === waiterId;
    const isTakenOrder      = orderInfo && !isYours;
    const tileServed        = isYours && orderInfo && isServed(orderInfo);

    const displayLabel = entry.name ? entry.name : `Table ${n}`;
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const pendingReservations = tableDoc?.reservations || [];
    const nextReservation = pendingReservations
      .map(r => ({ ...r, mins: getReservationMinutes(r.time) }))
      .filter(r => r.mins !== null)
      .sort((a, b) => a.mins - b.mins)[0];
    const minsUntilNext = nextReservation ? nextReservation.mins - nowMins : null;
    const hasSoonReservation = minsUntilNext !== null && minsUntilNext <= 31 && minsUntilNext > 0;
    const capInfo = entry.capacity ? `<div class="table-cap">${entry.capacity} seats</div>` : '';

    let stClass, badge, badgeLbl, meta, icon, yoursInd = '';

    if (isYours) {
      if (tileServed) {
        stClass = 'yours'; badge = 'served'; badgeLbl = '✓ Served';
        icon = '✓'; meta = 'Food delivered · Awaiting payment';
      } else {
        stClass = 'yours'; badge = 'yours'; badgeLbl = '✦ Your Table';
        icon = '🍽️'; meta = 'Active order';
      }
      yoursInd = `<div class="yours-indicator">YOURS</div>`;
    } else if (isReserved) {
      stClass = 'reserved'; badge = 'reserved'; badgeLbl = '📅 Reserved';
      icon = '📅';
      const res = (tableDoc?.reservations?.[0]) || tableDoc?.reservation || {};
      meta = `${res.guestName || 'Guest'} · ${res.time || ''}`;
    } else if (isTakenOrder) {
      stClass = 'occupied'; badge = 'occupied'; badgeLbl = 'Occupied';
      icon = '🚫'; meta = orderInfo.waiterName || 'Another waiter';
    } else if (isWalkIn) {
      stClass = 'walk-in'; badge = 'walk-in'; badgeLbl = '🚶 Walk-in';
      icon = '👥';
      meta = (isWalkInYours ? '(You) · ' : (tableDoc.waiterName ? tableDoc.waiterName + ' · ' : '')) + 'Guests seated';
      if (isWalkInYours) yoursInd = `<div class="yours-indicator" style="color:var(--orange)">YOURS</div>`;
    } else if (isOccupiedNoOrder) {
      stClass = isOccupiedYours ? 'yours' : 'occupied';
      badge   = isOccupiedYours ? 'yours' : 'occupied';
      badgeLbl = isOccupiedYours ? '✦ Your Table' : 'Occupied';
      icon = isOccupiedYours ? '🍽️' : '🚫';
      meta = isOccupiedYours ? 'Guest arrived · Taking order' : tableDoc.waiterName || 'Another waiter';
      if (isOccupiedYours) yoursInd = `<div class="yours-indicator">YOURS</div>`;
    } else {
      stClass = 'free'; badge = 'free'; badgeLbl = 'Available';
      icon = '🪑';
      if (hasSoonReservation) {
        const urgency = minsUntilNext <= 30 ? '⚠️' : '🕐';
        meta = `${urgency} Reserved in ${minsUntilNext}m for ${nextReservation.guestName}`;
      } else if (nextReservation) {
        meta = `🗓️ Reserved at ${nextReservation.time} · Tap to seat`;
      } else {
        meta = 'Tap to seat guests';
      }
    }

    return `<div class="table-tile ${stClass}" onclick="window._selectTable(${n}, '${stClass}', ${isWalkIn}, ${tileServed})">
      ${yoursInd}
      <div class="table-num">${displayLabel}</div>
      ${capInfo}
      <div class="table-icon">${icon}</div>
      <span class="table-status-badge ${badge}">${badgeLbl}</span>
      <div class="table-meta">${meta}</div>
    </div>`;
  }).join('');
}

// ── MARK OCCUPIED ──
window._openOccupyModal = (num) => {
  pendingOccupyTable = num;
  $('occupiedTableBadge').textContent = `Table ${num}`;
  $('occupiedModal').classList.add('show');
};

$('occupiedModalClose').onclick = $('occupiedModalCancel').onclick = () => {
  $('occupiedModal').classList.remove('show');
  pendingOccupyTable = null;
};

$('confirmMarkOccupied').onclick = async () => {
  if (!pendingOccupyTable) return;
  const btn = $('confirmMarkOccupied');
  btn.disabled = true; btn.classList.add('loading');
  try {
    const tableDoc = tablesData[pendingOccupyTable];
    const ref = doc(db, 'tables', tableDoc ? tableDoc.docId : `table_${pendingOccupyTable}`);
    await updateDoc(ref, {
      status: 'walk-in', waiterId, waiterName, lastUpdated: serverTimestamp()
    });
    $('occupiedModal').classList.remove('show');
    const os = $('occupiedSuccess');
    $('occupiedSuccessSub').textContent = `Table ${pendingOccupyTable} marked as occupied.`;
    os.classList.add('show');
    setTimeout(() => os.classList.remove('show'), 2000);
    pendingOccupyTable = null;
  } catch(e) {
    console.error(e);
    showToast('❌ Failed to mark table. Please retry.');
  } finally {
    btn.disabled = false; btn.classList.remove('loading');
  }
};

// ── WALK-IN OPTIONS MODAL ──
window._selectTable = (num, stClass, isWalkIn, isServed) => {
  if (stClass === 'occupied') { showToast('⚠ This table has an active order from another waiter.'); return; }
  if (stClass === 'reserved') { window._openReservedModal(num); return; }

  // If this is YOUR table with SERVED status, open served modal
  if (isServed && stClass === 'yours') {
    window._openServedModal(num);
    return;
  }

  if (isWalkIn) {
    pendingWalkinTable = num;
    $('freeTableBadge').textContent = `Table ${num}`;
    const info = tablesData[num];
    $('freeTableDesc').textContent = info?.waiterName
      ? `Marked by: ${info.waiterName}`
      : 'This table is marked as occupied with walk-in guests.';
    $('freeTableModal').classList.add('show');
    return;
  }

  if (stClass === 'yours') { goToOrder(num); return; }

  // Free table — check if there's a reservation within 30 mins
  const tableDoc = tablesData[num];
  const reservations = tableDoc?.reservations || [];
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const next = reservations
    .map(r => ({ ...r, mins: getReservationMinutes(r.time) }))
    .filter(r => r.mins !== null)
    .sort((a, b) => a.mins - b.mins)[0];

  if (next) {
    const minsUntil = next.mins - nowMins;
    if (minsUntil <= 30 && minsUntil > 0) {
      showToast(`⚠️ Table ${num} is reserved for ${next.guestName} in ${minsUntil} mins. Cannot seat now.`);
      return;
    }
    if (minsUntil <= 60 && minsUntil > 31) {
      showToast(`🕐 Heads up: Table ${num} has a reservation in ${minsUntil} mins for ${next.guestName}.`);
    }
  }

  window._openOccupyModal(num);
};

$('freeTableModalClose').onclick = $('freeTableModalCancel').onclick = () => {
  $('freeTableModal').classList.remove('show');
  pendingWalkinTable = null;
};

$('startOrderFromWalkin').onclick = async () => {
  if (!pendingWalkinTable) return;
  const tableDoc = tablesData[pendingWalkinTable];
  if (tableDoc) {
    try {
      await updateDoc(doc(db, 'tables', tableDoc.docId), {
        status: 'occupied', waiterId, waiterName, lastUpdated: serverTimestamp()
      });
    } catch(e) { /* non-blocking */ }
  }
  $('freeTableModal').classList.remove('show');
  goToOrder(pendingWalkinTable);
  pendingWalkinTable = null;
};

$('freeTableBtn').onclick = async () => {
  if (!pendingWalkinTable) return;
  const tableDoc = tablesData[pendingWalkinTable];
  if (tableDoc) {
    try {
      await updateDoc(doc(db, 'tables', tableDoc.docId), {
        status: 'available', waiterId: null, waiterName: null, lastUpdated: serverTimestamp()
      });
      $('freeTableModal').classList.remove('show');
      showToast(`✅ Table ${pendingWalkinTable} marked as free.`);
      pendingWalkinTable = null;
    } catch(e) {
      console.error(e);
      showToast('❌ Failed to update table. Please retry.');
    }
  }
};

// ── RESERVED TABLE MODAL ──
window._openReservedModal = (num) => {
  const tableDoc = tablesData[num];
  const res = tableDoc?.reservation || {};
  $('reservedTableBadge').textContent = `Table ${num}`;
  $('reservedGuestName').textContent = res.guestName || '—';
  $('reservedTime').textContent = res.time || '—';
  $('reservedModal').dataset.table = num;
  $('reservedModal').classList.add('show');
};

$('reservedModalClose').onclick = $('reservedModalCancel').onclick = () => {
  $('reservedModal').classList.remove('show');
};

$('confirmArrivalBtn').onclick = async () => {
  const num = parseInt($('reservedModal').dataset.table);
  if (!num) return;
  const btn = $('confirmArrivalBtn');
  btn.disabled = true; btn.classList.add('loading');
  try {
    const tableDoc = tablesData[num];
    if (!tableDoc?.docId) { showToast('❌ Table document not found.'); return; }
    await updateDoc(doc(db, 'tables', tableDoc.docId), {
      status: 'occupied', waiterId, waiterName, lastUpdated: serverTimestamp()
    });
    $('reservedModal').classList.remove('show');
    goToOrder(num);
  } catch(e) {
    console.error(e);
    showToast('❌ Failed to confirm arrival. Please retry.');
  } finally {
    btn.disabled = false; btn.classList.remove('loading');
  }
};

// ── SERVED ORDER MODAL ──
let pendingServedTable = null;
let customerLeftInProgress = false;

// A table can only be cleared after every live order assigned to it is paid.
// This checks all active table orders, so a newly added order cannot be bypassed.
const getActiveTableOrders = tableNumber => allOrders.filter(order =>
  order.tableNumber === tableNumber &&
  order.status !== STATUS.COMPLETED &&
  order.status !== STATUS.CANCELLED
);

const canCustomerLeave = tableNumber => {
  const activeOrders = getActiveTableOrders(tableNumber);
  return activeOrders.length > 0 && activeOrders.every(isPaid);
};

function updateCustomerLeftButton() {
  const btn = $('customerLeftBtn');
  const subtext = $('customerLeftBtnSub');
  if (!btn) return;

  const canLeave = !customerLeftInProgress &&
    pendingServedTable !== null &&
    canCustomerLeave(pendingServedTable);
  btn.disabled = !canLeave;
  btn.title = canLeave ? '' : 'All orders for this table must be paid before the customer can leave.';
  if (subtext) subtext.textContent = canLeave ? 'Clear the table' : 'Payment required';
}

window._openServedModal = (num) => {
  pendingServedTable = num;
  $('servedTableBadge').textContent = `Table ${num}`;
  updateCustomerLeftButton();
  $('servedModal').classList.add('show');
};

$('servedModalClose').onclick = $('servedModalCancel').onclick = () => {
  $('servedModal').classList.remove('show');
  pendingServedTable = null;
};

$('customerLeftBtn').onclick = async () => {
  if (!pendingServedTable) return;
  const btn = $('customerLeftBtn');

  // Re-check because payment status may have changed while this modal was open.
  if (!canCustomerLeave(pendingServedTable)) {
    updateCustomerLeftButton();
    showToast('⚠️ Payment is required before the customer can leave.');
    return;
  }

  customerLeftInProgress = true;
  btn.disabled = true;
  try {
    // The check above guarantees all live orders are paid before completion.
    const servedOrders = getActiveTableOrders(pendingServedTable);
    
    // Update all served orders to remove them from active view
    // (They're already paid, so we just need to mark them as complete)
    for (const order of servedOrders) {
      await updateDoc(doc(db, 'orders', order.id), {
        status: 'completed',
        note: (order.note || '') + ' [Customer left]',
        updatedAt: serverTimestamp()
      });
    }
    
    // Clear the table assignment
    const tableDoc = tablesData[pendingServedTable];
    if (tableDoc?.docId) {
      await updateDoc(doc(db, 'tables', tableDoc.docId), {
        status: 'free',
        waiterId: null,
        waiterName: null,
        lastUpdated: serverTimestamp()
      });
    }
    
    $('servedModal').classList.remove('show');
    showToast(`✓ Table ${pendingServedTable} cleared.`);
    pendingServedTable = null;
  } catch(e) {
    console.error(e);
    showToast('❌ Failed to clear table. Please retry.');
  } finally {
    customerLeftInProgress = false;
    updateCustomerLeftButton();
  }
};

$('takeOrderAgainBtn').onclick = () => {
  if (!pendingServedTable) return;
  $('servedModal').classList.remove('show');
  goToOrder(pendingServedTable);
  pendingServedTable = null;
};

function goToOrder(num) {
  // State consistency guard (design: "State Consistency Errors"). A dine-in
  // order must have a valid table number; a missing/invalid num means the
  // navigation was triggered with inconsistent state. Log a warning and recover
  // to the known-good entry screen instead of navigating with a bad table.
  if (num === null || num === undefined || isNaN(Number(num))) {
    console.warn('goToOrder called with missing/invalid table number:', num, '— resetting to entry screen.');
    showToast('⚠️ Something went wrong selecting the table. Please start again.');
    ensureEntryScreenState();
    return;
  }

  selectedTable = num;
  currentOrderType = 'dine-in'; // Set order type when going through table selection
  // Dine-in: show the table number in the existing gold table-label style (Req 7.2).
  // textContent also clears any takeout badge markup from a prior takeout order.
  $('selectedTableLabel').textContent = `Table ${num}`;
  updateStepIndicator();
  updateOrderTypeTabs();
  pill1Done(); pill2Active();
  const st = $('stepTables'), so = $('stepOrder');
  st.classList.add('out-left');
  so.classList.add('visible');
  requestAnimationFrame(() => so.classList.add('in'));
  setTimeout(() => st.classList.add('hidden'), 400);
  renderMenuGrid();
  setupCatScrollBtns();
}

// ════════════════════════════════════════════════════════════════════════
// DINE-IN / TAKEOUT ORDER FLOW
// Two order paths branch from the Order Type Selection Modal:
//   • Dine-in: Order Now → Select Order Type → Table → Order → Submit
//   • Takeout: Order Now → Select Order Type → Order → Submit (skips table)
// currentOrderType ('dine-in' | 'takeout' | null) drives the branching in the
// functions below, plus step-indicator visibility, back navigation, and the
// order document written on submit.
// ════════════════════════════════════════════════════════════════════════

// ── ORDER TYPE SELECTION ──
// Entry point for both flows: stores the chosen order type, closes the modal,
// then routes to table selection (dine-in) or straight to order taking (takeout).
function selectOrderType(type) {
  currentOrderType = type;
  // Guard against a missing modal node so selection still proceeds without
  // throwing; log an error and surface a toast for visibility.
  const modal = $('orderTypeModal');
  if (modal) {
    modal.classList.remove('show');
  } else {
    console.error('Order Type Modal element not found during selection');
    showToast('❌ Unable to update order type selection');
  }
  
  if (type === 'dine-in') {
    // Show table selection. Also hide the order-taking step in case we're
    // switching here FROM takeout order taking (otherwise its menu/summary
    // would remain visible on top of the table grid).
    selectedTable = null;
    $('orderEntry').classList.add('hidden');
    $('stepOrder').classList.remove('visible', 'in');
    $('stepTables').classList.remove('hidden', 'out-left');
    updateStepIndicator();
    updateOrderTypeTabs(); // reflect Dine In as the active tab
    // Refresh the table grid so all tables and their current status
    // are shown when the table selection step becomes visible (Req 2.2)
    renderTables();
    pill1Active(); pill2Reset(); pill3Reset();
  } else if (type === 'takeout') {
    // Skip to order taking
    $('orderEntry').classList.add('hidden');
    $('stepTables').classList.add('hidden');
    goToOrderDirect();
  }
}

// ── GO TO ORDER (TAKEOUT) ──
// Takeout-only navigation that skips table selection and jumps straight to the
// order-taking step, clearing any table and showing the "Takeout Order" badge.
function goToOrderDirect() {
  // State consistency guard (design: "State Consistency Errors"). This path is
  // takeout-only; if the active order type isn't 'takeout', the state is
  // inconsistent. Log a warning and recover to the known-good entry screen
  // rather than proceeding into the takeout order-taking step.
  if (currentOrderType !== 'takeout') {
    console.warn('goToOrderDirect called with inconsistent order type:', currentOrderType, '— resetting to entry screen.');
    showToast('⚠️ Order flow was out of sync. Please start again.');
    resetOrderFlow();
    return;
  }

  // Navigate directly to order taking step for takeout
  selectedTable = null;  // Ensure no table is set
  // Takeout: show "Takeout Order" using the distinct orange badge style so the
  // waiter clearly sees a takeout order is active throughout order taking
  // (Req 3.5, 7.1, 7.3). Reuses the existing .order-type-badge/.takeout-badge classes.
  const label = $('selectedTableLabel');
  label.innerHTML = '<span class="order-type-badge takeout-badge"><i class="fa-solid fa-bag-shopping"></i> Takeout Order</span>';
  updateStepIndicator();
  updateOrderTypeTabs();
  pill1Done();
  pill2Active();
  
  const so = $('stepOrder');
  so.classList.add('visible');
  requestAnimationFrame(() => so.classList.add('in'));
  
  renderMenuGrid();
  setupCatScrollBtns();
}

// ── BACK TO TABLES ──
function goBackToTables() {
  const st = $('stepTables'), so = $('stepOrder');
  st.classList.remove('hidden', 'out-left');
  so.classList.remove('in');
  setTimeout(() => so.classList.remove('visible'), 400);
  pill1Active(); pill2Reset(); pill3Reset();
  selectedTable = null;
}

// ── BACK FROM ORDER TAKING ──
// Back always returns to the table-selection hub, which carries the
// Dine In / Takeout tabs. The waiter switches modes there via the tabs, so we
// never reopen the order-type modal (that modal is only shown once, on the
// first "Order Now" entry). The hub defaults to dine-in mode.
function goBackFromOrder() {
  // Default the hub to dine-in so the table grid + full step indicator show,
  // and the tabs reflect the active mode. From here the waiter can pick a table
  // (dine-in) or tap the Takeout tab to switch back to takeout.
  currentOrderType = 'dine-in';
  selectedTable = null;
  updateStepIndicator();
  updateOrderTypeTabs();
  renderTables();
  goBackToTables();
}

// ── RESET ORDER FLOW ──
// Returns the interface to a clean initial state so the next order can start
// fresh from the entry screen (Req 4.2, 4.3). Reuses existing helpers
// (updateCart, pill helpers, updateStepIndicator). Called from the submission
// success handler for takeout orders to return to a clean entry screen.
function resetOrderFlow() {
  // Clear order session state
  currentOrderType = null;
  selectedTable = null;
  cart = {};
  updateCart();

  // Clear the order note field
  $('orderNote').value = '';

  // Show the entry screen and hide the order-taking step.
  // NOTE: #orderEntry is a CHILD of #stepTables and overlays the table grid
  // (via z-index). So #stepTables must stay VISIBLE for the entry overlay to
  // show — hiding #stepTables would hide the entry screen too (black screen).
  $('stepTables').classList.remove('hidden', 'out-left');
  $('orderEntry').classList.remove('hidden');
  $('stepOrder').classList.remove('visible', 'in');

  // Reset the step indicator pills to their initial state
  pill1Active();
  pill2Reset();
  pill3Reset();
  updateStepIndicator(); // restore pill1 display for the next order
  updateOrderTypeTabs(); // clear active tab (no order type on the entry screen)
}

// ── ORDER TYPE TABS ──
// Reflects the active order type on the table-selection segmented tabs.
function updateOrderTypeTabs() {
  const dineTab = $('tabDineIn');
  const takeoutTab = $('tabTakeout');
  if (!dineTab || !takeoutTab) return;
  dineTab.classList.toggle('active', currentOrderType === 'dine-in');
  takeoutTab.classList.toggle('active', currentOrderType === 'takeout');
}

// ── STEP INDICATOR ──
// Shows a 2-step flow (Take Order → Submit) for takeout orders by hiding the
// table selection pill and its arrow, and the full 3-step flow for dine-in.
function updateStepIndicator() {
  const pill1 = $('pill1');
  const arrow1 = $('stepArrow1');

  if (currentOrderType === 'takeout') {
    if (pill1) pill1.style.display = 'none';
    if (arrow1) arrow1.style.display = 'none';
  } else {
    if (pill1) pill1.style.display = '';
    if (arrow1) arrow1.style.display = '';
  }
}

// ── STEP PILLS ──
function pill1Done()   { $('pill1').className='step-pill done clickable'; }
function pill1Active() { $('pill1').className='step-pill active'; }
function pill2Active() { $('pill2').className='step-pill active'; }
function pill2Done()   { $('pill2').className='step-pill done'; }
function pill2Reset()  { $('pill2').className='step-pill'; }
function pill3Active() { $('pill3').className='step-pill active clickable'; }
function pill3Reset()  { $('pill3').className='step-pill'; }

$('pill1').addEventListener('click', () => {
  if ($('pill1').classList.contains('done')) {
    $('confirmModal').classList.remove('show');
    // Route via order-type-aware navigation (Req 5.3, 5.4, 5.5).
    goBackFromOrder();
  }
});

// Dedicated back button in the order taking header. Provides a working back
// affordance for takeout orders where pill1 is hidden (Req 5.3, 5.5).
$('backFromOrderBtn').addEventListener('click', () => {
  $('confirmModal').classList.remove('show');
  goBackFromOrder();
});

$('pill3').addEventListener('click', () => {
  if ($('pill2').classList.contains('active') || $('pill2').classList.contains('done')) {
    const items = Object.values(cart);
    if (!items.length) { showToast('⚠ Add items to the cart first.'); return; }
    $('submitOrderBtn').click();
  }
});

// ── MENU ──
function loadMenu() {
  onSnapshot(collection(db, 'menu'), snap => {
    menuItems = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(m => m.available !== false);
    buildCategoryTabs();
    renderMenuGrid();
  });
}

function buildCategoryTabs() {
  const cats = ['all', ...new Set(menuItems.map(m => m.category || 'Other'))];
  $('catScroll').innerHTML = cats.map(c =>
    `<button class="cat-btn${c==='all'?' active':''}" data-cat="${c}" onclick="window._setCat('${c}')">${c==='all'?'All':c}</button>`
  ).join('');
}

window._setCat = cat => {
  activeCat = cat;
  menuPage = 1;
  $('catScroll').querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b.dataset.cat===cat));
  renderMenuGrid();
};

$('menuSearch').addEventListener('input', () => { menuPage = 1; renderMenuGrid(); });

function renderMenuGrid() {
  const ITEMS_PER_PAGE = getItemsPerPage();
  const q = $('menuSearch').value.toLowerCase().trim();
  let items = activeCat === 'all' ? menuItems : menuItems.filter(m => (m.category||'Other') === activeCat);
  if (q) items = items.filter(m => (m.name||'').toLowerCase().includes(q) || (m.description||'').toLowerCase().includes(q));
  const grid = $('menuGrid');

  const oldPager = document.getElementById('menuPagination');
  if (oldPager) oldPager.remove();

  if (!items.length) { grid.innerHTML = '<div style="color:var(--text-muted);font-size:14px;padding:32px;grid-column:1/-1;text-align:center;">No items found.</div>'; return; }

  const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
  if (menuPage > totalPages) menuPage = totalPages;
  const start = (menuPage - 1) * ITEMS_PER_PAGE;
  const pageItems = items.slice(start, start + ITEMS_PER_PAGE);

  grid.innerHTML = pageItems.map(m => {
   const inCart       = cart[m.id];
const isBento      = isBentoItem(m.name || '');
const bentoOpen    = isBentoWindowOpen();
const bentoBlocked = isBento && !bentoOpen;
const served       = menuOrderCounts[m.name || '']?.served || 0;
const limitReached = m.serveLimit !== null && m.serveLimit !== undefined && served >= m.serveLimit;
const unavail      = m.available === false || bentoBlocked || limitReached;
const remaining = (m.serveLimit !== null && m.serveLimit !== undefined) ? Math.max(m.serveLimit - served, 0) : null;
const remainingHtml = remaining !== null
  ? `<div class="serving-left-tag">${remaining} serving${remaining === 1 ? '' : 's'} left</div>`
  : '';
    const safeName = (m.name||'—').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const safeDesc = (m.description||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const safeCat  = (m.category||'Other').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const atMax = inCart && inCart.qty >= 20;

    // Tag shown on card — bento-blocked gets its own blue time tag
    const tagHtml = bentoBlocked
  ? `<div class="unavail-tag bento-time-tag">11AM–3PM</div>`
  : (limitReached ? `<div class="unavail-tag">Sold Out</div>`
  : (m.available === false ? `<div class="unavail-tag">Unavail.</div>` : ''));

    return `<div class="menu-item-card${unavail?' unavailable':inCart?' in-cart':''}" onclick="window._addToCart('${m.id}')">
      ${inCart ? `<div class="cart-badge-pill${atMax?' at-max':''}">×${inCart.qty}${atMax?' MAX':''}</div>` : ''}
      ${tagHtml}
      <div class="mic-img-placeholder" id="wimg-${m.id}" style="display:flex;"></div>
      <div class="mic-body">
        <div class="mic-cat">${safeCat}</div>
        <div class="mic-name">${safeName}</div>
        <div class="mic-desc">${safeDesc}</div>
${bentoBlocked ? `<div class="bento-window-hint">Available 11:00 AM – 3:00 PM only</div>` : ''}
<div class="mic-footer">
  <div class="mic-price-wrap">
    <span class="mic-price">₱${(m.price||0).toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
    ${remainingHtml}
  </div>
  ${!unavail ? `<button class="mic-add${atMax?' mic-add-disabled':''}" onclick="event.stopPropagation();window._addToCart('${m.id}')" ${atMax?'title="Maximum 20 reached"':''}>+</button>` : ''}
</div>
      </div>
    </div>`;
  }).join('');

  pageItems.forEach((m, i) => {
    if (!m.imageUrl) return;
    setTimeout(() => {
      const slot = document.getElementById(`wimg-${m.id}`);
      if (!slot) return;
      const img = document.createElement('img');
      img.className = 'mic-img';
      img.alt = m.name || '';
      img.onerror = () => { img.remove(); slot.style.display = 'flex'; };
      img.onload  = () => { slot.style.display = 'none'; };
      slot.parentNode.insertBefore(img, slot);
      img.src = m.imageUrl;
    }, i * 20);
  });

  if (totalPages > 1) {
    const menuPanel = document.querySelector('.menu-panel');
    const pager = document.createElement('div');
    pager.id = 'menuPagination';
    pager.className = 'menu-pagination';

    const isTablet = window.innerWidth <= 1024;

    const prevBtn = document.createElement('button');
    prevBtn.className = 'pg-btn' + (menuPage === 1 ? ' pg-disabled' : '');
    prevBtn.textContent = '‹ Prev';
    prevBtn.disabled = menuPage === 1;
    prevBtn.onclick = () => { menuPage--; renderMenuGrid(); grid.scrollTop = 0; };
    pager.appendChild(prevBtn);

    const pillWrap = document.createElement('div');
    pillWrap.className = 'pg-pills';

    const makePill = (p) => {
      const pill = document.createElement('button');
      pill.className = 'pg-pill' + (p === menuPage ? ' pg-pill-active' : '');
      pill.textContent = p;
      pill.onclick = ((page) => () => { menuPage = page; renderMenuGrid(); grid.scrollTop = 0; })(p);
      pillWrap.appendChild(pill);
    };

    const makeDots = () => {
      const dots = document.createElement('span');
      dots.className = 'pg-dots';
      dots.textContent = '…';
      pillWrap.appendChild(dots);
    };

    if (isTablet && totalPages > 7) {
      const pages = new Set([1, totalPages, menuPage, menuPage - 1, menuPage + 1].filter(p => p >= 1 && p <= totalPages));
      const sorted = [...pages].sort((a, b) => a - b);
      sorted.forEach((p, i) => {
        if (i > 0 && p - sorted[i - 1] > 1) makeDots();
        makePill(p);
      });
    } else {
      for (let p = 1; p <= totalPages; p++) makePill(p);
    }

    pager.appendChild(pillWrap);

    const nextBtn = document.createElement('button');
    nextBtn.className = 'pg-btn' + (menuPage === totalPages ? ' pg-disabled' : '');
    nextBtn.textContent = 'Next ›';
    nextBtn.disabled = menuPage === totalPages;
    nextBtn.onclick = () => { menuPage++; renderMenuGrid(); grid.scrollTop = 0; };
    pager.appendChild(nextBtn);

    const countLbl = document.createElement('div');
    countLbl.className = 'pg-count';
    countLbl.textContent = `${start + 1}–${Math.min(start + ITEMS_PER_PAGE, items.length)} of ${items.length} items`;
    pager.appendChild(countLbl);

    menuPanel.appendChild(pager);
  }
}

// ── ADD TO CART — enforces bento time-window + max qty 20 ──
window._addToCart = id => {
  const item = menuItems.find(m => m.id === id);
  if (!item || item.available === false) return;

  // Bento time-window gate
  if (isBentoItem(item.name || '') && !isBentoWindowOpen()) {
    showToast('⏰ Bento items are only available 11:00 AM – 3:00 PM.');
    return;
  }

 // Serve limit check
  if (item.serveLimit !== null && item.serveLimit !== undefined) {
    const served = menuOrderCounts[item.name || '']?.served || 0;
    const inCartQty = cart[id]?.qty || 0;
    if (served + inCartQty >= item.serveLimit) {
      showToast(`⚠ "${item.name}" has reached its serving limit for today.`);
      return;
    }
  }

  if (cart[id]) {
    if (cart[id].qty >= 20) {
      showToast('⚠ Maximum 20 servings per item allowed.');
      return;
    }
    cart[id].qty++;
  } else {
    cart[id] = { id, name: item.name, price: item.price, qty: 1, category: item.category||'Other' };
  }
  updateCart();
  renderMenuGrid();
};

window._removeFromCart = id => {
  if (!cart[id]) return;
  cart[id].qty--;
  if (cart[id].qty <= 0) delete cart[id];
  updateCart();
  renderMenuGrid();
};

$('clearCartBtn').onclick = () => { cart = {}; updateCart(); renderMenuGrid(); };

function updateCart() {
  const items = Object.values(cart);
  const total = items.reduce((s, i) => s + i.price * i.qty, 0);
  $('cartCount').textContent = `${items.reduce((s,i)=>s+i.qty,0)} items`;
  $('cartTotal').textContent = `₱${total.toLocaleString('en-PH',{minimumFractionDigits:2})}`;
  $('submitOrderBtn').disabled = items.length === 0;
  const ci = $('cartItems');
  if (!items.length) {
    ci.innerHTML = '<div class="cart-empty"><div class="cart-empty-icon">🛒</div>No items yet.<br><span style="font-size:12px">Tap menu items to add.</span></div>';
    return;
  }
  ci.innerHTML = items.map(i => {
    const atMax = i.qty >= 20;
    return `
    <div class="cart-item">
      <div class="ci-info">
        <div class="ci-name">${i.name}</div>
        <div class="ci-price">₱${(i.price*i.qty).toLocaleString('en-PH',{minimumFractionDigits:2})}</div>
      </div>
      <div class="ci-controls">
        <button class="qty-btn" onclick="window._removeFromCart('${i.id}')">−</button>
        <span class="qty-num">${i.qty}</span>
        <button class="qty-btn${atMax?' qty-btn-disabled':''}" onclick="window._addToCart('${i.id}')" ${atMax?'title="Max 20"':''}>+</button>
      </div>
    </div>`;
  }).join('');
}

// ── ORDER SUBMISSION ──
$('submitOrderBtn').onclick = () => {
  const items = Object.values(cart);
  // Takeout orders have no selected table; only dine-in orders require one (Req 3.1, 6.4).
  if (!items.length) return;
  if (currentOrderType !== 'takeout' && !selectedTable) return;
  const total = items.reduce((s,i)=>s+i.price*i.qty,0);
  // Order-type context line at the top of the confirmation body (Req 7.4, 7.5).
  const orderTypeLine = currentOrderType === 'takeout'
    ? `<div class="confirm-order-type"><i class="fa-solid fa-bag-shopping"></i> Order Type: <strong>Takeout</strong></div>`
    : `<div class="confirm-order-type"><i class="fa-solid fa-utensils"></i> Table: <strong>${selectedTable}</strong></div>`;
  $('confirmModalBody').innerHTML =
    orderTypeLine +
    items.map(i => `<div class="confirm-row">
      <div><div class="confirm-item">${i.name}</div><div class="confirm-qty">× ${i.qty}</div></div>
      <div class="confirm-sub">₱${(i.price*i.qty).toLocaleString('en-PH',{minimumFractionDigits:2})}</div>
    </div>`).join('') +
    `<div class="confirm-total-row"><span class="confirm-total-label">Total</span><span class="confirm-total-val">₱${total.toLocaleString('en-PH',{minimumFractionDigits:2})}</span></div>`;
  $('confirmModal').classList.add('show');
  pill2Done(); pill3Active();
};

$('confirmModalClose').onclick = $('confirmModalCancel').onclick = () => {
  $('confirmModal').classList.remove('show');
  pill2Active(); pill3Reset();
};

// ── buildOrderDocument ──
// Pure helper that constructs the Firestore order document for a brand-new
// order from the current cart and order context (Req 1.1, 1.3, 1.4, 1.5).
// New orders enter preparation automatically (status = STATUS.PREPARING); the
// manual "Start Preparing" admin step is gone. The document intentionally
// omits the server timestamps (createdAt/updatedAt) — those are attached at
// write time via serverTimestamp() — so this helper stays pure and testable.
// tableNumber is the selected table for dine-in and null for takeout.
function buildOrderDocument(cartItems, { orderType, waiterId, waiterName, selectedTable }) {
  const items = Object.values(cartItems).map(i => ({
    id: i.id,
    name: i.name,
    price: i.price,
    qty: Math.min(i.qty, 20),
    category: i.category || 'Other'
  }));
  const total = items.reduce((s, i) => s + i.price * i.qty, 0);
  return {
    orderType,
    waiterId,
    waiterName,
    items,
    total,
    status: STATUS.PREPARING,
    tableNumber: orderType === 'takeout' ? null : selectedTable
  };
}

$('confirmOrderBtn').onclick = async () => {
  const btn = $('confirmOrderBtn');
  btn.disabled = true; btn.classList.add('loading');
  const newItems = Object.values(cart);
  const note     = $('orderNote').value.trim();

  // Order type guard: prevent creating an order with no order type set (Req 6.3, 6.4).
  if (!currentOrderType) {
    showToast('⚠️ Order type not set. Please restart order flow.');
    btn.disabled = false; btn.classList.remove('loading');
    return;
  }

  // Dine-in table guard: dine-in orders must have a selected table before submit (Req 6.3).
  if (currentOrderType === 'dine-in' && !selectedTable) {
    showToast('⚠️ Please select a table for dine-in orders.');
    btn.disabled = false; btn.classList.remove('loading');
    return;
  }

  // Frontend qty guard
  const overLimit = newItems.filter(i => i.qty > 20 || i.qty < 1);
  if (overLimit.length) {
    showToast('⚠ Item quantities must be between 1 and 20.');
    btn.disabled = false; btn.classList.remove('loading');
    return;
  }

  // Final bento time-window guard before submit
  const bentoOutOfWindow = newItems.filter(i => isBentoItem(i.name || '') && !isBentoWindowOpen());
  if (bentoOutOfWindow.length) {
    const names = bentoOutOfWindow.map(i => i.name).join(', ');
    showToast(`⏰ Cannot submit: ${names} outside 11AM–3PM window.`);
    btn.disabled = false; btn.classList.remove('loading');
    return;
  }

  try {
    const itemsForOrder = newItems.map(i=>({
      id: i.id,
      name: i.name,
      price: i.price,
      qty: Math.min(i.qty, 20),
      category: i.category||'Other'
    }));
    const total = itemsForOrder.reduce((s,i)=>s+i.price*i.qty,0);

    // ── Re-order onto the same ticket ────────────────────────────────
    // If this dine-in table's current order is "served_unpaid" (food already
    // delivered, bill not settled yet) and the customer orders again, the new
    // items go onto that SAME order document instead of creating a new one.
    // That way the cashier's receipt for this table shows the full order —
    // everything the table ever ordered — as a single bill.
    let existingServedUnpaidOrder = null;
    if (currentOrderType === 'dine-in' && selectedTable) {
      existingServedUnpaidOrder = allOrders.find(o =>
        o.tableNumber === selectedTable &&
        o.waiterId === waiterId &&
        o.status === 'served_unpaid'
      );
    }

    if (existingServedUnpaidOrder) {
      // Merge by item id: same item ordered again → add to its quantity;
      // a new item → appended as its own line.
      const mergedItems = (existingServedUnpaidOrder.items || []).map(i => ({ ...i }));
      itemsForOrder.forEach(newItem => {
        const match = mergedItems.find(i => i.id === newItem.id);
        if (match) match.qty += newItem.qty;
        else mergedItems.push(newItem);
      });
      const mergedTotal = mergedItems.reduce((s, i) => s + i.price * i.qty, 0);
      const mergedNote = [existingServedUnpaidOrder.note, note].filter(Boolean).join(' | ');

      // newItems records exactly what THIS re-order added — id, name, and the
      // qty just ordered (not the merged running total) — so admin-orders.js
      // (Live Orders) can announce precisely what's new, e.g. "2× Ice Cream",
      // even when it's more of something the table already had rather than a
      // brand-new item. Cleared once the kitchen marks the order served again.
      await updateDoc(doc(db, 'orders', existingServedUnpaidOrder.id), {
        items: mergedItems,
        total: mergedTotal,
        note: mergedNote,
        status: 'preparing', // the new items still need to be cooked & re-served
        newItems: itemsForOrder.map(i => ({ id: i.id, name: i.name, qty: i.qty })),
        updatedAt: serverTimestamp()
      });

      $('confirmModal').classList.remove('show');
      const os = $('orderSuccess');
      $('orderSuccessSub').textContent = `Added to Table ${selectedTable}'s open bill · ₱${mergedTotal.toLocaleString('en-PH',{minimumFractionDigits:2})}`;
      os.classList.add('show');
      cart = {}; $('orderNote').value = '';
      updateCart(); renderMenuGrid();
      setTimeout(() => {
        os.classList.remove('show');
        resetOrderFlow();
      }, 2200);
      return;
    }

    // ── No served_unpaid ticket for this table — create a brand-new order ──
    // buildOrderDocument sets status = STATUS.PREPARING and resolves tableNumber
    // (selected table for dine-in, null for takeout). The note and server
    // timestamps are attached here at write time (Req 1.1, 1.2, 1.3, 1.4, 1.5).
    const orderData = {
      ...buildOrderDocument(cart, {
        orderType: currentOrderType,
        waiterId,
        waiterName,
        selectedTable
      }),
      note,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await addDoc(collection(db,'orders'), orderData);

    $('confirmModal').classList.remove('show');
    const os = $('orderSuccess');
    // Show "Takeout Order" for takeout, otherwise show the table number (Req 7.1, 7.2).
    const orderLabel = currentOrderType === 'takeout' ? 'Takeout Order' : `Table ${selectedTable}`;
    $('orderSuccessSub').textContent = `${orderLabel} · ₱${total.toLocaleString('en-PH',{minimumFractionDigits:2})}`;
    os.classList.add('show');
    cart = {}; $('orderNote').value = '';
    updateCart(); renderMenuGrid();
    setTimeout(() => {
      os.classList.remove('show');
      // After a successful submission (dine-in or takeout), always return to the
      // Order Now entry screen so the next order starts fresh from order-type
      // selection. resetOrderFlow() clears state, shows the entry screen, and
      // hides the table/order steps. (Table status for dine-in is written at
      // table-selection time; takeout never touches the tables collection.)
      resetOrderFlow();
    }, 2200);
  } catch(e) {
    console.error(e);
    showToast('❌ Failed to submit order. Please retry.');
  } finally {
    btn.disabled = false; btn.classList.remove('loading');
  }
};

$('pill1').className = 'step-pill active';

// ── ORDER TYPE BUTTON HANDLERS ──
// Guard each handler against a missing DOM node so a broken element logs an
// error and shows a toast rather than throwing at load time.
const selectDineInBtn = $('selectDineIn');
if (selectDineInBtn) {
  selectDineInBtn.onclick = () => { selectOrderType('dine-in'); };
} else {
  console.error('Dine In button element not found');
}

const selectTakeoutBtn = $('selectTakeout');
if (selectTakeoutBtn) {
  selectTakeoutBtn.onclick = () => { selectOrderType('takeout'); };
} else {
  console.error('Takeout button element not found');
}

// ── ORDER TYPE SWITCH (persistent navbar tabs) ──
// Always-visible switcher. Clicking a tab enters/switches that mode from
// anywhere (entry screen, table selection, or order taking):
//   - Dine In → show table selection (waiter then picks a table)
//   - Takeout → jump straight to takeout order taking
// The cart is order-type-agnostic, so switching mid-order preserves items.
const tabDineIn = $('tabDineIn');
const tabTakeout = $('tabTakeout');
if (tabDineIn) {
  tabDineIn.onclick = () => {
    if (currentOrderType === 'dine-in') return; // already in dine-in mode
    selectOrderType('dine-in');
  };
}
if (tabTakeout) {
  tabTakeout.onclick = () => {
    if (currentOrderType === 'takeout') return; // already in takeout mode
    selectOrderType('takeout');
  };
}

// ── CATEGORY SCROLL BUTTONS (looping) ──
let catScrollWired = false;
function setupCatScrollBtns() {
  if (catScrollWired) return;
  const btnL = document.getElementById('catScrollLeft');
  const btnR = document.getElementById('catScrollRight');
  const s    = document.getElementById('catScroll');
  if (!btnL || !btnR || !s) return;

  const STEP = 220;

  btnL.addEventListener('click', function(e) {
    e.preventDefault(); e.stopPropagation();
    if (s.scrollLeft <= 2) { s.scrollLeft = s.scrollWidth; }
    else { s.scrollLeft -= STEP; }
  });

  btnR.addEventListener('click', function(e) {
    e.preventDefault(); e.stopPropagation();
    if (s.scrollLeft >= s.scrollWidth - s.clientWidth - 2) { s.scrollLeft = 0; }
    else { s.scrollLeft += STEP; }
  });

  catScrollWired = true;
}

// ════════════════════════════════════════════════════════════════════════
// ORDER-SLIP PANEL (Req 6)
// A panel on the right of the waiter interface that lists the signed-in
// waiter's active orders as clickable slips. It renders straight from the live
// `allOrders` snapshot filtered by `belongsInWaiterSlips(order, waiterId)`, so
// new orders (6.3) and status changes (6.4) refresh automatically whenever the
// orders `onSnapshot` callback re-runs `renderOrderSlips()`. Selecting a slip
// sets `selectedSlipOrderId` and shows a detail view of that order (6.5). All
// order-derived text is escaped before injection (6.6).
//
// NOTE: the Served action button is intentionally NOT implemented here — task
// 5.6 owns it. The detail view leaves a clearly-marked placeholder container
// (`#orderSlipServedSlot`) where that control will be wired.
// ════════════════════════════════════════════════════════════════════════

// Escape order-derived text before injecting into HTML (Req 6.6). Mirrors the
// cashier portal's helper: uses the DOM to encode &, <, >, and quotes safely.
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

// Human-readable label for an order status, covering the full recognized set
// plus the legacy `pending` value.
function slipStatusLabel(status) {
  switch (status) {
    case STATUS.PREPARING:     return 'Preparing';
    case STATUS.SERVED_UNPAID: return 'Served · Unpaid';
    case STATUS.PAID_UNSERVED: return 'Paid · Preparing';
    case STATUS.SERVED_PAID:   return 'Served · Paid';
    case STATUS.COMPLETED:     return 'Completed';
    case STATUS.CANCELLED:     return 'Cancelled';
    case STATUS.PENDING:       return 'Pending';
    default:                   return status ? String(status) : 'Unknown';
  }
}

// A short, readable status token used for the slip's coloured badge class.
function slipStatusClass(status) {
  switch (status) {
    case STATUS.SERVED_UNPAID:
    case STATUS.SERVED_PAID:   return 'served';
    case STATUS.PAID_UNSERVED: return 'paid';
    case STATUS.PREPARING:
    case STATUS.PENDING:       return 'preparing';
    default:                   return 'other';
  }
}

// Location label: `Table N` for dine-in, `Takeout` for takeout, with safe
// fallbacks for malformed orders.
function slipLocationLabel(order) {
  if (order?.orderType === 'takeout') return 'Takeout';
  if (order?.tableNumber != null)     return `Table ${order.tableNumber}`;
  return 'Table —';
}

// Short display form of the order id.
function slipShortId(id) {
  return id ? `#${String(id).slice(-5).toUpperCase()}` : '#—';
}

// Render the list of order slips belonging to the signed-in waiter (Req 6.1,
// 6.2). Orders that are completed or cancelled are excluded by
// `belongsInWaiterSlips`.
function renderOrderSlips() {
  const list = $('orderSlipList');
  if (!list) return;

  const slips = allOrders.filter(o => belongsInWaiterSlips(o, waiterId));

  if (!slips.length) {
    selectedSlipOrderId = null;
    list.innerHTML = `<div class="slip-empty">
      <div class="slip-empty-icon"><i class="fa-solid fa-receipt"></i></div>
      No active orders yet.<br>
      <span class="slip-empty-sub">Submitted orders appear here.</span>
    </div>`;
    renderOrderSlipDetail();
    return;
  }

  // Drop a stale selection if the selected order is no longer in the list.
  if (selectedSlipOrderId && !slips.some(o => o.id === selectedSlipOrderId)) {
    selectedSlipOrderId = null;
  }

  list.innerHTML = slips.map(o => {
    const itemCount = (o.items || []).length;
    const selected  = o.id === selectedSlipOrderId ? ' selected' : '';
    return `<button type="button" class="order-slip${selected}" onclick="window._selectSlip('${o.id}')">
      <div class="slip-top">
        <span class="slip-id">${escapeHtml(slipShortId(o.id))}</span>
        <span class="slip-badge ${slipStatusClass(o.status)}">${escapeHtml(slipStatusLabel(o.status))}</span>
      </div>
      <div class="slip-loc">${escapeHtml(slipLocationLabel(o))}</div>
      <div class="slip-meta">${itemCount} item${itemCount !== 1 ? 's' : ''}</div>
    </button>`;
  }).join('');

  renderOrderSlipDetail();
}

// Render the detail view for the currently-selected slip (Req 6.5): items,
// note, totals, and status. Leaves a clearly-marked placeholder container for
// the Served button (task 5.6).
function renderOrderSlipDetail() {
  const detail = $('orderSlipDetail');
  if (!detail) return;

  const order = selectedSlipOrderId
    ? allOrders.find(o => o.id === selectedSlipOrderId)
    : null;

  if (!order) {
    detail.innerHTML = `<div class="slip-detail-empty">
      <i class="fa-solid fa-hand-pointer"></i>
      Select an order slip to view its details.
    </div>`;
    return;
  }

  const items = order.items || [];
  const itemsHtml = items.length
    ? items.map(i => `<div class="slip-detail-item">
        <span class="sdi-qty">${Number(i.qty) || 0}×</span>
        <span class="sdi-name">${escapeHtml(i.name || '—')}</span>
        <span class="sdi-price">₱${((Number(i.price) || 0) * (Number(i.qty) || 0)).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
      </div>`).join('')
    : '<div class="slip-detail-item"><span class="sdi-name">No items.</span></div>';

  const total = Number(order.total)
    || items.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 0), 0);

  const noteHtml = order.note
    ? `<div class="slip-detail-note"><strong>Note:</strong> ${escapeHtml(order.note)}</div>`
    : '';

  // Keep the takeout action visible but disabled until payment arrives. The
  // live order snapshot re-renders it as soon as the cashier records payment.
  const takeoutAwaitingPayment = isTakeout(order) && canServeOrder(order) && !isPaid(order);
  const servedBtnHtml = shouldShowServedButton(order)
    ? `<button type="button" class="slip-served-btn" onclick="window._markSlipServed('${order.id}')"><i class="fa-solid fa-utensils"></i> Mark as Served</button>`
    : takeoutAwaitingPayment
      ? `<button type="button" class="slip-served-btn" disabled title="Payment is required before serving a takeout order."><i class="fa-solid fa-lock"></i> Payment Required Before Serving</button>`
      : '';

  // Print a kitchen order slip (items & qty, no prices). Use the browser print
  // dialog's "Save as PDF" to export a PDF.
  const printBtnHtml = `<button type="button" class="slip-print-btn" onclick="window._printSlip('${order.id}')"><i class="fa-solid fa-print"></i> Print Order Slip</button>`;

  detail.innerHTML = `
    <div class="slip-detail-head">
      <div class="slip-detail-title">${escapeHtml(slipShortId(order.id))}</div>
      <span class="slip-badge ${slipStatusClass(order.status)}">${escapeHtml(slipStatusLabel(order.status))}</span>
    </div>
    <div class="slip-detail-loc">${escapeHtml(slipLocationLabel(order))}</div>
    <div class="slip-detail-items">${itemsHtml}</div>
    ${noteHtml}
    <div class="slip-detail-total">
      <span class="sdt-label">Total</span>
      <span class="sdt-val">₱${total.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
    </div>
    <div id="orderSlipServedSlot" class="slip-detail-served-slot">${servedBtnHtml}${printBtnHtml}</div>
  `;
}

// Select (or re-select) an order slip and render its detail view (Req 6.5).
window._selectSlip = (id) => {
  selectedSlipOrderId = id;
  renderOrderSlips();
};

// Mark the selected order served (Req 7). An unpaid order becomes served_unpaid
// (never 'completed' — Req 8.5); a paid_unserved order becomes served_paid.
// servedAt is first-write-wins (Req 9.4). The live onSnapshot re-renders the
// panel automatically after the write.
window._markSlipServed = async (id) => {
  const order = allOrders.find(o => o.id === id);
  if (isTakeout(order) && canServeOrder(order) && !isPaid(order)) {
    showToast('Payment is required before serving a takeout order.');
    return;
  }
  if (!order || !shouldShowServedButton(order)) {
    showToast('⚠ This order can no longer be marked served.');
    return;
  }
  try {
    await updateDoc(doc(db, 'orders', id), {
      status: nextStatusAfterServed(order),
      ...servedAtUpdate(order, serverTimestamp()),
      updatedAt: serverTimestamp(),
    });
    showToast('✓ Order marked as served.');
  } catch (e) {
    console.error('markSlipServed:', e);
    showToast('❌ Failed to mark served. Please retry.');
  }
};

// Print a kitchen order slip for the selected order — items and quantities only,
// no prices (that's the cashier's receipt). Opens a print window; the browser's
// print dialog offers "Save as PDF" to export a PDF. Mirrors the cashier
// portal's printOrderSlip format for a consistent kitchen copy.
window._printSlip = (id) => {
  const order = allOrders.find(o => o.id === id);
  if (!order) { showToast('⚠ Order not found.'); return; }

  const takeout = order.orderType === 'takeout' || !order.tableNumber;
  const timestamp = order.createdAt?.toDate
    ? order.createdAt.toDate().toLocaleString('en-PH', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
      })
    : '—';

  const itemsRows = (order.items || []).map(item => `
    <tr>
      <td class="qty-col">${Number(item.qty) || 0}×</td>
      <td>${escapeHtml(item.name || '—')}</td>
    </tr>
  `).join('');

  const printWindow = window.open('', '_blank', 'width=380,height=600');
  if (!printWindow) { showToast('❌ Allow popups to print order slips.'); return; }

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
    .mr { display: flex; justify-content: space-between; font-size: 12px; padding: 2px 0; }
    .ml { color: #666; }
    .mv { font-weight: 700; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; margin-top: 6px; }
    td { padding: 7px 0; border-bottom: 1px dashed #ccc; }
    tbody tr:last-child td { border-bottom: none; }
    .qty-col { width: 42px; font-weight: 700; color: #b8821e; }
    .ft { text-align: center; margin-top: 16px; font-size: 10px; color: #777; letter-spacing: 0.08em; text-transform: uppercase; }
    .takeout-banner {
      text-align: center; background: #e67e22; color: #fff; font-weight: 700;
      font-size: 13px; letter-spacing: 0.06em; padding: 6px 0; margin-bottom: 8px; border-radius: 4px;
    }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <div class="rh">
    <div class="rn">Salo sa Antipolo</div>
    <div class="rs">Order Slip · Kitchen Copy</div>
  </div>
  <hr class="s"/>
  ${takeout ? `<div class="takeout-banner">🥡 TAKEOUT ORDER</div>` : ''}
  <div class="mr"><span class="ml">Order:</span><span class="mv">#${String(order.id).slice(-5).toUpperCase()}</span></div>
  <div class="mr"><span class="ml">${takeout ? 'Type:' : 'Table:'}</span><span class="mv">${escapeHtml(slipLocationLabel(order))}</span></div>
  <div class="mr"><span class="ml">Waiter:</span><span class="mv">${escapeHtml(order.waiterName || '—')}</span></div>
  <div class="mr"><span class="ml">Time:</span><span class="mv">${timestamp}</span></div>
  ${order.note ? `<div class="mr" style="margin-top:4px"><span class="ml">Note:</span><span class="mv">${escapeHtml(order.note)}</span></div>` : ''}
  <hr class="d"/>
  <table><tbody>${itemsRows}</tbody></table>
  <div class="ft">— End of Order —</div>
</body>
</html>`);

  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 250);
};
