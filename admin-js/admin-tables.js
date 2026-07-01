import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs,
  updateDoc, deleteDoc, setDoc, onSnapshot, query, orderBy, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { bootstrapAdmin } from './admin-auth.js';

const app = initializeApp({ apiKey:"AIzaSyCKQneulIrm9KWuOg69f29nFo6TGz2PF4w", authDomain:"salo-sa-antipolo.firebaseapp.com", projectId:"salo-sa-antipolo", storageBucket:"salo-sa-antipolo.firebasestorage.app", messagingSenderId:"60032898501", appId:"1:60032898501:web:3a4e663fee4ccd2adae7ac" });
const auth = getAuth(app);
const db   = getFirestore(app);

function escapeHtml(s) { return (s+'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function capitalize(s)  { return s ? s[0].toUpperCase()+s.slice(1) : ''; }

// ── Toast ─────────────────────────────────────────────────────────────────────
let showToast = m => console.log(m);
const toastEl  = document.getElementById('toast');
const toastMsg = document.getElementById('toastMsg');
if (toastEl && toastMsg) {
  showToast = m => { toastMsg.textContent=m; toastEl.classList.add('show'); setTimeout(()=>toastEl.classList.remove('show'),3000); };
}

// ── Confirm modal ─────────────────────────────────────────────────────────────
function showConfirm({ icon='⚠️', title='Confirm', message, okLabel='Confirm', onOk }) {
  const modal = document.getElementById('confirmModal'); if(!modal){if(onOk&&window.confirm(message))onOk();return;}
  document.getElementById('confirmIcon').textContent   = icon;
  document.getElementById('confirmTitle').textContent  = title;
  document.getElementById('confirmMessage').textContent = message;
  const okBtn = document.getElementById('confirmOk'); okBtn.textContent = okLabel;
  modal.classList.add('show');
  if (window.lucide) lucide.createIcons();
  const close = () => modal.classList.remove('show');
  const cleanup = () => {
    ['confirmOk','confirmCancel','confirmModalClose'].forEach(id => {
      const el=document.getElementById(id); if(el){const clone=el.cloneNode(true);el.parentNode.replaceChild(clone,el);}
    });
  };
  const handler  = () => { close(); cleanup(); if(onOk) onOk(); };
  const cancelH  = () => { close(); cleanup(); };
  document.getElementById('confirmOk')?.addEventListener('click', handler, {once:true});
  document.getElementById('confirmCancel')?.addEventListener('click', cancelH, {once:true});
  document.getElementById('confirmModalClose')?.addEventListener('click', cancelH, {once:true});
}

// ── State ─────────────────────────────────────────────────────────────────────
let tableStatuses = {};
let tableDocsList = [];
let allOrders     = [];

// ── Bootstrap then start listeners ───────────────────────────────────────────
bootstrapAdmin(auth, db, { doc, getDoc, signOut }, 'admin-tables.html')
  .then(() => startListeners());

function startListeners() {
  onSnapshot(query(collection(db,'orders'), orderBy('createdAt','desc')), snap => {
    allOrders = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    updateOrdersBadge();
  });

  onSnapshot(collection(db,'tables'), snap => {
    tableStatuses = {}; tableDocsList = [];
    snap.forEach(d => {
      const data=d.data();
      const rawNum=data.tableNumber?parseInt(data.tableNumber):parseInt(d.id.replace('table_',''));
      const num=isNaN(rawNum)?null:rawNum; if(!num) return;
      if(tableStatuses[num]&&!data.tableNumber) return;
      tableStatuses[num]={docId:d.id,...data,tableNumber:num};
      const idx=tableDocsList.findIndex(t=>t.tableNumber===num);
      if(idx!==-1) tableDocsList.splice(idx,1);
      tableDocsList.push({docId:d.id,tableNumber:num,...data});
    });
    tableDocsList.sort((a,b)=>a.tableNumber-b.tableNumber);
    renderTablesGrid();
    updateTableCountStat();
    checkReservationTimes();
  });
}

function updateOrdersBadge() {
  const active=allOrders.filter(o=>['pending','preparing'].includes(o.status)).length;
  const badge=document.getElementById('ordersBadge');
  if(badge){badge.textContent=active;badge.style.display=active>0?'inline-flex':'none';}
}

const STATUS_CFG = {
  free:      {icon:'armchair',     label:'Free',      textColor:'#5e5e5e'},
  reserved:  {icon:'calendar-check',label:'Reserved', textColor:'#c9973a'},
  'walk-in': {icon:'users',        label:'Walk-in',   textColor:'#e8c07a'},
  pending:   {icon:'clock',        label:'Pending',   textColor:'#f39c12'},
  preparing: {icon:'chef-hat',     label:'Preparing', textColor:'#3498db'},
  served:    {icon:'check-circle', label:'Served',    textColor:'#2ecc71'},
  billed:    {icon:'banknote',     label:'Billed',    textColor:'#9b59b6'},
};

function getResMins(timeStr) {
  const m=timeStr?.match(/(\d+):(\d+)\s*(AM|PM)/i); if(!m) return null;
  let h=parseInt(m[1])%12; if(m[3].toUpperCase()==='PM') h+=12; return h*60+parseInt(m[2]);
}

function updateTableCountStat() {
  const el=document.getElementById('tablesToolbarTitle'); if(el) el.textContent=`${tableDocsList.length} Tables`;
}

function renderTablesGrid() {
  const grid=document.getElementById('tablesGrid'); if(!grid) return;
  const cards=tableDocsList.map(entry=>{
    const n=entry.tableNumber, data=tableStatuses[n];
    const rawSt=(data?.status||'free').toLowerCase().trim();
    const st=rawSt==='available'?'free':rawSt;
    const cfg=STATUS_CFG[st]||STATUS_CFG.free;
    const waiter=data?.waiterName||null, guestName=data?.reservation?.guestName||null, resTime=data?.reservation?.time||null;
    const label=data?.name||`Table ${n}`, cap=data?.capacity?`· ${data.capacity} seats`:'';
    return `
      <div class="table-card ${st}">
        <div class="table-card-num" style="color:${cfg.textColor}">${escapeHtml(label)}</div>
        ${cap?`<div class="table-card-info muted" style="font-size:11px;margin-top:-6px;">${escapeHtml(cap)}</div>`:''}
        <div class="table-card-icon"><i data-lucide="${cfg.icon}"></i></div>
        <div class="table-card-status">
          <span class="status-badge ${st}" style="color:${cfg.textColor};border-color:${cfg.textColor}33;background:${cfg.textColor}18">${cfg.label}</span>
        </div>
        ${renderTableDetail(n, st, data, cfg, guestName, resTime, waiter)}
        <div style="display:flex;gap:6px;margin-top:4px;">
          <button class="btn-sm" style="flex:1;" onclick="window._openEditTableModal(${n})"><i data-lucide="edit-3"></i></button>
          <button class="btn-sm danger" onclick="window._deleteTable(${n})"><i data-lucide="trash-2"></i></button>
        </div>
      </div>`;
  });
  cards.push(`<div class="table-card free add-table-card" onclick="window._openAddTableModal()" style="cursor:pointer;border-style:dashed;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;opacity:0.65;">
    <i data-lucide="plus" style="font-size:32px;"></i>
    <div style="font-size:13px;font-weight:600;color:var(--text-muted);">Add Table</div>
  </div>`);
  grid.innerHTML=cards.join('');
  setTimeout(()=>{if(window.lucide)lucide.createIcons();},100);
}

function renderTableDetail(n, st, data, cfg, guestName, resTime, waiter) {
  if(st==='reserved'){
    const reservations=data?.reservations||[];
    if(reservations.length>0) return `<div style="width:100%;margin-top:4px;">${reservations.map((r,i)=>`
      <div style="display:flex;align-items:center;justify-content:space-between;gap:4px;margin-bottom:3px;">
        <span style="color:${cfg.textColor};font-size:10px;"><i data-lucide="user"></i> ${escapeHtml(r.guestName)} · ${escapeHtml(r.time)}</span>
        <button class="btn-sm" style="padding:1px 5px;font-size:9px;border-color:rgba(192,57,43,0.4);color:#e07070;" onclick="window._removeReservation(${n},${i})"><i data-lucide="x"></i></button>
      </div>`).join('')}</div>`;
    return `
      <div class="table-card-info" style="color:${cfg.textColor};font-weight:500;"><i data-lucide="user"></i> ${escapeHtml(guestName||'—')}</div>
      <div class="table-card-info" style="color:${cfg.textColor};"><i data-lucide="clock"></i> ${escapeHtml(resTime||'—')}</div>
      <button class="btn-sm" style="margin-top:6px;border-color:rgba(192,57,43,0.4);color:#e07070;width:100%;" onclick="window._removeReservation(${n},0)"><i data-lucide="x"></i> Remove</button>`;
  }
  if(st==='free'){
    const now=new Date(), nowMins=now.getHours()*60+now.getMinutes();
    const reservations=data?.reservations||[];
    const resList=reservations.length>0?`<div style="width:100%;margin-top:4px;">${reservations.map((r,i)=>{
      const rMins=getResMins(r.time), minsUntil=rMins-nowMins;
      const urgentColor=minsUntil<=60?'#e07070':'#c9973a', urgentLabel=minsUntil<=60?`⚠️ in ${minsUntil}m`:'';
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:4px;margin-bottom:3px;">
        <span style="color:${urgentColor};font-size:10px;"><i data-lucide="calendar-clock"></i> ${escapeHtml(r.guestName)} · ${escapeHtml(r.time)}${urgentLabel?` <span style="color:#e07070;font-weight:700;"> ${urgentLabel}</span>`:''}</span>
        <button class="btn-sm" style="padding:1px 5px;font-size:9px;border-color:rgba(192,57,43,0.4);color:#e07070;" onclick="window._removeReservation(${n},${i})"><i data-lucide="x"></i></button>
      </div>`;}).join('')}</div>`:
    `<div class="table-card-info muted">No waiter assigned</div>`;
    return resList+`<button class="btn-sm gold" style="margin-top:6px;width:100%;" onclick="window._openReserveModal(${n})"><i data-lucide="plus"></i> Reserve</button>`;
  }
  return `<div class="table-card-info" style="color:${cfg.textColor}">${waiter?`<i data-lucide="user"></i> ${escapeHtml(waiter)}`:'No waiter assigned'}</div>`;
}

// ── Add / Edit table ──────────────────────────────────────────────────────────
window._openAddTableModal = () => openTableModal('add');
window._openEditTableModal = n => openTableModal('edit', n);
let tableModalMode='add', tableModalTarget=null;

function openTableModal(mode, tableNum=null) {
  tableModalMode=mode; tableModalTarget=tableNum;
  const modal=document.getElementById('tableModal'); if(!modal) return;
  const numRow=document.getElementById('tableModalNumberRow');
  document.getElementById('tableModalTitle').textContent = mode==='add'?'Add New Table':'Edit Table';
  if(numRow) numRow.style.display = mode==='add'?'':'none';
  if(mode==='add'){
    let next=1; while(tableDocsList.find(t=>t.tableNumber===next)) next++;
    const ni=document.getElementById('tableModalNumber'); if(ni) ni.value=next;
    const nn=document.getElementById('tableModalName'); if(nn) nn.value='';
    const nc=document.getElementById('tableModalCapacity'); if(nc) nc.value='';
  } else {
    const data=tableStatuses[tableNum];
    const nn=document.getElementById('tableModalName'); if(nn) nn.value=data?.name||'';
    const nc=document.getElementById('tableModalCapacity'); if(nc) nc.value=data?.capacity||'';
  }
  modal.classList.add('show');
  document.getElementById('tableModalName')?.focus();
}

document.getElementById('tableModalClose')?.addEventListener('click',  ()=>document.getElementById('tableModal').classList.remove('show'));
document.getElementById('tableModalCancel')?.addEventListener('click', ()=>document.getElementById('tableModal').classList.remove('show'));

document.getElementById('tableModalSave')?.addEventListener('click', async ()=>{
  const name=document.getElementById('tableModalName')?.value.trim();
  const capacity=document.getElementById('tableModalCapacity')?.value?parseInt(document.getElementById('tableModalCapacity').value):null;
  const btn=document.getElementById('tableModalSave');
  if(tableModalMode==='add'){
    const num=parseInt(document.getElementById('tableModalNumber')?.value);
    if(!num||num<1){showToast('Enter a valid table number.');return;}
    if(tableStatuses[num]){showToast(`Table ${num} already exists.`);return;}
    btn.disabled=true;btn.textContent='Saving…';
    try{await setDoc(doc(db,'tables',`table_${num}`),{tableNumber:num,name:name||null,capacity:capacity||null,status:'free',reservation:null,waiterId:null,waiterName:null,lastUpdated:serverTimestamp()});showToast(`Table ${num} added.`);document.getElementById('tableModal').classList.remove('show');}
    catch(e){showToast('Failed to add table.');console.error(e);}finally{btn.disabled=false;btn.textContent='Save';}
  }else{
    const data=tableStatuses[tableModalTarget]; if(!data){showToast('Table not found.');return;}
    btn.disabled=true;btn.textContent='Saving…';
    try{await updateDoc(doc(db,'tables',data.docId),{name:name||null,capacity:capacity||null,lastUpdated:serverTimestamp()});showToast(`Table ${tableModalTarget} updated.`);document.getElementById('tableModal').classList.remove('show');}
    catch(e){showToast('Failed to update table.');console.error(e);}finally{btn.disabled=false;btn.textContent='Save';}
  }
});

window._deleteTable = n => {
  const data=tableStatuses[n]; if(!data) return;
  const label=data.name?`"${data.name}" (Table ${n})`:`Table ${n}`;
  showConfirm({icon:'🗑️',title:'Delete Table',message:`Delete ${label}? This cannot be undone.`,okLabel:'Delete',
    onOk:async()=>{try{await deleteDoc(doc(db,'tables',data.docId));showToast(`${label} deleted.`);}catch(e){showToast('Failed.');console.error(e);}}
  });
};

// ── Reserve modal ─────────────────────────────────────────────────────────────
let reserveTarget=null;
window._openReserveModal = n => {
  reserveTarget=n;
  const modal=document.getElementById('reserveModal'); if(!modal) return;
  document.getElementById('reserveTableLabel').textContent=`Reserve Table ${n}`;
  ['reserveGuestName'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  if(document.getElementById('reserveHour'))   document.getElementById('reserveHour').value='7';
  if(document.getElementById('reserveMinute')) document.getElementById('reserveMinute').value='00';
  if(document.getElementById('reserveAmPm'))   document.getElementById('reserveAmPm').value='PM';
  modal.classList.add('show');
};

document.getElementById('reserveModalClose')?.addEventListener('click',  ()=>{document.getElementById('reserveModal').classList.remove('show');reserveTarget=null;});
document.getElementById('reserveModalCancel')?.addEventListener('click', ()=>{document.getElementById('reserveModal').classList.remove('show');reserveTarget=null;});

document.getElementById('reserveModalConfirm')?.addEventListener('click', async()=>{
  const guestName=document.getElementById('reserveGuestName')?.value.trim();
  const hour=parseInt(document.getElementById('reserveHour').value)||12;
  const minute=String(document.getElementById('reserveMinute').value).padStart(2,'0');
  const ampm=document.getElementById('reserveAmPm').value;
  const time=`${hour}:${minute} ${ampm}`;
  if(!guestName){showToast('Please enter the guest name.');return;}
  const now=new Date(); let rh=hour%12; if(ampm==='PM') rh+=12;
  const resMins=rh*60+parseInt(minute), nowMins=now.getHours()*60+now.getMinutes();
  if(resMins<=nowMins){showToast(`${time} has already passed.`);return;}
  const data=tableStatuses[reserveTarget]; if(!data){showToast('Table not found.');return;}
  const existing=data.reservations||[];
  for(const r of existing){const em=getResMins(r.time);if(em===null)continue;if(Math.abs(resMins-em)<30){showToast(`Too close to reservation at ${r.time}. Must be 30+ mins apart.`);return;}}
  const btn=document.getElementById('reserveModalConfirm');btn.disabled=true;btn.textContent='Saving…';
  try{
    const updated=[...existing,{guestName,time}].sort((a,b)=>(getResMins(a.time)||0)-(getResMins(b.time)||0));
    await updateDoc(doc(db,'tables',data.docId),{status:'free',reservation:updated[0],reservations:updated,waiterId:null,waiterName:null,lastUpdated:serverTimestamp()});
    showToast(`Table ${reserveTarget} reserved for ${guestName} at ${time}`);
    document.getElementById('reserveModal').classList.remove('show');reserveTarget=null;
  }catch(e){showToast('Failed to save reservation.');console.error(e);}
  finally{btn.disabled=false;btn.textContent='Confirm Reservation';}
});

window._removeReservation = (tableNum, index) => {
  const data=tableStatuses[tableNum]; if(!data) return;
  const res=(data.reservations||[])[index], guestLabel=res?.guestName?`"${res.guestName}"`:'this reservation';
  showConfirm({icon:'🗓️',title:'Remove Reservation',message:`Remove ${guestLabel} from Table ${tableNum}?`,okLabel:'Remove',
    onOk:async()=>{
      try{
        const updated=[...(data.reservations||[])];updated.splice(index,1);
        await updateDoc(doc(db,'tables',data.docId),{reservations:updated,status:updated.length===0?'free':data.status,reservation:updated.length>0?updated[0]:null,lastUpdated:serverTimestamp()});
        showToast(`Reservation removed.`);
      }catch(e){showToast('Failed.');console.error(e);}
    }
  });
};

// ── Clear all modal ───────────────────────────────────────────────────────────
document.getElementById('clearAllTablesBtn')?.addEventListener('click',  ()=>{document.getElementById('clearAllModal').classList.add('show');if(window.lucide)lucide.createIcons();});
document.getElementById('clearAllModalClose')?.addEventListener('click', ()=>document.getElementById('clearAllModal').classList.remove('show'));
document.getElementById('clearAllModalCancel')?.addEventListener('click',()=>document.getElementById('clearAllModal').classList.remove('show'));
document.getElementById('clearAllModalConfirm')?.addEventListener('click', async()=>{
  const btn=document.getElementById('clearAllModalConfirm');btn.disabled=true;btn.textContent='Clearing…';
  try{
    const snap=await getDocs(collection(db,'tables'));
    await Promise.all(snap.docs.map(d=>updateDoc(d.ref,{
      status:'free',
      reservation:null,
      reservations:[],
      waiterId:null,
      waiterName:null,
      assignedTo:null,
      lastUpdated:serverTimestamp()
    })));
    showToast('All tables cleared.');document.getElementById('clearAllModal').classList.remove('show');
  }catch(e){showToast('Failed to clear tables.');console.error(e);}
  finally{btn.disabled=false;btn.textContent='Yes, Clear All';}
});

// ── Reservation time check ────────────────────────────────────────────────────
function checkReservationTimes() {
  const now=new Date(), nowMins=now.getHours()*60+now.getMinutes();
  tableDocsList.forEach(async entry=>{
    const data=tableStatuses[entry.tableNumber], reservations=data?.reservations;
    if(!reservations||reservations.length===0) return;
    const mapped=reservations.map(r=>({...r,mins:getResMins(r.time)})).filter(r=>r.mins!==null).sort((a,b)=>a.mins-b.mins);
    if(!mapped.length) return;
    const expired=mapped.filter(r=>(nowMins-r.mins)>=15), valid=mapped.filter(r=>(nowMins-r.mins)<15);
    if(expired.length>0){
      try{
        const cleaned=valid.map(({mins,...r})=>r);
        const nextValid=valid[0], nextMinsUntil=nextValid?nextValid.mins-nowMins:null;
        const shouldLock=nextMinsUntil!==null&&nextMinsUntil<=30&&nextMinsUntil>0;
        await updateDoc(doc(db,'tables',data.docId),{reservations:cleaned,reservation:cleaned[0]||null,status:cleaned.length===0?'free':(shouldLock?'reserved':'free'),lastUpdated:serverTimestamp()});
        expired.forEach(r=>showToast(`Table ${entry.tableNumber}: ${r.guestName} was 15 mins late — reservation cleared.`));
      }catch(e){console.error(e);}
      return;
    }
    const next=valid[0]; if(!next) return;
    const minsUntil=next.mins-nowMins;
    if(minsUntil<=31&&minsUntil>0&&data.status==='free'){
      try{await updateDoc(doc(db,'tables',data.docId),{status:'reserved',lastUpdated:serverTimestamp()});showToast(`Table ${entry.tableNumber} locked for ${next.guestName} at ${next.time}`);}catch(e){console.error(e);}return;
    }
    if(minsUntil<=30&&minsUntil>0&&['walk-in','pending','preparing','served','billed'].includes(data.status)){
      showToast(`⚠️ Table ${entry.tableNumber} occupied but ${next.guestName} reserved at ${next.time}!`);
    }
  });
}

checkReservationTimes();
setInterval(checkReservationTimes, 60*1000);
