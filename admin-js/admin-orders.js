import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs,
  updateDoc, onSnapshot, query, orderBy, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { bootstrapAdmin } from './admin-auth.js';

const app = initializeApp({ apiKey:"AIzaSyCKQneulIrm9KWuOg69f29nFo6TGz2PF4w", authDomain:"salo-sa-antipolo.firebaseapp.com", projectId:"salo-sa-antipolo", storageBucket:"salo-sa-antipolo.firebasestorage.app", messagingSenderId:"60032898501", appId:"1:60032898501:web:3a4e663fee4ccd2adae7ac" });
const auth = getAuth(app);
const db   = getFirestore(app);

const VAT_RATE            = 0.12;
const SERVICE_CHARGE_RATE = 0.07;

function escapeHtml(s) { return (s+'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function capitalize(s)  { return s ? s[0].toUpperCase()+s.slice(1) : ''; }

function computeVat(total) {
  const vatAmount     = total * VAT_RATE / (1 + VAT_RATE);
  const netAmount     = total - vatAmount;
  const serviceCharge = total * SERVICE_CHARGE_RATE;
  const grandTotal    = total + serviceCharge;
  return { netAmount, vatAmount, serviceCharge, grandTotal };
}

let allOrders   = [];
let activeFilter = 'all';

// ── Toast ─────────────────────────────────────────────────────────────────────
let showToast = m => console.log(m);
const toastEl    = document.getElementById('toast');
const toastMsgEl = document.getElementById('toastMsg');
if (toastEl && toastMsgEl) {
  showToast = m => { toastMsgEl.textContent=m; toastEl.classList.add('show'); setTimeout(()=>toastEl.classList.remove('show'),3000); };
}

// ── Bootstrap then start listeners ───────────────────────────────────────────
bootstrapAdmin(auth, db, { doc, getDoc, signOut }, 'admin-orders.html')
  .then(() => startListeners());

function startListeners() {
  onSnapshot(query(collection(db,'orders'), orderBy('createdAt','desc')), snap => {
    allOrders = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    renderOrders();
    updateOrdersBadge();
  });
}

function updateOrdersBadge() {
  const active = allOrders.filter(o => ['pending','preparing'].includes(o.status)).length;
  const badge  = document.getElementById('ordersBadge');
  if (badge) { badge.textContent=active; badge.style.display=active>0?'inline-flex':'none'; }
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(status) {
  document.querySelectorAll('.ftab[data-status]').forEach(x => x.classList.remove('active'));
  const tab = document.querySelector(`.ftab[data-status="${status}"]`);
  if (tab) tab.classList.add('active');
  activeFilter = status;
  renderOrders();
}

document.querySelectorAll('.ftab[data-status]').forEach(b => b.addEventListener('click', () => {
  switchTab(b.dataset.status);
}));

// ── Search ────────────────────────────────────────────────────────────────────
const orderSearch = document.getElementById('orderSearch');
if (orderSearch) orderSearch.addEventListener('input', renderOrders);

// ── Update status ─────────────────────────────────────────────────────────────
async function updateOrderStatus(id, status) {
  await updateDoc(doc(db,'orders',id), { status, updatedAt:serverTimestamp() });
  if (['paid','cancelled','served'].includes(status)) {
    if (status==='paid' || status==='cancelled') {
      const order = allOrders.find(o => o.id===id);
      if (order?.tableNumber) {
        const tablesSnap = await getDocs(collection(db,'tables'));
        const tableDoc   = tablesSnap.docs.find(d => {
          const data = d.data();
          return data.tableNumber===order.tableNumber || d.id===`table_${order.tableNumber}`;
        });
        if (tableDoc) await updateDoc(doc(db,'tables',tableDoc.id), { status:'free', waiterId:null, waiterName:null, lastUpdated:serverTimestamp() });
      }
    }
    switchTab(status);
  }
  showToast(`Order updated to "${status}"`);
}
window._updateStatus = updateOrderStatus;

// ── Toggle items expand ───────────────────────────────────────────────────────
window._toggleItems = function(el) {
  el.classList.toggle('expanded');
};

// ── Render orders ─────────────────────────────────────────────────────────────
function renderOrders() {
  const grid = document.getElementById('ordersGrid'); if (!grid) return;

  let filtered = allOrders;
  if (activeFilter !== 'all') {
    filtered = filtered.filter(o => o.status === activeFilter);
  }

  const q = (orderSearch?.value||'').trim().toLowerCase();
  if (q) filtered = filtered.filter(o => String(o.tableNumber).includes(q) || (o.waiterName||'').toLowerCase().includes(q));

  if (!filtered.length) { grid.innerHTML='<div class="empty-state">No orders found.</div>'; return; }

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
          <div><span class="order-id mono">#${o.id.slice(-5).toUpperCase()}</span> <span class="status-badge ${o.status}">${capitalize(o.status||'')}</span></div>
          <span class="order-time">${ts}</span>
        </div>
        <div class="order-meta">Table <strong>${o.tableNumber || '?'}</strong> · ${o.waiterName || 'Unknown'}</div>
        <div class="order-items-wrap" onclick="window._toggleItems(this)">
          <ul class="order-items">${items}</ul>
        </div>
        ${o.status !== 'cancelled' ? `
        <div class="order-total" style="flex-direction:column;align-items:stretch;gap:4px;">
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);"><span>VAT-excl.</span><span>₱${netAmount.toLocaleString('en-PH',{minimumFractionDigits:2})}</span></div>
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);"><span>VAT (12%)</span><span>₱${vatAmount.toLocaleString('en-PH',{minimumFractionDigits:2})}</span></div>
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);"><span>Service (7%)</span><span>₱${serviceCharge.toLocaleString('en-PH',{minimumFractionDigits:2})}</span></div>
          <div style="display:flex;justify-content:space-between;padding-top:6px;border-top:1px solid var(--border);">
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

// ── Receipt modal ─────────────────────────────────────────────────────────────
window._showReceipt = id => {
  const o = allOrders.find(x => x.id===id); if (!o) { showToast('Order not found'); return; }
  const modal = document.getElementById('receiptModal');
  const body  = document.getElementById('receiptModalBody');
  if (!modal||!body) return;

  const { netAmount, vatAmount, serviceCharge, grandTotal } = computeVat(o.total||0);
  const ts = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString('en-PH') : '—';

  // Build items list ONCE (no duplication)
  const items = (o.items||[]).map(it => `
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed rgba(255,255,255,0.08);">
      <div>${escapeHtml(it.name)} <span style="color:var(--text-muted)">×${it.qty}</span></div>
      <div style="font-weight:600;">₱${((it.price||0)*(it.qty||0)).toLocaleString('en-PH',{minimumFractionDigits:2})}</div>
    </div>`).join('');

  body.innerHTML = `
    <div style="text-align:center;margin-bottom:12px;">
      <div style="font-weight:700;font-size:15px;">Order #${o.id.slice(-5).toUpperCase()}</div>
      <div style="color:var(--text-muted);font-size:12px;margin-top:4px;">${ts}</div>
      <div style="color:var(--text-muted);font-size:12px;">Table ${o.tableNumber||'?'} · ${escapeHtml(o.waiterName||'Unknown')}</div>
    </div>
    <hr style="border:none;border-top:1px solid var(--border);margin:10px 0;">
    <div style="overflow-y:auto;max-height:220px;scrollbar-width:thin;scrollbar-color:var(--border) transparent;">
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

  body.dataset.orderId = id;
  modal.classList.add('show');
};

document.getElementById('receiptModalClose')?.addEventListener('click',  () => document.getElementById('receiptModal')?.classList.remove('show'));
document.getElementById('receiptModalClose2')?.addEventListener('click', () => document.getElementById('receiptModal')?.classList.remove('show'));

document.getElementById('receiptModalPrint')?.addEventListener('click', async () => {
  const body = document.getElementById('receiptModalBody');
  const id   = body?.dataset.orderId;
  const o    = id ? allOrders.find(x => x.id===id) : null;
  if (!o) { showToast('Could not find order for printing'); return; }

  let logo = null;
  try {
    const res  = await fetch('../image/logo.png');
    const blob = await res.blob();
    logo = await new Promise(r => { const rd=new FileReader(); rd.onload=()=>r(rd.result); rd.readAsDataURL(blob); });
  } catch(_) {}

  const { netAmount, vatAmount, serviceCharge, grandTotal } = computeVat(o.total||0);
  const ts = o.createdAt?.toDate
    ? o.createdAt.toDate().toLocaleString('en-PH',{year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:true})
    : '—';

  const rows = (o.items||[]).map(it =>
    `<tr>
      <td>${escapeHtml(it.name)}</td>
      <td style="text-align:center">${it.qty}</td>
      <td style="text-align:right">₱${((it.price||0)*(it.qty||0)).toLocaleString('en-PH',{minimumFractionDigits:2})}</td>
    </tr>`
  ).join('');

  const pw = window.open('','_blank','width=400,height=700');
  if (!pw) { showToast('Allow popups to print.'); return; }

  pw.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>Receipt</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'Courier New',monospace;font-size:11px;color:#111;background:#fff;padding:12mm 6mm;}
    .rh{text-align:center;margin-bottom:10px;}
    .logo{width:52px;height:52px;border-radius:50%;display:block;margin:0 auto 6px;}
    .rn{font-weight:700;font-size:13px;}.ri{font-style:italic;color:#b8821e;}
    hr.s{border:none;border-top:1px solid #111;margin:7px 0;}
    hr.d{border:none;border-top:1px dashed #aaa;margin:5px 0;}
    .mr{display:flex;justify-content:space-between;font-size:10px;padding:1px 0;}
    .ml{color:#888;}
    table{width:100%;border-collapse:collapse;font-size:10px;}
    th{text-align:left;font-size:8px;letter-spacing:.06em;text-transform:uppercase;color:#555;border-bottom:1px solid #ddd;padding:3px 0;}
    th:not(:first-child){text-align:right;}
    td{padding:4px 0;}
    tbody tr:last-child td{border-bottom:1px dashed #ccc;}
    .tr{display:flex;justify-content:space-between;font-size:10px;padding:2px 0;}
    .tg{display:flex;justify-content:space-between;font-size:13px;font-weight:700;border-top:1.5px solid #111;margin-top:6px;padding-top:5px;}
    .tg span:last-child{color:#b8821e;}
    .ft{text-align:center;margin-top:14px;font-size:9px;color:#777;line-height:1.8;}
    @media print{body{padding:0;}}
  </style></head><body>
  <div class="rh">
    ${logo ? `<img class="logo" src="${logo}" alt=""/>` : ''}
    <div class="rn">Salo sa <span class="ri">Antipolo</span></div>
  </div>
  <hr class="s"/>
  <div class="mr"><span class="ml">Order:</span><span style="font-weight:700;color:#b8821e">#${o.id.slice(-5).toUpperCase()}</span></div>
  <div class="mr"><span class="ml">Date:</span><span>${ts}</span></div>
  <div class="mr"><span class="ml">Table:</span><span>${o.tableNumber||'—'}</span></div>
  <div class="mr"><span class="ml">Waiter:</span><span>${escapeHtml(o.waiterName||'—')}</span></div>
  <hr class="d"/>
  <table>
    <thead><tr><th>Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div style="margin-top:6px;">
    <div class="tr"><span>VAT-Excl.</span><span>₱${netAmount.toLocaleString('en-PH',{minimumFractionDigits:2})}</span></div>
    <div class="tr"><span>VAT (12%)</span><span>₱${vatAmount.toLocaleString('en-PH',{minimumFractionDigits:2})}</span></div>
    <div class="tr"><span>Service Charge (7%)</span><span>₱${serviceCharge.toLocaleString('en-PH',{minimumFractionDigits:2})}</span></div>
    <div class="tg"><span>TOTAL</span><span>₱${grandTotal.toLocaleString('en-PH',{minimumFractionDigits:2})}</span></div>
  </div>
  <hr class="d" style="margin-top:12px;"/>
  <div class="ft"><strong>Thank you for dining with us!</strong><br>Please come again 😊</div>
  <script>window.onload=()=>setTimeout(()=>window.print(),400);<\/script>
  </body></html>`);
  pw.document.close();
});