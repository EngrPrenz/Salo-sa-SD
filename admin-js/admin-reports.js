import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app = initializeApp({ apiKey: "AIzaSyCKQneulIrm9KWuOg69f29nFo6TGz2PF4w", authDomain: "salo-sa-antipolo.firebaseapp.com", projectId: "salo-sa-antipolo", storageBucket: "salo-sa-antipolo.firebasestorage.app", messagingSenderId: "60032898501", appId: "1:60032898501:web:3a4e663fee4ccd2adae7ac" });
const auth = getAuth(app);
const db = getFirestore(app);

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }

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
  initReports();
});

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

if (document.getElementById('pageDate')) {
  const d = new Date();
  document.getElementById('pageDate').textContent = d.toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

let showToast = m => console.log(m);
if (document.getElementById('toast') && document.getElementById('toastMsg')) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toastMsg');
  showToast = m => { toastMsg.textContent = m; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 3000); };
}

const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('overlay');
const hamburger = document.getElementById('hamburger');
if (hamburger) hamburger.onclick = () => { sidebar.classList.toggle('open'); overlay.classList.toggle('show'); };
if (overlay) overlay.onclick = () => { sidebar.classList.remove('open'); overlay.classList.remove('show'); };

let allOrders = [];
let selectedMonth = new Date().toISOString().slice(0, 7);
let reportsReady = false;

function initReports() {
  populateMonthSelect();
  loadOrders().then(() => { reportsReady = true; });
}

function populateMonthSelect() {
  const select = document.getElementById('rptMonthSelect');
  if (!select) return;
  
  const months = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    months.push(`${year}-${month}`);
  }
  
  select.innerHTML = months.map(m => {
    const [year, month] = m.split('-');
    const date = new Date(year, parseInt(month) - 1);
    const label = date.toLocaleDateString('en-PH', { year: 'numeric', month: 'long' });
    return `<option value="${m}" ${m === selectedMonth ? 'selected' : ''}>${label}</option>`;
  }).join('');
  
  select.addEventListener('change', () => {
    selectedMonth = select.value;
    if (reportsReady) renderReports();
  });
}

async function loadOrders() {
  const snap = await getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc')));
  allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderReports();
  updateOrdersBadge();
}

onSnapshot(query(collection(db, 'orders'), orderBy('createdAt', 'desc')), snap => {
  allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderReports();
  updateOrdersBadge();
});

function updateOrdersBadge() {
  const active = allOrders.filter(o => ['pending', 'preparing'].includes(o.status)).length;
  const badge = document.getElementById('ordersBadge');
  if (badge) { badge.textContent = active; badge.style.display = active > 0 ? 'inline-flex' : 'none'; }
}

function renderReports() {
  if (!selectedMonth) return;
  
  const [year, monthStr] = selectedMonth.split('-');
  const month = parseInt(monthStr) - 1;
  const startDate = new Date(year, month, 1);
  const endDate = new Date(year, month + 1, 0, 23, 59, 59);
  
  const monthOrders = allOrders.filter(o => {
    const d = o.createdAt?.toDate();
    return d && d >= startDate && d <= endDate && o.status === 'paid';
  });
  
  const monthRev = monthOrders.reduce((s, o) => s + (o.total || 0), 0);
  if (document.getElementById('rptMonthRev')) document.getElementById('rptMonthRev').textContent = `₱${monthRev.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
  if (document.getElementById('rptMonthOrders')) document.getElementById('rptMonthOrders').textContent = monthOrders.length;
  if (document.getElementById('rptMonthAvg')) document.getElementById('rptMonthAvg').textContent = monthOrders.length ? `₱${(monthRev / monthOrders.length).toFixed(2)}` : '—';
  
  renderCalendar(startDate, monthOrders);
  renderTopItems(monthOrders);
  renderStatusChart();
}

function renderCalendar(startDate, monthOrders) {
  const grid = document.getElementById('calGrid');
  if (!grid) return;
  
  const year = startDate.getFullYear();
  const month = startDate.getMonth();
  const today = new Date();
  
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  
  const dailySales = {};
  monthOrders.forEach(o => {
    const d = o.createdAt?.toDate();
    if (d) {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!dailySales[key]) dailySales[key] = { revenue: 0, count: 0 };
      dailySales[key].revenue += o.total || 0;
      dailySales[key].count++;
    }
  });
  
  let html = '';
  
  for (let i = 0; i < firstDay; i++) {
    html += '<div class="cal-day-cell empty"></div>';
  }
  
  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const sales = dailySales[dateKey] || { revenue: 0, count: 0 };
    const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
    const hasSale = sales.count > 0;
    
    html += `<div class="cal-day-cell ${hasSale ? 'has-sales' : 'no-sale'} ${isToday ? 'today' : ''}" data-date="${dateKey}">
      <div class="cal-day-num">${day}</div>
      ${hasSale ? `<div class="cal-day-rev">₱${sales.revenue.toLocaleString('en-PH', { minimumFractionDigits: 0 })}</div><div class="cal-day-cnt">${sales.count} orders</div>` : ''}
    </div>`;
  }
  
  grid.innerHTML = html;
  
  if (document.getElementById('calTitle')) {
    document.getElementById('calTitle').textContent = startDate.toLocaleDateString('en-PH', { year: 'numeric', month: 'long' });
  }
  
  grid.querySelectorAll('.cal-day-cell:not(.empty)').forEach(cell => {
    cell.style.cursor = 'pointer';
    cell.addEventListener('click', () => {
      grid.querySelectorAll('.cal-day-cell').forEach(c => c.classList.remove('selected'));
      cell.classList.add('selected');
      const dateStr = cell.dataset.date;
      showDayDetails(dateStr, monthOrders);
    });
  });
  
  const totalRevenue = monthOrders.reduce((s, o) => s + (o.total || 0), 0);
  const totalOrders = monthOrders.length;
  const avgOrder = totalOrders > 0 ? totalRevenue / totalOrders : 0;
  
  document.getElementById('dayDetailTitle').textContent = 'Daily Summary';
  document.getElementById('dayDetailRev').textContent = '₱0';
  document.getElementById('dayDetailOrders').textContent = '0';
  document.getElementById('dayDetailItems').innerHTML = '<tr><td colspan="3" class="empty-row">Select a day from the calendar</td></tr>';
}

function showDayDetails(dateStr, monthOrders) {
  const panel = document.getElementById('dayDetailPanel');
  if (!panel) return;
  
  const dayOrders = monthOrders.filter(o => {
    const d = o.createdAt?.toDate();
    if (!d) return false;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return key === dateStr;
  });
  
  const dayRev = dayOrders.reduce((s, o) => s + (o.total || 0), 0);
  const dayCount = dayOrders.length;
  
  if (document.getElementById('dayDetailTitle')) {
    const [y, m, d] = dateStr.split('-');
    const date = new Date(y, parseInt(m) - 1, d);
    document.getElementById('dayDetailTitle').textContent = date.toLocaleDateString('en-PH', { weekday: 'long', month: 'short', day: 'numeric' });
  }
  if (document.getElementById('dayDetailRev')) document.getElementById('dayDetailRev').textContent = `₱${dayRev.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
  if (document.getElementById('dayDetailOrders')) document.getElementById('dayDetailOrders').textContent = dayCount;
  
  const itemCount = {};
  dayOrders.forEach(o => (o.items || []).forEach(it => {
    const k = it.name || '?';
    if (!itemCount[k]) itemCount[k] = { name: k, qty: 0, amount: 0 };
    itemCount[k].qty += (it.qty || 1);
    itemCount[k].amount += ((it.price || 0) * (it.qty || 1));
  }));
  const sorted = Object.values(itemCount).sort((a, b) => b.amount - a.amount);
  const tbody = document.getElementById('dayDetailItems');
  if (tbody) {
    tbody.innerHTML = sorted.length ? sorted.map(it => `
      <tr><td>${it.name}</td><td>${it.qty}</td><td>₱${it.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td></tr>`).join('') : '<tr><td colspan="3" class="empty-row">No orders</td></tr>';
  }
  
  panel.style.display = '';
}

function renderTopItems(orders) {
  const itemCount = {};
  orders.forEach(o => (o.items || []).forEach(it => {
    const k = it.name || '?';
    if (!itemCount[k]) itemCount[k] = { name: k, category: it.category || '—', orders: 0, revenue: 0 };
    itemCount[k].orders += (it.qty || 1);
    itemCount[k].revenue += ((it.price || 0) * (it.qty || 1));
  }));
  const sorted = Object.values(itemCount).sort((a, b) => b.orders - a.orders).slice(0, 10);
  const tbody = document.getElementById('topItemsBody');
  if (tbody) {
    tbody.innerHTML = sorted.length ? sorted.map(it => `
      <tr><td>${it.name}</td><td>${it.category}</td><td>${it.orders}</td><td>₱${it.revenue.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td></tr>`).join('') : '<tr><td colspan="4" class="empty-row">No data yet.</td></tr>';
  }
}

function renderStatusChart() {
  const statuses = ['pending', 'preparing', 'served', 'paid', 'cancelled'];
  const counts = {};
  statuses.forEach(s => counts[s] = 0);
  allOrders.forEach(o => { if (counts[o.status] !== undefined) counts[o.status]++; });
  const max = Math.max(...Object.values(counts), 1);
  if (document.getElementById('statusChart')) {
    document.getElementById('statusChart').innerHTML = statuses.map(s => `
      <div class="bar-row">
        <span class="bar-label">${capitalize(s)}</span>
        <div class="bar-track"><div class="bar-fill ${s}" style="width:${(counts[s] / max) * 100}%"></div></div>
        <span class="bar-count">${counts[s]}</span>
      </div>`).join('');
  }
}