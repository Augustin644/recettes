import { useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import ChatView from "../components/social/ChatView";
import EmptyState from "../components/ui/EmptyState";

export default function ChatPage() {
  const { uid } = useParams();
  const location = useLocation();
  const [name, setName] = useState(location.state?.name || null);
  const [loading, setLoading] = useState(!location.state?.name);

  useEffect(() => {
    if (name) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', uid));
        if (snap.exists()) setName(snap.data().displayName || 'Membre');
      } catch {}
      finally { setLoading(false); }
    })();
  }, [name, uid]);

  if (loading || !name) {
    return <div className="app-main" style={{ maxWidth: 560 }}><EmptyState emoji="⟳" title="Chargement de la conversation…" /></div>;
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: 'var(--space-s) var(--space-s) calc(var(--nav-h) + var(--space-m))' }}>
      <ChatView otherUid={uid} otherName={name} />
    </div>
  );
}