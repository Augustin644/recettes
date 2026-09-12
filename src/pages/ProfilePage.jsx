import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { collection, query, where, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useApp } from "../context/AppContext";
import RecipeCard from "../components/recipe/RecipeCard";
import Avatar from "../components/ui/Avatar";
import FollowButton from "../components/ui/FollowButton";
import EmptyState from "../components/ui/EmptyState";

export default function ProfilePage() {
  const navigate = useNavigate();
  const { user, myProfile, myRecipes, syncStatus, isAdmin, sportif, incomingRequests, hasUnreadMsgs,
    updateMyProfile, uploadAvatar, deleteRecipe, addToProfile, logoutUser, addToast, myFollowsMap } = useApp();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(myProfile?.displayName || user.displayName || '');
  const [bio, setBio] = useState(myProfile?.bio || '');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);
  const [listModal, setListModal] = useState(null);
  const [listPeople, setListPeople] = useState([]);

  const stats = {
    recipe: myRecipes.length,
    followers: myProfile?.followersCount || 0,
    following: myProfile?.followingCount || 0,
  };

  const openList = async (type) => {
    setListModal(type);
    setListPeople([]);
    try {
      const qy = type === 'following'
        ? query(collection(db, 'follows'), where('followerId', '==', user.uid), where('status', '==', 'accepted'))
        : query(collection(db, 'follows'), where('followingId', '==', user.uid), where('status', '==', 'accepted'));
      const snap = await getDocs(qy);
      const people = await Promise.all(snap.docs.map(async d => {
        const otherId = type === 'following' ? d.data().followingId : d.data().followerId;
        const uSnap = await getDoc(doc(db, 'users', otherId));
        return uSnap.exists() ? { id: uSnap.id, ...uSnap.data() } : null;
      }));
      setListPeople(people.filter(Boolean));
    } catch { setListPeople([]); }
  };

  const saveIdentity = async () => {
    setSaving(true);
    try {
      await updateMyProfile({
        displayName: name.trim() || 'Utilisateur',
        displayNameLower: (name.trim() || 'utilisateur').toLowerCase(),
        bio: bio.trim(),
      });
      setEditing(false);
      addToast('Profil mis à jour', 'success');
    } catch { addToast('Erreur de mise à jour', 'error'); }
    finally { setSaving(false); }
  };

  const handleAvatar = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try { await uploadAvatar(f); addToast('Photo de profil mise à jour', 'success'); }
    catch { addToast('Échec du téléversement', 'error'); }
  };

  const syncPill = syncStatus === 'synced'
    ? <span className="sync-pill sync-pill--ok">✓ Profil synchronisé</span>
    : syncStatus === 'error'
      ? <span className="sync-pill sync-pill--err">⚠ Déconnecté</span>
      : <span className="sync-pill sync-pill--loading">⟳ Liaison…</span>;

  return (
    <div className="app-main" style={{ maxWidth: 760 }}>
      {/* En-tête de profil */}
      <div className="profile-hero" style={{ padding: 'var(--space-s) 0 var(--space-m)' }}>
        <button onClick={() => fileRef.current?.click()} style={{ background: 'none', border: 'none', cursor: 'pointer' }} aria-label="Changer de photo">
          <Avatar name={myProfile?.displayName || user.displayName} url={myProfile?.avatarURL} size={84} style={{ margin: '0 auto', cursor: 'pointer' }} />
        </button>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatar} />

        {editing ? (
          <div style={{ maxWidth: 420, margin: 'var(--space-s) auto 0', display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Pseudo" />
            <textarea className="textarea" value={bio} onChange={e => setBio(e.target.value)} placeholder="Quelques mots sur vous…" style={{ minHeight: 70 }} />
            <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
              <button className="btn btn--secondary" style={{ flex: 1 }} onClick={() => setEditing(false)}>Annuler</button>
              <button className="btn btn--primary" style={{ flex: 1 }} disabled={saving} onClick={saveIdentity}>
                {saving ? '⟳…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <h1 className="profile-hero__name">
              {myProfile?.displayName || user.displayName}
              {myProfile?.isPrivate && <span title="Compte privé" style={{ fontSize: 'var(--step-1)' }}> 🔒</span>}
              {isAdmin && <span className="admin-tag" style={{ marginLeft: 8 }}>Admin</span>}
            </h1>
            {myProfile?.bio && <p className="profile-hero__bio">{myProfile.bio}</p>}
            <div style={{ marginTop: 'var(--space-2xs)' }}>{syncPill}</div>
            <button className="btn btn--secondary btn--sm" style={{ marginTop: 'var(--space-xs)' }} onClick={() => setEditing(true)}>✏️ Modifier le profil</button>
          </>
        )}
      </div>

      {/* Statistiques */}
      <div className="stats-row">
        <div className="stat"><b>{stats.recipe}</b><span>Recettes</span></div>
        <button className="stat" onClick={() => openList('followers')}><b>{stats.followers}</b><span>Abonnés</span></button>
        <button className="stat" onClick={() => openList('following')}><b>{stats.following}</b><span>Abonnements</span></button>
      </div>

      {/* Raccourcis */}
      <div className="quick-cards" style={{ marginTop: 'var(--space-m)' }}>
        {sportif?.active && (
          <button className="quick-card quick-card--sportif" onClick={() => navigate('/sportif')}>
            <span className="quick-card__icon">🏋️</span>
            <span className="quick-card__label">Mode sportif {sportif.targets && `· ${sportif.targets.kcal} kcal`}</span>
          </button>
        )}
        <button className="quick-card" onClick={() => navigate('/planning')}>
          <span className="quick-card__icon">📅</span>
          <span className="quick-card__label">Planning repas</span>
        </button>
        {!sportif?.active && (
          <button className="quick-card quick-card--sportif" onClick={() => navigate('/sportif')}>
            <span className="quick-card__icon">🏋️</span>
            <span className="quick-card__label">Activer le mode sportif</span>
          </button>
        )}
        <button className="quick-card" onClick={() => navigate('/messages')}>
          <span className="quick-card__icon">✉️ {hasUnreadMsgs && '●'}</span>
          <span className="quick-card__label">Messages</span>
        </button>
        <button className="quick-card" onClick={() => navigate('/reglages')}>
          <span className="quick-card__icon">⚙️</span>
          <span className="quick-card__label">Réglages du compte</span>
        </button>
        {isAdmin && (
          <button className="quick-card" onClick={() => navigate('/admin')}>
            <span className="quick-card__icon">🛡️</span>
            <span className="quick-card__label">Modération</span>
          </button>
        )}
      </div>

      {/* Mes recettes */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: 'var(--space-m) 0 var(--space-s)' }}>
        <div className="section-title" style={{ margin: 0 }}>Mes recettes</div>
        <button className="btn btn--primary btn--sm" onClick={() => navigate('/ajouter')}>＋ Ajouter</button>
      </div>

      {myRecipes.length === 0 ? (
        <EmptyState emoji="📖" title="Aucune recette" text="Créez votre première fiche pour remplir votre Atelier." />
      ) : (
        <div className="recipes-grid">
          {myRecipes.map(r => (
            <RecipeCard key={r.id} recipe={r} onDelete={deleteRecipe} onAddToProfile={addToProfile} />
          ))}
        </div>
      )}

      {listModal && (
        <div className="overlay" style={{ zIndex: 320 }} onClick={() => setListModal(null)}>
          <div className="sheet" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div className="sheet__grab" />
            <div className="sheet__head">
              <div className="page-title" style={{ fontSize: 'var(--step-2)' }}>{listModal === 'following' ? 'Abonnements' : 'Abonnés'}</div>
              <button className="icon-btn" onClick={() => setListModal(null)}>✕</button>
            </div>
            <div className="sheet__body">
              {listPeople.length === 0 ? (
                <p style={{ textAlign: 'center', padding: 'var(--space-l)', color: 'var(--ink-3)' }}>
                  {listModal === 'following' ? "Vous ne suivez personne pour l'instant." : "Personne ne vous suit encore."}
                </p>
              ) : listPeople.map(p => (
                <div key={p.id} className="member-row">
                  <Link to={`/membre/${p.id}`} onClick={() => setListModal(null)} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', flex: 1, minWidth: 0 }}>
                    <Avatar name={p.displayName} url={p.avatarURL} size={42} />
                    <div style={{ minWidth: 0 }}>
                      <div className="member-row__name">
                        {p.displayName}
                        {p.role === 'admin' && <span className="admin-tag">Admin</span>}
                      </div>
                      <div className="member-row__sub">{p.followersCount || 0} abonné{(p.followersCount || 0) !== 1 ? 's' : ''}</div>
                    </div>
                  </Link>
                  <FollowButton targetUid={p.id} targetIsPrivate={!!p.isPrivate} relation={myFollowsMap[p.id]} compact />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <button className="btn btn--secondary btn--block" style={{ marginTop: 'var(--space-l)', color: 'var(--danger)' }} onClick={() => logoutUser()}>
        🚪 Se déconnecter
      </button>
    </div>
  );
}