import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, addDoc, updateDoc,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app  = initializeApp({ apiKey:"AIzaSyCKQneulIrm9KWuOg69f29nFo6TGz2PF4w", authDomain:"salo-sa-antipolo.firebaseapp.com", projectId:"salo-sa-antipolo", storageBucket:"salo-sa-antipolo.firebasestorage.app", messagingSenderId:"60032898501", appId:"1:60032898501:web:3a4e663fee4ccd2adae7ac" });
const auth = getAuth(app);
const db   = getFirestore(app);

const $ = id => document.getElementById(id);
const showToast = m => { $('toastMsg').textContent=m; $('toast').classList.add('show'); setTimeout(()=>$('toast').classList.remove('show'),3000); };

// ── State ──
let waiterName = '', waiterId = '', menuItems = [], cart = {}, selectedTable = null, activeCat = 'all';
let allOrders = [];
let tablesData = {};
let pendingOccupyTable = null;
let pendingWalkinTable = null;
let menuPage = 1;
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

// ── Auth guard ──
onAuthStateChanged(auth, async user => {
  if (!user) { window.location.href = 'waiter-login.html'; return; }
  const snap = await getDoc(doc(db, 'Users', user.uid));
  if (!snap.exists()) { await signOut(auth); window.location.href = 'waiter-login.html'; return; }
  const data = snap.data();
  if (data.role !== 'waiter') { await signOut(auth); window.location.href = 'waiter-login.html'; return; }
  if (data.status === 'pending') {
    await signOut(auth);
    sessionStorage.setItem('waiterAuthMsg', 'Your account is pending admin approval. Please check back later.');
    window.location.href = 'waiter-login.html'; return;
  }
  if (data.status === 'rejected') {
    await signOut(auth);
    sessionStorage.setItem('waiterAuthMsg', 'Your registration was declined. Please contact the restaurant manager.');
    window.location.href = 'waiter-login.html'; return;
  }
  waiterName = data.name || user.email;
  waiterId   = user.uid;
  $('waiterAvatar').textContent = waiterName[0].toUpperCase();
  init();
});

$('logoutBtn').onclick = async () => { await signOut(auth); window.location.href = 'waiter-login.html'; };

async function init() {
  await loadMenu();

  onSnapshot(query(collection(db, 'orders'), orderBy('createdAt', 'desc')), snap => {
    allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTables();
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

// ── TABLE RENDERING ──
let tablesList = [];

function renderTables() {
  const orderOccupied = {};
  allOrders.filter(o => ['pending','preparing','served'].includes(o.status)).forEach(o => {
    if (o.tableNumber) orderOccupied[o.tableNumber] = { status: o.status, waiterName: o.waiterName, waiterId: o.waiterId };
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

    const displayLabel = entry.name ? entry.name : `Table ${n}`;
    const capInfo = entry.capacity ? `<div class="table-cap">${entry.capacity} seats</div>` : '';

    let stClass, badge, badgeLbl, meta, icon, yoursInd = '';

    if (isYours) {
      stClass = 'yours'; badge = 'yours'; badgeLbl = 'Your Table';
      icon = ''; meta = 'Active order';
      yoursInd = `<div class="yours-indicator">YOURS</div>`;
    } else if (isReserved) {
      stClass = 'reserved'; badge = 'reserved'; badgeLbl = 'Reserved';
      icon = '';
      const res = tableDoc.reservation || {};
      meta = `${res.guestName || 'Guest'} · ${res.time || ''}`;
    } else if (isTakenOrder) {
      stClass = 'occupied'; badge = 'occupied'; badgeLbl = 'Occupied';
      icon = ''; meta = orderInfo.waiterName || 'Another waiter';
    } else if (isWalkIn) {
      stClass = 'walk-in'; badge = 'walk-in'; badgeLbl = 'Walk-in';
      icon = '';
      meta = (isWalkInYours ? '(You) · ' : (tableDoc.waiterName ? tableDoc.waiterName + ' · ' : '')) + 'Guests seated';
      if (isWalkInYours) yoursInd = `<div class="yours-indicator" style="color:var(--orange)">YOURS</div>`;
    } else if (isOccupiedNoOrder) {
      stClass = isOccupiedYours ? 'yours' : 'occupied';
      badge   = isOccupiedYours ? 'yours' : 'occupied';
      badgeLbl = isOccupiedYours ? 'Your Table' : 'Occupied';
      icon = '';
      meta = isOccupiedYours ? 'Guest arrived · Taking order' : tableDoc.waiterName || 'Another waiter';
      if (isOccupiedYours) yoursInd = `<div class="yours-indicator">YOURS</div>`;
    } else {
      stClass = 'free'; badge = 'free'; badgeLbl = 'Available';
      icon = ''; meta = 'Tap to seat guests';
    }

    return `<div class="table-tile ${stClass}" onclick="window._selectTable(${n}, '${stClass}', ${isWalkIn})">
      ${yoursInd}
      <div class="table-num">${displayLabel}</div>
      ${capInfo}
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
    showToast('Failed to mark table. Please retry.');
  } finally {
    btn.disabled = false; btn.classList.remove('loading');
  }
};

// ── WALK-IN OPTIONS MODAL ──
window._selectTable = (num, stClass, isWalkIn) => {
  if (stClass === 'occupied') { showToast('This table has an active order from another waiter.'); return; }
  if (stClass === 'reserved') { window._openReservedModal(num); return; }

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
      showToast(`Table ${pendingWalkinTable} marked as free.`);
      pendingWalkinTable = null;
    } catch(e) {
      console.error(e);
      showToast('Failed to update table. Please retry.');
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
    if (!tableDoc?.docId) { showToast('Table document not found.'); return; }
    await updateDoc(doc(db, 'tables', tableDoc.docId), {
      status: 'occupied', waiterId, waiterName, lastUpdated: serverTimestamp()
    });
    $('reservedModal').classList.remove('show');
    goToOrder(num);
  } catch(e) {
    console.error(e);
    showToast('Failed to confirm arrival. Please retry.');
  } finally {
    btn.disabled = false; btn.classList.remove('loading');
  }
};

function goToOrder(num) {
  selectedTable = num;
  $('selectedTableLabel').textContent = `Table ${num}`;
  pill1Done(); pill2Active();
  const st = $('stepTables'), so = $('stepOrder');
  st.classList.add('out-left');
  so.classList.add('visible');
  requestAnimationFrame(() => so.classList.add('in'));
  setTimeout(() => st.classList.add('hidden'), 400);
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
    goBackToTables();
  }
});

$('pill3').addEventListener('click', () => {
  if ($('pill2').classList.contains('active') || $('pill2').classList.contains('done')) {
    const items = Object.values(cart);
    if (!items.length) { showToast('Add items to the cart first.'); return; }
    $('submitOrderBtn').click();
  }
});

// ── MENU ──
async function loadMenu() {
  const snap = await getDocs(collection(db, 'menu'));
  menuItems = snap.docs.map(d => ({ id:d.id, ...d.data() })).filter(m => m.available !== false);
  buildCategoryTabs();
  renderMenuGrid();
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
    const inCart  = cart[m.id];
    const unavail = m.available === false;
    const safeName = (m.name||'—').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const safeDesc = (m.description||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const safeCat  = (m.category||'Other').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    // Show qty limit warning badge when at max
    const atMax = inCart && inCart.qty >= 20;
    return `<div class="menu-item-card${unavail?' unavailable':inCart?' in-cart':''}" onclick="window._addToCart('${m.id}')">
      ${inCart ? `<div class="cart-badge-pill${atMax?' at-max':''}">×${inCart.qty}${atMax?' MAX':''}</div>` : ''}
      ${unavail ? `<div class="unavail-tag">Unavail.</div>` : ''}
      <div class="mic-img-placeholder" id="wimg-${m.id}" style="display:flex;"><img src="image/logo.png" alt="Salo sa Antipolo" class="mic-logo-placeholder"/></div>
      <div class="mic-body">
        <div class="mic-cat">${safeCat}</div>
        <div class="mic-name">${safeName}</div>
        <div class="mic-desc">${safeDesc}</div>
        <div class="mic-footer">
          <span class="mic-price">₱${(m.price||0).toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
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
      img.onerror = () => { img.remove(); slot.innerHTML = '<img src="image/logo.png" alt="Salo sa Antipolo" class="mic-logo-placeholder"/>'; slot.style.display = 'flex'; };
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

// ═══════════════════════════════════════════════════════════════════
// IMPROVEMENT #4 — _addToCart: enforce max qty 20 per item
// ═══════════════════════════════════════════════════════════════════
window._addToCart = id => {
  const item = menuItems.find(m => m.id === id);
  if (!item || item.available === false) return;
  if (cart[id]) {
    if (cart[id].qty >= 20) {
      showToast('Maximum 20 servings per item allowed.');
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
    ci.innerHTML = '<div class="cart-empty"><div class="cart-empty-icon"><i class="fa-solid fa-cart-shopping"></i></div>No items yet.<br><span style="font-size:12px">Tap menu items to add.</span></div>';
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
  if (!items.length || !selectedTable) return;
  const total = items.reduce((s,i)=>s+i.price*i.qty,0);
  $('confirmModalBody').innerHTML =
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

// ═══════════════════════════════════════════════════════════════════
// IMPROVEMENT #4 — confirmOrderBtn: validate qty 1–20 before saving
// ═══════════════════════════════════════════════════════════════════
$('confirmOrderBtn').onclick = async () => {
  const btn = $('confirmOrderBtn');
  btn.disabled = true; btn.classList.add('loading');
  const newItems = Object.values(cart);
  const note     = $('orderNote').value.trim();

  // Frontend + backend qty guard
  const overLimit = newItems.filter(i => i.qty > 20 || i.qty < 1);
  if (overLimit.length) {
    showToast('Item quantities must be between 1 and 20.');
    btn.disabled = false; btn.classList.remove('loading');
    return;
  }

  try {
    const existingOrder = allOrders.find(o =>
      o.tableNumber === selectedTable &&
      ['pending','preparing','served'].includes(o.status)
    );

    if (existingOrder) {
      const merged = [...(existingOrder.items || [])];
      newItems.forEach(newItem => {
        const idx = merged.findIndex(i => i.id === newItem.id);
        if (idx >= 0) {
          // Cap merged quantity at 20
          merged[idx] = { ...merged[idx], qty: Math.min(merged[idx].qty + newItem.qty, 20) };
        } else {
          merged.push({
            id: newItem.id,
            name: newItem.name,
            price: newItem.price,
            qty: Math.min(newItem.qty, 20),
            category: newItem.category
          });
        }
      });
      const newTotal = merged.reduce((s,i) => s + i.price * i.qty, 0);
      const newNote  = [existingOrder.note, note].filter(Boolean).join(' | ');
      await updateDoc(doc(db,'orders', existingOrder.id), {
        items: merged, total: newTotal, note: newNote, updatedAt: serverTimestamp()
      });
    } else {
      const total = newItems.reduce((s,i)=>s+i.price*i.qty,0);
      await addDoc(collection(db,'orders'), {
        tableNumber: selectedTable, waiterId, waiterName,
        items: newItems.map(i=>({
          id: i.id,
          name: i.name,
          price: i.price,
          qty: Math.min(i.qty, 20),
          category: i.category||'Other'
        })),
        total, note, status: 'pending',
        createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
    }

    $('confirmModal').classList.remove('show');
    const os = $('orderSuccess');
    $('orderSuccessSub').textContent = existingOrder
      ? `Added to Table ${selectedTable}'s order`
      : `Table ${selectedTable} · ₱${newItems.reduce((s,i)=>s+i.price*i.qty,0).toLocaleString('en-PH',{minimumFractionDigits:2})}`;
    os.classList.add('show');
    cart = {}; $('orderNote').value = '';
    updateCart(); renderMenuGrid();
    setTimeout(() => {
      os.classList.remove('show');
      goBackToTables();
      pill1Active(); pill2Reset(); pill3Reset();
    }, 2200);
  } catch(e) {
    console.error(e);
    showToast('Failed to submit order. Please retry.');
  } finally {
    btn.disabled = false; btn.classList.remove('loading');
  }
};

$('pill1').className = 'step-pill active';

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