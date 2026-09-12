import { useNavigate } from "react-router-dom";
import { updateDoc, setDoc, deleteDoc, doc, increment } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { useApp } from "../../context/AppContext";
import Avatar from "../ui/Avatar";

export default function FollowRequestsPanel({ onClose }) {
  const { user, incomingRequests, addToast } = useApp();
  const navigate = useNavigate();

  const respond = async (req, accept) => {
    try {
      if (accept) {
        await updateDoc(doc(db, 'follows', req.id), { status: 'accepted' });
        await setDoc(doc(db, 'users', user.uid), { followersCount: increment(1) }, { merge: true });
        await setDoc(doc(db, 'users', req.followerId), { followingCount: increment(1) }, { merge: true });
        addToast('Demande acceptée', 'success');
      } else {
        await deleteDoc(doc(db, 'follows', req.id));
        addToast('Demande refusée', 'info');
      }
    } catch { addToast('Erreur', 'error'); }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div className="sheet__grab" />
        <div className="sheet__head">
          <div className="page-title" style={{ fontSize: 'var(--step-2)' }}>Demandes d'abonnement</div>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className="sheet__body">
          {incomingRequests.length === 0 ? (
            <p style={{ textAlign: 'center', padding: 'var(--space-l)', color: 'var(--ink-3)' }}>Aucune demande en attente.</p>
          ) : incomingRequests.map(req => (
            <div key={req.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', padding: 'var(--space-xs) 0', borderBottom: '1px solid var(--line)' }}>
              <button onClick={() => { navigate(`/membre/${req.followerId}`); onClose(); }} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <Avatar name={req.followerName} size={40} />
              </button>
              <span style={{ flex: 1, fontWeight: 600 }}>{req.followerName}</span>
              <button className="btn btn--secondary btn--sm" onClick={() => respond(req, false)}>Refuser</button>
              <button className="btn btn--primary btn--sm" onClick={() => respond(req, true)}>Accepter</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}