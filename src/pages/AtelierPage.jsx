import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import RecipeCard from "../components/recipe/RecipeCard";
import EmptyState from "../components/ui/EmptyState";
import { CATEGORIES, catColor } from "../lib/constants";

export default function AtelierPage() {
  const navigate = useNavigate();
  const { myRecipes, deleteRecipe, addToProfile } = useApp();
  const [cat, setCat] = useState('Toutes');
  const [q, setQ] = useState('');

  const filtered = useMemo(() => myRecipes.filter(r => {
    const matchCat = cat === 'Toutes' || r.cat === cat;
    const term = q.toLowerCase();
    return matchCat && (!term
      || r.name.toLowerCase().includes(term)
      || r.cat.toLowerCase().includes(term)
      || (r.ingredients || []).some(i => i.name.toLowerCase().includes(term)));
  }), [myRecipes, cat, q]);

  const cats = ['Toutes', ...new Set(myRecipes.map(r => r.cat))];

  return (
    <div className="app-main">
      <div className="page-head">
        <div>
          <div className="eyebrow">Mes créations</div>
          <h1 className="page-title">Atelier</h1>
          <p className="page-subtitle">{myRecipes.length} recette{myRecipes.length > 1 ? 's' : ''} dans le carnet</p>
        </div>
        <button className="btn btn--primary" onClick={() => navigate('/ajouter')}>＋ Nouvelle</button>
      </div>

      <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher une recette, un ingrédient…" style={{ marginBottom: 'var(--space-s)' }} />

      <div className="cat-rail" style={{ padding: '0 0 var(--space-s)' }}>
        <div className="cat-rail__inner">
          {cats.map(c => (
            <button key={c} className={`cat-pill ${c === cat ? 'active' : ''}`} onClick={() => setCat(c)}>{c}</button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          emoji="📖"
          title={myRecipes.length === 0 ? 'Votre carnet est vide' : 'Aucun résultat'}
          text={myRecipes.length === 0 ? 'Créez votre première fiche à la main ou via l’assistant IA.' : 'Essayez une autre catégorie ou un autre terme.'}
        >
          <button className="btn btn--primary" onClick={() => navigate('/ajouter')}>Créer une recette</button>
        </EmptyState>
      ) : (
        <div className="recipes-grid">
          {filtered.map(r => (
            <RecipeCard key={r.id} recipe={r} onDelete={deleteRecipe} onAddToProfile={addToProfile} />
          ))}
        </div>
      )}
    </div>
  );
}