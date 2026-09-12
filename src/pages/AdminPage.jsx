import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { collection, query, where, onSnapshot, doc, updateDoc, orderBy } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useApp } from "../context/AppContext";
import Avatar from "../components/ui/Avatar";
import EmptyState from "../components/ui/EmptyState";

export default function AdminPage() {
  const navigate = useNavigate();
  const { isAdmin, user, banUser, adminDeleteRecipe, addToast } = useApp();

  const [reports, setReports] = useState([]);
  const [users, setUsers] = useState([]);
  const [publicRecipes, setPublicRecipes] = useState([]);
  const [tab, setTab] = useState('reports');

  useEffect(() => {
    if (!isAdmin) return;
    const unsubR = onSnapshot(query(collection(db, 'reports'), orderBy('createdAt', 'desc')), snap => setReports(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const unsubU = onSnapshot(query(collection(db, 'users'), orderBy('displayNameLower')), snap => setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const unsubP = onSnapshot(query(collection(db, 'recipes'), where('visibility', '==', 'public')), snap => setPublicRecipes(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    return () => { unsubR(); unsubU(); unsubP(); };
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div className="app-main">
        <EmptyState emoji="🚫" title="Accès refusé"
          text="Seuls les administrateurs peuvent accéder à cette page.">
          <button className="btn btn--primary" onClick={() => navigate('/profil')}>Retour au profil</button>
        </EmptyState>
      </div>
    );
  }

  const openReports = reports.filter(r => r.status === 'open');
  const bannedCount = users.filter(u => u.banned).length;

  const dismissReport = async (reportId) => {
    await updateDoc(doc(db, 'reports', reportId), { status: 'dismissed' });
    addToast('Signalement ignoré', 'info');
  };

  const handleBan = async (uid, current) => {
    await banUser(uid, !current);
    await setUsers(users.map(u => u.id === uid ? { ...u, banned: !current } : u));
  };

  return (
    <div className="app-main" style={{ maxWidth: 820 }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Administration</div>
          <h1 className="page-title">Modération</h1>
        </div>
      </div>

      <div className="stat-tiles">
        <div className="stat-tile"><b>{users.length}</b><span>Utilisateurs</span></div>
        <div className="stat-tile"><b>{publicRecipes.length}</b><span>Recettes publiques</span></div>
        <div className="stat-tile"><b>{openReports.length}</b><span>Signalements</span></div>
        <div className="stat-tile"><b>{bannedCount}</b><span>Suspendus</span></div>
      </div>

      <div className="segmented" style={{ margin: 'var(--space-m) 0 var(--space-s)' }}>
        <button className={`segmented__btn ${tab === 'reports' ? 'active' : ''}`} onClick={() => setTab('reports')}>🚩 Signalements ({openReports.length})</button>
        <button className={`segmented__btn ${tab === 'recipes' ? 'active' : ''}`} onClick={() => setTab('recipes')}>📖 Recettes ({publicRecipes.length})</button>
        <button className={`segmented__btn ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>👤 Utilisateurs ({users.length})</button>
      </div>

      <div className="admin-panel">
        {tab === 'reports' && openReports.length === 0 && (
          <EmptyState emoji="✅" title="Aucun signalement en attente" text="Tout est propre." />
        )}
        {tab === 'reports' && openReports.map(r => (
          <div key={r.id} className="report-card">
            <div style={{ fontSize: 'var(--step-2)', flexShrink: 0 }}>🚩</div>
            <div className="report-card__body">
              <div style={{ fontWeight: 700 }}>« {r.recipeName} »</div>
              <div style={{ fontSize: 'var(--step--1)', color: 'var(--ink-3)', marginTop: 4 }}>
                Signalement de {(r.reporterId || '').slice(0, 6)}… · {r.createdAt?.toDate?.()?.toLocaleDateString('fr-FR') || 'date inconnue'}
              </div>
              <div className="report-card__actions" style={{ marginTop: 'var(--space-xs)' }}>
                <button className="btn btn--secondary btn--sm" onClick={() => navigate(`/recette/${r.recipeId}`)}>👁 Voir la recette</button>
                <button className="btn btn--danger btn--sm" onClick={async () => { if (r.recipeId) await adminDeleteRecipe({ id: r.recipeId, name: r.recipeName, ownerId: r.recipeOwnerId }); await dismissReport(r.id); }}>
                  🗑 Supprimer & fermer
                </button>
                <button className="btn btn--ghost btn--sm" onClick={() => dismissReport(r.id)}>Ignorer</button>
              </div>
            </div>
          </div>
        ))}

        {tab === 'recipes' && publicRecipes.map(r => (
          <div key={r.id} className="report-card">
            <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--surface-2)', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {r.photoURL ? <img src={r.photoURL} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 'var(--step-1)' }}>{r.emoji || '🍽️'}</span>}
            </div>
            <div className="report-card__body" style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
              <div style={{ fontSize: 'var(--step--1)', color: 'var(--ink-3)' }}>Par {r.ownerName || 'inconnu'} · {r.cat}</div>
            </div>
            <div className="report-card__actions">
              <button className="btn btn--secondary btn--sm" onClick={() => navigate(`/recette/${r.id}`)}>Voir</button>
              <button className="btn btn--danger btn--sm" onClick={() => adminDeleteRecipe(r)}>🗑 Supprimer</button>
            </div>
          </div>
        ))}

        {tab === 'users' && users.map(u => (
          <div key={u.id} className="report-card" style={{ alignItems: 'center' }}>
            <Avatar name={u.displayName} url={u.avatarURL} size={42} />
            <div className="report-card__body" style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                {u.displayName} {u.role === 'admin' && <span className="admin-tag">Admin</span>}
                {u.banned && <span className="banned-tag">Suspendu</span>}
              </div>
              <div style={{ fontSize: 'var(--step--1)', color: 'var(--ink-3)', marginTop: 2 }}>
                {u.followersCount || 0} abonnés · {u.followingCount || 0} abonnements
              </div>
            </div>
            <div className="report-card__actions">
              <button className="btn btn--secondary btn--sm" onClick={() => navigate(`/membre/${u.id}`)}>Profil</button>
              {u.id !== user.uid && (
                <button className={`btn ${u.banned ? 'btn--primary' : 'btn--danger'} btn--sm`} onClick={() => handleBan(u.id, u.banned)}>
                  {u.banned ? 'Reactiver' : 'Suspendre'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}