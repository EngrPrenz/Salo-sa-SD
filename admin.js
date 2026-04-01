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

  // Init data loads AFTER auth is confirmed so Firestore rules are satisfied
  loadTables();
  loadMenu();
  loadStaff();

  // Live badge for pending staff — only start after auth is confirmed
  onSnapshot(query(collection(db,'Users'), where('status','==','pending')), snap => {
    const count = snap.size;
    const badge = document.getElementById('staffBadge');
    if (badge) { badge.textContent = count; badge.style.display = count > 0 ? 'inline-flex' : 'none'; }
  });
});

document.getElementById('logoutBtn').onclick = async () => {
  await signOut(auth); window.location.href = 'admin-login.html';
};

// ── Helpers (defined early so all functions below can use them) ──
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

  // Clone to remove old listeners
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
  // Reload staff list every time the Staff view is opened
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
  grid.innerHTML = Array.from({length:10},(_,i)=>{
    const n = i+1, st = occupied[n] || 'free';
    return `<div class="mini-table ${st}"><span class="mini-table-num">${n}</span><span class="mini-table-st">${st==='free'?'Free':capitalize(st)}</span></div>`;
  }).join('');
}

// ── Live Orders view ──
const orderSearch = document.getElementById('orderSearch');
orderSearch.addEventListener('input', renderOrders);
document.querySelectorAll('.ftab[data-status]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.ftab[data-status]').forEach(x=>x.classList.remove('active'));
  b.classList.add('active'); activeFilter = b.dataset.status; renderOrders();
}));

async function updateOrderStatus(id, status) {
  await updateDoc(doc(db,'orders',id), { status, updatedAt: serverTimestamp() });
  showToast(`Order updated to "${status}"`);
}

function renderOrders() {
  const grid = document.getElementById('ordersGrid');
  let filtered = allOrders;
  if (activeFilter !== 'all') filtered = filtered.filter(o => o.status === activeFilter);
  const q = orderSearch.value.trim().toLowerCase();
  if (q) filtered = filtered.filter(o =>
    String(o.tableNumber).includes(q) || (o.waiterName||'').toLowerCase().includes(q)
  );
  if (!filtered.length) { grid.innerHTML = '<div class="empty-state">No orders found.</div>'; return; }
  grid.innerHTML = filtered.map(o => {
    const items = (o.items||[]).map(it=>`<li>${it.name} × ${it.qty} <span>₱${((it.price||0)*it.qty).toLocaleString()}</span></li>`).join('');
    const ts = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}) : '—';
    const nextStatus = {pending:'preparing', preparing:'served', served:'paid'}[o.status];
    const nextLabel  = {pending:'Mark Preparing', preparing:'Mark Served', served:'Mark Paid'}[o.status] || '';
    return `
      <div class="order-card ${o.status}">
        <div class="order-card-head">
          <div>
            <span class="order-id mono">#${o.id.slice(-5).toUpperCase()}</span>
            <span class="status-badge ${o.status}">${capitalize(o.status||'')}</span>
          </div>
          <span class="order-time">${ts}</span>
        </div>
        <div class="order-meta">Table <strong>${o.tableNumber||'?'}</strong> · ${o.waiterName||'Unknown'}</div>
        <ul class="order-items">${items}</ul>
        <div class="order-total">Total: <strong>₱${(o.total||0).toLocaleString('en-PH',{minimumFractionDigits:2})}</strong></div>
        <div style="display:flex;gap:8px;margin-top:8px;">
          ${nextStatus ? `<button class="btn-sm gold" onclick="window._updateStatus('${o.id}','${nextStatus}')">${nextLabel}</button>` : ''}
          ${o.status!=='paid' ? `<button class="btn-sm" onclick="window._editOrder('${o.id}')">Edit</button>` : ''}
          <button class="btn-sm" onclick="window._showReceipt('${o.id}')">Receipt</button>
          ${o.status!=='paid' ? `<button class="btn-sm danger" onclick="window._updateStatus('${o.id}','cancelled')">Cancel</button>` : ''}
        </div>
      </div>`;
  }).join('');
}
window._updateStatus = updateOrderStatus;

// ── Tables view ──
let tableStatuses = {};
async function loadTables() {
  const snap = await getDocs(collection(db, 'tables'));
  snap.forEach(d => { tableStatuses[d.id] = d.data(); });
  renderTablesGrid();
}

function renderTablesGrid() {
  const grid = document.getElementById('tablesGrid');
  // Merge active orders into table status
  const occupied = {};
  allOrders.filter(o=>['pending','preparing','served'].includes(o.status)).forEach(o => {
    if (o.tableNumber) occupied[o.tableNumber] = o;
  });
  grid.innerHTML = Array.from({length:10},(_,i)=>{
    const n = i+1, order = occupied[n];
    // prefer active order, then manual tableStatuses override, else free
    const manual = tableStatuses[String(n)] && tableStatuses[String(n)].manualStatus;
    const st = order ? order.status : (manual || 'free');
    const orderId = order ? `#${order.id.slice(-5).toUpperCase()}` : '';
    const waiter = order ? (order.waiterName||'') : '';
    const total = order ? `₱${(order.total||0).toLocaleString('en-PH',{minimumFractionDigits:2})}` : '';
    return `
      <div class="table-card ${st}">
        <div class="table-card-num">Table ${n}</div>
        <div class="table-card-icon">${st==='free'?'🪑':'🍽️'}</div>
        <div class="table-card-status"><span class="status-badge ${st}">${capitalize(st)}</span></div>
        ${order ? `<div class="table-card-info">${orderId}<br>${waiter}<br>${total}</div>` : '<div class="table-card-info muted">Available</div>'}
        ${order && order.status!=='paid' ? `<button class="btn-sm gold" onclick="window._updateStatus('${order.id}','paid')">Mark Paid</button>` : ''}
        <div style="margin-top:8px;display:flex;gap:8px;justify-content:center;">
          <button class="btn-sm" onclick="window._toggleTable(${n})">Toggle Occupied</button>
          <button class="btn-sm" onclick="window._showTableHistory(${n})">Info</button>
        </div>
      </div>`;
  }).join('');
}

document.getElementById('clearAllTablesBtn').onclick = async () => {
  if (!confirm('Mark ALL active orders as paid?')) return;
  const active = allOrders.filter(o=>['pending','preparing','served'].includes(o.status));
  await Promise.all(active.map(o => updateDoc(doc(db,'orders',o.id),{status:'paid',updatedAt:serverTimestamp()})));
  showToast('All tables cleared.');
};

onSnapshot(query(ordersRef, orderBy('createdAt','desc')), () => renderTablesGrid());

// ── Menu ──
let menuItems = [], editMenuId = null;
let menuCatFilter = 'all';

async function loadMenu() {
  const snap = await getDocs(collection(db,'menu'));
  menuItems = snap.docs.map(d=>({id:d.id,...d.data()}));
  buildMenuCategoryTabs();
  renderMenuGrid();
}

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

// ── Time-based availability rules ──────────────────────────────────────────
// Add any category here with a start/end hour (24h) to restrict its availability.
const TIME_RESTRICTED = {
  'Bento sa Salo': { start: 11, end: 15 }, // 11:00 AM – 3:00 PM
};

function isTimeAvailable(category) {
  const rule = TIME_RESTRICTED[category];
  if (!rule) return null; // null = no restriction
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
// ──────────────────────────────────────────────────────────────────────────

function renderMenuGrid() {
  const grid = document.getElementById('menuGrid');
  let items = menuCatFilter === 'all' ? menuItems : menuItems.filter(m => (m.category || 'Other') === menuCatFilter);
  if (!items.length) { grid.innerHTML = '<div class="empty-state">No items in this category.</div>'; return; }
 
  grid.innerHTML = items.map(m => {
    // Sold / quota
    const sold = allOrders.reduce((s, o) => {
      (o.items || []).forEach(it => { if ((it.name || '') === (m.name || '')) s += (it.qty || 0); });
      return s;
    }, 0);
    const quota = m.quota || null;
    const remaining = quota !== null ? Math.max(0, quota - sold) : null;
    const soldBadge = quota !== null
      ? `<div class="menu-card-sold">Sold: ${sold} &nbsp;·&nbsp; Remaining: ${remaining}</div>`
      : '';
 
    // Time-based availability
    const timeOk = isTimeAvailable(m.category);
    const isAvailable = timeOk !== null
      ? timeOk
      : (quota !== null ? remaining > 0 : m.available !== false);
 
    // Top banner
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
      <div class="menu-avail-banner ${bannerClass}">
        <span class="menu-avail-banner-dot"></span>
        ${bannerText}
      </div>
      <div class="menu-card-body">
        <div class="menu-card-cat">${m.category || 'Other'}</div>
        <div class="menu-card-name">${m.name || '—'}</div>
        <div class="menu-card-desc">${m.description || ''}</div>
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
}

window._editMenu = id => {
  const item = menuItems.find(m=>m.id===id); if(!item)return;
  editMenuId=id;
  document.getElementById('menuModalTitle').textContent='Edit Menu Item';
  document.getElementById('menuItemName').value=item.name||'';
  document.getElementById('menuItemPrice').value=item.price||'';
  document.getElementById('menuItemCategory').value=item.category||'';
  document.getElementById('menuItemDesc').value=item.description||'';
  document.getElementById('menuItemAvail').value=item.available===false?'false':'true';
  document.getElementById('menuModal').classList.add('show');
};

window._deleteMenu = async id => {
  if(!confirm('Delete this menu item?'))return;
  await deleteDoc(doc(db,'menu',id));
  await loadMenu(); showToast('Item deleted.');
};

document.getElementById('addMenuItemBtn').onclick = ()=>{
  editMenuId=null;
  document.getElementById('menuModalTitle').textContent='Add Menu Item';
  ['menuItemName','menuItemPrice','menuItemCategory','menuItemDesc'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('menuItemAvail').value='true';
  document.getElementById('menuModal').classList.add('show');
};
document.getElementById('menuModalClose').onclick = ()=>document.getElementById('menuModal').classList.remove('show');
document.getElementById('menuModalCancel').onclick = ()=>document.getElementById('menuModal').classList.remove('show');

document.getElementById('menuModalSave').onclick = async ()=>{
  const name=document.getElementById('menuItemName').value.trim();
  const price=parseFloat(document.getElementById('menuItemPrice').value)||0;
  const category=document.getElementById('menuItemCategory').value.trim();
  const description=document.getElementById('menuItemDesc').value.trim();
  const available=document.getElementById('menuItemAvail').value==='true';
  if(!name){showToast('Please enter a name.');return;}
  if(editMenuId){
    await updateDoc(doc(db,'menu',editMenuId),{name,price,category,description,available});
  } else {
    await addDoc(collection(db,'menu'),{name,price,category,description,available,createdAt:serverTimestamp()});
  }
  document.getElementById('menuModal').classList.remove('show');
  await loadMenu(); showToast(editMenuId?'Item updated.':'Item added.');
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
        ${nextStatus?`<button class="btn-sm gold" onclick="window._updateStatus('${o.id}','${nextStatus}')">${nextLabel}</button>`:'<span>—</span>'}
        ${o.status!=='paid'?`<button class="btn-sm" onclick="window._editOrder('${o.id}')">Edit</button>`:''}
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

  // Pending approvals banner
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

  // Active staff
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

  // Rejected
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

  console.log("loadStaff: total users:", staff.length, "| pending:", pending.length, "| approved:", approved.length, "| rejected:", rejected.length);
  console.log("loadStaff: raw data:", JSON.stringify(staff.map(s => ({ id: s.id, role: s.role, status: s.status, name: s.name }))));

  if (!staff.length) html = '<div class="empty-state">No staff accounts found.</div>';
  else if (!html) html = '<div class="empty-state">No staff matched any category — check console.</div>';
  console.log('loadStaff: grid element:', grid, '| html length:', html.length, '| html preview:', html.slice(0,200));
  grid.innerHTML = html;
  console.log('loadStaff: grid.innerHTML after set length:', grid.innerHTML.length);
  const observer = new MutationObserver(muts => {
    muts.forEach(m => {
      if (grid.innerHTML.length < 100) {
        console.error('GRID WAS CLEARED! innerHTML now:', grid.innerHTML.length, 'Stack:', new Error().stack);
      }
    });
  });
  observer.observe(grid, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 5000);

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
    okLabel: '✓ Approve',
    okClass: 'gold',
    onOk: async () => {
      try {
        await updateDoc(doc(db,'Users',uid), {
          status: 'approved',
          approvedAt: serverTimestamp(),
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
    okLabel: '✗ Reject',
    okClass: 'danger',
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
}

// ── Order edit / receipt / table helpers ──
let editingOrderId = null;

window._editOrder = id => {
  const o = allOrders.find(x=>x.id===id);
  if(!o){ showToast('Order not found'); return; }
  editingOrderId = id;
  const body = document.getElementById('orderModalBody');
  const items = (o.items||[]).map((it,idx)=>`
    <div class="form-row" data-idx="${idx}">
      <div class="form-group"><label>Item</label><input type="text" value="${escapeHtml(it.name)}" disabled></div>
      <div class="form-group"><label>Price</label><input type="number" value="${it.price||0}" disabled></div>
      <div class="form-group"><label>Qty</label><input type="number" class="edit-qty" value="${it.qty||1}" min="0"></div>
    </div>`).join('');
  body.innerHTML = `<div style="max-height:360px;overflow:auto;">${items}</div>` +
    `<div style="margin-top:12px;text-align:right">Current total: <strong>₱${(o.total||0).toLocaleString('en-PH',{minimumFractionDigits:2})}</strong></div>`;
  document.getElementById('orderModal').classList.add('show');
};

async function saveOrderEdits(){
  if(!editingOrderId){ showToast('No order selected'); return; }
  const modal = document.getElementById('orderModalBody');
  const rows = modal.querySelectorAll('.form-row');
  const items = [];
  rows.forEach(r=>{
    const name = r.querySelector('input[type="text"]').value;
    const price = parseFloat(r.querySelector('input[type="number"]').value)||0;
    const qty = parseInt(r.querySelector('.edit-qty').value)||0;
    if(qty>0) items.push({ name, price, qty });
  });
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

window._showTableHistory = tableNum => {
  const info = tableStatuses[String(tableNum)];
  showToast(info?JSON.stringify(info):'No manual status set');
};

// Modal controls
document.getElementById('orderModalClose').onclick = ()=>document.getElementById('orderModal').classList.remove('show');
document.getElementById('orderModalCancel').onclick = ()=>document.getElementById('orderModal').classList.remove('show');
document.getElementById('orderModalSave').onclick = saveOrderEdits;
document.getElementById('receiptModalClose').onclick = ()=>document.getElementById('receiptModal').classList.remove('show');
document.getElementById('receiptModalClose2').onclick = ()=>document.getElementById('receiptModal').classList.remove('show');
document.getElementById('receiptPrint').onclick = ()=>{ window.print(); };

// ── Auto-refresh menu grid every minute so time-based availability stays current ──
setInterval(() => { if (menuItems.length) renderMenuGrid(); }, 60 * 1000);

// ── Init ──
// (loadTables, loadMenu, loadStaff are called inside onAuthStateChanged above)