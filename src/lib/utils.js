import { collection, doc, setDoc, getDoc, getDocs, query, where, writeBatch, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";

export const followDocId = (followerId, followingId) => `${followerId}__${followingId}`;
export const conversationId = (a, b) => [a, b].sort().join('__');

export async function ensureUserDoc(user) {
  if (!user) return;
  const ref_ = doc(db, 'users', user.uid);
  await setDoc(ref_, {
    displayName: user.displayName || 'Utilisateur',
    displayNameLower: (user.displayName || '').toLowerCase(),
  }, { merge: true });
  const snap = await getDoc(ref_);
  const data = snap.data() || {};
  if (data.isPrivate === undefined) {
    await setDoc(ref_, {
      isPrivate: false,
      followersCount: data.followersCount || 0,
      followingCount: data.followingCount || 0,
      createdAt: data.createdAt || serverTimestamp(),
    }, { merge: true });
  }
  return snap.data() || {};
}

export async function propagatePrivacyToRecipes(uid, isPrivate) {
  const snap = await getDocs(query(collection(db, 'recipes'), where('ownerId', '==', uid)));
  const batch = writeBatch(db);
  snap.docs.forEach(d => batch.update(d.ref, { ownerIsPrivate: isPrivate }));
  await batch.commit();
}

export async function loadImageAsBase64(url) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

export async function exportRecipeToPDF(recipe, labels) {
  const { jsPDF } = await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm");
  const docPdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = docPdf.internal.pageSize.getWidth();
  const margin = 48;
  let y = margin;

  const INK = [29, 29, 31];
  const MUTED = [110, 110, 115];
  const SIGNAL = [255, 90, 54];
  const MIST = [245, 245, 247];

  docPdf.setFillColor(...SIGNAL);
  docPdf.rect(0, 0, pageW, 8, 'F');
  y += 20;

  if (recipe.photoURL) {
    const b64 = await loadImageAsBase64(recipe.photoURL);
    if (b64) {
      try {
        const imgW = pageW - margin * 2;
        const imgH = imgW * 0.55;
        docPdf.addImage(b64, 'JPEG', margin, y, imgW, imgH, undefined, 'FAST');
        y += imgH + 20;
      } catch {}
    }
  }

  docPdf.setFont('helvetica', 'bold');
  docPdf.setFontSize(24);
  docPdf.setTextColor(...INK);
  docPdf.text(`${recipe.emoji || '🍽️'}  ${recipe.name}`, margin, y);
  y += 22;

  docPdf.setFont('helvetica', 'normal');
  docPdf.setFontSize(10.5);
  docPdf.setTextColor(...MUTED);
  const diffLabel = labels?.diff ? labels.diff.replace(/⬤|○/g, '').trim() : null;
  const metaLine = [
    recipe.cat,
    `${recipe.portions || 4} portions`,
    recipe.time ? `${recipe.time} min` : null,
    diffLabel,
  ].filter(Boolean).join('   ·   ');
  docPdf.text(metaLine, margin, y);
  y += 24;

  docPdf.setDrawColor(...MIST);
  docPdf.setLineWidth(1);
  docPdf.line(margin, y, pageW - margin, y);
  y += 22;

  docPdf.setFont('helvetica', 'bold');
  docPdf.setFontSize(13);
  docPdf.setTextColor(...INK);
  docPdf.text('Ingrédients', margin, y);
  y += 18;

  docPdf.setFont('helvetica', 'normal');
  docPdf.setFontSize(10.5);
  (recipe.ingredients || []).forEach(ing => {
    if (y > 760) { docPdf.addPage(); y = margin; }
    docPdf.setTextColor(...SIGNAL);
    docPdf.circle(margin + 2, y - 3, 1.6, 'F');
    docPdf.setTextColor(...INK);
    docPdf.text(`${ing.qty ? ing.qty + '  ' : ''}${ing.name}`, margin + 12, y);
    y += 16;
  });
  y += 14;

  docPdf.setFont('helvetica', 'bold');
  docPdf.setFontSize(13);
  docPdf.setTextColor(...INK);
  docPdf.text('Préparation', margin, y);
  y += 18;

  docPdf.setFont('helvetica', 'normal');
  docPdf.setFontSize(10.5);
  (recipe.steps || []).forEach((s, i) => {
    const lines = docPdf.splitTextToSize(s.text, pageW - margin * 2 - 24);
    if (y + lines.length * 14 > 780) { docPdf.addPage(); y = margin; }
    docPdf.setFont('helvetica', 'bold');
    docPdf.setTextColor(...SIGNAL);
    docPdf.text(String(i + 1), margin, y);
    docPdf.setFont('helvetica', 'normal');
    docPdf.setTextColor(...INK);
    docPdf.text(lines, margin + 18, y);
    y += lines.length * 14 + 8;
  });

  if (recipe.notes) {
    y += 10;
    if (y > 740) { docPdf.addPage(); y = margin; }
    docPdf.setFont('helvetica', 'bold');
    docPdf.setFontSize(13);
    docPdf.setTextColor(...INK);
    docPdf.text("Notes de l'auteur", margin, y);
    y += 18;
    docPdf.setFont('helvetica', 'italic');
    docPdf.setFontSize(10.5);
    docPdf.setTextColor(...MUTED);
    const noteLines = docPdf.splitTextToSize(recipe.notes, pageW - margin * 2);
    docPdf.text(noteLines, margin, y);
  }

  docPdf.save(`${recipe.name.replace(/[^a-z0-9]+/gi, '_')}.pdf`);
}

export function initials(name) {
  return (name || '?')[0]?.toUpperCase() || '?';
}