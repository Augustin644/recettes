import { useState } from "react";
import { DAYS } from "../../lib/constants";
import { macroForMeal, weekdayLabel, todayStr } from "../../lib/nutrition";

export default function AddToPlanSheet({
  recipe,
  fixedDay,
  initial,
  confirmLabel = "Ajouter au planning",
  onConfirm,
  onCancel,
  onRemove,
  onOpenRecipe,
}) {
  const [day, setDay] = useState(initial?.day || fixedDay || weekdayLabel(todayStr()));
  const [portions, setPortions] = useState(initial?.portions || 1);
  const [omitted, setOmitted] = useState(initial?.omittedIngredients || []);
  const [qtys, setQtys] = useState(() => {
    const map = {};
    (recipe.ingredients || []).forEach(ing => {
      if (initial?.qtyOverrides?.[ing.name] != null) map[ing.name] = initial.qtyOverrides[ing.name];
      else map[ing.name] = ing.qty || "";
    });
    return map;
  });

  const ingredients = recipe.ingredients || [];
  const m = macroForMeal(recipe, { portions, omittedIngredients: omitted });

  const toggleIng = (name) =>
    setOmitted(o => (o.includes(name) ? o.filter(x => x !== name) : [...o, name]));

  const confirm = () => {
    const qtyOverrides = {};
    ingredients.forEach(ing => {
      if (omitted.includes(ing.name)) return;
      const v = (qtys[ing.name] || "").trim();
      if (v && v !== (ing.qty || "").trim()) qtyOverrides[ing.name] = v;
    });
    onConfirm({ day, portions, omittedIngredients: omitted, qtyOverrides });
  };

  return (
    <div className="overlay" style={{ zIndex: 340 }} onClick={onCancel}>
      <div className="sheet" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div className="sheet__grab" />
        <div className="sheet__head">
          <div className="page-title" style={{ fontSize: "var(--step-2)" }}>📅 {recipe.name}</div>
          <button className="icon-btn" onClick={onCancel}>✕</button>
        </div>
        <div className="sheet__body">
          {!fixedDay && (
            <div style={{ marginBottom: "var(--space-s)" }}>
              <div className="eyebrow" style={{ marginBottom: 4 }}>Jour du repas</div>
              <div className="day-picker">
                {DAYS.map(d => (
                  <button key={d} className={`day-picker__btn ${day === d ? "active" : ""}`} onClick={() => setDay(d)}>
                    {d.slice(0, 3)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="portions-stepper" style={{ marginBottom: "var(--space-s)" }}>
            <span style={{ color: "var(--ink-2)", fontSize: "var(--step--1)", flex: 1, fontWeight: 600 }}>Portions</span>
            <button className="stepper-btn" onClick={() => setPortions(p => Math.max(1, p - 1))}>−</button>
            <span className="stepper-value">{portions}</span>
            <button className="stepper-btn" onClick={() => setPortions(p => p + 1)}>+</button>
          </div>

          {ingredients.length > 0 && (
            <div style={{ marginBottom: "var(--space-s)" }}>
              <div className="eyebrow" style={{ marginBottom: 4 }}>Ingrédients & quantités</div>
              {ingredients.map((ing, i) => {
                const removed = omitted.includes(ing.name);
                return (
                  <div key={i} className={`ing-toggle ${removed ? "off" : "on"}`} style={{ cursor: "default" }}>
                    <button type="button" className="ing-toggle__check" style={{ background: removed ? "var(--surface-2)" : "var(--success)", borderColor: removed ? "var(--line)" : "var(--success)", color: "var(--on-accent)" }}
                      onClick={() => toggleIng(ing.name)} aria-label="Inclure / retirer">
                      {removed ? "" : "✓"}
                    </button>
                    <span style={{ flex: 1, textAlign: "left", textDecoration: removed ? "line-through" : "none", fontSize: "var(--step--1)" }}>{ing.name}</span>
                    {!removed ? (
                      <input className="input ing-qty-input" value={qtys[ing.name] || ""}
                        onChange={e => setQtys(q => ({ ...q, [ing.name]: e.target.value }))}
                        placeholder={ing.qty || "qté"} title="Quantité pour la liste de courses" />
                    ) : (
                      <span style={{ fontSize: "var(--step--1)", color: "var(--ink-3)" }}>retiré</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {m ? (
            <div className="macro-live" style={{ marginBottom: "var(--space-s)" }}>
              <div className="eyebrow">Macros du repas</div>
              <div className="macro-chips">
                <span className="macro-chip" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{Math.round(m.kcal)} kcal</span>
                <span className="macro-chip" style={{ background: "var(--success-soft)", color: "var(--success)" }}>P {m.protein} g</span>
                <span className="macro-chip" style={{ background: "var(--info-soft)", color: "var(--info)" }}>G {m.carbs} g</span>
                <span className="macro-chip" style={{ background: "var(--warn-soft)", color: "var(--warn)" }}>L {m.fat} g</span>
              </div>
            </div>
          ) : recipe.nutrition ? (
            <div className="sportif-cta" style={{ marginBottom: "var(--space-s)" }}>
              <span>Pour calculer les macros du repas, enrichissez d'abord cette fiche.</span>
              {onOpenRecipe && <button className="btn btn--secondary btn--sm" onClick={onOpenRecipe}>Voir la fiche</button>}
            </div>
          ) : null}

          <div style={{ display: "flex", gap: "var(--space-xs)" }}>
            <button className="btn btn--secondary" style={{ flex: 1 }} onClick={onCancel}>Annuler</button>
            <button className="btn btn--primary" style={{ flex: 1 }} onClick={confirm}>{confirmLabel}</button>
          </div>
          {onRemove && (
            <button className="btn btn--ghost btn--block" style={{ color: "var(--danger)", marginTop: "var(--space-xs)" }} onClick={onRemove}>
              🗑 Retirer ce repas
            </button>
          )}
        </div>
      </div>
    </div>
  );
}