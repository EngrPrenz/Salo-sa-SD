import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app = initializeApp({ apiKey: "AIzaSyCKQneulIrm9KWuOg69f29nFo6TGz2PF4w", authDomain: "salo-sa-antipolo.firebaseapp.com", projectId: "salo-sa-antipolo", storageBucket: "salo-sa-antipolo.firebasestorage.app", messagingSenderId: "60032898501", appId: "1:60032898501:web:3a4e663fee4ccd2adae7ac" });
const auth = getAuth(app);
const db = getFirestore(app);

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }
function fmtCurrency(n) { return `\u20B1${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function fmtCompact(n) {
  if (n >= 1000000) return `\u20B1${(n/1000000).toFixed(2)}M`;
  if (n >= 1000)    return `\u20B1${(n/1000).toFixed(2)}K`;
  return fmtCurrency(n);
}
function fmtTiny(n) {
  if (n >= 1000000) return `\u20B1${(n/1000000).toFixed(1)}M`;
  if (n >= 1000)    return `\u20B1${(n/1000).toFixed(1)}k`;
  return `\u20B1${Math.round(n)}`;
}
function toDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function startOfWeek(d) {
  const day = d.getDay();
  const diff = d.getDate() - day;
  return new Date(d.getFullYear(), d.getMonth(), diff);
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
let selectedPeriod = 'monthly';
let selectedMonth = new Date().toISOString().slice(0, 7);
let selectedDay = toDateKey(new Date());
let selectedWeekStart = startOfWeek(new Date());
let reportsReady = false;

// ── Period Tab Switching ──────────────────────────────────────────────────────
document.querySelectorAll('.rpt-period-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    selectedPeriod = tab.dataset.period;
    // Sync active state across all tab instances
    document.querySelectorAll('.rpt-period-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.period === selectedPeriod)
    );
    document.querySelectorAll('.rpt-panel-view').forEach(v => v.classList.remove('active'));
    const view = document.getElementById(`view-${selectedPeriod}`);
    if (view) view.classList.add('active');
    if (reportsReady) renderCurrentPeriod();
    if (window.lucide) lucide.createIcons();
  });
});

// ── Init ──────────────────────────────────────────────────────────────────────
function initReports() {
  populateMonthSelect();
  initDailyControls();
  initWeeklyControls();
  loadOrders().then(() => { reportsReady = true; });
}

// ── Monthly: populate select ──────────────────────────────────────────────────
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
    if (reportsReady) renderMonthly();
  });
}

// ── Daily: controls ───────────────────────────────────────────────────────────
function initDailyControls() {
  const input = document.getElementById('dayDateInput');
  const prevBtn = document.getElementById('dayPrevBtn');
  const nextBtn = document.getElementById('dayNextBtn');
  if (!input) return;
  input.value = selectedDay;
  input.max = toDateKey(new Date());
  input.addEventListener('change', () => {
    selectedDay = input.value;
    if (reportsReady) renderDaily();
  });
  prevBtn && prevBtn.addEventListener('click', () => {
    const d = new Date(selectedDay + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    selectedDay = toDateKey(d);
    input.value = selectedDay;
    if (reportsReady) renderDaily();
  });
  nextBtn && nextBtn.addEventListener('click', () => {
    const d = new Date(selectedDay + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    const today = toDateKey(new Date());
    if (toDateKey(d) <= today) {
      selectedDay = toDateKey(d);
      input.value = selectedDay;
      if (reportsReady) renderDaily();
    }
  });
}

// ── Weekly: controls ──────────────────────────────────────────────────────────
function initWeeklyControls() {
  const prevBtn = document.getElementById('weekPrevBtn');
  const nextBtn = document.getElementById('weekNextBtn');
  prevBtn && prevBtn.addEventListener('click', () => {
    selectedWeekStart = new Date(selectedWeekStart);
    selectedWeekStart.setDate(selectedWeekStart.getDate() - 7);
    if (reportsReady) renderWeekly();
  });
  nextBtn && nextBtn.addEventListener('click', () => {
    const next = new Date(selectedWeekStart);
    next.setDate(next.getDate() + 7);
    if (next <= new Date()) {
      selectedWeekStart = next;
      if (reportsReady) renderWeekly();
    }
  });
}

// ── Load Orders ───────────────────────────────────────────────────────────────
async function loadOrders() {
  const snap = await getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc')));
  allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderCurrentPeriod();
  updateOrdersBadge();
}

onSnapshot(query(collection(db, 'orders'), orderBy('createdAt', 'desc')), snap => {
  allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderCurrentPeriod();
  updateOrdersBadge();
});

function updateOrdersBadge() {
  const active = allOrders.filter(o => ['pending', 'preparing'].includes(o.status)).length;
  const badge = document.getElementById('ordersBadge');
  if (badge) { badge.textContent = active; badge.style.display = active > 0 ? 'inline-flex' : 'none'; }
}

function renderCurrentPeriod() {
  if (selectedPeriod === 'daily') renderDaily();
  else if (selectedPeriod === 'weekly') renderWeekly();
  else renderMonthly();
}

// ══════════════════════════════════════════════════════════════════════════════
// DAILY
// ══════════════════════════════════════════════════════════════════════════════
function renderDaily() {
  const [y, m, d] = selectedDay.split('-').map(Number);
  const startDate = new Date(y, m - 1, d, 0, 0, 0);
  const endDate   = new Date(y, m - 1, d, 23, 59, 59);

  const dayOrders = allOrders.filter(o => {
    const dt = o.createdAt?.toDate();
    return dt && dt >= startDate && dt <= endDate && o.status === 'paid';
  });

  const dayRev = dayOrders.reduce((s, o) => s + (o.total || 0), 0);
  const avg = dayOrders.length ? dayRev / dayOrders.length : 0;

  const date = new Date(y, m - 1, d);
  const dateLabel = date.toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  setEl('dayTitle', dateLabel);
  setEl('dayKpiRev', dayOrders.length ? fmtCompact(dayRev) : '₱0');
  setEl('dayKpiOrders', dayOrders.length.toString());
  setEl('dayKpiAvg', dayOrders.length ? fmtCompact(avg) : '—');
  setEl('dayKpiRevSub', dayOrders.length ? `from ${dayOrders.length} paid orders` : 'No sales this day');

  renderHourlyChart(dayOrders);
  renderTopItems(dayOrders, 'dayTopItemsBody');
  renderStatusChartForOrders(allOrders.filter(o => {
    const dt = o.createdAt?.toDate();
    return dt && dt >= startDate && dt <= endDate;
  }), 'dayStatusChart');
}

function renderHourlyChart(orders) {
  const el = document.getElementById('dailyHourlyChart');
  if (!el) return;

  // Build hourly buckets (operating hours 6am–11pm)
  const hours = {};
  for (let h = 6; h <= 23; h++) hours[h] = 0;
  orders.forEach(o => {
    const d = o.createdAt?.toDate();
    if (d) {
      const h = d.getHours();
      if (h >= 6 && h <= 23) hours[h] = (hours[h] || 0) + (o.total || 0);
    }
  });

  const maxVal = Math.max(...Object.values(hours), 1);
  const hasAny = Object.values(hours).some(v => v > 0);

  if (!hasAny) {
    el.innerHTML = '<div class="empty-detail"><div class="empty-detail-icon">🕐</div><div class="empty-detail-text">No sales recorded<br>for this day</div></div>';
    return;
  }

  const fmt12 = h => {
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}${period}`;
  };

  el.innerHTML = Object.entries(hours).map(([h, val]) => `
    <div class="hourly-bar-row">
      <span class="hourly-label">${fmt12(Number(h))}</span>
      <div class="hourly-track">
        <div class="hourly-fill" style="width:0%" data-target="${(val/maxVal)*100}%"></div>
      </div>
      <span class="hourly-val">${val > 0 ? fmtTiny(val) : ''}</span>
    </div>`).join('');

  requestAnimationFrame(() => {
    el.querySelectorAll('.hourly-fill').forEach(bar => {
      bar.style.width = bar.dataset.target;
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// WEEKLY
// ══════════════════════════════════════════════════════════════════════════════
function renderWeekly() {
  const weekEnd = new Date(selectedWeekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59);

  const weekStartFull = new Date(selectedWeekStart);
  weekStartFull.setHours(0, 0, 0, 0);

  const weekOrders = allOrders.filter(o => {
    const dt = o.createdAt?.toDate();
    return dt && dt >= weekStartFull && dt <= weekEnd && o.status === 'paid';
  });

  const weekRev = weekOrders.reduce((s, o) => s + (o.total || 0), 0);
  const avg = weekOrders.length ? weekRev / weekOrders.length : 0;

  // Week range label
  const rangeLabel = document.getElementById('weekRangeLabel');
  if (rangeLabel) {
    const opts = { month: 'short', day: 'numeric' };
    rangeLabel.textContent = `${weekStartFull.toLocaleDateString('en-PH', opts)} – ${weekEnd.toLocaleDateString('en-PH', { ...opts, year: 'numeric' })}`;
  }

  // Build daily breakdown
  const days = [];
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const todayKey = toDateKey(new Date());
  let bestDay = null, bestRev = -1;
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStartFull);
    d.setDate(d.getDate() + i);
    const key = toDateKey(d);
    const dayOrd = weekOrders.filter(o => {
      const dt = o.createdAt?.toDate();
      return dt && toDateKey(dt) === key;
    });
    const rev = dayOrd.reduce((s, o) => s + (o.total || 0), 0);
    if (rev > bestRev) { bestRev = rev; bestDay = { name: dayNames[d.getDay()], rev }; }
    days.push({ key, name: dayNames[d.getDay()], date: d, rev, orders: dayOrd.length, isToday: key === todayKey });
  }

  setEl('weekKpiRev', weekOrders.length ? fmtCompact(weekRev) : '₱0');
  setEl('weekKpiOrders', weekOrders.length.toString());
  setEl('weekKpiRevSub', `${weekOrders.length} paid orders`);
  setEl('weekKpiBestDay', bestDay && bestDay.rev > 0 ? bestDay.name : '—');
  setEl('weekKpiBestDaySub', bestDay && bestDay.rev > 0 ? fmtCompact(bestDay.rev) : 'No sales yet');

  renderWeeklyBars(days, weekOrders);
  renderTopItems(weekOrders, 'weekTopItemsBody');
  renderStatusChartForOrders(allOrders.filter(o => {
    const dt = o.createdAt?.toDate();
    return dt && dt >= weekStartFull && dt <= weekEnd;
  }), 'weekStatusChart');
}

function renderWeeklyBars(days, weekOrders) {
  const el = document.getElementById('weeklyBarsChart');
  if (!el) return;
  const maxRev = Math.max(...days.map(d => d.rev), 1);

  el.innerHTML = days.map((d, i) => `
    <div class="weekly-bar-col" data-idx="${i}">
      <div class="weekly-bar-val">${d.rev > 0 ? fmtTiny(d.rev) : ''}</div>
      <div class="weekly-bar-track" data-date="${d.key}" style="cursor:${d.rev>0?'pointer':'default'};">
        <div class="weekly-bar-fill ${d.isToday ? 'today' : ''}" style="height:0%" data-target="${(d.rev/maxRev)*100}%"></div>
      </div>
      <div class="weekly-bar-label ${d.isToday ? 'today' : ''}">${d.name}</div>
    </div>`).join('');

  requestAnimationFrame(() => {
    el.querySelectorAll('.weekly-bar-fill').forEach(bar => {
      bar.style.height = bar.dataset.target;
    });
  });

  // Click handlers
  el.querySelectorAll('.weekly-bar-track').forEach(track => {
    const dateKey = track.dataset.date;
    const dayData = days.find(d => d.key === dateKey);
    if (!dayData || dayData.rev === 0) return;
    track.addEventListener('click', () => {
      el.querySelectorAll('.weekly-bar-fill').forEach(b => b.classList.remove('selected'));
      track.querySelector('.weekly-bar-fill').classList.add('selected');
      showWeeklyDayDetail(dayData, weekOrders);
    });
  });
}

function showWeeklyDayDetail(dayData, weekOrders) {
  const detailEl = document.getElementById('weeklyDayDetail');
  const titleEl  = document.getElementById('weeklyDayDetailTitle');
  const kpisEl   = document.getElementById('weeklyDayKpis');
  if (!detailEl || !kpisEl) return;

  const dayLabel = dayData.date.toLocaleDateString('en-PH', { weekday: 'long', month: 'short', day: 'numeric' });
  titleEl.textContent = dayLabel;

  const dayOrd = weekOrders.filter(o => {
    const dt = o.createdAt?.toDate();
    return dt && toDateKey(dt) === dayData.key;
  });
  const rev = dayOrd.reduce((s, o) => s + (o.total || 0), 0);
  const avg = dayOrd.length ? rev / dayOrd.length : 0;

  kpisEl.innerHTML = `
    <div class="day-kpi gold">
      <div class="day-kpi-label">Revenue</div>
      <div class="day-kpi-value">${fmtCurrency(rev)}</div>
    </div>
    <div class="day-kpi">
      <div class="day-kpi-label">Orders</div>
      <div class="day-kpi-value">${dayOrd.length}</div>
    </div>
    <div class="day-kpi">
      <div class="day-kpi-label">Avg. Order</div>
      <div class="day-kpi-value">${dayOrd.length ? fmtCompact(avg) : '—'}</div>
    </div>`;

  detailEl.style.display = 'block';
  if (window.lucide) lucide.createIcons();
}

// ══════════════════════════════════════════════════════════════════════════════
// MONTHLY
// ══════════════════════════════════════════════════════════════════════════════
function renderMonthly() {
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
  renderTopItems(monthOrders, 'topItemsBody');
  renderStatusChartForOrders(allOrders.filter(o => {
    const d = o.createdAt?.toDate();
    return d && d >= startDate && d <= endDate;
  }), 'statusChart');
}

// ── Reports shared helpers ────────────────────────────────────────────────────

// now calls renderMonthly internally (kept for legacy)
function renderReports() { renderMonthly(); }

// ── Calendar ──────────────────────────────────────────────────────────────────
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
      const key = toDateKey(d);
      if (!dailySales[key]) dailySales[key] = { revenue: 0, count: 0 };
      dailySales[key].revenue += o.total || 0;
      dailySales[key].count++;
    }
  });

  const maxRev = Math.max(...Object.values(dailySales).map(s => s.revenue), 1);

  let html = '';
  for (let i = 0; i < firstDay; i++) html += '<div class="cal-day-cell empty"></div>';

  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const sales = dailySales[dateKey] || { revenue: 0, count: 0 };
    const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
    const hasSale = sales.count > 0;
    const heatPct = hasSale ? (sales.revenue / maxRev) : 0;
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

  grid.querySelectorAll('.cal-day-cell.has-sales').forEach(cell => {
    cell.addEventListener('click', () => {
      grid.querySelectorAll('.cal-day-cell').forEach(c => c.classList.remove('selected'));
      cell.classList.add('selected');
      showDayDetails(cell.dataset.date, monthOrders);
    });
  });

  const todayKey = toDateKey(today);
  const todayCell = grid.querySelector(`[data-date="${todayKey}"]`);
  if (todayCell && todayCell.classList.contains('has-sales')) {
    todayCell.classList.add('selected');
    showDayDetails(todayKey, monthOrders);
  }
}

// ── Day Details (monthly calendar panel) ─────────────────────────────────────
function showDayDetails(dateStr, monthOrders) {
  const dayOrders = monthOrders.filter(o => {
    const d = o.createdAt?.toDate();
    return d && toDateKey(d) === dateStr;
  });

  const dayRev = dayOrders.reduce((s, o) => s + (o.total || 0), 0);

  const [y, m, day] = dateStr.split('-');
  const date = new Date(y, parseInt(m) - 1, day);
  setEl('dayDetailTitle', date.toLocaleDateString('en-PH', { weekday: 'long', month: 'short', day: 'numeric' }));
  setEl('dayDetailRev', fmtCurrency(dayRev));
  setEl('dayDetailOrders', dayOrders.length.toString());

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

// ── Top Items (shared) ────────────────────────────────────────────────────────
function renderTopItems(orders, containerId) {
  const itemCount = {};
  orders.forEach(o => (o.items || []).forEach(it => {
    const k = it.name || '?';
    if (!itemCount[k]) itemCount[k] = { name: k, category: it.category || '—', orders: 0, revenue: 0 };
    itemCount[k].orders += (it.qty || 1);
    itemCount[k].revenue += ((it.price || 0) * (it.qty || 1));
  }));
  const sorted = Object.values(itemCount).sort((a, b) => b.orders - a.orders).slice(0, 10);
  const maxOrders = sorted.length ? sorted[0].orders : 1;

  const container = document.getElementById(containerId);
  if (!container) return;

  if (!sorted.length) {
    container.innerHTML = '<div class="empty-detail"><div class="empty-detail-icon">🍽️</div><div class="empty-detail-text">No data for this period</div></div>';
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

  requestAnimationFrame(() => {
    container.querySelectorAll('.top-item-row').forEach((row, i) => {
      row.style.opacity = '0';
      row.style.transform = 'translateX(-8px)';
      row.style.transition = `opacity 0.3s ${i * 0.04}s, transform 0.3s ${i * 0.04}s`;
      requestAnimationFrame(() => { row.style.opacity = '1'; row.style.transform = 'none'; });
    });
  });
}

// ── Status Chart (shared) ─────────────────────────────────────────────────────
function renderStatusChartForOrders(orders, chartId) {
  const statuses = ['pending', 'preparing', 'served', 'paid', 'cancelled'];
  const counts = {};
  statuses.forEach(s => counts[s] = 0);
  orders.forEach(o => { if (counts[o.status] !== undefined) counts[o.status]++; });
  const total = orders.length || 1;
  const max = Math.max(...Object.values(counts), 1);

  const chartEl = document.getElementById(chartId);
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

  requestAnimationFrame(() => {
    chartEl.querySelectorAll('.bar-fill').forEach(bar => {
      bar.style.width = bar.dataset.target;
    });
  });
}

// Legacy wrapper for monthly status chart
function renderStatusChart() {
  if (!selectedMonth) return;
  const [year, monthStr] = selectedMonth.split('-');
  const month = parseInt(monthStr) - 1;
  const startDate = new Date(year, month, 1);
  const endDate = new Date(year, month + 1, 0, 23, 59, 59);
  renderStatusChartForOrders(allOrders.filter(o => {
    const d = o.createdAt?.toDate();
    return d && d >= startDate && d <= endDate;
  }), 'statusChart');
}