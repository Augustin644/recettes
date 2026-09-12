import { useState } from "react";
import { setDoc, deleteDoc, doc, serverTimestamp, increment } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { followDocId } from "../../lib/utils";
import { useApp } from "../../context/AppContext";

export default function FollowButton({ targetUid, targetIsPrivate, relation, compact, stopPropagation }) {
  const { user, addToast } = useApp();
  const [busy, setBusy] = useState(false);
  if (!user || user.uid === targetUid) return null;

  const wrap = (fn) => (e) => { if (stopPropagation) e.stopPropagation(); fn(); };

  const follow = async () => {
    setBusy(true);
    try {
      const id = followDocId(user.uid, targetUid);
      const status = targetIsPrivate ? 'pending' : 'accepted';
      await setDoc(doc(db, 'follows', id), { followerId: user.uid, followingId: targetUid, status, createdAt: serverTimestamp() });
      if (status === 'accepted') {
        await setDoc(doc(db, 'users', user.uid), { followingCount: increment(1) }, { merge: true });
        await setDoc(doc(db, 'users', targetUid), { followersCount: increment(1) }, { merge: true });
        addToast('Abonnement confirmé', 'success');
      } else {
        addToast('Demande envoyée', 'info');
      }
    } catch { addToast("Erreur lors de l'abonnement", 'error'); }
    finally { setBusy(false); }
  };

  const unfollowOrCancel = async () => {
    const wasAccepted = relation === 'accepted';
    if (wasAccepted && !window.confirm('Ne plus suivre ce compte ?')) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, 'follows', followDocId(user.uid, targetUid)));
      if (wasAccepted) {
        await setDoc(doc(db, 'users', user.uid), { followingCount: increment(-1) }, { merge: true });
        await setDoc(doc(db, 'users', targetUid), { followersCount: increment(-1) }, { merge: true });
      }
      addToast(wasAccepted ? 'Abonnement retiré' : 'Demande annulée', 'info');
    } catch { addToast("Erreur", 'error'); }
    finally { setBusy(false); }
  };

  const cls = `follow-btn ${compact ? 'compact' : ''}`;
  if (relation === 'accepted') {
    return <button disabled={busy} onClick={wrap(unfollowOrCancel)} className={`${cls} following`}>{compact ? '✓ Suivi(e)' : '✓ Abonné(e)'}</button>;
  }
  if (relation === 'pending') {
    return <button disabled={busy} onClick={wrap(unfollowOrCancel)} className={`${cls} pending`}>{compact ? 'En attente' : 'Demande envoyée'}</button>;
  }
  return <button disabled={busy} onClick={wrap(follow)} className={cls}>{targetIsPrivate ? "🔒 Suivre" : "Suivre"}</button>;
}