export const CATEGORIES = ["Toutes", "Entrées", "Plats", "Desserts", "Boulangerie", "Boissons", "Sauces & Condiments", "Autre"];
export const CAT_LIST = CATEGORIES.filter(c => c !== "Toutes");

export const DIFF_LABELS = ["", "Facile", "Intermédiaire", "Difficile"];

export const CAT_TAB_COLORS = {
  "Entrées": "#3DA5D9",
  "Plats": "#FF5A36",
  "Desserts": "#C9518B",
  "Boulangerie": "#C98A2C",
  "Boissons": "#33A16B",
  "Sauces & Condiments": "#7C6AE8",
  "Autre": "#6E6E73",
};

export const catColor = (c) => CAT_TAB_COLORS[c] || "#6E6E73";

export const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

export const RECIPE_TYPES = ["Healthy", "Gourmand", "Sucré", "Salé", "Végé", "Rapide"];

export const FAVS_KEY = "culinary_favs";
export const THEME_KEY = "carnet_theme";

export const formatTime = (t) => {
  if (t == null) return null;
  if (t < 60) return `${t} min`;
  const h = Math.floor(t / 60);
  const m = t % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
};