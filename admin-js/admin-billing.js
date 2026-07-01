import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc,
  onSnapshot, query, orderBy,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { bootstrapAdmin } from './admin-auth.js';

const app = initializeApp({ apiKey:"AIzaSyCKQneulIrm9KWuOg69f29nFo6TGz2PF4w", authDomain:"salo-sa-antipolo.firebaseapp.com", projectId:"salo-sa-antipolo", storageBucket:"salo-sa-antipolo.firebasestorage.app", messagingSenderId:"60032898501", appId:"1:60032898501:web:3a4e663fee4ccd2adae7ac" });
const auth = getAuth(app);
const db   = getFirestore(app);

const VAT_RATE            = 0.12;
const SERVICE_CHARGE_RATE = 0.07;
const PAGE_SIZE            = 10;
let billingPage             = 1;

function escapeHtml(s) { return (s+'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function capitalize(s)  { return s ? s[0].toUpperCase()+s.slice(1) : ''; }

function computeVat(total) {
  const vatAmount     = total * VAT_RATE / (1 + VAT_RATE);
  const netAmount     = total - vatAmount;
  const serviceCharge = total * SERVICE_CHARGE_RATE;
  const grandTotal    = total + serviceCharge;
  return { netAmount, vatAmount, serviceCharge, grandTotal };
}

let allOrders = [];

// ── Toast ─────────────────────────────────────────────────────────────────────
let showToast = m => console.log(m);
const toastEl  = document.getElementById('toast');
const toastMsg = document.getElementById('toastMsg');
if (toastEl && toastMsg) {
  showToast = m => { toastMsg.textContent=m; toastEl.classList.add('show'); setTimeout(()=>toastEl.classList.remove('show'),3000); };
}

// ── Bootstrap then start listeners ───────────────────────────────────────────
bootstrapAdmin(auth, db, { doc, getDoc, signOut }, 'admin-billing.html')
  .then(() => startListeners());

function startListeners() {
  onSnapshot(query(collection(db,'orders'), orderBy('createdAt','desc')), snap => {
    allOrders = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    renderBilling();
    updateOrdersBadge();
  });
}

function updateOrdersBadge() {
  const active = allOrders.filter(o => ['pending','preparing'].includes(o.status)).length;
  const badge  = document.getElementById('ordersBadge');
  if (badge) { badge.textContent=active; badge.style.display=active>0?'inline-flex':'none'; }
}

// ── Render billing ────────────────────────────────────────────────────────────
function renderBilling() {
  const tbody = document.getElementById('billingTableBody'); if (!tbody) return;
  const paidOrders = allOrders.filter(o => ['paid', 'served', 'completed'].includes(o.status));

  // Today's total (using grandTotal with service charge)
  const now        = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const todayGrandTotal = paidOrders
    .filter(o => {
      if (!o.createdAt) return false;
      const ts = typeof o.createdAt.toDate === 'function' ? o.createdAt.toDate() : new Date(o.createdAt);
      return ts >= todayStart;
    })
    .reduce((sum, o) => sum + computeVat(Number(o.total)||0).grandTotal, 0);

  const totalEl = document.getElementById('billingTodayTotal');
  if (totalEl) totalEl.textContent = `₱${todayGrandTotal.toLocaleString('en-PH',{minimumFractionDigits:2})}`;

  if (!paidOrders.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-row">No completed transactions yet.</td></tr>';
    renderPagination(0);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(paidOrders.length / PAGE_SIZE));
  if (billingPage > totalPages) billingPage = totalPages;
  const start    = (billingPage - 1) * PAGE_SIZE;
  const pageRows = paidOrders.slice(start, start + PAGE_SIZE);

  tbody.innerHTML = pageRows.map(o => {
    const ts        = o.createdAt?.toDate
      ? o.createdAt.toDate().toLocaleString('en-PH',{dateStyle:'short',timeStyle:'short'}) : '—';
    const itemCount = (o.items||[]).length;
    const { grandTotal } = computeVat(Number(o.total)||0);
    return `<tr>
      <td class="mono">#${o.id.slice(-5).toUpperCase()}</td>
      <td>Table ${escapeHtml(String(o.tableNumber||'—'))}</td>
      <td class="col-waiter">${escapeHtml(o.waiterName||'—')}</td>
      <td class="col-items">${itemCount} item${itemCount!==1?'s':''}</td>
      <td><strong>₱${grandTotal.toLocaleString('en-PH',{minimumFractionDigits:2})}</strong></td>
      <td class="col-date" style="white-space:nowrap">${ts}</td>
      <td><span class="status-badge ${escapeHtml(o.status)}">${capitalize(o.status||'')}</span></td>
      <td><button class="btn-sm" onclick="window._showReceipt('${escapeHtml(o.id)}')">Receipt</button></td>
    </tr>`;
  }).join('');

  renderPagination(paidOrders.length, totalPages);
}

// ── Pagination ────────────────────────────────────────────────────────────────
function renderPagination(rowCount, totalPages = 1) {
  const el = document.getElementById('billingPagination'); if (!el) return;
  if (rowCount <= PAGE_SIZE) { el.innerHTML = ''; return; }

  const start = (billingPage - 1) * PAGE_SIZE + 1;
  const end   = Math.min(billingPage * PAGE_SIZE, rowCount);

  el.innerHTML = `
    <span class="pagination-info">${start}–${end} of ${rowCount}</span>
    <div class="pagination-controls">
      <button class="btn-sm" id="pgPrev" ${billingPage<=1?'disabled':''}>‹ Prev</button>
      <span class="pagination-page">${billingPage} / ${totalPages}</span>
      <button class="btn-sm" id="pgNext" ${billingPage>=totalPages?'disabled':''}>Next ›</button>
    </div>`;

  document.getElementById('pgPrev')?.addEventListener('click', () => { if (billingPage>1) { billingPage--; renderBilling(); } });
  document.getElementById('pgNext')?.addEventListener('click', () => { if (billingPage<totalPages) { billingPage++; renderBilling(); } });
}

// ── Receipt modal ─────────────────────────────────────────────────────────────
window._showReceipt = id => {
  const o = allOrders.find(x => x.id===id); if (!o) { showToast('Order not found'); return; }
  const modal = document.getElementById('receiptModal');
  const body  = document.getElementById('receiptModalBody');
  if (!modal||!body) return;

  const { netAmount, vatAmount, serviceCharge, grandTotal } = computeVat(Number(o.total)||0);

  const items = (o.items||[]).map(it => `
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
      <div style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        ${escapeHtml(it.name)} <span style="color:var(--text-muted)">× ${it.qty}</span>
      </div>
      <div style="flex-shrink:0;margin-left:12px;font-weight:600;">
        ₱${((Number(it.price)||0)*(Number(it.qty)||0)).toLocaleString('en-PH',{minimumFractionDigits:2})}
      </div>
    </div>`).join('');

  const ts = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString('en-PH') : '—';

  body.innerHTML = `
    <div style="margin-bottom:12px;">
      <div style="font-size:15px;font-weight:700;color:var(--white)">Order #${o.id.slice(-5).toUpperCase()}</div>
      <div style="color:var(--text-muted);font-size:12px;margin-top:3px;">${ts}</div>
      <div style="color:var(--text-muted);font-size:12px;">
        Table ${escapeHtml(String(o.tableNumber||'—'))} · ${escapeHtml(o.waiterName||'—')}
      </div>
    </div>
    <hr style="border:none;border-top:1px solid var(--border);margin:0 0 10px;">
    ${items}
    <hr style="border:none;border-top:1px solid var(--border);margin:12px 0 8px;">
    <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);padding:3px 0;">
      <span>VAT-excl. Amount</span><span>₱${netAmount.toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);padding:3px 0;">
      <span>VAT (12%)</span><span>₱${vatAmount.toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);padding:3px 0;">
      <span>Service Charge (7%)</span><span>₱${serviceCharge.toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
    </div>
    <hr style="border:none;border-top:1px solid var(--border);margin:8px 0;">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted)">Total</span>
      <span style="font-size:20px;font-weight:700;color:var(--gold-light);font-family:'Cormorant Garamond',serif;">
        ₱${grandTotal.toLocaleString('en-PH',{minimumFractionDigits:2})}
      </span>
    </div>`;

  body.dataset.orderId = id;
  modal.classList.add('show');
};

document.getElementById('receiptModalClose')?.addEventListener('click',  () => document.getElementById('receiptModal')?.classList.remove('show'));
document.getElementById('receiptModalClose2')?.addEventListener('click', () => document.getElementById('receiptModal')?.classList.remove('show'));
document.getElementById('receiptModal')?.addEventListener('click', e => {
  if (e.target === document.getElementById('receiptModal')) document.getElementById('receiptModal').classList.remove('show');
});

document.getElementById('receiptModalPrint')?.addEventListener('click', async () => {
  const body = document.getElementById('receiptModalBody'); if (!body) return;
  const id   = body.dataset?.orderId;
  const o    = id ? allOrders.find(x => x.id===id) : null;

  // If we have the full order object, do a rich print; otherwise fall back to HTML copy
  if (!o) {
    const pw = window.open('','_blank');
    pw.document.write(`<!DOCTYPE html><html><head><title>Receipt — Salo sa Antipolo</title>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/tabler-icons/2.47.0/iconfont/tabler-icons.min.css"/>
      <style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:'Courier New',monospace;padding:24px 20px;max-width:320px;margin:0 auto;font-size:13px;color:#111;}
      h2{text-align:center;font-size:18px;margin-bottom:4px;}.sub{text-align:center;color:#666;font-size:11px;margin-bottom:6px;}
      .addr{text-align:center;color:#999;font-size:10px;margin-bottom:20px;line-height:1.5;}
      hr{border:none;border-top:1px dashed #bbb;margin:14px 0;}.footer{text-align:center;margin-top:28px;font-size:11px;color:#888;}
      .social{display:flex;justify-content:center;gap:12px;margin-top:10px;}.social i{font-size:14px;color:#999;}</style></head>
      <body><h2>Salo sa Antipolo</h2><div class="sub">Official Receipt</div>
      <div class="addr">Sumulong Highway, Siete Media,<br>Antipolo City, Rizal, Philippines, 1870</div>
      ${body.innerHTML}<div class="footer">Thank you for dining with us!</div>
      <div class="social"><i class="ti ti-brand-instagram"></i><i class="ti ti-brand-tiktok"></i><i class="ti ti-phone"></i></div></body></html>`);
    pw.document.close();
    setTimeout(() => pw.print(), 300);
    return;
  }

  let logo = null;
  try {
    const res  = await fetch('../image/logo.png');
    const blob = await res.blob();
    logo = await new Promise(r => { const rd=new FileReader(); rd.onload=()=>r(rd.result); rd.readAsDataURL(blob); });
  } catch(_) {}

  const { netAmount, vatAmount, serviceCharge, grandTotal } = computeVat(Number(o.total)||0);
  const ts   = o.createdAt?.toDate
    ? o.createdAt.toDate().toLocaleString('en-PH',{year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:true})
    : '—';
  const rows = (o.items||[]).map(it =>
    `<tr>
      <td>${escapeHtml(it.name)}</td>
      <td style="text-align:center">${it.qty}</td>
      <td style="text-align:right">₱${((Number(it.price)||0)*(Number(it.qty)||0)).toLocaleString('en-PH',{minimumFractionDigits:2})}</td>
    </tr>`
  ).join('');

  const pw = window.open('','_blank','width=400,height=700');
  if (!pw) { showToast('Allow popups to print.'); return; }

  pw.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>Receipt</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/tabler-icons/2.47.0/iconfont/tabler-icons.min.css"/>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'Courier New',monospace;font-size:11px;color:#111;background:#fff;padding:12mm 6mm;}
    .rh{text-align:center;margin-bottom:10px;}
    .logo{width:52px;height:52px;border-radius:50%;display:block;margin:0 auto 6px;}
    .rn{font-weight:700;font-size:13px;}.ri{font-style:italic;color:#b8821e;}
    .ra{font-size:9px;color:#888;margin-top:3px;line-height:1.5;}
    .social{display:flex;justify-content:center;gap:12px;margin-top:8px;}
    .social i{font-size:14px;color:#999;}
    .handle{text-align:center;font-size:9px;color:#aaa;margin-top:4px;}
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
    <div class="ra">Sumulong Highway, Siete Media,<br>Antipolo City, Rizal, Philippines, 1870</div>
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
  <div class="social">
    <i class="ti ti-brand-instagram"></i><i class="ti ti-brand-tiktok"></i><i class="ti ti-brand-facebook"></i><i class="ti ti-phone"></i><i class="ti ti-mail"></i>
  </div>
  <div class="handle">@salosaantipolo</div>
  <script>window.onload=()=>setTimeout(()=>window.print(),400);<\/script>
  </body></html>`);
  pw.document.close();
});