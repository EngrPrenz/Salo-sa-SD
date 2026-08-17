import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs,
  onSnapshot, query, orderBy,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { bootstrapAdmin } from './admin-auth.js';

const app = initializeApp({ apiKey:"AIzaSyCKQneulIrm9KWuOg69f29nFo6TGz2PF4w", authDomain:"salo-sa-antipolo.firebaseapp.com", projectId:"salo-sa-antipolo", storageBucket:"salo-sa-antipolo.firebasestorage.app", messagingSenderId:"60032898501", appId:"1:60032898501:web:3a4e663fee4ccd2adae7ac" });
const auth = getAuth(app);
const db   = getFirestore(app);

function escapeHtml(s) { return (s+'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function capitalize(s)  { return s ? s[0].toUpperCase()+s.slice(1) : ''; }

/** Generate N skeleton <tr> rows with shimmer cells of given widths (px). */
function skeletonRows(n, widths) {
  return Array(n).fill(null).map(() =>
    `<tr class="skeleton-row">${widths.map((w,i)=>`<td><div class="sk-cell" style="width:${w}px;animation-delay:${i*0.06}s"></div></td>`).join('')}</tr>`
  ).join('');
}

/** Replace a stat card value element with a shimmer placeholder. */
function skeletonStat(valueId, subId) {
  const v = document.getElementById(valueId);
  const s = document.getElementById(subId);
  if (v) v.innerHTML = '<div class="sk-val"></div>';
  if (s) s.innerHTML = '<div class="sk-sub"></div>';
}

let allOrders     = [];
let tableStatuses = {};
let tableDocsList = [];
let currentRole   = '';

const VAT_RATE            = 0.12;
const SERVICE_CHARGE_RATE = 0.07;

function computeVat(total) {
  const vatAmount     = total * VAT_RATE / (1 + VAT_RATE);
  const netAmount     = total - vatAmount;
  const serviceCharge = total * SERVICE_CHARGE_RATE;
  const grandTotal    = total + serviceCharge;
  return { netAmount, vatAmount, serviceCharge, grandTotal };
}

// ── Bootstrap (resolves after auth guard passes) ───────────────────────────────
bootstrapAdmin(auth, db, { doc, getDoc, signOut }, 'admin-overview.html')
  .then(userInfo => {
    currentRole = userInfo.role;
    applyCashierRestrictions(currentRole);
    // Start data listeners only after auth resolves
    startListeners();
  });

// ── Toast ─────────────────────────────────────────────────────────────────────
let showToast = m => console.log(m);
const toastEl  = document.getElementById('toast');
const toastMsg = document.getElementById('toastMsg');
if (toastEl && toastMsg) {
  showToast = m => { toastMsg.textContent=m; toastEl.classList.add('show'); setTimeout(()=>toastEl.classList.remove('show'),3000); };
}

// ── Hide revenue stat card for cashier ────────────────────────────────────────
function applyCashierRestrictions(role) {
  if (role !== 'admin_cashier') return;
  // Hide "Today's Revenue" stat card — cashiers don't need financial overview
  const revenueCard = document.getElementById('statRevenueCard');
  if (revenueCard) revenueCard.style.display = 'none';
}

// ── Data listeners ────────────────────────────────────────────────────────────
function startListeners() {
  // Show skeleton placeholders while waiting for first snapshot
  skeletonStat('statActiveOrders', 'statOrdersSub');
  skeletonStat('statTablesOcc', 'statTablesSub');
  skeletonStat('statRevenue', 'statRevSub');
  const tbody = document.getElementById('recentOrdersBody');
  if (tbody) tbody.innerHTML = skeletonRows(6, [80, 70, 90, 60, 90, 70]);

  // Orders
  onSnapshot(query(collection(db,'orders'), orderBy('createdAt','desc')), snap => {
    allOrders = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    renderOverview();
    renderOverviewTableGrid();
    updateOrdersBadge();
  });

  // Tables
  onSnapshot(collection(db,'tables'), snap => {
    tableStatuses = {}; tableDocsList = [];
    snap.forEach(d => {
      const data = d.data();
      const rawNum = data.tableNumber ? parseInt(data.tableNumber) : parseInt(d.id.replace('table_',''));
      const num = isNaN(rawNum) ? null : rawNum;
      if (!num) return;
      tableStatuses[num] = { docId:d.id, ...data, tableNumber:num };
      tableDocsList.push({ docId:d.id, tableNumber:num, ...data });
    });
    tableDocsList.sort((a,b) => a.tableNumber - b.tableNumber);
    renderOverviewTableGrid();
  });
}

function updateOrdersBadge() {
  const active = allOrders.filter(o => ['pending','preparing'].includes(o.status)).length;
  const badge  = document.getElementById('ordersBadge');
  if (badge) { badge.textContent=active; badge.style.display=active>0?'inline-flex':'none'; }
}

function renderOverview() {
  const active = allOrders.filter(o => ['pending','preparing','paid'].includes(o.status));
  const el = id => document.getElementById(id);

  if (el('statActiveOrders')) el('statActiveOrders').textContent = active.length;
  if (el('statOrdersSub')) {
    el('statOrdersSub').textContent =
      `${allOrders.filter(o=>o.status==='pending').length} pending · ${allOrders.filter(o=>o.status==='preparing').length} preparing`;
  }

  const occupied = [...new Set(active.map(o=>o.tableNumber))].length;
  if (el('statTablesOcc')) el('statTablesOcc').textContent = occupied;
  if (el('statTablesSub')) el('statTablesSub').textContent = `of ${tableDocsList.length||10} tables`;

  // Revenue — only rendered when card is visible (non-cashier)
  if (currentRole !== 'admin_cashier') {
    const today = new Date(); today.setHours(0,0,0,0);
    const completedToday = allOrders.filter(o => ['paid','served'].includes(o.status) && o.createdAt?.toDate()>=today);
    const rev = completedToday.reduce((s,o) => s + computeVat(Number(o.total)||0).grandTotal, 0);
    if (el('statRevenue')) el('statRevenue').textContent = `₱${rev.toLocaleString('en-PH',{minimumFractionDigits:2})}`;
    if (el('statRevSub'))  el('statRevSub').textContent  = `${completedToday.length} completed orders today (incl. service)`;
  }

  renderRecentOrders();
}

function renderRecentOrders() {
  const tbody = document.getElementById('recentOrdersBody');
  if (!tbody) return;
  const orders = allOrders.slice(0, 6);
  if (!orders.length) { tbody.innerHTML='<tr><td colspan="6" class="empty-row">No orders yet.</td></tr>'; return; }
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

function renderOverviewTableGrid() {
  const grid = document.getElementById('overviewTableGrid');
  if (!grid) return;
  const active = allOrders.filter(o => ['pending','preparing','paid'].includes(o.status));
  const occupied = {};
  active.forEach(o => { if (o.tableNumber) occupied[o.tableNumber] = o.status; });
  const tables = tableDocsList.length ? tableDocsList : Array.from({length:10},(_,i)=>({tableNumber:i+1}));
  grid.innerHTML = tables.map(t => {
    const n    = t.tableNumber;
    const st   = occupied[n] || tableStatuses[n]?.status || 'free';
    const norm = st==='available' ? 'free' : st;
    const label = t.name || `${n}`;
    return `<div class="mini-table ${norm}"><span class="mini-table-num">${escapeHtml(label)}</span><span class="mini-table-st">${norm==='free'?'Free':capitalize(norm)}</span></div>`;
  }).join('');
}
