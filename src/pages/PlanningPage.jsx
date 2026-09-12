import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useApp } from "../context/AppContext";
import { DAYS } from "../lib/constants";
import AddToPlanSheet from "../components/planning/AddToPlanSheet";
import { macroForMeal, dayTotals, weekdayLabel, todayStr, dateLabel } from "../lib/nutrition";
import { hasApiKey, guessNutritionFromText } from "../lib/ai";

function MacroBar({ label, current, target, color, unit = "" }) {
  const pct = target > 0 ? Math.min(100, current / target * 100) : 0;
  const over = target > 0 && current > target;
  return (
    <div className="macro-bar">
      <div className="macro-bar__head">
        <span className="macro-bar__label">{label}</span>
        <span className="macro-bar__value">
          {Math.round(current)}{unit} <span className="macro-bar__target">/ {Math.round(target)}{unit}</span>
        </span>
      </div>
      <div className="macro-bar__track">
        <div className="macro-bar__fill" style={{ width: `${pct}%`, background: color, opacity: over ? 0.85 : 1 }} />
      </div>
    </div>
  );
}

export default function PlanningPage() {
  const navigate = useNavigate();
  const { user, myRecipes, publicRecipes, sportif, plan, addMealToPlan, updatePlanMeal, removePlanMeal } = useApp();
  const sporty = sportif?.active && sportif?.targets;

  const [showList, setShowList] = useState(false);
  const [addingTo, setAddingTo] = useState(null);
  const [configuring, setConfiguring] = useState(null);
  const [search, setSearch] = useState('');
  const [checked, setChecked] = useState({});

  const [date, setDate] = useState(todayStr());
  const [quickEntries, setQuickEntries] = useState([]);
  const [quickAdding, setQuickAdding] = useState(false);
  const [quickForm, setQuickForm] = useState({ name: '', kcal: '', protein: '', carbs: '', fat: '' });
  const [guessBusy, setGuessBusy] = useState(false);

  const quickDocId = `${user?.uid}_${date}`;

  useEffect(() => {
    if (!user) return;
    const ref_ = doc(db, 'macro_days', quickDocId);
    const unsub = onSnapshot(ref_, snap => {
      if (snap.exists()) setQuickEntries(snap.data().entries || []);
      else setQuickEntries([]);
    });
    return unsub;
  }, [user, quickDocId]);

  const addMeal = async (day, recipe, options) => {
    const meal = {
      recipeId: recipe.id,
      name: recipe.name,
      ingredients: recipe.ingredients || [],
      portions: options?.portions || 1,
      omittedIngredients: options?.omittedIngredients || [],
      qtyOverrides: options?.qtyOverrides || {},
      macros: macroForMeal(recipe, options),
    };
    await addMealToPlan(day, meal);
    setAddingTo(null);
    setSearch('');
  };

  const editMeal = async (day, idx, options, recipe) => {
    const prev = (plan[day] || [])[idx];
    const macros = recipe?.nutrition ? macroForMeal(recipe, options) : prev?.macros;
    await updatePlanMeal(day, idx, {
      ...prev,
      portions: options.portions,
      omittedIngredients: options.omittedIngredients,
      qtyOverrides: options.qtyOverrides || {},
      macros,
    });
  };

  const openConfig = (day, recipe) => {
    setConfiguring({ day, recipe, idx: null, existing: null });
  };

  const openConfigEdit = (day, idx) => {
    const m = (plan[day] || [])[idx];
    const recipe = myRecipes.find(r => r.id === m.recipeId);
    setConfiguring({
      day, idx,
      recipe: recipe || { name: m.name, ingredients: m.ingredients || [], nutrition: null },
      existing: m,
      initial: {
        day,
        portions: m.portions || 1,
        omittedIngredients: m.omittedIngredients || [],
        qtyOverrides: m.qtyOverrides || {},
      },
    });
  };

  /* ── Saisie rapide du jour ─────────────────────────────────────────── */
  const quickMacrosForm = () => ({
    kcal: parseFloat(quickForm.kcal) || 0,
    protein: parseFloat(quickForm.protein) || 0,
    carbs: parseFloat(quickForm.carbs) || 0,
    fat: parseFloat(quickForm.fat) || 0,
  });

  const saveQuickAdd = async () => {
    if (!quickForm.name.trim()) return;
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      type: 'quick',
      name: quickForm.name.trim(),
      macros: quickMacrosForm(),
      createdAt: serverTimestamp(),
    };
    const ref_ = doc(db, 'macro_days', quickDocId);
    const existing = quickEntries;
    await setDoc(ref_, {
      uid: user.uid, date,
      entries: [...existing, entry],
    }, { merge: true });
    setQuickForm({ name: '', kcal: '', protein: '', carbs: '', fat: '' });
    setQuickAdding(false);
  };

  const removeQuickAdd = async (id) => {
    const ref_ = doc(db, 'macro_days', quickDocId);
    await setDoc(ref_, { uid: user.uid, date, entries: quickEntries.filter(e => e.id !== id) }, { merge: true });
  };

  const guessMacros = async () => {
    if (!quickForm.name.trim()) return;
    setGuessBusy(true);
    try {
      const g = await guessNutritionFromText(quickForm.name);
      setQuickForm(f => ({
        ...f,
        kcal: g.kcal != null ? String(g.kcal) : f.kcal,
        protein: g.protein != null ? String(g.protein) : f.protein,
        carbs: g.carbs != null ? String(g.carbs) : f.carbs,
        fat: g.fat != null ? String(g.fat) : f.fat,
      }));
    } catch {
      // silencieux : l'utilisateur saisit à la main
    } finally { setGuessBusy(false); }
  };

  const { totals: dayMacros, hasData } = useMemo(() => dayTotals(plan, date, quickEntries), [plan, date, quickEntries]);
  const targets = sporty;

  const shoppingList = () => {
    const map = {};
    Object.values(plan).forEach(meals => {
      (meals || []).forEach(meal => {
        (meal.ingredients || []).forEach(ing => {
          if ((meal.omittedIngredients || []).includes(ing.name)) return;
          const key = ing.name.toLowerCase().trim();
          if (!map[key]) map[key] = { name: ing.name, quantities: [] };
          const qty = meal.qtyOverrides?.[ing.name];
          if (qty) map[key].quantities.push(qty);
          else if (ing.qty) map[key].quantities.push(ing.qty);
        });
      });
    });
    return Object.values(map);
  };

  const toggleCheck = (key) => setChecked(p => ({ ...p, [key]: !p[key] }));

  const allAvailable = useMemo(() => {
    const map = new Map();
    [...myRecipes, ...publicRecipes].forEach(r => map.set(r.id, r));
    return [...map.values()];
  }, [myRecipes, publicRecipes]);

  const pickerRecipes = allAvailable
    .filter(r => !search || (r.name || '').toLowerCase().includes(search.toLowerCase()))
    .slice(0, 40)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const pickerCount = allAvailable.length;
  const items = shoppingList();
  const unchecked = items.filter(i => !checked[i.name.toLowerCase()]);
  const checkedItems = items.filter(i => checked[i.name.toLowerCase()]);

  return (
    <div className="app-main" style={{ maxWidth: 860 }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Votre semaine</div>
          <h1 className="page-title">Planning repas</h1>
        </div>
        <button className="btn btn--primary" onClick={() => setShowList(true)}>
          🛒 Liste {items.length > 0 && `(${items.length})`}
        </button>
      </div>

      {/* ── Panneau sportif du jour ─────────────────────────────────────── */}
      {sportif?.active && (
        <div className="sportif-day" style={{ marginBottom: 'var(--space-l)' }}>
          <div className="sportif-day__head">
            <div>
              <div className="eyebrow">Suivi du jour</div>
              <div style={{ fontWeight: 700, fontSize: 'var(--step-1)' }}>{dateLabel(date)}</div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2xs)', alignItems: 'center' }}>
              <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)}
                style={{ width: 150, fontSize: 'var(--step--1)', padding: '8px 10px' }} />
              <button className="btn btn--secondary btn--sm" onClick={() => setQuickAdding(true)}>＋ Ajout rapide</button>
            </div>
          </div>

          {targets ? (
            <>
              <div className="macro-bars">
                <MacroBar label="Calories" current={dayMacros.kcal} target={targets.kcal} color="var(--accent)" unit=" kcal" />
                <MacroBar label="Protéines" current={dayMacros.protein} target={targets.protein} color="var(--success)" unit=" g" />
                <MacroBar label="Glucides" current={dayMacros.carbs} target={targets.carbs} color="var(--info)" unit=" g" />
                <MacroBar label="Lipides" current={dayMacros.fat} target={targets.fat} color="#E8A33D" unit=" g" />
              </div>
              {!hasData && (
                <p style={{ fontSize: 'var(--step--1)', color: 'var(--ink-3)', marginTop: 'var(--space-2xs)' }}>
                  Aucun repas avec macros pour ce jour. Ajoutez un repas au planning en configurant les portions et ingrédients.
                </p>
              )}
              {quickEntries.length > 0 && (
                <div className="sportif-day__extras">
                  {quickEntries.map(e => (
                    <div key={e.id} className="sportif-extra">
                      <span style={{ fontWeight: 600 }}>＋ {e.name}</span>
                      <span style={{ fontSize: 'var(--step--1)', color: 'var(--ink-3)' }}>
                        {Math.round(e.macros?.kcal || 0)} kcal · P {e.macros?.protein || 0} · G {e.macros?.carbs || 0} · L {e.macros?.fat || 0}
                      </span>
                      <button className="btn btn--ghost btn--sm" onClick={() => removeQuickAdd(e.id)}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="sportif-cta" style={{ marginTop: 'var(--space-xs)' }}>
              <span>Activez vos objectifs pour suivre vos macros au quotidien.</span>
              <button className="btn btn--primary btn--sm" onClick={() => navigate('/sportif')}>Configurer mes objectifs</button>
            </div>
          )}
        </div>
      )}

      {/* ── Planning semaine ────────────────────────────────────────────── */}
      <div className="planner-grid">
        {DAYS.map(day => {
          const dayMeals = plan[day] || [];
          const dayKcal = dayMeals.reduce((s, m) => s + (m.macros?.kcal || 0), 0);
          return (
            <div key={day} className={`planner-day ${weekdayLabel(todayStr()) === day ? 'is-today' : ''}`}>
              <div className="planner-day__head">
                <span>{day}{weekdayLabel(todayStr()) === day && <em style={{ fontStyle: 'normal', fontSize: 'var(--step--1)', color: 'var(--accent)' }}> · auj.</em>}</span>
                <button className="planner-day__add" onClick={() => setAddingTo(addingTo === day ? null : day)}>+</button>
              </div>
              <div className="planner-day__body">
                {dayMeals.length === 0 && (
                  <p style={{ color: 'var(--ink-3)', fontSize: 'var(--step--1)', textAlign: 'center', padding: 'var(--space-s) 0', fontStyle: 'italic' }}>Vide</p>
                )}
                {dayMeals.map((meal, i) => (
                  <div key={i} className="planner-meal">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span className="planner-meal__name">{meal.name}</span>
                      {meal.macros && (
                        <div className="planner-meal__macros" style={{ display: 'block', fontSize: 'var(--step--1)', color: 'var(--accent)', fontWeight: 700 }}>
                          ⚡ {Math.round(meal.macros.kcal)} kcal · P {meal.macros.protein} · G {meal.macros.carbs} · L {meal.macros.fat}
                        </div>
                      )}
                    </div>
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontSize: 'var(--step--1)', flexShrink: 0 }} onClick={() => sportif?.active ? openConfigEdit(day, i) : removeMeal(day, i)}>
                      {sportif?.active ? '⚙' : '✕'}
                    </button>
                  </div>
                ))}
                {sportif?.active && dayKcal > 0 && (
                  <div style={{ fontSize: 'var(--step--1)', color: 'var(--ink-2)', textAlign: 'right', paddingTop: 4, fontWeight: 600 }}>
                    ≈ {Math.round(dayKcal)} kcal
                  </div>
                )}
              </div>

              {addingTo === day && (
                <div className="planner-day__picker">
                  <input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder={`Rechercher parmi ${pickerCount} recettes…`} style={{ fontSize: 'var(--step--1)', padding: '8px 10px', marginBottom: 4 }} />
                  <div style={{ maxHeight: 170, overflowY: 'auto' }}>
                    {pickerRecipes.map(r => (
                      <button key={r.id} className="pick-item" style={{ width: '100%', textAlign: 'left' }} onClick={() => sportif?.active ? openConfig(day, r) : addMeal(day, r, {})}>
                        {r.emoji || '🍽️'} {r.name}
                      </button>
                    ))}
                    {pickerRecipes.length === 0 && <p style={{ color: 'var(--ink-3)', fontSize: 'var(--step--1)', padding: 4 }}>Aucune recette</p>}
                    {pickerCount > pickerRecipes.length && <p style={{ color: 'var(--ink-3)', fontSize: 'var(--step--1)', padding: 4 }}>Affinez la recherche pour voir plus de résultats…</p>}
                  </div>
                  <button className="btn btn--ghost btn--sm" style={{ width: '100%', marginTop: 4 }} onClick={() => { setAddingTo(null); setSearch(''); }}>Fermer</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Configuration repas (portions + ingrédients + quantités courses) ── */}
      {configuring && (
        <AddToPlanSheet
          recipe={configuring.recipe}
          fixedDay={configuring.day}
          initial={configuring.existing ? configuring.initial : undefined}
          confirmLabel={configuring.existing ? 'Mettre à jour' : 'Ajouter au planning'}
          onConfirm={(opts) => {
            if (configuring.existing) editMeal(configuring.day, configuring.idx, opts, configuring.recipe);
            else addMeal(configuring.day, configuring.recipe, opts);
            setConfiguring(null);
          }}
          onCancel={() => setConfiguring(null)}
          onRemove={configuring.existing ? () => { removePlanMeal(configuring.day, configuring.idx); setConfiguring(null); } : undefined}
          onOpenRecipe={() => { setConfiguring(null); navigate(`/recette/${configuring.recipe.id}`); }}
        />
      )}

      {/* ── Ajout rapide ─────────────────────────────────────────────────── */}
      {quickAdding && (
        <div className="overlay" style={{ zIndex: 340 }} onClick={() => setQuickAdding(false)}>
          <div className="sheet" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div className="sheet__grab" />
            <div className="sheet__head">
              <div className="page-title" style={{ fontSize: 'var(--step-2)' }}>＋ Aliment ponctuel</div>
              <button className="icon-btn" onClick={() => setQuickAdding(false)}>✕</button>
            </div>
            <div className="sheet__body">
              <div className="field">
                <label className="field__label">Aliment</label>
                <input className="input" value={quickForm.name} onChange={e => setQuickForm(f => ({ ...f, name: e.target.value }))} placeholder="ex : 50 g de gruyère, 1 banane…" />
              </div>
              <div className="macro-inputs">
                <div className="field"><label className="field__label">Calories</label><input className="input" type="number" inputMode="decimal" value={quickForm.kcal} onChange={e => setQuickForm(f => ({ ...f, kcal: e.target.value }))} placeholder="0" /></div>
                <div className="field"><label className="field__label">Protéines (g)</label><input className="input" type="number" inputMode="decimal" value={quickForm.protein} onChange={e => setQuickForm(f => ({ ...f, protein: e.target.value }))} placeholder="0" /></div>
                <div className="field"><label className="field__label">Glucides (g)</label><input className="input" type="number" inputMode="decimal" value={quickForm.carbs} onChange={e => setQuickForm(f => ({ ...f, carbs: e.target.value }))} placeholder="0" /></div>
                <div className="field"><label className="field__label">Lipides (g)</label><input className="input" type="number" inputMode="decimal" value={quickForm.fat} onChange={e => setQuickForm(f => ({ ...f, fat: e.target.value }))} placeholder="0" /></div>
              </div>
              {hasApiKey() && (
                <button className="btn btn--ghost btn--sm" disabled={guessBusy} onClick={guessMacros} style={{ marginBottom: 'var(--space-s)' }}>
                  {guessBusy ? '⟳ Devinette…' : '🤖 Deviner les macros'}
                </button>
              )}
              <button className="btn btn--primary btn--block" disabled={!quickForm.name.trim()} onClick={saveQuickAdd}>
                Ajouter au suivi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Liste de courses */}
      {showList && (
        <div className="overlay" style={{ zIndex: 320 }} onClick={() => setShowList(false)}>
          <div className="sheet" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div className="sheet__grab" />
            <div className="sheet__head">
              <div className="page-title" style={{ fontSize: 'var(--step-2)' }}>🛒 Liste de courses</div>
              <button className="icon-btn" onClick={() => setShowList(false)}>✕</button>
            </div>
            <div className="sheet__body">
              {items.length === 0 ? (
                <p style={{ textAlign: 'center', padding: 'var(--space-l)', color: 'var(--ink-3)' }}>
                  Ajoute des repas au planning pour générer ta liste !
                </p>
              ) : (
                <>
                  <p className="eyebrow" style={{ marginBottom: 'var(--space-2xs)' }}>
                    {unchecked.length} article{unchecked.length > 1 ? 's' : ''} restant{unchecked.length > 1 ? 's' : ''}
                  </p>
                  {unchecked.map(item => (
                    <div key={item.name} className="list-item" onClick={() => toggleCheck(item.name.toLowerCase())}>
                      <span className="check" />
                      <span style={{ flex: 1 }}>{item.name}</span>
                      {item.quantities.length > 0 && <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 'var(--step--1)' }}>{item.quantities.join(' + ')}</span>}
                    </div>
                  ))}
                  {checkedItems.length > 0 && (
                    <>
                      <p className="eyebrow" style={{ margin: 'var(--space-s) 0 var(--space-2xs)' }}>✓ Déjà dans le panier</p>
                      {checkedItems.map(item => (
                        <div key={item.name} className="list-item done" onClick={() => toggleCheck(item.name.toLowerCase())}>
                          <span className="check checked">✓</span>
                          <span className="list-item__name" style={{ flex: 1 }}>{item.name}</span>
                        </div>
                      ))}
                    </>
                  )}
                  <button className="btn btn--secondary btn--block" style={{ marginTop: 'var(--space-s)' }} onClick={() => setChecked({})}>
                    Tout réinitialiser
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}