import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app  = initializeApp({ apiKey:"AIzaSyCKQneulIrm9KWuOg69f29nFo6TGz2PF4w", authDomain:"salo-sa-antipolo.firebaseapp.com", projectId:"salo-sa-antipolo", storageBucket:"salo-sa-antipolo.firebasestorage.app", messagingSenderId:"60032898501", appId:"1:60032898501:web:3a4e663fee4ccd2adae7ac" });
const auth = getAuth(app);
const db   = getFirestore(app);

const loginBtn=document.getElementById('loginBtn'), emailEl=document.getElementById('email'),
      pwEl=document.getElementById('password'), errMsg=document.getElementById('errorMsg'),
      errTxt=document.getElementById('errorText'), togglePw=document.getElementById('togglePw'),
      toast=document.getElementById('toast'), toastMsg=document.getElementById('toastMsg');

togglePw.onclick = () => { const t=pwEl.type==='text'; pwEl.type=t?'password':'text'; togglePw.textContent=t?'👁':'⌣'; };

const showToast = m => { toastMsg.textContent=m; toast.classList.add('show'); setTimeout(()=>toast.classList.remove('show'),3000); };
const showError = m => { errTxt.textContent=m; errMsg.classList.remove('show'); requestAnimationFrame(()=>errMsg.classList.add('show')); };
const setLoad   = v => { loginBtn.disabled=v; loginBtn.classList.toggle('loading',v); };

loginBtn.onclick = async () => {
  const email=emailEl.value.trim(), pw=pwEl.value;
  errMsg.classList.remove('show');
  if(!email||!pw){ showError('Please enter your email and password.'); return; }
  setLoad(true);
  try {
    const cred = await signInWithEmailAndPassword(auth,email,pw);
    const snap = await getDoc(doc(db,'Users',cred.user.uid));
    if(!snap.exists()){ showError('Account not found. Please contact admin.'); await auth.signOut(); setLoad(false); return; }
    const data = snap.data();
    if(data.role!=='waiter'){ showError('This portal is for waiters only. Use Admin Login.'); await auth.signOut(); setLoad(false); return; }
    // Check approval status
    if(data.status === 'pending'){
      showError('⏳ Your account is awaiting admin approval. Please wait for the manager to approve your registration.');
      await auth.signOut(); setLoad(false); return;
    }
    if(data.status === 'rejected'){
      showError('❌ Your registration was declined. Please contact the manager.');
      await auth.signOut(); setLoad(false); return;
    }
    sessionStorage.setItem('userRole','waiter');
    sessionStorage.setItem('userName', data.name||email);
    sessionStorage.setItem('userId', cred.user.uid);
    showToast('Welcome, '+(data.name||'Waiter')+'!');
    setTimeout(()=>window.location.href='waiter.html',1500);
  } catch(err) {
    setLoad(false);
    const c=err.code;
    if(['auth/user-not-found','auth/wrong-password','auth/invalid-credential'].includes(c)) showError('Invalid email or password. Try again.');
    else if(c==='auth/too-many-requests') showError('Too many attempts. Please wait and try again.');
    else if(c==='auth/invalid-email') showError('Please enter a valid email address.');
    else showError('Something went wrong. Please try again.');
  }
};
[emailEl,pwEl].forEach(el=>el.addEventListener('keydown',e=>{if(e.key==='Enter')loginBtn.click();}));