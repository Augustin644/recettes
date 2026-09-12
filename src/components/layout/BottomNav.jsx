import { NavLink, useNavigate } from "react-router-dom";

const TABS = [
  { to: "/decouvrir", label: "Découvrir", icon: "🍽️" },
  { to: "/atelier", label: "Atelier", icon: "📖" },
  { to: "/favoris", label: "Favoris", icon: "❤️" },
  { to: "/profil", label: "Profil", icon: "👤" },
];

export default function BottomNav() {
  const navigate = useNavigate();
  return (
    <nav className="bottom-nav">
      <Tab to="/decouvrir" label="Découvrir" icon="🍽️" />
      <Tab to="/atelier" label="Atelier" icon="📖" />

      <div className="nav-fab-slot">
        <button className="fab nav-fab" onClick={() => navigate('/ajouter')} aria-label="Ajouter une recette">＋</button>
      </div>

      <Tab to="/favoris" label="Favoris" icon="❤️" />
      <Tab to="/profil" label="Profil" icon="👤" />
    </nav>
  );
}

function Tab({ to, label, icon }) {
  return (
    <NavLink to={to} className={({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`}>
      <span className="nav-btn__icon">{icon}</span>
      <span className="nav-btn__label">{label}</span>
    </NavLink>
  );
}