import { DAYS } from "./constants";

export const ACTIVITY_LEVELS = {
  sedentary: { label: "Sédentaire (bureau, peu d'activité)", factor: 1.2 },
  light: { label: "Léger (1-2 séances/semaine)", factor: 1.375 },
  moderate: { label: "Modéré (3-4 séances/semaine)", factor: 1.55 },
  active: { label: "Actif (5-6 séances/semaine)", factor: 1.725 },
  very_active: { label: "Très actif (pro athlète)", factor: 1.9 },
};

export const GOALS = {
  lose: { label: "Perdre du poids", adjust: -500, min: 1400 },
  maintain: { label: "Maintenir", adjust: 0 },
  gain: { label: "Prendre du muscle", adjust: 400 },
  cut: { label: "Sèche", adjust: -300, min: 1500 },
};

export const roundMacro = (v) => Math.max(0, Math.round(v || 0));

export function computeTargets({ sex, birthYear, heightCm, weightKg, activityLevel, goal }) {
  const age = Math.max(14, new Date().getFullYear() - (parseInt(birthYear) || 1990));
  const w = parseFloat(weightKg) || 70;
  const h = parseFloat(heightCm) || 170;
  const bmr = 10 * w + 6.25 * h - 5 * age + (sex === "female" ? -161 : 5);
  const factor = (ACTIVITY_LEVELS[activityLevel] || ACTIVITY_LEVELS.moderate).factor;
  const tdee = bmr * factor;
  const goalCfg = GOALS[goal] || GOALS.maintain;
  let kcal = tdee + goalCfg.adjust;
  if (goalCfg.min) kcal = Math.max(goalCfg.min, kcal);

  const protein = Math.min(260, Math.max(90, Math.round(1.8 * w)));
  const fat = Math.min(140, Math.max(40, Math.round(0.8 * w)));
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));

  return { kcal: roundMacro(kcal), protein, carbs, fat, bmr: roundMacro(bmr), tdee: roundMacro(tdee) };
}

/* Construction de l'objet nutrition stocké sur une fiche recette.
   parsed provient de enrichRecipeNutrition (IA) : ingredients [ {name, grams, kcal, protein, carbs, fat} ]. */
export function buildNutrition(parsed, portions) {
  const ings = (parsed.ingredients || []).filter(i => i && i.name);
  const total = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  let sumGrams = 0;
  ings.forEach(i => {
    total.kcal += Number(i.kcal) || 0;
    total.protein += Number(i.protein) || 0;
    total.carbs += Number(i.carbs) || 0;
    total.fat += Number(i.fat) || 0;
    const g = Number(i.grams) || 0;
    if (g > 0) {
      sumGrams += g;
      i.grams = g;
    }
  });
  const perServingBase = Math.max(1, portions || 4);
  const perServing = {
    kcal: roundMacro(total.kcal / perServingBase),
    protein: roundMacro(total.protein / perServingBase),
    carbs: roundMacro(total.carbs / perServingBase),
    fat: roundMacro(total.fat / perServingBase),
  };
  const per100g = sumGrams > 0
    ? {
        kcal: roundMacro(total.kcal / sumGrams * 100),
        protein: roundMacro(total.protein / sumGrams * 100),
        carbs: roundMacro(total.carbs / sumGrams * 100),
        fat: roundMacro(total.fat / sumGrams * 100),
      }
    : null;

  return {
    source: "ai",
    ingredients: ings,
    perServing,
    per100g,
    healthScore: Math.max(0, Math.min(100, Math.round(Number(parsed.healthScore) || 0))),
    healthNote: parsed.healthNote || "",
    adaptations: (parsed.adaptations || []).filter(a => a && a.from && a.to).slice(0, 4),
  };
}

/* Macros d'un plat pour un repas, en fonction des portions et des ingrédients retirés. */
export function macroForMeal(recipe, { portions = 1, omittedIngredients = [] } = {}) {
  const nutrition = recipe?.nutrition;
  if (!nutrition?.perServing) return null;
  const p = portions > 0 ? portions : 1;

  const ing = nutrition.ingredients;
  const omitted = (omittedIngredients || []).map(s => String(s).trim().toLowerCase()).filter(Boolean);

  if (Array.isArray(ing) && ing.length > 0) {
    let changed = false;
    const total = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
    ing.forEach(i => {
      if (omitted.includes(String(i.name).trim().toLowerCase())) { changed = true; return; }
      total.kcal += Number(i.kcal) || 0;
      total.protein += Number(i.protein) || 0;
      total.carbs += Number(i.carbs) || 0;
      total.fat += Number(i.fat) || 0;
    });
    if (changed) {
      const base = Math.max(1, recipe.portions || 4);
      return {
        kcal: roundMacro(total.kcal / base * p),
        protein: roundMacro(total.protein / base * p),
        carbs: roundMacro(total.carbs / base * p),
        fat: roundMacro(total.fat / base * p),
      };
    }
  }

  return {
    kcal: roundMacro(nutrition.perServing.kcal * p),
    protein: roundMacro(nutrition.perServing.protein * p),
    carbs: roundMacro(nutrition.perServing.carbs * p),
    fat: roundMacro(nutrition.perServing.fat * p),
  };
}

/* Étiquette du jour de la semaine (Lundi…Dimanche) pour une date 'YYYY-MM-DD'. */
export function weekdayLabel(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  if (isNaN(d.getTime())) return DAYS[0];
  return DAYS[(d.getDay() + 6) % 7];
}

export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const dateLabel = (dateStr) => {
  const d = new Date(dateStr + "T12:00:00");
  if (isNaN(d.getTime())) return dateStr;
  const parts = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).formatToParts(d);
  const wd = parts.find(p => p.type === "weekday")?.value || "";
  const day = parts.find(p => p.type === "day")?.value || "";
  const month = parts.find(p => p.type === "month")?.value || "";
  return `${wd[0] ? wd[0].toUpperCase() + wd.slice(1) : wd} ${day} ${month}`;
};

export const addDaysToDate = (dateStr, n) => {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/* Additionne les macros d'une journée : repas du planning (portion du jour) + saisis rapides. */
export function dayTotals(plan, dateStr, quickEntries) {
  const totals = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  const day = plan[weekdayLabel(dateStr)] || [];
  let hasData = day.some(m => m.macros) || (quickEntries && quickEntries.length > 0);
  day.forEach(m => {
    if (!m.macros) return;
    totals.kcal += m.macros.kcal || 0;
    totals.protein += m.macros.protein || 0;
    totals.carbs += m.macros.carbs || 0;
    totals.fat += m.macros.fat || 0;
  });
  (quickEntries || []).forEach(e => {
    totals.kcal += e.macros?.kcal || 0;
    totals.protein += e.macros?.protein || 0;
    totals.carbs += e.macros?.carbs || 0;
    totals.fat += e.macros?.fat || 0;
  });
  return { totals, hasData };
}

/* Applique les échanges proposés (adaptations) à une recette : ingrédients + texte des étapes/notes. */
export function applyAdaptations(recipe, adaptations) {
  if (!Array.isArray(adaptations) || adaptations.length === 0) return recipe;
  const subs = {};
  adaptations.forEach(a => { if (a.from && a.to) subs[a.from.trim().toLowerCase()] = a.to.trim(); });

  const swapText = (t) => {
    if (!t) return t;
    let out = t;
    Object.keys(subs).forEach(k => {
      if (out.length === 0) return;
      out = out.replace(new RegExp(`\\b${escapeRegExp(k)}\\b`, "gi"), subs[k]);
    });
    return out;
  };

  const ingredients = (recipe.ingredients || []).map(ing => {
    const key = ing.name.trim().toLowerCase();
    return subs[key] ? { ...ing, name: subs[key] } : ing;
  });

  return {
    ...recipe,
    ingredients,
    steps: (recipe.steps || []).map(s => ({ ...s, text: swapText(s.text) })),
    notes: swapText(recipe.notes),
  };
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* Note colorée selon le score santé. */
export function healthTone(score) {
  if (score >= 75) return { color: "var(--success)", label: "Excellent" };
  if (score >= 55) return { color: "var(--accent)", label: "Correct" };
  return { color: "var(--danger)", label: "À améliorer" };
}