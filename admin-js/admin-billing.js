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
const DISCOUNT_RATE       = 0.20; // PWD / Senior Citizen

function escapeHtml(s) { return (s+'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function capitalize(s)  { return s ? s[0].toUpperCase()+s.slice(1) : ''; }

/**
 * Compute totals.
 * discountInfo: null | { type: 'PWD'|'Senior Citizen', count: number }
 *
 * Strategy:
 *   – Each item line is treated as a "meal entry" with value = price × qty.
 *   – The `count` highest-value meal entries get 20 % off.
 *   – Discount is applied BEFORE VAT / service charge.
 */
function computeTotals(items = [], total = 0, discountInfo = null) {
  // subtotal from items (may differ slightly from o.total due to rounding — use o.total as base)
  const subtotal = Number(total) || 0;

  // --- Discount computation ---
  let discountAmount = 0;
  let discountedItems = []; // { name, lineTotal, discountAmt }

  if (discountInfo && discountInfo.count > 0) {
    // Sort item lines by line total descending, pick top N
    const sorted = [...items]
      .map(it => ({
        name: it.name,
        lineTotal: (Number(it.price) || 0) * (Number(it.qty) || 0),
      }))
      .sort((a, b) => b.lineTotal - a.lineTotal);

    const toDiscount = sorted.slice(0, discountInfo.count);
    discountedItems = toDiscount.map(it => ({
      ...it,
      discountAmt: it.lineTotal * DISCOUNT_RATE,
    }));
    discountAmount = discountedItems.reduce((s, it) => s + it.discountAmt, 0);
  }

  const discountedSubtotal = subtotal - discountAmount;

  // VAT is computed on the discounted subtotal
  const vatAmount     = discountedSubtotal * VAT_RATE / (1 + VAT_RATE);
  const netAmount     = discountedSubtotal - vatAmount;
  const serviceCharge = discountedSubtotal * SERVICE_CHARGE_RATE;
  const grandTotal    = discountedSubtotal + serviceCharge;

  return { netAmount, vatAmount, serviceCharge, grandTotal, discountAmount, discountedItems };
}

// Legacy helper kept for "today's total" where we don't apply discounts (or apply stored ones)
function computeVat(total) {
  return computeTotals([], total, null);
}

let allOrders = [];

// ── Toast ─────────────────────────────────────────────────────────────────────
let showToast = m => console.log(m);
const toastEl  = document.getElementById('toast');
const toastMsg = document.getElementById('toastMsg');
if (toastEl && toastMsg) {
  showToast = m => { toastMsg.textContent=m; toastEl.classList.add('show'); setTimeout(()=>toastEl.classList.remove('show'),3000); };
}

// ── In-memory discount store (per order, resets on page reload) ───────────────
// Structure: { [orderId]: { type: 'PWD'|'Senior Citizen', count: number } }
const discountStore = {};

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
  const paidOrders = allOrders.filter(o => ['paid', 'served'].includes(o.status));

  // Today's total — use stored discounts if any
  const now        = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const todayGrandTotal = paidOrders
    .filter(o => {
      if (!o.createdAt) return false;
      const ts = typeof o.createdAt.toDate === 'function' ? o.createdAt.toDate() : new Date(o.createdAt);
      return ts >= todayStart;
    })
    .reduce((sum, o) => {
      const di = discountStore[o.id] || null;
      return sum + computeTotals(o.items, Number(o.total)||0, di).grandTotal;
    }, 0);

  const totalEl = document.getElementById('billingTodayTotal');
  if (totalEl) totalEl.textContent = `₱${todayGrandTotal.toLocaleString('en-PH',{minimumFractionDigits:2})}`;

  if (!paidOrders.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-row">No paid orders yet.</td></tr>';
    return;
  }

  tbody.innerHTML = paidOrders.map(o => {
    const ts        = o.createdAt?.toDate
      ? o.createdAt.toDate().toLocaleString('en-PH',{dateStyle:'short',timeStyle:'short'}) : '—';
    const itemCount = (o.items||[]).length;
    const di        = discountStore[o.id] || null;
    const { grandTotal } = computeTotals(o.items, Number(o.total)||0, di);
    const discBadge = di
      ? `<span class="discount-badge">${di.type === 'PWD' ? 'PWD' : 'SC'} ×${di.count}</span>`
      : '';
    return `<tr>
      <td class="mono">#${o.id.slice(-5).toUpperCase()}</td>
      <td>Table ${escapeHtml(String(o.tableNumber||'—'))}</td>
      <td class="col-waiter">${escapeHtml(o.waiterName||'—')}</td>
      <td class="col-items">${itemCount} item${itemCount!==1?'s':''}${discBadge}</td>
      <td><strong>₱${grandTotal.toLocaleString('en-PH',{minimumFractionDigits:2})}</strong></td>
      <td class="col-date" style="white-space:nowrap">${ts}</td>
      <td><span class="status-badge ${escapeHtml(o.status)}">${capitalize(o.status||'')}</span></td>
      <td><button class="btn-sm" onclick="window._showReceipt('${escapeHtml(o.id)}')">Receipt</button></td>
    </tr>`;
  }).join('');
}

// ── Receipt modal ─────────────────────────────────────────────────────────────
window._showReceipt = id => {
  const o = allOrders.find(x => x.id===id); if (!o) { showToast('Order not found'); return; }
  const modal = document.getElementById('receiptModal');
  const body  = document.getElementById('receiptModalBody');
  if (!modal||!body) return;

  body.dataset.orderId = id;
  renderReceiptBody(o);
  modal.classList.add('show');
};

function renderReceiptBody(o) {
  const body = document.getElementById('receiptModalBody'); if (!body) return;
  const di   = discountStore[o.id] || null;
  const { netAmount, vatAmount, serviceCharge, grandTotal, discountAmount, discountedItems }
    = computeTotals(o.items, Number(o.total)||0, di);

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

  // --- Discount section ---
  const discountTypeVal  = di?.type  || 'PWD';
  const discountCountVal = di?.count || 1;
  const hasDiscount      = !!di;

  const discountSectionHtml = `
    <div style="margin:12px 0;padding:10px 12px;background:rgba(255,255,255,0.04);border-radius:8px;border:1px solid rgba(255,255,255,0.08);">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px;">
        Discount (PWD / Senior Citizen)
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <select id="discountType" style="flex:1;min-width:110px;background:var(--surface,#1a1a2e);color:var(--white,#fff);border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:6px 8px;font-size:12px;">
          <option value="" ${!hasDiscount?'selected':''}>— None —</option>
          <option value="PWD" ${di?.type==='PWD'?'selected':''}>PWD (20%)</option>
          <option value="Senior Citizen" ${di?.type==='Senior Citizen'?'selected':''}>Senior Citizen (20%)</option>
        </select>
        <div style="display:flex;align-items:center;gap:6px;">
          <label style="font-size:11px;color:var(--text-muted);white-space:nowrap;">No. of persons:</label>
          <input id="discountCount" type="number" min="1" max="${(o.items||[]).length}" value="${discountCountVal}"
            style="width:54px;background:var(--surface,#1a1a2e);color:var(--white,#fff);border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:6px 8px;font-size:12px;text-align:center;"
            ${!hasDiscount?'disabled':''}/>
        </div>
        <button id="applyDiscountBtn"
          style="background:var(--gold-light,#d4a843);color:#111;border:none;border-radius:6px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;">
          Apply
        </button>
      </div>
      ${hasDiscount ? `
      <div style="margin-top:8px;font-size:11px;color:var(--gold-light,#d4a843);">
        ✓ ${escapeHtml(di.type)} discount applied for ${di.count} person${di.count!==1?'s':''}
        — top ${di.count} meal${di.count!==1?'s':''} discounted:
        ${discountedItems.map(it=>`<em>${escapeHtml(it.name)}</em> (−₱${it.discountAmt.toLocaleString('en-PH',{minimumFractionDigits:2})})`).join(', ')}
      </div>` : ''}
    </div>`;

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
    ${discountSectionHtml}
    <hr style="border:none;border-top:1px solid var(--border);margin:12px 0 8px;">
    <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);padding:3px 0;">
      <span>VAT-excl. Amount</span><span>₱${netAmount.toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);padding:3px 0;">
      <span>VAT (12%)</span><span>₱${vatAmount.toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
    </div>
    ${hasDiscount ? `
    <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--gold-light,#d4a843);padding:3px 0;">
      <span>${escapeHtml(di.type)} Discount (20% × ${di.count})</span>
      <span>−₱${discountAmount.toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
    </div>` : ''}
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

  // Wire up discount controls
  const typeSelect  = document.getElementById('discountType');
  const countInput  = document.getElementById('discountCount');
  const applyBtn    = document.getElementById('applyDiscountBtn');

  typeSelect?.addEventListener('change', () => {
    if (countInput) countInput.disabled = !typeSelect.value;
  });

  applyBtn?.addEventListener('click', () => {
    const type  = typeSelect?.value;
    const count = parseInt(countInput?.value, 10);

    if (!type) {
      // Remove discount
      delete discountStore[o.id];
    } else {
      if (!count || count < 1) { showToast('Enter a valid number of persons.'); return; }
      const maxItems = (o.items||[]).length;
      if (count > maxItems) { showToast(`Only ${maxItems} item line${maxItems!==1?'s':''} in this order.`); return; }
      discountStore[o.id] = { type, count };
    }

    // Re-render receipt body and billing table
    renderReceiptBody(o);
    renderBilling();
    showToast(type ? `${type} discount applied!` : 'Discount removed.');
  });
}

document.getElementById('receiptModalClose')?.addEventListener('click',  () => document.getElementById('receiptModal')?.classList.remove('show'));
document.getElementById('receiptModalClose2')?.addEventListener('click', () => document.getElementById('receiptModal')?.classList.remove('show'));
document.getElementById('receiptModal')?.addEventListener('click', e => {
  if (e.target === document.getElementById('receiptModal')) document.getElementById('receiptModal').classList.remove('show');
});

// ── Print receipt ─────────────────────────────────────────────────────────────
document.getElementById('receiptModalPrint')?.addEventListener('click', async () => {
  const body = document.getElementById('receiptModalBody'); if (!body) return;
  const id   = body.dataset?.orderId;
  const o    = id ? allOrders.find(x => x.id===id) : null;
  if (!o) return;

  const di = discountStore[o.id] || null;
  const { netAmount, vatAmount, serviceCharge, grandTotal, discountAmount, discountedItems }
    = computeTotals(o.items, Number(o.total)||0, di);

  let logo = null;
  try {
    const res  = await fetch('../image/logo.png');
    const blob = await res.blob();
    logo = await new Promise(r => { const rd=new FileReader(); rd.onload=()=>r(rd.result); rd.readAsDataURL(blob); });
  } catch(_) {}

  const ts = o.createdAt?.toDate
    ? o.createdAt.toDate().toLocaleString('en-PH',{year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:true})
    : '—';

  const rows = (o.items||[]).map(it =>
    `<tr>
      <td>${escapeHtml(it.name)}</td>
      <td style="text-align:center">${it.qty}</td>
      <td style="text-align:right">₱${((Number(it.price)||0)*(Number(it.qty)||0)).toLocaleString('en-PH',{minimumFractionDigits:2})}</td>
    </tr>`
  ).join('');

  const discountRowHtml = di && discountAmount > 0 ? `
    <div class="tr disc"><span>${escapeHtml(di.type)} Disc. (20% × ${di.count})</span><span>−₱${discountAmount.toLocaleString('en-PH',{minimumFractionDigits:2})}</span></div>
    <div style="font-size:9px;color:#777;margin:2px 0 4px;line-height:1.4;">
      ${discountedItems.map(it=>`${escapeHtml(it.name)} −₱${it.discountAmt.toLocaleString('en-PH',{minimumFractionDigits:2})}`).join(' · ')}
    </div>` : '';

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
    .tr.disc{color:#b8821e;font-weight:700;}
    .tg{display:flex;justify-content:space-between;font-size:13px;font-weight:700;border-top:1.5px solid #111;margin-top:6px;padding-top:5px;}
    .tg span:last-child{color:#b8821e;}
    .ft{text-align:center;margin-top:14px;font-size:9px;color:#777;line-height:1.8;}
    .disc-box{border:1px dashed #b8821e;border-radius:4px;padding:4px 6px;margin:6px 0;font-size:10px;}
    .disc-box .db-title{font-weight:700;color:#b8821e;margin-bottom:2px;}
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
  ${di ? `
  <div class="disc-box">
    <div class="db-title">${escapeHtml(di.type)} Discount — ${di.count} Person${di.count!==1?'s':''}</div>
    ${discountedItems.map(it=>`<div style="display:flex;justify-content:space-between;">
      <span>${escapeHtml(it.name)}</span><span>−₱${it.discountAmt.toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
    </div>`).join('')}
  </div>` : ''}
  <div style="margin-top:6px;">
    <div class="tr"><span>VAT-Excl.</span><span>₱${netAmount.toLocaleString('en-PH',{minimumFractionDigits:2})}</span></div>
    <div class="tr"><span>VAT (12%)</span><span>₱${vatAmount.toLocaleString('en-PH',{minimumFractionDigits:2})}</span></div>
    ${discountRowHtml}
    <div class="tr"><span>Service Charge (7%)</span><span>₱${serviceCharge.toLocaleString('en-PH',{minimumFractionDigits:2})}</span></div>
    <div class="tg"><span>TOTAL</span><span>₱${grandTotal.toLocaleString('en-PH',{minimumFractionDigits:2})}</span></div>
  </div>
  <hr class="d" style="margin-top:12px;"/>
  <div class="ft"><strong>Thank you for dining with us!</strong><br>Please come again 😊</div>
  <script>window.onload=()=>setTimeout(()=>window.print(),400);<\/script>
  </body></html>`);
  pw.document.close();
});