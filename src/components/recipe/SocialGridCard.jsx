import { useNavigate } from "react-router-dom";
import { catColor, formatTime } from "../../lib/constants";
import { useApp } from "../../context/AppContext";
import Avatar from "../ui/Avatar";

export default function SocialGridCard({ recipe }) {
  const navigate = useNavigate();
  const { favIds, toggleFavorite } = useApp();
  const isFav = favIds.includes(recipe.id);
  const kcal = recipe.nutrition?.perServing?.kcal;
  const tags = Array.isArray(recipe.tags) ? recipe.tags : [];

  return (
    <div className="social-card">
      <button className="social-card__media" onClick={() => navigate(`/recette/${recipe.id}`)} aria-label={`Ouvrir ${recipe.name}`}>
        {recipe.photoURL
          ? <img src={recipe.photoURL} alt={recipe.name} loading="lazy" />
          : <div className="social-card__emoji">{recipe.emoji || '🍽️'}</div>}
        <div className="social-card__scrim" />
        <span className="social-card__cat" style={{ color: catColor(recipe.cat) }}>{recipe.cat}</span>
        {kcal != null && <span className="social-card__kcal">⚡ {Math.round(kcal)} kcal</span>}
      </button>
      <button className={`social-card__fav ${isFav ? 'on' : ''}`} onClick={() => toggleFavorite(recipe.id)} aria-label="Favori">
        {isFav ? '❤️' : '🤍'}
      </button>
      <div className="social-card__info">
        <button className="social-card__title" onClick={() => navigate(`/recette/${recipe.id}`)}>{recipe.name}</button>
        <div className="social-card__meta">
          <span className="social-card__owner" onClick={() => navigate(`/membre/${recipe.ownerId}`)}>
            <Avatar name={recipe.ownerName} url={recipe.ownerPhotoURL} size={16} />
            {recipe.ownerName}
          </span>
          {recipe.time != null && <span>· ⏱ {formatTime(recipe.time)}</span>}
        </div>
        {tags.length > 0 && (
          <div className="social-card__tags">
            {tags.map(t => <span key={t} className="social-card__tag">{t}</span>)}
          </div>
        )}
      </div>
    </div>
  );
}