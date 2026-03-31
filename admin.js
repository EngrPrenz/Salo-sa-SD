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
});

document.getElementById('logoutBtn').onclick = async () => {
  await signOut(auth); window.location.href = 'admin-login.html';
};

// ── Date ──
const d = new Date();
document.getElementById('pageDate').textContent = d.toLocaleDateString('en-PH',{weekday:'long',year:'numeric',month:'long',day:'numeric'});

// ── Toast ──
const toast = document.getElementById('toast'), toastMsg = document.getElementById('toastMsg');
const showToast = m => { toastMsg.textContent=m; toast.classList.add('show'); setTimeout(()=>toast.classList.remove('show'),3000); };

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

function renderMenuGrid() {
  const grid = document.getElementById('menuGrid');
  let items = menuCatFilter==='all' ? menuItems : menuItems.filter(m=>(m.category||'Other')===menuCatFilter);
  if(!items.length){grid.innerHTML='<div class="empty-state">No items in this category.</div>';return;}
  grid.innerHTML = items.map(m=>{
    // compute sold count from orders
    const sold = allOrders.reduce((s,o)=>{
      (o.items||[]).forEach(it=>{ if((it.name||'')=== (m.name||'')) s += (it.qty||0); });
      return s;
    },0);
    const quota = m.quota || null;
    const remaining = quota!==null ? Math.max(0, quota - sold) : null;
    const soldBadge = quota!==null ? `<div style="font-size:11px;color:var(--text-muted);">Sold: ${sold} · Rem: ${remaining}</div>` : '';
    const reachedClass = (quota!==null && remaining<=0) ? 'unavailable' : (m.available===false ? 'unavailable' : '');
    const quotaLabel = quota!==null ? `<div class="menu-avail ${remaining<=0?'off':'on'}">${remaining<=0?'Quota reached':`Quota ${remaining}/${quota}`}</div>` : `<div class="menu-avail ${m.available===false?'off':'on'}">${m.available===false?'Unavailable':'Available'}</div>`;
    return `
    <div class="menu-card ${reachedClass}">
      <div class="menu-card-cat">${m.category||'Other'}</div>
      <div class="menu-card-name">${m.name||'—'}</div>
      <div class="menu-card-desc">${m.description||''}</div>
      <div style="margin-top:6px">${soldBadge}</div>
      <div class="menu-card-footer">
        <span class="menu-card-price">₱${(m.price||0).toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
        <div class="menu-card-actions">
          <button class="btn-sm" onclick="window._editMenu('${m.id}')">Edit</button>
          <button class="btn-sm danger" onclick="window._deleteMenu('${m.id}')">Del</button>
        </div>
      </div>
      ${quotaLabel}
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
async function loadStaff() {
  const snap = await getDocs(collection(db,'Users'));
  const staff = snap.docs.map(d=>({id:d.id,...d.data()}));
  const grid = document.getElementById('staffGrid');
  if(!staff.length){grid.innerHTML='<div class="empty-state">No staff accounts found.</div>';return;}
  grid.innerHTML = staff.map(s=>`
    <div class="staff-card">
      <div class="staff-avatar">${(s.name||s.email||'?')[0].toUpperCase()}</div>
      <div class="staff-info">
        <div class="staff-name">${s.name||'—'}</div>
        <div class="staff-email">${s.email||'—'}</div>
        <span class="status-badge ${s.role}">${capitalize(s.role||'unknown')}</span>
      </div>
    </div>`).join('');
}

// ── Reports ──
function renderReports() {
  const today=new Date(); today.setHours(0,0,0,0);
  const paidToday=allOrders.filter(o=>o.status==='paid'&&o.createdAt?.toDate()>=today);
  const rev=paidToday.reduce((s,o)=>s+(o.total||0),0);
  document.getElementById('rptTodayRev').textContent=`₱${rev.toLocaleString('en-PH',{minimumFractionDigits:2})}`;
  document.getElementById('rptOrdersToday').textContent=paidToday.length;
  document.getElementById('rptAvgOrder').textContent=paidToday.length?`₱${(rev/paidToday.length).toFixed(2)}`:'—';

  // Top table
  const tblCount={};
  allOrders.forEach(o=>{if(o.tableNumber)tblCount[o.tableNumber]=(tblCount[o.tableNumber]||0)+1;});
  const topT=Object.entries(tblCount).sort((a,b)=>b[1]-a[1])[0];
  document.getElementById('rptTopTable').textContent=topT?`Table ${topT[0]}`:'—';

  // Top items
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

  // Status chart
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

function escapeHtml(s){ return (s+'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

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

// Toggle manual table status (create or update Tables doc)
window._toggleTable = async tableNum => {
  const id = String(tableNum);
  const current = tableStatuses[id] && tableStatuses[id].manualStatus;
  const next = current==='occupied' ? 'free' : 'occupied';
  try{
    await setDoc(doc(db,'tables',id), { manualStatus: next, updatedAt: serverTimestamp() }, { merge: true });
    showToast(`Table ${tableNum} set to ${next}`);
    // reload local copy
    const snap = await getDoc(doc(db,'tables',id)); if(snap.exists()) tableStatuses[id]=snap.data();
    renderTablesGrid();
  }catch(e){ console.error(e); showToast('Failed to update table'); }
};

window._showTableHistory = tableNum => {
  const info = tableStatuses[String(tableNum)];
  showToast(info?JSON.stringify(info):'No manual status set');
};

// modal controls
document.getElementById('orderModalClose').onclick = ()=>document.getElementById('orderModal').classList.remove('show');
document.getElementById('orderModalCancel').onclick = ()=>document.getElementById('orderModal').classList.remove('show');
document.getElementById('orderModalSave').onclick = saveOrderEdits;
document.getElementById('receiptModalClose').onclick = ()=>document.getElementById('receiptModal').classList.remove('show');
document.getElementById('receiptModalClose2').onclick = ()=>document.getElementById('receiptModal').classList.remove('show');
document.getElementById('receiptPrint').onclick = ()=>{ window.print(); };

// ── Init ──
function capitalize(s){return s?s[0].toUpperCase()+s.slice(1):''}
loadTables();
loadMenu();
loadStaff();
