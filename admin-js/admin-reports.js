import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app = initializeApp({ apiKey: "AIzaSyCKQneulIrm9KWuOg69f29nFo6TGz2PF4w", authDomain: "salo-sa-antipolo.firebaseapp.com", projectId: "salo-sa-antipolo", storageBucket: "salo-sa-antipolo.firebasestorage.app", messagingSenderId: "60032898501", appId: "1:60032898501:web:3a4e663fee4ccd2adae7ac" });
const auth = getAuth(app);
const db = getFirestore(app);

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }
// Full precision for tables
function fmtCurrency(n) { return `\u20B1${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
// Compact for KPI cards
function fmtCompact(n) {
  if (n >= 1000000) return `\u20B1${(n/1000000).toFixed(2)}M`;
  if (n >= 1000)    return `\u20B1${(n/1000).toFixed(2)}K`;
  return fmtCurrency(n);
}
// Tiny for calendar cells
function fmtTiny(n) {
  if (n >= 1000000) return `\u20B1${(n/1000000).toFixed(1)}M`;
  if (n >= 1000)    return `\u20B1${(n/1000).toFixed(1)}k`;
  return `\u20B1${Math.round(n)}`;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  if (!user) { window.location.href = '../admin-login.html'; return; }
  const snap = await getDoc(doc(db, 'Users', user.uid));
  if (!snap.exists() || snap.data().role !== 'admin') {
    await signOut(auth); window.location.href = '../admin-login.html'; return;
  }
  const name = snap.data().name || user.email;
  setEl('userNameSidebar', name);
  setEl('topbarName', name);
  setInitial('userAvatarSidebar', name);
  setInitial('userAvatarTop', name);
  initReports();
});

function setEl(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function setInitial(id, name) { const el = document.getElementById(id); if (el) el.textContent = name[0].toUpperCase(); }

if (document.getElementById('logoutBtn')) {
  document.getElementById('logoutBtn').onclick = async () => {
    try { await signOut(auth); } catch {}
    window.location.href = '../admin-login.html';
  };
}

if (document.getElementById('pageDate')) {
  document.getElementById('pageDate').textContent = new Date().toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let showToast = m => console.log(m);
const toastEl = document.getElementById('toast');
const toastMsg = document.getElementById('toastMsg');
if (toastEl && toastMsg) {
  showToast = m => { toastMsg.textContent = m; toastEl.classList.add('show'); setTimeout(() => toastEl.classList.remove('show'), 3000); };
}

// ── Sidebar toggle ────────────────────────────────────────────────────────────
const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('overlay');
const hamburger = document.getElementById('hamburger');
if (hamburger) hamburger.onclick = () => { sidebar.classList.toggle('open'); overlay.classList.toggle('show'); };
if (overlay) overlay.onclick = () => { sidebar.classList.remove('open'); overlay.classList.remove('show'); };

// ── State ─────────────────────────────────────────────────────────────────────
let allOrders = [];
let selectedMonth = new Date().toISOString().slice(0, 7);
let reportsReady = false;

// ── Init ──────────────────────────────────────────────────────────────────────
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
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  select.innerHTML = months.map(m => {
    const [year, month] = m.split('-');
    const label = new Date(year, parseInt(month) - 1).toLocaleDateString('en-PH', { year: 'numeric', month: 'long' });
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

// ── Render ────────────────────────────────────────────────────────────────────
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
  const avg = monthOrders.length ? monthRev / monthOrders.length : 0;

  setEl('rptMonthRev', fmtCompact(monthRev));
  setEl('rptMonthOrders', monthOrders.length.toString());
  setEl('rptMonthAvg', monthOrders.length ? fmtCompact(avg) : '—');
  setEl('rptMonthRevSub', monthOrders.length ? `from ${monthOrders.length} paid orders` : 'No paid orders');
  setEl('rptMonthOrdersSub', `Paid orders in ${startDate.toLocaleDateString('en-PH', { month: 'long' })}`);

  const label = startDate.toLocaleDateString('en-PH', { year: 'numeric', month: 'long' });
  setEl('calTitle', label);

  renderCalendar(startDate, monthOrders);
  renderTopItems(monthOrders);
  renderStatusChart();
}

// ── Calendar ──────────────────────────────────────────────────────────────────
function renderCalendar(startDate, monthOrders) {
  const grid = document.getElementById('calGrid');
  if (!grid) return;

  const year = startDate.getFullYear();
  const month = startDate.getMonth();
  const today = new Date();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Build daily sales map
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

  // Find max revenue for heat scale
  const maxRev = Math.max(...Object.values(dailySales).map(s => s.revenue), 1);

  let html = '';
  for (let i = 0; i < firstDay; i++) html += '<div class="cal-day-cell empty"></div>';

  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const sales = dailySales[dateKey] || { revenue: 0, count: 0 };
    const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
    const hasSale = sales.count > 0;
    const heatPct = hasSale ? (sales.revenue / maxRev) : 0;

    // Heat color: low = gold-dim, high = gold
    const heatOpacity = 0.15 + heatPct * 0.85;
    const heatColor = hasSale ? `rgba(201,151,58,${heatOpacity})` : 'transparent';

    html += `<div class="cal-day-cell ${hasSale ? 'has-sales' : 'no-sale'} ${isToday ? 'today' : ''}" data-date="${dateKey}">
      <div class="cal-day-num">${day}</div>
      ${hasSale ? `
        <div class="cal-day-rev">${fmtTiny(sales.revenue)}</div>
        <div class="cal-day-cnt">${sales.count} order${sales.count !== 1 ? 's' : ''}</div>
      ` : ''}
      <div class="cal-day-heat" style="background:${heatColor};"></div>
    </div>`;
  }

  grid.innerHTML = html;

  // Click handlers
  grid.querySelectorAll('.cal-day-cell.has-sales').forEach(cell => {
    cell.addEventListener('click', () => {
      grid.querySelectorAll('.cal-day-cell').forEach(c => c.classList.remove('selected'));
      cell.classList.add('selected');
      showDayDetails(cell.dataset.date, monthOrders);
    });
  });

  // Auto-select today if it has sales
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const todayCell = grid.querySelector(`[data-date="${todayKey}"]`);
  if (todayCell && todayCell.classList.contains('has-sales')) {
    todayCell.classList.add('selected');
    showDayDetails(todayKey, monthOrders);
  }
}

// ── Day Details ───────────────────────────────────────────────────────────────
function showDayDetails(dateStr, monthOrders) {
  const dayOrders = monthOrders.filter(o => {
    const d = o.createdAt?.toDate();
    if (!d) return false;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return key === dateStr;
  });

  const dayRev = dayOrders.reduce((s, o) => s + (o.total || 0), 0);

  const [y, m, day] = dateStr.split('-');
  const date = new Date(y, parseInt(m) - 1, day);
  setEl('dayDetailTitle', date.toLocaleDateString('en-PH', { weekday: 'long', month: 'short', day: 'numeric' }));
  setEl('dayDetailRev', fmtCurrency(dayRev));
  setEl('dayDetailOrders', dayOrders.length.toString());

  // Build items list
  const itemCount = {};
  dayOrders.forEach(o => (o.items || []).forEach(it => {
    const k = it.name || '?';
    if (!itemCount[k]) itemCount[k] = { name: k, qty: 0, amount: 0 };
    itemCount[k].qty += (it.qty || 1);
    itemCount[k].amount += ((it.price || 0) * (it.qty || 1));
  }));
  const sorted = Object.values(itemCount).sort((a, b) => b.amount - a.amount);

  const tbody = document.getElementById('dayDetailItems');
  if (!tbody) return;
  if (!sorted.length) {
    tbody.innerHTML = '<tr><td colspan="3"><div class="empty-detail"><div class="empty-detail-icon">🍽️</div><div class="empty-detail-text">No items recorded</div></div></td></tr>';
    return;
  }
  tbody.innerHTML = sorted.map(it => `
    <tr>
      <td style="font-weight:500;">${it.name}</td>
      <td style="color:var(--gold);font-weight:600;text-align:center;">${it.qty}</td>
      <td style="text-align:right;font-weight:600;">${fmtCurrency(it.amount)}</td>
    </tr>`).join('');
}

// ── Top Items ─────────────────────────────────────────────────────────────────
function renderTopItems(orders) {
  const itemCount = {};
  orders.forEach(o => (o.items || []).forEach(it => {
    const k = it.name || '?';
    if (!itemCount[k]) itemCount[k] = { name: k, category: it.category || '—', orders: 0, revenue: 0 };
    itemCount[k].orders += (it.qty || 1);
    itemCount[k].revenue += ((it.price || 0) * (it.qty || 1));
  }));
  const sorted = Object.values(itemCount).sort((a, b) => b.orders - a.orders).slice(0, 10);
  const maxOrders = sorted.length ? sorted[0].orders : 1;

  const container = document.getElementById('topItemsBody');
  if (!container) return;

  if (!sorted.length) {
    container.innerHTML = '<div class="empty-detail"><div class="empty-detail-icon">🍽️</div><div class="empty-detail-text">No data for this month</div></div>';
    return;
  }

  container.innerHTML = sorted.map((it, i) => {
    const barPct = (it.orders / maxOrders) * 100;
    const rankClass = i === 0 ? 'r1' : i === 1 ? 'r2' : i === 2 ? 'r3' : '';
    return `<div class="top-item-row" style="--bar-w:${barPct}%;">
      <div class="top-item-rank ${rankClass}">${i + 1}</div>
      <div class="top-item-name">${it.name}</div>
      <div class="top-item-cat">${it.category}</div>
      <div class="top-item-sold">${it.orders}</div>
      <div class="top-item-rev">${fmtCurrency(it.revenue)}</div>
    </div>`;
  }).join('');

  // Stagger the bar widths for a nice entrance
  requestAnimationFrame(() => {
    container.querySelectorAll('.top-item-row').forEach((row, i) => {
      row.style.opacity = '0';
      row.style.transform = 'translateX(-8px)';
      row.style.transition = `opacity 0.3s ${i * 0.04}s, transform 0.3s ${i * 0.04}s`;
      requestAnimationFrame(() => { row.style.opacity = '1'; row.style.transform = 'none'; });
    });
  });
}

// ── Status Chart ──────────────────────────────────────────────────────────────
function renderStatusChart() {
  const statuses = ['pending', 'preparing', 'served', 'paid', 'cancelled'];
  const counts = {};
  statuses.forEach(s => counts[s] = 0);
  allOrders.forEach(o => { if (counts[o.status] !== undefined) counts[o.status]++; });
  const total = allOrders.length || 1;
  const max = Math.max(...Object.values(counts), 1);

  const chartEl = document.getElementById('statusChart');
  if (!chartEl) return;

  chartEl.innerHTML = statuses.map(s => {
    const pct = Math.round((counts[s] / total) * 100);
    const barW = (counts[s] / max) * 100;
    return `<div class="bar-row">
      <span class="bar-label">${capitalize(s)}</span>
      <div class="bar-track">
        <div class="bar-fill ${s}" style="width:0%" data-target="${barW}%"></div>
      </div>
      <span class="bar-count">${counts[s]}</span>
      <span class="bar-pct">${pct}%</span>
    </div>`;
  }).join('');

  // Animate bars after render
  requestAnimationFrame(() => {
    chartEl.querySelectorAll('.bar-fill').forEach(bar => {
      bar.style.width = bar.dataset.target;
    });
  });
}