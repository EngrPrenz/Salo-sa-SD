/**
 * ONE-TIME CLEANUP — Run this in your browser console on admin.html
 * while logged in as admin. It finds duplicate table documents for
 * the same tableNumber and deletes the extras, keeping the one with
 * the most data (or the most recently updated one).
 *
 * Paste the entire script into the console and press Enter.
 */

(async () => {
  const { getFirestore, collection, getDocs, deleteDoc, doc } = await import(
    'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'
  );

  // Re-use the already-initialized app from the page
  const db = getFirestore();

  const snap = await getDocs(collection(db, 'tables'));
  const byNumber = {};

  snap.forEach(d => {
    const data = d.data();
    const rawNum = data.tableNumber
      ? parseInt(data.tableNumber)
      : parseInt(d.id.replace('table_', ''));
    if (isNaN(rawNum)) return;

    if (!byNumber[rawNum]) byNumber[rawNum] = [];
    byNumber[rawNum].push({ docId: d.id, data, ref: d.ref });
  });

  let deleted = 0;
  for (const [num, docs] of Object.entries(byNumber)) {
    if (docs.length <= 1) continue;

    console.log(`Table ${num} has ${docs.length} duplicate docs:`, docs.map(d => d.docId));

    // Keep the doc with an explicit tableNumber field; otherwise keep the first
    docs.sort((a, b) => {
      const aHas = a.data.tableNumber ? 1 : 0;
      const bHas = b.data.tableNumber ? 1 : 0;
      return bHas - aHas;
    });

    const [keep, ...remove] = docs;
    console.log(`  → Keeping: ${keep.docId}`);
    for (const d of remove) {
      console.log(`  → Deleting: ${d.docId}`);
      await deleteDoc(doc(db, 'tables', d.docId));
      deleted++;
    }
  }

  console.log(`✅ Done. Deleted ${deleted} duplicate table document(s).`);
})();