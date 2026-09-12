import { Link } from "react-router-dom";
import { catColor, formatTime } from "../../lib/constants";
import { useApp } from "../../context/AppContext";
import DiffDots from "../ui/DiffDots";

export default function RecipeCard({ recipe, onDelete, onAddToProfile }) {
  const { user, favIds, toggleFavorite } = useApp();
  const isOwner = recipe.ownerId === user?.uid;
  const isFav = favIds.includes(recipe.id);

  return (
    <div className="recipe-card">
      <span className="recipe-card__tab" style={{ background: catColor(recipe.cat) }} />
      <Link to={`/recette/${recipe.id}`} className="recipe-card__thumb" style={{ flexShrink: 0 }}>
        {recipe.photoURL ? <img src={recipe.photoURL} alt="" /> : <span>{recipe.emoji || '🍽️'}</span>}
      </Link>
      <Link to={`/recette/${recipe.id}`} className="recipe-card__body">
        <div className="recipe-card__title">{recipe.name}</div>
        <div className="recipe-card__meta">
          <span className="recipe-card__cat" style={{ color: catColor(recipe.cat) }}>{recipe.cat}</span>
          {recipe.time != null && <span>· {formatTime(recipe.time)}</span>}
          <DiffDots diff={recipe.diff} />
        </div>
      </Link>
      <div className="recipe-card__actions">
        <button
          className="mini-btn mini-btn--fav"
          title="Favori"
          aria-label="Favori"
          onClick={() => toggleFavorite(recipe.id)}
        >
          {isFav ? '❤️' : '🤍'}
        </button>
        {isOwner ? (
          <button className="mini-btn mini-btn--danger" title="Supprimer" aria-label="Supprimer" onClick={() => onDelete(recipe.id)}>✕</button>
        ) : (
          <button className="btn-add-card" onClick={() => onAddToProfile(recipe)}>＋ Carnet</button>
        )}
      </div>
    </div>
  );
}