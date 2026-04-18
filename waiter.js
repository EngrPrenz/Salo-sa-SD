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
let tablesData = {}; // { tableNumber: { docId, status, waiterName, waiterId, ... } }
let pendingOccupyTable = null;
let pendingWalkinTable = null;

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

async function init() {
  await loadMenu();

  // Listen to orders
  onSnapshot(query(collection(db, 'orders'), orderBy('createdAt', 'desc')), snap => {
    allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTables();
  });

  // Listen to tables collection — single source of truth for walk-in status
  onSnapshot(collection(db, 'tables'), snap => {
    tablesData = {};
    snap.docs.forEach(d => {
      const data = d.data();
      const num = data.tableNumber || parseInt(d.id.replace('table_', ''));
      tablesData[num] = { docId: d.id, ...data };
    });
    renderTables();
  });
}

// ── TABLE RENDERING ──
function renderTables() {
  const orderOccupied = {};
  allOrders.filter(o => ['pending','preparing','served'].includes(o.status)).forEach(o => {
    if (o.tableNumber) orderOccupied[o.tableNumber] = { status: o.status, waiterName: o.waiterName, waiterId: o.waiterId };
  });
  const grid = $('tablesGrid');
  grid.innerHTML = Array.from({ length: 10 }, (_, i) => {
    const n = i + 1;
    const orderInfo        = orderOccupied[n];
    const tableDoc         = tablesData[n];
    const isWalkIn         = !orderInfo && tableDoc && tableDoc.status === 'walk-in';
    const isWalkInYours    = isWalkIn && tableDoc.waiterId === waiterId;
    const isReserved       = !orderInfo && tableDoc && tableDoc.status === 'reserved';
    const isOccupiedNoOrder = !orderInfo && tableDoc && tableDoc.status === 'occupied';
    const isOccupiedYours  = isOccupiedNoOrder && tableDoc.waiterId === waiterId;
    const isYours          = orderInfo && orderInfo.waiterId === waiterId;
    const isTakenOrder     = orderInfo && !isYours;

    let stClass, badge, badgeLbl, meta, icon, yoursInd = '';

    if (isYours) {
      stClass = 'yours'; badge = 'yours'; badgeLbl = '✦ Your Table';
      icon = '🍽️'; meta = 'Active order';
      yoursInd = `<div class="yours-indicator">YOURS</div>`;
    } else if (isReserved) {
      stClass = 'reserved'; badge = 'reserved'; badgeLbl = '📅 Reserved';
      icon = '📅';
      const res = tableDoc.reservation || {};
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
      icon = '🪑'; meta = 'Tap to seat guests';
    }

    return `<div class="table-tile ${stClass}" onclick="window._selectTable(${n}, '${stClass}', ${isWalkIn})">
      ${yoursInd}
      <div class="table-num">${n}</div>
      <div class="table-icon">${icon}</div>
      <span class="table-status-badge ${badge}">${badgeLbl}</span>
      <div class="table-meta">${meta}</div>
    </div>`;
  }).join('');
}

// ── MARK OCCUPIED — updates tables collection ──
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
      status: 'walk-in',
      waiterId,
      waiterName,
      lastUpdated: serverTimestamp()
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
window._selectTable = (num, stClass, isWalkIn) => {
  if (stClass === 'occupied') { showToast('⚠ This table has an active order from another waiter.'); return; }
  if (stClass === 'reserved') { window._openReservedModal(num); return; }
  if (isWalkIn) { /* ...existing walk-in logic... */ return; }
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
        status: 'available',
        waiterId: null,
        waiterName: null,
        lastUpdated: serverTimestamp()
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
        status: 'available',
        waiterId: null,
        waiterName: null,
        lastUpdated: serverTimestamp()
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
  const num = parseInt($('reservedModal').dataset.table); // ✅ already parseInt'd here
  if (!num) return;
  const btn = $('confirmArrivalBtn');
  btn.disabled = true; btn.classList.add('loading');
  try {
    const tableDoc = tablesData[num];
    if (!tableDoc?.docId) {
      showToast('❌ Table document not found.');
      return;
    }
    await updateDoc(doc(db, 'tables', tableDoc.docId), {
      status: 'occupied',
      waiterId,
      waiterName,
      lastUpdated: serverTimestamp()
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

// ── BACK TO TABLES (shared function) ──
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

// ── PILL CLICK NAVIGATION ──
$('pill1').addEventListener('click', () => {
  // Only navigate back if we're past step 1 (pill1 is 'done')
  if ($('pill1').classList.contains('done')) {
    // Close confirm modal if open
    $('confirmModal').classList.remove('show');
    goBackToTables();
  }
});

$('pill3').addEventListener('click', () => {
  // Only trigger if on step 2 (pill2 is active) and cart has items
  if ($('pill2').classList.contains('active') || $('pill2').classList.contains('done')) {
    const items = Object.values(cart);
    if (!items.length) { showToast('⚠ Add items to the cart first.'); return; }
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
  $('catScroll').querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b.dataset.cat===cat));
  renderMenuGrid();
};

$('menuSearch').addEventListener('input', renderMenuGrid);

function renderMenuGrid() {
  const q = $('menuSearch').value.toLowerCase().trim();
  let items = activeCat === 'all' ? menuItems : menuItems.filter(m => (m.category||'Other') === activeCat);
  if (q) items = items.filter(m => (m.name||'').toLowerCase().includes(q) || (m.description||'').toLowerCase().includes(q));
  const grid = $('menuGrid');
  if (!items.length) { grid.innerHTML = '<div style="color:var(--text-muted);font-size:14px;padding:32px;grid-column:1/-1;text-align:center;">No items found.</div>'; return; }

  grid.innerHTML = items.map(m => {
    const inCart  = cart[m.id];
    const unavail = m.available === false;
    const safeName = (m.name||'—').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const safeDesc = (m.description||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const safeCat  = (m.category||'Other').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return `<div class="menu-item-card${unavail?' unavailable':inCart?' in-cart':''}" onclick="window._addToCart('${m.id}')">
      ${inCart ? `<div class="cart-badge-pill">×${inCart.qty}</div>` : ''}
      ${unavail ? `<div class="unavail-tag">Unavail.</div>` : ''}
      <div class="mic-img-placeholder" id="wimg-${m.id}" style="display:flex;">🍽️</div>
      <div class="mic-body">
        <div class="mic-cat">${safeCat}</div>
        <div class="mic-name">${safeName}</div>
        <div class="mic-desc">${safeDesc}</div>
        <div class="mic-footer">
          <span class="mic-price">₱${(m.price||0).toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
          ${!unavail ? `<button class="mic-add" onclick="event.stopPropagation();window._addToCart('${m.id}')">+</button>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');

  items.forEach((m, i) => {
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
}

window._addToCart = id => {
  const item = menuItems.find(m => m.id === id);
  if (!item || item.available === false) return;
  if (cart[id]) cart[id].qty++;
  else cart[id] = { id, name: item.name, price: item.price, qty: 1, category: item.category||'Other' };
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
  ci.innerHTML = items.map(i => `
    <div class="cart-item">
      <div class="ci-info">
        <div class="ci-name">${i.name}</div>
        <div class="ci-price">₱${(i.price*i.qty).toLocaleString('en-PH',{minimumFractionDigits:2})}</div>
      </div>
      <div class="ci-controls">
        <button class="qty-btn" onclick="window._removeFromCart('${i.id}')">−</button>
        <span class="qty-num">${i.qty}</span>
        <button class="qty-btn" onclick="window._addToCart('${i.id}')">+</button>
      </div>
    </div>`).join('');
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

$('confirmOrderBtn').onclick = async () => {
  const btn = $('confirmOrderBtn');
  btn.disabled = true; btn.classList.add('loading');
  const newItems = Object.values(cart);
  const note     = $('orderNote').value.trim();
  try {
    const existingOrder = allOrders.find(o =>
      o.tableNumber === selectedTable &&
      ['pending','preparing','served'].includes(o.status)
    );

    if (existingOrder) {
      const merged = [...(existingOrder.items || [])];
      newItems.forEach(newItem => {
        const idx = merged.findIndex(i => i.id === newItem.id);
        if (idx >= 0) merged[idx] = { ...merged[idx], qty: merged[idx].qty + newItem.qty };
        else merged.push({ id:newItem.id, name:newItem.name, price:newItem.price, qty:newItem.qty, category:newItem.category });
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
        items: newItems.map(i=>({ id:i.id, name:i.name, price:i.price, qty:i.qty, category:i.category })),
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
    showToast('❌ Failed to submit order. Please retry.');
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
    // If at the very start, jump to the end
    if (s.scrollLeft <= 2) {
      s.scrollLeft = s.scrollWidth;
    } else {
      s.scrollLeft -= STEP;
    }
  });

  btnR.addEventListener('click', function(e) {
    e.preventDefault(); e.stopPropagation();
    // If at the very end, jump back to start
    if (s.scrollLeft >= s.scrollWidth - s.clientWidth - 2) {
      s.scrollLeft = 0;
    } else {
      s.scrollLeft += STEP;
    }
  });

  catScrollWired = true;
}