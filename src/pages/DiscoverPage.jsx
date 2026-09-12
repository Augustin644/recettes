import { useState } from "react";
import { useApp } from "../context/AppContext";
import SocialGridCard from "../components/recipe/SocialGridCard";
import MembersDirectory from "../components/social/MembersDirectory";
import EmptyState from "../components/ui/EmptyState";
import { RECIPE_TYPES } from "../lib/constants";

const SWEET_CATS = ["Desserts", "Boulangerie", "Boissons"];
const SAVORY_CATS = ["Entrées", "Plats", "Sauces & Condiments"];

export default function DiscoverPage() {
  const { publicRecipes, followingIds, user, myRecipes } = useApp();
  const [mode, setMode] = useState('discover');
  const [typeFilter, setTypeFilter] = useState('Tous');

  const base = (() => {
    const map = new Map();
    if (mode === 'discover') {
      myRecipes.forEach(r => map.set(r.id, r));
    }
    publicRecipes.forEach(r => map.set(r.id, r));
    const list = [...map.values()];
    if (mode === 'following') return list.filter(r => followingIds.includes(r.ownerId));
    return list.filter(r => !r.ownerIsPrivate || r.ownerId === user.uid || followingIds.includes(r.ownerId));
  })();

  const matchesType = (r) => {
    if (typeFilter === 'Tous') return true;
    const tags = Array.isArray(r.tags) ? r.tags : [];
    if (tags.includes(typeFilter)) return true;
    if (typeFilter === 'Sucré') return SWEET_CATS.includes(r.cat);
    if (typeFilter === 'Salé') return SAVORY_CATS.includes(r.cat);
    return false;
  };

  const list = base.filter(matchesType);
  const isEmpty = list.length === 0;

  return (
    <>
      <div className="community-subtabs-wrap" style={{ padding: 'var(--space-xs) var(--space-s)', borderBottom: '1px solid var(--line)', background: 'var(--bg)' }}>
        <div className="segmented" style={{ maxWidth: 'var(--content-max)', margin: '0 auto' }}>
          <button className={`segmented__btn ${mode === 'discover' ? 'active' : ''}`} onClick={() => setMode('discover')}>🔭 Découvrir</button>
          <button className={`segmented__btn ${mode === 'following' ? 'active' : ''}`} onClick={() => setMode('following')}>👥 Abonnements</button>
          <button className={`segmented__btn ${mode === 'members' ? 'active' : ''}`} onClick={() => setMode('members')}>🔎 Membres</button>
        </div>
      </div>

      {mode !== 'members' && (
        <div className="type-chips">
          <button className={`type-chip ${typeFilter === 'Tous' ? 'active' : ''}`} onClick={() => setTypeFilter('Tous')}>Tous</button>
          {RECIPE_TYPES.map(t => (
            <button key={t} className={`type-chip ${typeFilter === t ? 'active' : ''}`} onClick={() => setTypeFilter(t)}>{t}</button>
          ))}
        </div>
      )}

      {mode === 'members' ? (
        <div className="app-main" style={{ maxWidth: 640 }}>
          <MembersDirectory />
        </div>
      ) : isEmpty ? (
        <div className="app-main" style={{ maxWidth: 640 }}>
          <EmptyState
            emoji={mode === 'following' ? '👥' : '🍳'}
            title={typeFilter !== 'Tous' ? `Aucune recette « ${typeFilter} »` : (mode === 'following' ? 'Encore personne à suivre' : 'Aucune recette publique')}
            text={typeFilter !== 'Tous'
              ? 'Changez de type ou revenez à « Tous » pour découvrir d’autres recettes.'
              : (mode === 'following' ? 'Abonnez-vous à des membres pour voir leurs recettes ici.' : 'Le fil se remplira dès que la communauté publiera.')}
          />
        </div>
      ) : (
        <div className="social-grid">
          {list.map(r => <SocialGridCard key={r.id} recipe={r} />)}
        </div>
      )}
    </>
  );
}