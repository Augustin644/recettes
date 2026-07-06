import React, { useState, useEffect, useRef } from 'react';

// ── 1. PALETTES DE COULEURS ACCORDÉES (CONTRASTE 25% AFFIRMÉ) ────────────────
const THEMES = {
  mine: {
    "--bg-main": "#EFECE6",          // Sable chaud
    "--bg-card": "#FFFFFF",          // Blanc pur
    "--bg-header": "rgba(239, 236, 230, 0.85)",
    "--bg-nav": "#DFD9CE",           // Bouton inactif
    "--text-main": "#1F1A17",        // Café noir
    "--text-muted": "#6E655F",       // Écorce
    "--accent": "#C85329",           // Terre cuite
    "--accent-light": "#FBEBE3",     // Crème de pêche
    "--border": "#D5CEBF",           // Trait croquis
    "--shadow": "0 6px 20px rgba(31, 26, 23, 0.05)",
  },
  public: {
    "--bg-main": "#E3EAE4",          // Vert sauge
    "--bg-card": "#FFFFFF",
    "--bg-header": "rgba(227, 234, 228, 0.85)",
    "--bg-nav": "#CDDAD0",
    "--text-main": "#0F1812",        // Vert forêt profond
    "--text-muted": "#526357",       // Feuille de laurier
    "--accent": "#2E623E",           // Vert pin noble
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

// Exemples de recettes pour tester le rendu graphique
const SAMPLE_RECIPES = {
  mine: [
    { id: 1, title: "Tarte Tatin aux coings et romarin", duration: "45 min", level: "Moyen" },
    { id: 2, title: "Brioche tressée à la fleur d'oranger", duration: "1h 30", level: "Avancé" },
  ],
  public: [
    { id: 3, title: "Velouté de potimarron, éclats de châtaigne", duration: "30 min", level: "Facile" },
    { id: 4, title: "Risotto d'épeautre aux champignons sauvages", duration: "40 min", level: "Moyen" },
  ],
  favorites: [
    { id: 5, title: "Moelleux au chocolat noir & fleur de sel", duration: "25 min", level: "Facile" },
  ]
};

// ── 2. ICÔNES FAITES MAIN EN CSS (CROQUIS DU CHEF) ───────────────────────────
const Icons = {
  Atelier: () => (
    <span style={{ display: 'inline-block', width: '18px', height: '18px', border: '1.5px solid currentColor', borderRadius: '40% 60% 65% 35% / 40% 45% 55% 60%', transform: 'rotate(-5deg)' }} />
  ),
  Public: () => (
    <span style={{ display: 'inline-block', width: '18px', height: '18px', border: '1.5px solid currentColor', borderRadius: '50% 50% 30% 70% / 50% 60% 40% 50%', transform: 'rotate(12deg)' }} />
  ),
  Favorites: () => (
    <span style={{ display: 'inline-block', width: '16px', height: '16px', backgroundColor: 'currentColor', borderRadius: '50% 50% 50% 50% / 40% 40% 60% 60%', transform: 'scale(0.9) rotate(-45deg)', position: 'relative', top: '-2px' }} />
  )
};

export default App;

function App() {
  const [activeTab, setActiveTab] = useState('mine'); // 'mine', 'public', 'favorites'

  // Appliquer dynamiquement les variables CSS du thème choisi
  useEffect(() => {
    const root = document.documentElement;
    const theme = THEMES[activeTab];
    Object.keys(theme).forEach((key) => {
      root.style.setProperty(key, theme[key]);
    });
  }, [activeTab]);

  return (
    <>
      <Styles/ > {/* Injection des styles CSS sous le code */}
      
      <div className="app-container">
        {/* EN-TÊTE ÉDITORIAL */}
        <header className="app-header">
          <div className="header-content">
            <h1 className="logo">Cuisine.</h1>
            
            {/* Navigation Graphique */}
            <nav className="nav-tabs">
              <button 
                className={`tab-btn ${activeTab === 'mine' ? 'active' : ''}`}
                onClick={() => setActiveTab('mine')}
              >
                <Icons.Atelier />
                <span>Mon Atelier</span>
              </button>
              <button 
                className={`tab-btn ${activeTab === 'public' ? 'active' : ''}`}
                onClick={() => setActiveTab('public')}
              >
                <Icons.Public />
                <span>Marché Public</span>
              </button>
              <button 
                className={`tab-btn ${activeTab === 'favorites' ? 'active' : ''}`}
                onClick={() => setActiveTab('favorites')}
              >
                <Icons.Favorites />
                <span>Mes Favoris</span>
              </button>
            </nav>
          </div>
        </header>

        {/* CONTENU PRINCIPAL */}
        <main className="main-content">
          <div className="section-intro">
            <p className="subtitle">
              {activeTab === 'mine' && "Vos carnets de notes, essais et recettes secrètes."}
              {activeTab === 'public' && "Les créations partagées par la communauté culinaire."}
              {activeTab === 'favorites' && "Vos coups de cœur absolus, à portée de main."}
            </p>
          </div>

          {/* Grille de cartes animées */}
          <div className="recipes-grid">
            {SAMPLE_RECIPES[activeTab].map((recipe) => (
              <AnimatedCard key={recipe.id} recipe={recipe} />
            ))}
          </div>
        </main>
      </div>
    </>
  );
}

// ── 3. COMPOSANT CARTE AVEC INTERSECTION OBSERVER (INERTIE FLUIDE) ────────────
function AnimatedCard({ recipe }) {
  const cardRef = useRef(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          // Ajoute la classe quand elle entre, l'enlève quand elle sort (effet continu haut/bas)
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
          } else {
            entry.target.classList.remove('is-visible');
          }
        });
      },
      { threshold: 0.05, rootMargin: "0px 0px -20px 0px" }
    );

    if (cardRef.current) observer.observe(cardRef.current);
    return () => {
      if (cardRef.current) observer.unobserve(cardRef.current);
    };
  }, [recipe]);

  return (
    <div ref={cardRef} className="recipe-card">
      <div className="card-illustration-sketch">
        {/* Un faux croquis abstrait au trait organique unique pour chaque carte */}
        <div className="sketch-shape" style={{ borderRadius: recipe.id % 2 === 0 ? '55% 45% 42% 58% / 40% 50% 50% 60%' : '35% 65% 55% 45% / 60% 40% 60% 40%' }}>
          <span>{recipe.title.charAt(0)}</span>
        </div>
      </div>
      <div className="card-body">
        <h3 className="card-title">{recipe.title}</h3>
        <div className="card-meta">
          <span className="meta-tag">{recipe.duration}</span>
          <span className="meta-separator">•</span>
          <span className="meta-tag">{recipe.level}</span>
        </div>
      </div>
    </div>
  );
}

// ── 4. STYLES CSS NATIFS ET EFFETS GRAPHIQUE HUMAINS ─────────────────────────
function Styles() {
  return (
    <style>{`
      /* Reset & Polices Éditoriales */
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
        transition: background-color 0.5s cubic-bezier(0.16, 1, 0.3, 1);
        -webkit-font-smoothing: antialiased;
      }

      .app-container {
        min-height: 100vh;
        display: flex;
        flex-direction: column;
      }

      /* Header Style Papier Journal Pur */
      .app-header {
        position: sticky;
        top: 0;
        z-index: 100;
        background-color: var(--bg-header);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border-bottom: 1px dashed var(--border);
        transition: background-color 0.5s, border-color 0.5s;
      }

      .header-content {
        max-width: 1100px;
        margin: 0 auto;
        padding: 1.5rem 2rem;
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
        font-size: 2rem;
        letter-spacing: -0.5px;
      }

      /* Onglets type "Carnet d'artisan" */
      .nav-tabs {
        display: flex;
        gap: 0.75rem;
        background: var(--bg-nav);
        padding: 6px;
        border-radius: 14px;
        border: 1.5px solid var(--border);
        transition: background 0.5s, border-color 0.5s;
      }

      .tab-btn {
        background: transparent;
        border: none;
        padding: 10px 18px;
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
        /* Ligne asymétrique type croquis */
        border-radius: 12px 8px 14px 9px / 9px 11px 9px 12px;
        border: 1px solid var(--border);
      }

      /* Structure du Contenu principal */
      .main-content {
        max-width: 1100px;
        margin: 0 auto;
        width: 100%;
        padding: 3rem 2rem;
        flex-grow: 1;
      }

      .section-intro {
        margin-bottom: 3rem;
      }

      .subtitle {
        font-family: 'Playfair Display', serif;
        font-style: italic;
        font-size: 1.4rem;
        color: var(--text-muted);
        max-width: 600px;
        line-height: 1.4;
      }

      /* Grille Web Cassée */
      .recipes-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 2.5rem;
      }

      /* La Carte Humaine & L'effet Inertie Fluide (Scroll haut et bas) */
      .recipe-card {
        background: var(--bg-card);
        border: 2px solid var(--border);
        /* Coins imparfaits tracés main */
        border-radius: 255px 15px 225px 15px / 15px 225px 15px 255px;
        padding: 1.5rem;
        box-shadow: var(--shadow);
        display: flex;
        gap: 1.5rem;
        align-items: center;
        cursor: pointer;
        
        /* État initial pour l'animation au scroll */
        opacity: 0;
        transform: translateY(50px) scale(0.96) rotate(1deg);
        transition: opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1), 
                    transform 0.8s cubic-bezier(0.16, 1, 0.3, 1), 
                    background-color 0.5s, border-color 0.5s;
      }

      /* Classe déclenchée par l'Intersection Observer */
      .recipe-card.is-visible {
        opacity: 1;
        transform: translateY(0) scale(1) rotate(0deg);
      }

      /* Micro-mouvement vivant au survol */
      .recipe-card:hover {
        transform: translateY(-4px) scale(1.01) rotate(-0.5deg) !important;
        border-color: var(--accent);
      }

      /* L'illustration "Croquis au trait" */
      .card-illustration-sketch {
        flex-shrink: 0;
      }

      .sketch-shape {
        width: 65px;
        height: 65px;
        border: 2px dashed var(--accent);
        background-color: var(--accent-light);
        color: var(--accent);
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: 'Playfair Display', serif;
        font-size: 1.5rem;
        font-weight: 600;
        transition: all 0.4s ease;
      }

      .recipe-card:hover .sketch-shape {
        border-style: solid;
        transform: rotate(8deg);
      }

      /* Contenu de la fiche */
      .card-body {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .card-title {
        font-family: 'Playfair Display', serif;
        font-size: 1.25rem;
        font-weight: 600;
        line-height: 1.3;
        color: var(--text-main);
      }

      .card-meta {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--text-muted);
        font-weight: 600;
      }

      .meta-separator {
        color: var(--accent);
      }

      @media (max-width: 600px) {
        .header-content {
          flex-direction: column;
          align-items: flex-start;
        }
        .nav-tabs {
          width: 100%;
          justify-content: space-between;
        }
        .tab-btn {
          padding: 8px 12px;
          font-size: 0.8rem;
        }
      }
    `}</style>
  );
}
