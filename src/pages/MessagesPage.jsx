import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { collection, query, where, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useApp } from "../context/AppContext";
import Avatar from "../components/ui/Avatar";
import EmptyState from "../components/ui/EmptyState";

export default function MessagesPage() {
  const { user } = useApp();
  const [convos, setConvos] = useState([]);

  useEffect(() => {
    const q = query(collection(db, 'conversations'), where('participants', 'array-contains', user.uid), orderBy('updatedAt', 'desc'));
    const unsub = onSnapshot(q, snap => setConvos(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    return unsub;
  }, [user.uid]);

  return (
    <div className="app-main" style={{ maxWidth: 640 }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Messagerie</div>
          <h1 className="page-title">Messages</h1>
        </div>
      </div>

      {convos.length === 0 ? (
        <EmptyState emoji="✉️" title="Aucune conversation"
          text="Ouvrez le profil d'un membre et touchez « Message » pour démarrer une discussion."
        />
      ) : convos.map(c => {
        const otherUid = c.participants.find(p => p !== user.uid);
        const otherName = c.participantNames?.[otherUid] || 'Utilisateur';
        const unread = c.lastMessage && c.lastMessage.senderId !== user.uid;
        return (
          <Link key={c.id} to={`/messages/${otherUid}`} state={{ name: otherName }} className="convo-row">
            <Avatar name={otherName} size={46} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>{otherName}</div>
              <div style={{ fontSize: 'var(--step--1)', color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.lastMessage?.recipeShare ? `🍽️ ${c.lastMessage.recipeShare.name}` : (c.lastMessage?.text || '…')}
              </div>
            </div>
            {unread && <span className="unread-dot" />}
          </Link>
        );
      })}
    </div>
  );
}