import { initializeApp }   from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app  = initializeApp({ apiKey:"AIzaSyCKQneulIrm9KWuOg69f29nFo6TGz2PF4w", authDomain:"salo-sa-antipolo.firebaseapp.com", projectId:"salo-sa-antipolo", storageBucket:"salo-sa-antipolo.firebasestorage.app", messagingSenderId:"60032898501", appId:"1:60032898501:web:3a4e663fee4ccd2adae7ac" });
const auth = getAuth(app);
const db   = getFirestore(app);

const $ = id => document.getElementById(id);
const showToast = m => { $('toastMsg').textContent=m; $('toast').classList.add('show'); setTimeout(()=>$('toast').classList.remove('show'),3000); };
const showError = m => { $('errorText').textContent=m; $('errorMsg').classList.remove('show'); requestAnimationFrame(()=>$('errorMsg').classList.add('show')); };
const setLoad   = v => { $('registerBtn').disabled=v; $('registerBtn').classList.toggle('loading',v); };

// Toggle password visibility
$('togglePw1').onclick = () => { const t=$('password').type==='text'; $('password').type=t?'password':'text'; $('togglePw1').textContent=t?'👁':'⌣'; };
$('togglePw2').onclick = () => { const t=$('confirmPw').type==='text'; $('confirmPw').type=t?'password':'text'; $('togglePw2').textContent=t?'👁':'⌣'; };

// Password strength meter
$('password').addEventListener('input', () => {
  const pw = $('password').value;
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const bars = ['pwBar1','pwBar2','pwBar3','pwBar4'];
  bars.forEach((id, i) => {
    const el = $(id);
    el.className = 'pw-bar';
    if (i < score) el.classList.add(score <= 1 ? 'weak' : score <= 2 ? 'fair' : 'strong');
  });
});

$('registerBtn').onclick = async () => {
  const firstName = $('firstName').value.trim();
  const lastName  = $('lastName').value.trim();
  const phone     = $('phone').value.trim();
  const email     = $('email').value.trim();
  const pw        = $('password').value;
  const cpw       = $('confirmPw').value;

  $('errorMsg').classList.remove('show');

  if (!firstName || !lastName)     { showError('Please enter your full name.'); return; }
  if (!phone)                       { showError('Please enter your phone number.'); return; }
  if (!email)                       { showError('Please enter your email address.'); return; }
  if (pw.length < 8)                { showError('Password must be at least 8 characters.'); return; }
  if (pw !== cpw)                   { showError('Passwords do not match.'); return; }

  setLoad(true);
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pw);
    await setDoc(doc(db, 'Users', cred.user.uid), {
      name: `${firstName} ${lastName}`,
      firstName,
      lastName,
      phone,
      email,
      role: 'waiter',
      status: 'pending',       // 🔑 admin must set to 'approved' before they can log in
      createdAt: serverTimestamp(),
      approvedAt: null,
      approvedBy: null
    });
    // Sign out immediately — they can't use the app until approved
    await signOut(auth);
    $('formState').style.display = 'none';
    $('successState').classList.add('show');
  } catch(err) {
    setLoad(false);
    const c = err.code;
    if (c === 'auth/email-already-in-use') showError('This email is already registered. Try logging in instead.');
    else if (c === 'auth/invalid-email')   showError('Please enter a valid email address.');
    else if (c === 'auth/weak-password')   showError('Password is too weak. Use at least 8 characters.');
    else showError('Registration failed. Please try again.');
  }
};