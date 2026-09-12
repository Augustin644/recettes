import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { collection, query, where, onSnapshot, doc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useApp } from "../context/AppContext";
import RecipeCard from "../components/recipe/RecipeCard";
import Avatar from "../components/ui/Avatar";
import FollowButton from "../components/ui/FollowButton";
import EmptyState from "../components/ui/EmptyState";

export default function UserPage() {
  const { uid } = useParams();
  const navigate = useNavigate();
  const { user, myFollowsMap, favIds, toggleFavorite, addToProfile, deleteRecipe } = useApp();
  const [profile, setProfile] = useState(null);
  const [recipes, setRecipes] = useState([]);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'users', uid), snap => setProfile(snap.exists() ? snap.data() : null));
    return unsub;
  }, [uid]);

  useEffect(() => {
    const q = query(collection(db, 'recipes'), where('ownerId', '==', uid), where('visibility', '==', 'public'));
    const unsub = onSnapshot(q, snap => setRecipes(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    return unsub;
  }, [uid]);

  if (!profile) {
    return <div className="app-main"><EmptyState emoji="⟳" title="Chargement du profil…" /></div>;
  }

  const relation = myFollowsMap[uid];
  const isMe = uid === user.uid;
  const canSeeRecipes = isMe || !profile.isPrivate || relation === 'accepted';

  return (
    <div className="app-main" style={{ maxWidth: 760 }}>
      <button className="icon-btn icon-btn--ghost" style={{ marginBottom: 'var(--space-xs)' }} onClick={() => navigate(-1)} aria-label="Retour">← Retour</button>

      <div className="profile-hero" style={{ padding: 'var(--space-s) 0' }}>
        <Avatar name={profile.displayName} url={profile.avatarURL} size={84} style={{ margin: '0 auto' }} />
        <h1 className="profile-hero__name">
          {profile.displayName}
          {profile.isPrivate && <span style={{ fontSize: 'var(--step-1)' }}> 🔒</span>}
          {profile.role === 'admin' && <span className="admin-tag" style={{ marginLeft: 8 }}>Admin</span>}
        </h1>
        {profile.bio && <p className="profile-hero__bio">{profile.bio}</p>}
      </div>

      <div className="stats-row">
        <div className="stat"><b>{recipes.length}</b><span>Recettes</span></div>
        <div className="stat"><b>{profile.followersCount || 0}</b><span>Abonnés</span></div>
        <div className="stat"><b>{profile.followingCount || 0}</b><span>Abonnements</span></div>
      </div>

      {!isMe && (
        <div style={{ display: 'flex', gap: 'var(--space-xs)', marginTop: 'var(--space-m)' }}>
          <FollowButton targetUid={uid} targetIsPrivate={!!profile.isPrivate} relation={relation} />
          <button className="btn btn--secondary" style={{ flex: 1 }} onClick={() => navigate(`/messages/${uid}`, { state: { name: profile.displayName } })}>
            💬 Message
          </button>
        </div>
      )}

      {!canSeeRecipes ? (
        <EmptyState emoji="🔒" title="Compte privé" text="Abonnez-vous à ce membre pour découvrir ses recettes." />
      ) : recipes.length === 0 ? (
        <EmptyState emoji="📖" title="Aucune recette publique" text="Ce membre n'a pas encore partagé de recettes." />
      ) : (
        <div className="recipes-grid" style={{ marginTop: 'var(--space-m)' }}>
          {recipes.map(r => (
            <RecipeCard key={r.id} recipe={r} onDelete={deleteRecipe} onAddToProfile={addToProfile} />
          ))}
        </div>
      )}
    </div>
  );
}