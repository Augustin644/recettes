import { useState, useEffect } from "react";
import { collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";
import { Link } from "react-router-dom";
import { db } from "../../lib/firebase";
import { useApp } from "../../context/AppContext";
import Avatar from "../ui/Avatar";
import FollowButton from "../ui/FollowButton";
import EmptyState from "../ui/EmptyState";

export default function MembersDirectory() {
  const { user, myFollowsMap } = useApp();
  const [allUsers, setAllUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  useEffect(() => {
    const qy = query(collection(db, 'users'), orderBy('displayNameLower'), limit(300));
    const unsub = onSnapshot(qy, snap => {
      setAllUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(u => u.id !== user.uid));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [user.uid]);

  const term = q.trim().toLowerCase();
  const visible = term ? allUsers.filter(u => (u.displayNameLower || u.displayName?.toLowerCase() || '').includes(term)) : allUsers;

  return (
    <div>
      <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="Chercher un membre par pseudo…" style={{ marginBottom: 'var(--space-xs)' }} />

      {loading && <p style={{ color: 'var(--ink-3)', padding: 'var(--space-s)' }}>Chargement des membres…</p>}

      {!loading && visible.length === 0 && (
        <EmptyState emoji="🔍" title="Aucun résultat"
          text={term ? 'Aucun membre ne correspond à cette recherche.' : 'Aucun autre membre pour le moment.'} />
      )}

      {visible.map(u => (
        <div key={u.id} className="member-row">
          <Link to={`/membre/${u.id}`} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', flex: 1, minWidth: 0 }}>
            <Avatar name={u.displayName} url={u.avatarURL} size={42} />
            <div style={{ minWidth: 0 }}>
              <div className="member-row__name">
                {u.displayName}
                {u.isPrivate && <span style={{ fontSize: 'var(--step--1)' }}>🔒</span>}
                {u.role === 'admin' && <span className="admin-tag">Admin</span>}
              </div>
              <div className="member-row__sub">{u.followersCount || 0} abonné{(u.followersCount || 0) !== 1 ? 's' : ''}</div>
            </div>
          </Link>
          <FollowButton targetUid={u.id} targetIsPrivate={!!u.isPrivate} relation={myFollowsMap[u.id]} compact stopPropagation />
        </div>
      ))}
    </div>
  );
}