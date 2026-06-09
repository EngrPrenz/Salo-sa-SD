import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, updateDoc, onSnapshot, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app = initializeApp({ apiKey: "AIzaSyCKQneulIrm9KWuOg69f29nFo6TGz2PF4w", authDomain: "salo-sa-antipolo.firebaseapp.com", projectId: "salo-sa-antipolo", storageBucket: "salo-sa-antipolo.firebasestorage.app", messagingSenderId: "60032898501", appId: "1:60032898501:web:3a4e663fee4ccd2adae7ac" });
const auth = getAuth(app);
const db = getFirestore(app);

const VAT_RATE = 0.12;
const SERVICE_CHARGE_RATE = 0.07;

function escapeHtml(s) { return (s + '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }
function computeVat(total) {
  const vatAmount = total * VAT_RATE / (1 + VAT_RATE);
  const netAmount = total - vatAmount;
  const serviceCharge = total * SERVICE_CHARGE_RATE;
  const grandTotal = total + serviceCharge;
  return { netAmount, vatAmount, serviceCharge, grandTotal, total };
}

let allOrders = [];
let activeFilter = 'all';

// ── Initial load + real-time listener ──────────────────────────────────────────
getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc'))).then(snap => {
  allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderOrders();
  updateOrdersBadge();
}).catch(err => console.error('getDocs error:', err));

onSnapshot(query(collection(db, 'orders'), orderBy('createdAt', 'desc')), snap => {
  allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderOrders();
  updateOrdersBadge();
}, err => console.error('onSnapshot error:', err));

// ── Auth guard ─────────────────────────────────────────────────────────────────
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

if (document.getElementById('logoutBtn')) {
  document.getElementById('logoutBtn').onclick = async () => {
    try { await signOut(auth); } catch (e) { console.error('Logout error:', e); }
    window.location.href = '../admin-login.html';
  };
}

if (document.getElementById('pageDate')) {
  document.getElementById('pageDate').textContent = new Date().toLocaleDateString('en-PH', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

// ── Toast ──────────────────────────────────────────────────────────────────────
let showToast = m => console.log(m);
const toastEl = document.getElementById('toast');
const toastMsgEl = document.getElementById('toastMsg');
if (toastEl && toastMsgEl) {
  showToast = m => {
    toastMsgEl.textContent = m;
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), 3000);
  };
}

// ── Sidebar hamburger ──────────────────────────────────────────────────────────
const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('overlay');
const hamburger = document.getElementById('hamburger');
if (hamburger) hamburger.onclick = () => { sidebar.classList.toggle('open'); overlay.classList.toggle('show'); };
if (overlay) overlay.onclick = () => { sidebar.classList.remove('open'); overlay.classList.remove('show'); };

// ── Badge ──────────────────────────────────────────────────────────────────────
function updateOrdersBadge() {
  const active = allOrders.filter(o => ['pending', 'preparing'].includes(o.status)).length;
  const badge = document.getElementById('ordersBadge');
  if (badge) { badge.textContent = active; badge.style.display = active > 0 ? 'inline-flex' : 'none'; }
}

// ── Tab switching ──────────────────────────────────────────────────────────────
function switchTab(status) {
  document.querySelectorAll('.ftab[data-status]').forEach(x => x.classList.remove('active'));
  const tab = document.querySelector(`.ftab[data-status="${status}"]`);
  if (tab) tab.classList.add('active');
  activeFilter = status;
}

// ── Update order status ────────────────────────────────────────────────────────
async function updateOrderStatus(id, status) {
  await updateDoc(doc(db, 'orders', id), { status, updatedAt: serverTimestamp() });

  if (status === 'served') switchTab('served');

  if (status === 'paid' || status === 'cancelled') {
    const order = allOrders.find(o => o.id === id);
    if (order?.tableNumber) {
      const tablesSnap = await getDocs(collection(db, 'tables'));
      const tableDoc = tablesSnap.docs.find(d => {
        const data = d.data();
        return data.tableNumber === order.tableNumber || d.id === `table_${order.tableNumber}`;
      });
      if (tableDoc) {
        await updateDoc(doc(db, 'tables', tableDoc.id), {
          status: 'free', waiterId: null, waiterName: null, lastUpdated: serverTimestamp()
        });
      }
    }
    switchTab(status);
  }

  showToast(`Order updated to "${status}"`);
}

// ── Search ─────────────────────────────────────────────────────────────────────
const orderSearch = document.getElementById('orderSearch');
if (orderSearch) orderSearch.addEventListener('input', renderOrders);

document.querySelectorAll('.ftab[data-status]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.ftab[data-status]').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  activeFilter = b.dataset.status;
  renderOrders();
}));

// ── Render orders grid ─────────────────────────────────────────────────────────
function renderOrders() {
  const grid = document.getElementById('ordersGrid');
  if (!grid) return;

  let filtered = allOrders;
  if (activeFilter !== 'all') {
    filtered = filtered.filter(o => o.status === activeFilter);
  }

  const q = orderSearch?.value?.trim().toLowerCase() || '';
  if (q) filtered = filtered.filter(o =>
    String(o.tableNumber).includes(q) || (o.waiterName || '').toLowerCase().includes(q)
  );

  if (!filtered.length) {
    grid.innerHTML = '<div class="empty-state">No orders found.</div>';
    return;
  }

  grid.innerHTML = filtered.map(o => {
    const subtotal = o.total || 0;
    const { netAmount, vatAmount, serviceCharge, grandTotal } = computeVat(subtotal);
    const itemCount = (o.items || []).length;
    const items = (o.items || []).map(it =>
      `<li>${it.name} × ${it.qty} <span>₱${((it.price || 0) * it.qty).toLocaleString()}</span></li>`
    ).join('');
    const ts = o.createdAt?.toDate
      ? o.createdAt.toDate().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })
      : '—';

    const nextStatus = { pending: 'preparing', preparing: 'served' }[o.status];
    const nextLabel  = { pending: 'Mark Preparing', preparing: 'Mark Served' }[o.status] || '';
    const showMarkPaid = o.status === 'served';
    const showCancel   = !['paid', 'cancelled', 'served'].includes(o.status);
    const showReceipt  = o.status !== 'cancelled';

    return `
      <div class="order-card ${o.status}">
        <div class="order-card-head">
          <div>
            <span class="order-id mono">#${o.id.slice(-5).toUpperCase()}</span>
            <span class="status-badge ${o.status}">${capitalize(o.status || '')}</span>
          </div>
          <span class="order-time">${ts}</span>
        </div>
        <div class="order-meta">Table <strong>${o.tableNumber || '?'}</strong> · ${o.waiterName || 'Unknown'}</div>
        <div class="order-items-wrap" onclick="window._toggleItems(this)">
          <ul class="order-items">${items}</ul>
        </div>
        ${o.status !== 'cancelled' ? `
        <div class="order-total" style="flex-direction:column;align-items:stretch;gap:4px;">
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);">
            <span>VAT-excl. Amount</span>
            <span style="font-family:'Courier New',monospace;">₱${netAmount.toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);">
            <span>VAT (12%)</span>
            <span style="font-family:'Courier New',monospace;">₱${vatAmount.toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);">
            <span>Service Charge (7%)</span>
            <span style="font-family:'Courier New',monospace;">₱${serviceCharge.toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding-top:6px;border-top:1px solid var(--border);margin-top:2px;">
            <span style="font-size:13px;color:var(--text-muted);">Grand Total</span>
            <strong>₱${grandTotal.toLocaleString('en-PH',{minimumFractionDigits:2})}</strong>
          </div>
        </div>` : ''}
        <div class="order-card-actions-row">
          <div class="order-card-actions-top">
            ${nextStatus ? `<button class="btn-sm gold" onclick="window._updateStatus('${o.id}','${nextStatus}')">${nextLabel}</button>` : ''}
            ${showMarkPaid ? `<button class="btn-sm green" onclick="window._updateStatus('${o.id}','paid')">Mark Paid</button>` : ''}
            ${showReceipt ? `<button class="btn-sm" onclick="window._showReceipt('${o.id}')">Receipt</button>` : ''}
          </div>
          ${showCancel ? `<button class="btn-sm danger" onclick="window._updateStatus('${o.id}','cancelled')">Cancel</button>` : ''}
        </div>
      </div>`;
  }).join('');
}

window._updateStatus = updateOrderStatus;

// ── Receipt modal ──────────────────────────────────────────────────────────────
window._showReceipt = id => {
  const o = allOrders.find(x => x.id === id);
  if (!o) { showToast('Order not found'); return; }
  const modal = document.getElementById('receiptModal');
  const body  = document.getElementById('receiptModalBody');
  if (!modal || !body) return;

  const subtotal = o.total || 0;
  const { netAmount, vatAmount, serviceCharge, grandTotal } = computeVat(subtotal);
  const ts = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString('en-PH') : '—';

  const items = (o.items || []).map(it => `
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed #eee;">
      <div style="flex:1;">${escapeHtml(it.name)}<span style="color:#888;margin-left:6px;">×${it.qty}</span></div>
      <div style="font-weight:600;">₱${((it.price||0)*(it.qty||0)).toLocaleString('en-PH',{minimumFractionDigits:2})}</div>
    </div>`).join('');

  body.innerHTML = `
    <div style="text-align:center;margin-bottom:12px;">
      <div style="font-weight:700;font-size:15px;">Order #${o.id.slice(-5).toUpperCase()}</div>
      <div style="color:var(--text-muted);font-size:12px;margin-top:4px;">${ts}</div>
      <div style="color:var(--text-muted);font-size:12px;">Table ${o.tableNumber||'?'} · ${escapeHtml(o.waiterName||'Unknown')}</div>
    </div>
    <hr style="border:none;border-top:1px solid var(--border);margin:10px 0;">
    <div style="overflow-y:auto;max-height:240px;scrollbar-width:thin;scrollbar-color:var(--border) transparent;">
      ${items}
    </div>
    <hr style="border:none;border-top:1px solid var(--border);margin:10px 0;">
    <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);padding:3px 0;">
      <span>VAT-excl. Amount</span><span>₱${netAmount.toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);padding:3px 0;">
      <span>VAT (12%)</span><span>₱${vatAmount.toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);padding:3px 0;">
      <span>Service Charge (7%)</span><span>₱${serviceCharge.toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:16px;font-weight:700;padding:8px 0 0;border-top:2px solid var(--border);margin-top:6px;">
      <span>TOTAL</span><span style="color:var(--gold-light);">₱${grandTotal.toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
    </div>`;

  // Store order id for print
  body.dataset.orderId = id;
  modal.classList.add('show');
};

if (document.getElementById('receiptModalClose')) {
  document.getElementById('receiptModalClose').onclick = () => document.getElementById('receiptModal').classList.remove('show');
}
if (document.getElementById('receiptModalClose2')) {
  document.getElementById('receiptModalClose2').onclick = () => document.getElementById('receiptModal').classList.remove('show');
}

// ── Print receipt ──────────────────────────────────────────────────────────────
let _logoCached = null;
async function getLogoBase64() {
  if (_logoCached) return _logoCached;
  try {
    const res = await fetch('../image/logo.png');
    const blob = await res.blob();
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => { _logoCached = reader.result; resolve(reader.result); };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

if (document.getElementById('receiptModalPrint')) {
  document.getElementById('receiptModalPrint').onclick = async () => {
    const body = document.getElementById('receiptModalBody');
    const id = body?.dataset.orderId;
    const o = id ? allOrders.find(x => x.id === id) : null;
    if (!o) { showToast('Could not find order for printing'); return; }
    const logoDataUrl = await getLogoBase64();
    printReceipt(o, logoDataUrl);
  };
}

function printReceipt(o, logoDataUrl) {
  const subtotal = o.total || 0;
  const { netAmount, vatAmount, serviceCharge, grandTotal } = computeVat(subtotal);
  const ts = o.createdAt?.toDate
    ? o.createdAt.toDate().toLocaleString('en-PH', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
      })
    : '—';

  const itemRows = (o.items || []).map(it => {
    const lineTotal = (it.price || 0) * (it.qty || 0);
    return `
      <tr>
        <td>${escapeHtml(it.name)}</td>
        <td style="text-align:center;">${it.qty}</td>
        <td style="text-align:right;">&#8369;${lineTotal.toLocaleString('en-PH',{minimumFractionDigits:2})}</td>
      </tr>`;
  }).join('');

  const pw = window.open('', '_blank', 'width=400,height=700,scrollbars=yes');
  if (!pw) { showToast('Please allow popups to print receipts.'); return; }

  pw.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Receipt &#8212; Salo sa Antipolo</title>
  <style>
    @page {
      size: 80mm auto;
      margin: 6mm 4mm 10mm 4mm;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: 11px;
      color: #111;
      background: #f5f5f5;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 20px 0 40px;
    }

    .hint-bar {
      background: #1a1a1a;
      color: #c9973a;
      font-family: Arial, sans-serif;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-align: center;
      padding: 10px 20px;
      width: 100%;
      margin-bottom: 20px;
    }
    .hint-bar span { color: #fff; }

    .receipt {
      background: #fff;
      width: 302px;
      padding: 10mm 5mm 12mm;
      box-shadow: 0 4px 24px rgba(0,0,0,0.15);
    }

    .rh { text-align: center; margin-bottom: 10px; }
    .rh img { display: block; margin: 0 auto 6px; width: 54px; height: 54px; border-radius: 50%; object-fit: contain; }
    .rh-name { font-family: Arial, sans-serif; font-size: 12px; font-weight: 700; line-height: 1.2; }
    .rh-italic { font-style: italic; font-size: 14px; font-weight: 700; color: #b8821e; display: block; }
    .rh-addr { font-size: 9px; color: #555; margin-top: 3px; line-height: 1.5; }
    .rh-tin  { font-size: 8.5px; color: #888; margin-top: 2px; }

    .ds { border: none; border-top: 1px solid #111; margin: 7px 0; }
    .dd { border: none; border-top: 1px dashed #aaa; margin: 5px 0; }

    .mr { display: flex; justify-content: space-between; font-size: 10px; color: #222; padding: 1.5px 0; }
    .ml { color: #666; flex-shrink: 0; margin-right: 8px; }
    .oid { font-weight: 700; font-size: 11px; color: #b8821e; letter-spacing: 0.05em; }

    table { width: 100%; border-collapse: collapse; font-size: 10px; }
    thead th {
      font-weight: 700; text-transform: uppercase;
      font-size: 8px; letter-spacing: 0.06em; color: #444;
      border-bottom: 1px solid #ccc; padding: 3px 0;
    }
    thead th:first-child { text-align: left; }
    tbody td { padding: 4px 0; vertical-align: top; }
    tbody tr:last-child td { border-bottom: 1px dashed #ccc; }

    .tr { display: flex; justify-content: space-between; font-size: 10px; padding: 2px 0; color: #333; }
    .tg {
      display: flex; justify-content: space-between;
      font-size: 12px; font-weight: 700;
      border-top: 1.5px solid #111; margin-top: 5px; padding-top: 5px;
    }
    .tg-amt { font-size: 14px; color: #b8821e; }

    .rf { text-align: center; margin-top: 14px; font-size: 9.5px; color: #555; line-height: 1.8; }
    .rf-ty  { font-weight: 700; font-size: 10px; color: #111; }
    .rf-note { font-size: 8px; color: #aaa; margin-top: 3px; }

    @media print {
      body {
        background: #fff;
        padding: 0;
        display: block;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .hint-bar { display: none !important; }
      .receipt {
        width: 100%;
        box-shadow: none;
        padding: 0;
      }
    }
  </style>
</head>
<body>

  <div class="receipt">

    <div class="rh">
      ${logoDataUrl ? `<img src="${logoDataUrl}" alt="Logo"/>` : ''}
      <div class="rh-name">Salo sa<br><span class="rh-italic">Antipolo</span></div>
      <div class="rh-addr">1870 Sumulong Hwy, Antipolo, 1870 Rizal</div>
    </div>

    <hr class="ds"/>

    <div class="mr"><span class="ml">Order No.:</span><span class="oid">#${o.id.slice(-5).toUpperCase()}</span></div>
    <div class="mr"><span class="ml">Date:</span><span>${ts}</span></div>
    <div class="mr"><span class="ml">Table:</span><span>${o.tableNumber || '&#8212;'}</span></div>
    <div class="mr"><span class="ml">Served by:</span><span>${escapeHtml(o.waiterName || 'Unknown')}</span></div>

    <hr class="dd"/>

    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th style="text-align:center;">Qty</th>
          <th style="text-align:right;">Amount</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>

    <div style="margin-top:5px;">
      <div class="tr"><span>VAT-Excl. Amount</span><span>&#8369;${netAmount.toLocaleString('en-PH',{minimumFractionDigits:2})}</span></div>
      <div class="tr"><span>VAT (12%)</span><span>&#8369;${vatAmount.toLocaleString('en-PH',{minimumFractionDigits:2})}</span></div>
      <div class="tr"><span>Service Charge (7%)</span><span>&#8369;${serviceCharge.toLocaleString('en-PH',{minimumFractionDigits:2})}</span></div>
      <div class="tg"><span>TOTAL</span><span class="tg-amt">&#8369;${grandTotal.toLocaleString('en-PH',{minimumFractionDigits:2})}</span></div>
    </div>

    <hr class="dd" style="margin-top:12px;"/>

    <div class="rf">
      <div class="rf-ty">Thank you for dining with us!</div>
      <div>Please come again &#128522;</div>
      <div class="rf-note">This serves as your official receipt.</div>
    </div>

  </div>

  <script>
    window.onload = function () {
      setTimeout(function () { window.print(); }, 400);
    };
  <\/script>

</body>
</html>`);
  pw.document.close();
}