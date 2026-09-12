import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp } from "../../context/AppContext";
import Avatar from "../ui/Avatar";
import FollowRequestsPanel from "../social/FollowRequestsPanel";

export default function Header() {
  const { user, dark, setDark, incomingRequests, hasUnreadMsgs } = useApp();
  const navigate = useNavigate();
  const [showRequests, setShowRequests] = useState(false);

  return (
    <>
      <header className="app-header">
        <div className="header-inner">
          <Link to="/decouvrir" className="logo">
            <span className="logo__dot" />
            Carnet<span className="logo-accent">.</span>
          </Link>

          <div className="header-actions">
            <button className="icon-btn icon-btn--ghost" onClick={() => navigate('/chercher')} aria-label="Rechercher">⌕</button>
            <button className="icon-btn icon-btn--ghost icon-btn--badge" onClick={() => navigate('/messages')} aria-label="Messages">
              ✉️
              {hasUnreadMsgs && <span className="badge-dot" />}
            </button>
            <button className="icon-btn icon-btn--ghost icon-btn--badge" onClick={() => setShowRequests(true)} aria-label="Demandes d'abonnement">
              👥
              {incomingRequests.length > 0 && <span className="badge-dot">{incomingRequests.length}</span>}
            </button>
            <button className="icon-btn icon-btn--ghost" onClick={() => setDark(d => !d)} aria-label="Changer de thème">
              {dark ? '☀️' : '🌙'}
            </button>
            <button className="icon-btn icon-btn--ghost" onClick={() => navigate('/profil')} aria-label="Mon profil" style={{ padding: 0 }}>
              <Avatar name={user.displayName} size={36} />
            </button>
          </div>
        </div>
      </header>

      {showRequests && <FollowRequestsPanel onClose={() => setShowRequests(false)} />}
    </>
  );
}