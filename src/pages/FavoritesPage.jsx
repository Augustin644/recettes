import { useMemo } from "react";
import { useApp } from "../context/AppContext";
import RecipeCard from "../components/recipe/RecipeCard";
import EmptyState from "../components/ui/EmptyState";

export default function FavoritesPage() {
  const { myRecipes, publicRecipes, favIds, deleteRecipe, addToProfile } = useApp();

  const allKnown = useMemo(() => [...myRecipes, ...publicRecipes], [myRecipes, publicRecipes]);
  const favorites = useMemo(() => favIds.map(id => allKnown.find(r => r.id === id)).filter(Boolean), [favIds, allKnown]);

  return (
    <div className="app-main">
      <div className="page-head">
        <div>
          <div className="eyebrow">Vos coups de cœur</div>
          <h1 className="page-title">Favoris</h1>
          <p className="page-subtitle">{favorites.length} recette{favorites.length > 1 ? 's' : ''} enregistrée{favorites.length > 1 ? 's' : ''}</p>
        </div>
      </div>

      {favorites.length === 0 ? (
        <EmptyState
          emoji="❤️"
          title="Aucun favori"
          text="Touchez le cœur sur une recette pour la retrouver ici, même hors connexion."
        />
      ) : (
        <div className="recipes-grid">
          {favorites.map(r => (
            <RecipeCard key={r.id} recipe={r} onDelete={deleteRecipe} onAddToProfile={addToProfile} />
          ))}
        </div>
      )}
    </div>
  );
}