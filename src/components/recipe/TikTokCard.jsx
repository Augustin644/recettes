import { useNavigate } from "react-router-dom";
import { catColor, formatTime } from "../../lib/constants";
import { useApp } from "../../context/AppContext";
import DiffDots from "../ui/DiffDots";
import Avatar from "../ui/Avatar";

export default function TikTokCard({ recipe, active }) {
  const navigate = useNavigate();
  const { user, favIds, toggleFavorite, addToProfile } = useApp();
  const isOwner = recipe.ownerId === user?.uid;
  const isFav = favIds.includes(recipe.id);
  const isImported = !!recipe.copiedFrom;

  return (
    <section className="tiktok-card" aria-hidden={!active}>
      <div className="tiktok-card__media">
        {recipe.photoURL
          ? <img src={recipe.photoURL} alt={recipe.name} loading="lazy" />
          : <div className="tiktok-card__emoji">{recipe.emoji || '🍽️'}</div>}
      </div>
      <div className="tiktok-card__scrim" />

      {/* Rail latéral d'actions */}
      <div className="tiktok-card__actions">
        <button className={`tiktok-rail-btn ${isFav ? 'fav' : ''}`} onClick={() => toggleFavorite(recipe.id)} aria-label="Ajouter aux favoris">
          <span>{isFav ? '❤️' : '🤍'}</span>
          <span>{isFav ? 'Retiré' : 'J’aime'}</span>
        </button>
        {isOwner ? (
          <button className="tiktok-rail-btn" onClick={() => navigate(`/recette/${recipe.id}?edit=1`)} aria-label="Modifier">
            <span>✏️</span>
            <span>Éditer</span>
          </button>
        ) : (
          <button className="tiktok-rail-btn" onClick={() => addToProfile(recipe)} aria-label="Ajouter au carnet">
            <span>＋</span>
            <span>Carnet</span>
          </button>
        )}
        <button className="tiktok-rail-btn" onClick={() => navigate(`/recette/${recipe.id}`)} aria-label="Voir la fiche">
          <span>📄</span>
          <span>Fiche</span>
        </button>
      </div>

      {/* Infos */}
      <div className="tiktok-card__info">
        <button className="tiktok-card__owner" onClick={() => navigate(`/membre/${recipe.ownerId}`)}>
          <Avatar name={recipe.ownerName} url={recipe.ownerPhotoURL} size={26} />
          {recipe.ownerName}
        </button>
        <h2 className="tiktok-card__title">{recipe.name}</h2>
        <div className="tiktok-card__pills">
          <span className="tiktok-pill" style={{ color: catColor(recipe.cat) }}>● {recipe.cat}</span>
          {recipe.time != null && <span className="tiktok-pill">⏱ {formatTime(recipe.time)}</span>}
          {recipe.portions && <span className="tiktok-pill">🍽 {recipe.portions} pers.</span>}
          <span className="tiktok-pill"><DiffDots diff={recipe.diff} /></span>
        </div>
        <button className="tiktok-card__cta" onClick={() => navigate(`/recette/${recipe.id}`)}>
          Voir la recette →
        </button>
        {isImported && (
          <p style={{ fontSize: 'var(--step--1)', marginTop: 8, opacity: 0.85 }}>
            Importé du carnet de {recipe.copiedFrom?.ownerName}
          </p>
        )}
      </div>
    </section>
  );
}