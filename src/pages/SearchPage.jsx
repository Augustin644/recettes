import { useMemo, useState } from "react";
import { useApp } from "../context/AppContext";
import RecipeCard from "../components/recipe/RecipeCard";
import EmptyState from "../components/ui/EmptyState";
import { CATEGORIES } from "../lib/constants";

export default function SearchPage() {
  const { myRecipes, publicRecipes, deleteRecipe, addToProfile } = useApp();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('Toutes');

  const all = useMemo(() => {
    const seen = {};
    [...myRecipes, ...publicRecipes].forEach(r => { if (!seen[r.id]) seen[r.id] = r; });
    return Object.values(seen);
  }, [myRecipes, publicRecipes]);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    return all.filter(r => {
      const matchCat = cat === 'Toutes' || r.cat === cat;
      if (!matchCat) return false;
      if (!term) return true;
      return r.name.toLowerCase().includes(term)
        || r.cat.toLowerCase().includes(term)
        || (r.ingredients || []).some(i => i.name.toLowerCase().includes(term))
        || (r.ownerName || '').toLowerCase().includes(term);
    });
  }, [all, q, cat]);

  return (
    <div className="app-main">
      <div className="page-head">
        <div>
          <div className="eyebrow">Parcourir</div>
          <h1 className="page-title">Recherche</h1>
        </div>
      </div>

      <input className="input search-page-input" value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher une recette, un ingrédient, un membre…" />

      <div className="cat-rail" style={{ padding: 'var(--space-s) 0' }}>
        <div className="cat-rail__inner">
          {CATEGORIES.map(c => (
            <button key={c} className={`cat-pill ${c === cat ? 'active' : ''}`} onClick={() => setCat(c)}>{c}</button>
          ))}
        </div>
      </div>

      {q.trim() && (
        <p style={{ color: 'var(--ink-3)', fontSize: 'var(--step--1)', marginBottom: 'var(--space-s)' }}>
          {results.length} résultat{results.length > 1 ? 's' : ''} pour « {q.trim()} »
        </p>
      )}

      {!q.trim() ? (
        <EmptyState emoji="🔍" title="Que cherchez-vous ?" text="Nom de recette, ingrédient, catégorie ou auteur." />
      ) : results.length === 0 ? (
        <EmptyState emoji="🍽️" title="Aucun résultat" text="Essayez un autre terme ou une autre catégorie." />
      ) : (
        <div className="recipes-grid">
          {results.map(r => (
            <RecipeCard key={r.id} recipe={r} onDelete={deleteRecipe} onAddToProfile={addToProfile} />
          ))}
        </div>
      )}
    </div>
  );
}