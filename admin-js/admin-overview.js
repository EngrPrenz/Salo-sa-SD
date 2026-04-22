import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app = initializeApp({ apiKey: "AIzaSyCKQneulIrm9KWuOg69f29nFo6TGz2PF4w", authDomain: "salo-sa-antipolo.firebaseapp.com", projectId: "salo-sa-antipolo", storageBucket: "salo-sa-antipolo.firebasestorage.app", messagingSenderId: "60032898501", appId: "1:60032898501:web:3a4e663fee4ccd2adae7ac" });
const auth = getAuth(app);
const db = getFirestore(app);

function escapeHtml(s) { return (s + '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }

// Load data immediately
let allOrders = [];
let tableStatuses = {};
let tableDocsList = [];

// Load orders immediately + real-time
getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc'))).then(snap => {
  allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderOverview();
  renderOverviewTableGrid();
  updateOrdersBadge();
});

onSnapshot(query(collection(db, 'orders'), orderBy('createdAt', 'desc')), snap => {
  allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderOverview();
  renderOverviewTableGrid();
  updateOrdersBadge();
});

function updateOrdersBadge() {
  const active = allOrders.filter(o => ['pending', 'preparing'].includes(o.status)).length;
  const badge = document.getElementById('ordersBadge');
  if (badge) { badge.textContent = active; badge.style.display = active > 0 ? 'inline-flex' : 'none'; }
}

// Load tables immediately + real-time
getDocs(collection(db, 'tables')).then(snap => {
  snap.forEach(d => {
    const data = d.data();
    const rawNum = data.tableNumber ? parseInt(data.tableNumber) : parseInt(d.id.replace('table_', ''));
    const num = isNaN(rawNum) ? null : rawNum;
    if (!num) return;
    tableStatuses[num] = { docId: d.id, ...data, tableNumber: num };
    tableDocsList.push({ docId: d.id, tableNumber: num, ...data });
  });
  tableDocsList.sort((a, b) => a.tableNumber - b.tableNumber);
  renderOverviewTableGrid();
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
  renderOverviewTableGrid();
});

// Auth guard
onAuthStateChanged(auth, async user => {
  if (!user) { window.location.href = '../admin-login.html'; return; }
  const snap = await getDoc(doc(db, 'Users', user.uid));
  if (!snap.exists() || snap.data().role !== 'admin') {
    await signOut(auth); window.location.href = '../admin-login.html'; return;
  }
  const name = snap.data().name || user.email;
  if (document.getElementById('userNameSidebar')) document.getElementById('userNameSidebar').textContent = name;
  if (document.getElementById('topbarName')) document.getElementById('topbarName').textContent = name;
  if (document.getElementById('userAvatarSidebar')) document.getElementById('userAvatarSidebar').textContent = name[0].toUpperCase();
  if (document.getElementById('userAvatarTop')) document.getElementById('userAvatarTop').textContent = name[0].toUpperCase();
});

// Logout
if (document.getElementById('logoutBtn')) {
  document.getElementById('logoutBtn').onclick = async () => {
    try {
      await signOut(auth);
      window.location.href = '../admin-login.html';
    } catch (e) {
      console.error('Logout error:', e);
      window.location.href = '../admin-login.html';
    }
  };
}

// Date
if (document.getElementById('pageDate')) {
  const d = new Date();
  document.getElementById('pageDate').textContent = d.toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

// Toast
let showToast = m => console.log(m);
if (document.getElementById('toast') && document.getElementById('toastMsg')) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toastMsg');
  showToast = m => { toastMsg.textContent = m; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 3000); };
}

// Sidebar
const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('overlay');
const hamburger = document.getElementById('hamburger');
if (hamburger) hamburger.onclick = () => { sidebar.classList.toggle('open'); overlay.classList.toggle('show'); };
if (overlay) overlay.onclick = () => { sidebar.classList.remove('open'); overlay.classList.remove('show'); };

function renderOverview() {
  if (!document.getElementById('view-overview')) return;
  
  const active = allOrders.filter(o => ['pending', 'preparing', 'served'].includes(o.status));
  if (document.getElementById('statActiveOrders')) document.getElementById('statActiveOrders').textContent = active.length;
  if (document.getElementById('statOrdersSub')) {
    document.getElementById('statOrdersSub').textContent = `${allOrders.filter(o => o.status === 'pending').length} pending · ${allOrders.filter(o => o.status === 'preparing').length} preparing`;
  }

  const occupied = [...new Set(active.map(o => o.tableNumber))].length;
  if (document.getElementById('statTablesOcc')) document.getElementById('statTablesOcc').textContent = occupied;
  if (document.getElementById('statTablesSub')) document.getElementById('statTablesSub').textContent = `of ${tableDocsList.length || 10} tables`;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const paidToday = allOrders.filter(o => o.status === 'paid' && o.createdAt?.toDate() >= today);
  const rev = paidToday.reduce((s, o) => s + (o.total || 0), 0);
  if (document.getElementById('statRevenue')) document.getElementById('statRevenue').textContent = `₱${rev.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
  if (document.getElementById('statRevSub')) document.getElementById('statRevSub').textContent = `${paidToday.length} paid orders today`;

  renderRecentOrders();
}

function renderRecentOrders() {
  const tbody = document.getElementById('recentOrdersBody');
  if (!tbody) return;
  const orders = allOrders.slice(0, 6);
  if (!orders.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty-row">No orders yet.</td></tr>'; return; }
  tbody.innerHTML = orders.map(o => `
    <tr>
      <td class="mono">#${o.id.slice(-5).toUpperCase()}</td>
      <td>Table ${o.tableNumber || '—'}</td>
      <td>${o.waiterName || '—'}</td>
      <td>${(o.items || []).length} items</td>
      <td>₱${(o.total || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
      <td><span class="status-badge ${o.status}">${capitalize(o.status || 'unknown')}</span></td>
    </tr>`).join('');
}

function renderOverviewTableGrid() {
  const grid = document.getElementById('overviewTableGrid');
  if (!grid) return;
  const active = allOrders.filter(o => ['pending', 'preparing', 'served'].includes(o.status));
  const occupied = {};
  active.forEach(o => { if (o.tableNumber) occupied[o.tableNumber] = o.status; });
  const tables = tableDocsList.length ? tableDocsList : Array.from({ length: 10 }, (_, i) => ({ tableNumber: i + 1 }));
  grid.innerHTML = tables.map(t => {
    const n = t.tableNumber;
    const st = occupied[n] || tableStatuses[n]?.status || 'free';
    const normSt = st === 'available' ? 'free' : st;
    const label = t.name || `${n}`;
    return `<div class="mini-table ${normSt}"><span class="mini-table-num">${escapeHtml(label)}</span><span class="mini-table-st">${normSt === 'free' ? 'Free' : capitalize(normSt)}</span></div>`;
  }).join('');
}