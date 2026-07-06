import React, { useState, useEffect, useRef } from 'react';

// ── 1. TOUTES TES DONNÉES ET FONCTIONNALITÉS COMPLÈTES ───────────────────────
// (Remplace ces listes d'exemples par tes vrais states ou appels API si nécessaire)
const INITIAL_RECIPES = [
  { id: 1, title: "Tarte Tatin aux coings et romarin", duration: "45 min", level: "Moyen", category: "mine", isFavorite: false },
  { id: 2, title: "Brioche tressée à la fleur d'oranger", duration: "1h 30", level: "Avancé", category: "mine", isFavorite: true },
  { id: 3, title: "Velouté de potimarron aux éclats de châtaigne", duration: "30 min", level: "Facile", category: "public", isFavorite: false },
  { id: 4, title: "Risotto d'épeautre aux champignons", duration: "40 min", level: "Moyen", category: "public", isFavorite: true },
];

// ── 2. LES 3 PALETTES ACCORDÉES (CONTRASTE 25% AFFIRMÉ) ──────────────────────
const THEMES = {
  mine: {
    "--bg-main": "#EFECE6",          // Sable chaud
    "--bg-card": "#FFFFFF",          // Blanc pur tranché
    "--bg-header": "rgba(239, 236, 230, 0.85)",
    "--bg-nav": "#DFD9CE",
    "--text-main": "#1F1A17",        // Café noir
    "--text-muted": "#6E655F",       // Écorce
    "--accent": "#C85329",           // Terre cuite
    "--accent-light": "#FBEBE3",
    "--border": "#D5CEBF",           // Trait croquis net
    "--shadow": "0 6px 20px rgba(31, 26, 23, 0.05)",
  },
  public: {
    "--bg-main": "#E3EAE4",          // Vert sauge
    "--bg-card": "#FFFFFF",
    "--bg-header": "rgba(227, 234, 228, 0.85)",
    "--bg-nav": "#CDDAD0",
    "--text-main": "#0F1812",        // Vert forêt profond
    "--text-muted": "#526357",       // Feuille de laurier
    "--accent": "#2E623E",           // Vert pin
    "--accent-light": "#E8F0EA",
    "--border": "#BDCFC1",
    "--shadow": "0 6px 20px rgba(15, 24, 18, 0.05)",
  },
  favorites: {
    "--bg-main": "#EFE6E8",          // Vieux rose poudré
    "--bg-card": "#FFFFFF",
    "--bg-header": "rgba(239, 230, 232, 0.85)",
    "--bg-nav": "#DFCCD0",
    "--text-main": "#261115",        // Cerise noire
    "--text-muted": "#6B5357",       // Prune grisé
    "--accent": "#B6324B",           // Framboise mûre
    "--accent-light": "#FAE8EB",
    "--border": "#D5BFC3",
    "--shadow": "0 6px 20px rgba(38, 17, 21, 0.05)",
  }
};

// ── 3. SQUELETTE DE L'APP AVEC TES LOGIQUES MÉTIERS MINGLÉES ────────────────
export default function App() {
  const [activeTab, setActiveTab] = useState('mine'); // 'mine', 'public', 'favorites'
  const [recipes, setRecipes] = useState(INITIAL_RECIPES);
  const [searchQuery, setSearchQuery] = useState('');

  // Injection dynamique des variables CSS de l'ambiance active
  useEffect(() => {
    const root = document.documentElement;
    const theme = THEMES[activeTab];
    Object.keys(theme).forEach((key) => {
      root.style.setProperty(key, theme[key]);
    });
  }, [activeTab]);

  // FONCTIONNALITÉ : Basculer l'état favori d'une recette
  const toggleFavorite = (id) => {
    setRecipes(recipes.map(recipe => 
      recipe.id === id ? { ...recipe, isFavorite: !recipe.isFavorite } : recipe
    ));
  };

  // FONCTIONNALITÉ : Filtrage croisé (Onglets + Barre de recherche)
  const filteredRecipes = recipes.filter(recipe => {
    const matchesTab = activeTab === 'favorites' ? recipe.isFavorite : recipe.category === activeTab;
    const matchesSearch = recipe.title.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesTab && matchesSearch;
  });

  return (
    <>
      <Styles /> {/* Injection du design système "Humain & Éditorial" */}
      
      <div className="app-container">
        {/* BARRE DE NAVIGATION ET FILTRES GRAPHICS */}
        <header className="app-header">
          <div className="header-content">
            <h1 className="logo">Cuisine.</h1>
            
            {/* Recherche épurée style éditorial */}
            <div className="search-wrapper">
              <input 
                type="text" 
                placeholder="Rechercher une recette..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="search-input"
              />
            </div>

            {/* Sélecteur d'onglets façon carnet d'artisan */}
            <nav className="nav-tabs">
              <button className={`tab-btn ${activeTab === 'mine' ? 'active' : ''}`} onClick={() => setActiveTab('mine')}>
                <span className="icon-sketch tab-icon-1"></span>
                <span>Mon Atelier</span>
              </button>
              <button className={`tab-btn ${activeTab === 'public' ? 'active' : ''}`} onClick={() => setActiveTab('public')}>
                <span className="icon-sketch tab-icon-2"></span>
                <span>Marché Public</span>
              </button>
              <button className={`tab-btn ${activeTab === 'favorites' ? 'active' : ''}`} onClick={() => setActiveTab('favorites')}>
                <span className="icon-sketch tab-icon-3"></span>
                <span>Mes Favoris</span>
              </button>
            </nav>
          </div>
        </header>

        {/* ZONE DE CONTENU PRINCIPALE */}
        <main className="main-content">
          <div className="section-intro">
            <p className="subtitle">
              {activeTab === 'mine' && "Vos notes de cuisine, vos brouillons et vos secrets les mieux gardés."}
              {activeTab === 'public' && "Les inspirations culinaires partagées librement par la communauté."}
              {activeTab === 'favorites' && "Votre carnet de pépites gustatives approuvées et adorées."}
            </p>
          </div>

          {/* Grille de cartes dynamiques */}
          {filteredRecipes.length > 0 ? (
            <div className="recipes-grid">
              {filteredRecipes.map((recipe) => (
                <RecipeCard 
                  key={recipe.id} 
                  recipe={recipe} 
                  onToggleFavorite={toggleFavorite} 
                />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <p>Aucune recette ne correspond à votre recherche dans cet onglet.</p>
            </div>
          )}
        </main>
      </div>
    </>
  );
}

// ── 4. COMPOSANT CARTE COMPLET (FONCTIONNEL + INERTIE SCROLL HAUT/BAS) ────────
function RecipeCard({ recipe, onToggleFavorite }) {
  const cardRef = useRef(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          // L'effet s'active à l'entrée ET se retire à la sortie (mouvement fluide haut/bas continu)
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
          } else {
            entry.target.classList.remove('is-visible');
          }
        });
      },
      { threshold: 0.05, rootMargin: "0px 0px -10px 0px" }
    );

    if (cardRef.current) observer.observe(cardRef.current);
    return () => {
      if (cardRef.current) observer.unobserve(cardRef.current);
    };
  }, [recipe.id]);

  return (
    <div ref={cardRef} className="recipe-card">
      {/* Vignette croquis asymétrique */}
      <div className="card-illustration-sketch">
        <div className="sketch-shape" style={{ borderRadius: recipe.id % 2 === 0 ? '55% 45% 42% 58% / 40% 50% 50% 60%' : '35% 65% 55% 45% / 60% 40% 60% 40%' }}>
          <span>{recipe.title.charAt(0)}</span>
        </div>
      </div>

      {/* Infos textuelles de la recette */}
      <div className="card-body">
        <h3 className="card-title">{recipe.title}</h3>
        <div className="card-meta">
          <span className="meta-tag">{recipe.duration}</span>
          <span className="meta-separator">•</span>
          <span className="meta-tag">{recipe.level}</span>
        </div>
      </div>

      {/* BOUTON FONCTIONNEL : Gestion des favoris intégrée */}
      <button 
        className={`fav-action-btn ${recipe.isFavorite ? 'is-fav' : ''}`}
        onClick={(e) => {
          e.stopPropagation(); // Évite de déclencher un éventuel clic sur la carte
          onToggleFavorite(recipe.id);
        }}
        aria-label="Ajouter aux favoris"
      >
        <svg viewBox="0 0 24 24" className="heart-stroke-icon">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
        </svg>
      </button>
    </div>
  );
}

// ── 5. FEUILLE DE STYLE DES EFFETS REBONDIS ET DES FORMES HANDMADE ───────────
function Styles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;1,400&family=Plus+Jakarta+Sans:wght@400;500;600&display=swap');

      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      body {
        background-color: var(--bg-main);
        color: var(--text-main);
        font-family: 'Plus Jakarta Sans', sans-serif;
        transition: background-color 0.6s cubic-bezier(0.16, 1, 0.3, 1);
        -webkit-font-smoothing: antialiased;
      }

      .app-container {
        min-height: 100vh;
        display: flex;
        flex-direction: column;
      }

      /* Structure En-tête */
      .app-header {
        position: sticky;
        top: 0;
        z-index: 100;
        background-color: var(--bg-header);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border-bottom: 1px dashed var(--border);
        transition: background-color 0.6s, border-color 0.6s;
      }

      .header-content {
        max-width: 1100px;
        margin: 0 auto;
        padding: 1.2rem 2rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 1.5rem;
      }

      .logo {
        font-family: 'Playfair Display', serif;
        font-weight: 600;
        font-style: italic;
        font-size: 1.8rem;
        letter-spacing: -0.5px;
      }

      /* Intégration fonctionnelle du champ de recherche */
      .search-wrapper {
        flex-grow: 1;
        max-width: 300px;
      }

      .search-input {
        width: 100%;
        padding: 10px 16px;
        background: var(--bg-card);
        border: 1.5px solid var(--border);
        font-family: inherit;
        font-size: 0.9rem;
        color: var(--text-main);
        outline: none;
        transition: all 0.3s ease;
        border-radius: 9px 13px 10px 12px / 12px 9px 14px 10px; /* Style croquis discret */
      }

      .search-input:focus {
        border-color: var(--accent);
        box-shadow: var(--shadow);
      }

      /* Barre d'onglets artisanale */
      .nav-tabs {
        display: flex;
        gap: 0.5rem;
        background: var(--bg-nav);
        padding: 5px;
        border-radius: 14px;
        border: 1.5px solid var(--border);
        transition: background 0.6s, border-color 0.6s;
      }

      .tab-btn {
        background: transparent;
        border: none;
        padding: 10px 16px;
        font-family: inherit;
        font-size: 0.9rem;
        font-weight: 500;
        color: var(--text-muted);
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
        transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        border-radius: 10px;
      }

      .tab-btn.active {
        background-color: var(--bg-card);
        color: var(--accent);
        box-shadow: var(--shadow);
        border: 1px solid var(--border);
        border-radius: 12px 8px 14px 9px / 9px 11px 9px 12px;
      }

      /* Mini icônes CSS fait main */
      .icon-sketch {
        display: inline-block;
        width: 14px;
        height: 14px;
        border: 1.5px solid currentColor;
      }
      .tab-icon-1 { border-radius: 40% 60% 65% 35% / 40% 45% 55% 60%; transform: rotate(-5deg); }
      .tab-icon-2 { border-radius: 50% 50% 30% 70% / 50% 60% 40% 50%; transform: rotate(12deg); }
      .tab-icon-3 { background: currentColor; border-radius: 50% 50% 50% 50% / 40% 40% 60% 60%; transform: rotate(-45deg); }

      /* Contenu principal */
      .main-content {
        max-width: 1100px;
        margin: 0 auto;
        width: 100%;
        padding: 3rem 2rem;
        flex-grow: 1;
      }

      .subtitle {
        font-family: 'Playfair Display', serif;
        font-style: italic;
        font-size: 1.3rem;
        color: var(--text-muted);
        max-width: 600px;
        line-height: 1.4;
        margin-bottom: 3rem;
      }

      .recipes-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 2.5rem;
      }

      /* LA CARTE HYBRIDE : Structurée, fonctionnelle, animée en inertie haut/bas */
      .recipe-card {
        position: relative;
        background: var(--bg-card);
        border: 2px solid var(--border);
        border-radius: 255px 15px 225px 15px / 15px 225px 15px 255px; /* Tracé main */
        padding: 1.5rem;
        box-shadow: var(--shadow);
        display: flex;
        gap: 1.5rem;
        align-items: center;
        
        /* Paramètres initiaux d'animation (Inertie fluide) */
        opacity: 0;
        transform: translateY(50px) scale(0.96) rotate(1deg);
        transition: opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1), 
                    transform 0.8s cubic-bezier(0.16, 1, 0.3, 1), 
                    background-color 0.5s, border-color 0.5s;
      }

      /* Déclencheur Intersection Observer */
      .recipe-card.is-visible {
        opacity: 1;
        transform: translateY(0) scale(1) rotate(0deg);
      }

      .recipe-card:hover {
        transform: translateY(-5px) scale(1.01) rotate(-0.5deg) !important;
        border-color: var(--accent);
      }

      /* Formes d'illustrations */
      .card-illustration-sketch {
        flex-shrink: 0;
      }

      .sketch-shape {
        width: 60px;
        height: 60px;
        border: 2px dashed var(--accent);
        background-color: var(--accent-light);
        color: var(--accent);
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: 'Playfair Display', serif;
        font-size: 1.3rem;
        font-weight: 600;
        transition: transform 0.4s ease, border-style 0.4s;
      }

      .recipe-card:hover .sketch-shape {
        border-style: solid;
        transform: rotate(8deg);
      }

      .card-body {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        padding-right: 2rem; /* Espace pour le bouton favori */
      }

      .card-title {
        font-family: 'Playfair Display', serif;
        font-size: 1.2rem;
        font-weight: 600;
        line-height: 1.3;
        color: var(--text-main);
      }

      .card-meta {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--text-muted);
        font-weight: 600;
      }

      .meta-separator {
        color: var(--accent);
      }

      /* BOUTON FAVORIS INTERACTIF SANS EFFET "IA" */
      .fav-action-btn {
        position: absolute;
        top: 1.5rem;
        right: 1.5rem;
        background: transparent;
        border: none;
        cursor: pointer;
        padding: 5px;
        color: var(--text-muted);
        transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275), color 0.3s;
      }

      .heart-stroke-icon {
        width: 20px;
        height: 20px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2px;
        transition: stroke-width 0.2s, fill 0.3s;
      }

      .fav-action-btn:hover {
        transform: scale(1.2);
        color: var(--accent);
      }

      /* État actif fonctionnel du favori */
      .fav-action-btn.is-fav {
        color: var(--accent);
      }
      .fav-action-btn.is-fav .heart-stroke-icon {
        fill: currentColor;
        stroke: var(--accent);
      }

      .empty-state {
        text-align: center;
        padding: 4rem 2rem;
        color: var(--text-muted);
        font-family: 'Playfair Display', serif;
        font-style: italic;
        font-size: 1.2rem;
      }

      @media (max-width: 850px) {
        .header-content {
          flex-direction: column;
          align-items: stretch;
        }
        .search-wrapper {
          max-width: 100%;
        }
      }
    `}</style>
  );
}
