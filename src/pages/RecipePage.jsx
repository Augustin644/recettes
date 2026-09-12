import { useState, useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { doc, getDoc, collection, addDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useApp } from "../context/AppContext";
import { formatTime } from "../lib/constants";
import { exportRecipeToPDF } from "../lib/utils";
import { enrichRecipeNutrition, hasApiKey } from "../lib/ai";
import { healthTone, buildNutrition, macroForMeal } from "../lib/nutrition";
import RecipeForm from "../components/recipe/RecipeForm";
import AddToPlanSheet from "../components/planning/AddToPlanSheet";
import DiffDots from "../components/ui/DiffDots";
import EmptyState from "../components/ui/EmptyState";
import { conversationId } from "../lib/utils";

export default function RecipePage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const {
    myRecipes, publicRecipes, user, favIds, toggleFavorite, addToProfile,
    timerCtx, updateRecipe, deleteRecipe, addToast, myFollows,
    saveEnrichedNutrition, clearNutrition, createHealthyVariant, addMealToPlan,
  } = useApp();

  const [recipe, setRecipe] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [mult, setMult] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [editing, setEditing] = useState(params.get('edit') === '1');
  const [showShare, setShowShare] = useState(false);
  const [sharingTo, setSharingTo] = useState(null);
  const [showPlanSheet, setShowPlanSheet] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [showNutriManual, setShowNutriManual] = useState(false);
  const [nutriForm, setNutriForm] = useState({ kcal: '', protein: '', carbs: '', fat: '' });

  const allKnown = [...myRecipes, ...publicRecipes];

  useEffect(() => {
    const known = allKnown.find(r => r.id === id);
    if (known) { setRecipe(known); return; }
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'recipes', id));
        if (snap.exists()) setRecipe({ id: snap.id, ...snap.data() });
        else setNotFound(true);
      } catch { setNotFound(true); }
    })();
  }, [id, allKnown]);

  const isOwner = recipe?.ownerId === user?.uid;
  const isFav = recipe ? favIds.includes(recipe.id) : false;
  const portions = recipe ? Math.round((recipe.portions || 1) * mult) : 0;
  const n = recipe?.nutrition || null;

  const changeMult = d => {
    if (!recipe) return;
    const np = recipe.portions * mult + d;
    if (np < 1) return;
    setMult(np / recipe.portions);
  };

  const fmtQty = qty => {
    if (typeof qty !== 'string') return qty;
    if (mult === 1) return qty;
    const num = parseFloat(qty);
    if (isNaN(num)) return qty;
    return qty.replace(/[\d.]+/, v => Math.round(parseFloat(v) * mult * 10) / 10);
  };

  const handleExport = async () => {
    setExporting(true);
    try { await exportRecipeToPDF(recipe); }
    catch (e) { alert("Erreur lors de la génération PDF : " + e.message); }
    finally { setExporting(false); }
  };

  const report = async () => {
    if (!window.confirm("Signaler cette recette à la modération ?")) return;
    try {
      await addDoc(collection(db, 'reports'), {
        recipeId: recipe.id, recipeName: recipe.name,
        recipeOwnerId: recipe.ownerId,
        reporterId: user.uid, createdAt: serverTimestamp(), status: 'open',
      });
      addToast('Merci, nous allons examiner ce signalement', 'success');
      setShowShare(false);
    } catch { addToast('Échec du signalement', 'error'); }
  };

  const shareByMessage = async (target) => {
    setSharingTo(target.uid);
    const cid = conversationId(user.uid, target.uid);
    const payload = {
      senderId: user.uid, text: '', recipeShare: { id: recipe.id, name: recipe.name, emoji: recipe.emoji, photoURL: recipe.photoURL || null },
      createdAt: serverTimestamp(),
    };
    try {
      await setDoc(doc(db, 'conversations', cid), {
        participants: [user.uid, target.uid],
        participantNames: { [user.uid]: user.displayName, [target.uid]: target.name },
        updatedAt: serverTimestamp(),
        lastMessage: { senderId: user.uid, text: '', recipeShare: payload.recipeShare },
      }, { merge: true });
      await addDoc(collection(db, 'conversations', cid, 'messages'), payload);
      addToast(`Recette envoyée à ${target.name}`, 'success');
      setShowShare(false);
    } catch { addToast("Échec de l'envoi", 'error'); }
    finally { setSharingTo(null); }
  };

  const allNames = Object.fromEntries(allKnown.map(r => [r.ownerId, r.ownerName]));
  const resolvedTargets = (myFollows.filter(f => f.status === 'accepted') || []).reduce((acc, f) => {
    if (!acc.seen.has(f.followingId)) { acc.seen.add(f.followingId); acc.out.push({ uid: f.followingId, name: allNames[f.followingId] || 'Membre' }); }
    return acc;
  }, { seen: new Set(), out: [] }).out;

  /* ── Enrichissement ────────────────────────────────────────────────── */
  const doEnrich = async () => {
    setEnriching(true);
    try {
      const raw = await enrichRecipeNutrition(recipe);
      const built = buildNutrition(raw, recipe.portions || 4);
      await saveEnrichedNutrition(recipe.id, built);
      setRecipe(r => ({ ...r, nutrition: built }));
    } catch (e) {
      addToast(e.message, 'error');
    } finally { setEnriching(false); }
  };

  const doManualNutri = async () => {
    const k = parseFloat(nutriForm.kcal) || 0;
    const p = parseFloat(nutriForm.protein) || 0;
    const c = parseFloat(nutriForm.carbs) || 0;
    const f = parseFloat(nutriForm.fat) || 0;
    const built = {
      source: 'manual',
      ingredients: null,
      perServing: { kcal: k, protein: p, carbs: c, fat: f },
      per100g: null,
      healthScore: null,
      healthNote: '',
      adaptations: [],
    };
    await saveEnrichedNutrition(recipe.id, built);
    setRecipe(r => ({ ...r, nutrition: built }));
    setShowNutriManual(false);
  };

  const doClearNutri = async () => {
    if (!window.confirm('Supprimer les données nutritionnelles ?')) return;
    await clearNutrition(recipe.id);
    setRecipe(r => ({ ...r, nutrition: null }));
  };

  const doCreateVariant = async (adaptation) => {
    const newId = await createHealthyVariant(recipe, [adaptation]);
    if (newId) navigate(`/recette/${newId}`);
  };

  const doCreateFullVariant = async () => {
    if (!n?.adaptations?.length) return;
    const newId = await createHealthyVariant(recipe, n.adaptations);
    if (newId) navigate(`/recette/${newId}`);
  };

  if (notFound) {
    return (
      <div className="app-main">
        <EmptyState emoji="🍽️" title="Recette introuvable" text="Elle a peut-être été supprimée par son auteur.">
          <button className="btn btn--primary" onClick={() => navigate('/decouvrir')}>Retour au fil</button>
        </EmptyState>
      </div>
    );
  }

  if (!recipe) {
    return <div className="app-main"><EmptyState emoji="⟳" title="Chargement de la fiche…" /></div>;
  }

  if (editing) {
    return (
      <RecipeForm
        title="Modifier les données de la fiche"
        initial={recipe}
        recipeId={recipe.id}
        onSave={(data) => updateRecipe(recipe.id, data)}
        onClose={() => { setEditing(false); navigate(`/recette/${recipe.id}`, { replace: true }); }}
      />
    );
  }

  const handleDelete = async () => {
    const ok = await deleteRecipe(recipe.id);
    if (ok) navigate('/atelier');
  };

  const tone = n?.healthScore != null ? healthTone(n.healthScore) : null;

  return (
    <div className="app-main" style={{ maxWidth: 680 }}>
      <button className="icon-btn icon-btn--ghost" style={{ marginBottom: 'var(--space-xs)' }} onClick={() => navigate(-1)} aria-label="Retour">← Retour</button>

      {/* Hero */}
      <div className="recipe-hero">
        {recipe.photoURL ? (
          <img src={recipe.photoURL} alt={recipe.name} />
        ) : (
          <div className="recipe-hero__emoji" style={{ paddingTop: 'var(--space-l)' }}>{recipe.emoji || '🍽️'}</div>
        )}
        {recipe.photoURL && <div className="recipe-hero__scrim" />}
        <div className="recipe-hero__content">
          <div className="recipe-hero__cat">{recipe.cat}</div>
          <h1 className="recipe-hero__name">{recipe.name}</h1>
          <div className="recipe-hero__meta">
            {recipe.time != null && <span className="meta-pill">⏱ {formatTime(recipe.time)}</span>}
            <span className="meta-pill">{recipe.portions} pers.</span>
            <span className="meta-pill"><DiffDots diff={recipe.diff} /></span>
            {recipe.visibility !== 'public' && <span className="meta-pill">🔒 Privée</span>}
          </div>
          {recipe.ownerName && (
            <p style={{ fontSize: 'var(--step--1)', marginTop: 10, opacity: 0.92 }}>
              Rédigé par <strong style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => navigate(`/membre/${recipe.ownerId}`)}>{recipe.ownerName}</strong>
              {recipe.copiedFrom?.ownerName && <span style={{ opacity: 0.75 }}> · Importé du carnet de {recipe.copiedFrom.ownerName}</span>}
            </p>
          )}
        </div>
      </div>

      {/* Barre d'actions */}
      <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap', marginTop: 'var(--space-s)' }}>
        <button className={`btn ${isFav ? '' : 'btn--secondary'}`} onClick={() => toggleFavorite(recipe.id)}>
          {isFav ? '❤️ Retiré des favoris' : '🤍 Favori'}
        </button>
        {!isOwner && <button className="btn btn--secondary" onClick={() => addToProfile(recipe)}>＋ Ajouter au carnet</button>}
        <button className="btn btn--secondary" onClick={() => setShowShare(true)}>📤 Partager</button>
        <button className="btn btn--primary" onClick={() => setShowPlanSheet(true)}>📅 Planning</button>
        <button className="btn btn--secondary" disabled={exporting} onClick={handleExport}>{exporting ? '⟳ PDF…' : '📄 Exporter PDF'}</button>
        {isOwner && (
          <>
            <button className="btn btn--secondary" onClick={() => { setEditing(true); navigate(`/recette/${recipe.id}?edit=1`, { replace: true }); }}>✏️ Éditer</button>
            <button className="btn btn--danger" onClick={handleDelete}>🗑</button>
          </>
        )}
      </div>

      {/* ── Nutrition card ─────────────────────────────────────────────── */}
      <div className="nutrition-card" style={{ marginTop: 'var(--space-l)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-xs)' }}>
          <div className="section-title" style={{ margin: 0 }}>Valeurs nutritionnelles</div>
          {isOwner && (
            <div style={{ display: 'flex', gap: 'var(--space-2xs)' }}>
              {!n && <button className="btn btn--primary btn--sm" disabled={enriching} onClick={doEnrich}>{enriching ? '⟳ IA…' : '⚡ Enrichir (IA)'}</button>}
              {n && n.source !== 'manual' && <button className="btn btn--ghost btn--sm" onClick={doClearNutri} title="Retirer l'enrichissement">🗑</button>}
            </div>
          )}
        </div>

        {!n ? (
          <div className="sportif-cta" style={{ padding: 'var(--space-s)' }}>
            <span>
              {isOwner
                ? (hasApiKey() ? 'Enrichissez cette fiche pour calculer les macros et le score santé.' : 'Ajoutez les valeurs nutritionnelles manuellement pour activer le suivi.')
                : "Cette fiche n'a pas encore de valeurs nutritionnelles."}
            </span>
            {isOwner && (
              <button className="btn btn--secondary btn--sm" onClick={() => hasApiKey() ? doEnrich() : setShowNutriManual(true)}>
                {hasApiKey() ? '⚡ Enrichir (IA)' : '✎ Saisie manuelle'}
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Macros per serving */}
            <div className="macro-chips" style={{ marginTop: 'var(--space-s)', flexWrap: 'wrap', gap: 'var(--space-2xs)' }}>
              <span className="macro-chip" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', fontWeight: 800, fontSize: 'var(--step-1)' }}>
                🔥 {n.perServing.kcal} kcal
              </span>
              <span className="macro-chip" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>
                🟣 Protéines {n.perServing.protein} g
              </span>
              <span className="macro-chip" style={{ background: 'var(--info-soft)', color: 'var(--info)' }}>
                🔵 Glucides {n.perServing.carbs} g
              </span>
              <span className="macro-chip" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>
                🟡 Lipides {n.perServing.fat} g
              </span>
            </div>
            <p style={{ fontSize: 'var(--step--1)', color: 'var(--ink-3)', marginTop: 'var(--space-2xs)' }}>
              Par portion de {recipe.portions} ·{' '}
              {n.per100g && `100 g : ${n.per100g.kcal} kcal · P${n.per100g.protein} · G${n.per100g.carbs} · L${n.per100g.fat} · `}
              {n.source === 'ai' ? 'Estimé par IA' : 'Saisi manuellement'}
            </p>

            {/* Health score ring */}
            {tone && (
              <div className="nutri-score">
                <div className="nutri-score__ring" style={{ color: tone.color }}>
                  <svg viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--line)" strokeWidth="2" />
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke={tone.color} strokeWidth="2.4"
                      strokeDasharray={`${n.healthScore} ${100 - n.healthScore}`} strokeLinecap="round"
                      style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }} />
                  </svg>
                  <span className="nutri-score__val" style={{ color: tone.color }}>{n.healthScore}</span>
                </div>
                <div>
                  <div className="nutri-score__label">{tone.label}</div>
                  {n.healthNote && <p className="nutri-score__note">{n.healthNote}</p>}
                </div>
              </div>
            )}

            {/* Adaptations */}
            {Array.isArray(n.adaptations) && n.adaptations.length > 0 && (
              <div className="adaptations" style={{ marginTop: 'var(--space-s)' }}>
                <div className="eyebrow">Adaptations saines proposées</div>
                {n.adaptations.map((a, i) => (
                  <div key={i} className="adapt-row">
                    <span className="adapt-row__arrow">❌</span>
                    <span className="adapt-row__from">{a.from}</span>
                    <span className="adapt-row__arrow">→</span>
                    <span className="adapt-row__to">{a.to}</span>
                    {a.reason && <span className="adapt-row__reason">{a.reason}</span>}
                    {isOwner && (
                      <button className="btn btn--ghost btn--sm" style={{ marginLeft: 'auto' }} onClick={() => doCreateVariant(a)} title="Créer la variante">
                        ＋
                      </button>
                    )}
                  </div>
                ))}
                {isOwner && (
                  <button className="btn btn--secondary btn--sm" style={{ marginTop: 'var(--space-xs)' }} onClick={doCreateFullVariant}>
                    🥗 Créer la variante saine complète
                  </button>
                )}
              </div>
            )}
            {isOwner && (
              <button className="btn btn--ghost btn--sm" style={{ marginTop: 'var(--space-s)' }} onClick={() => { setNutriForm({ kcal: n.perServing.kcal || '', protein: n.perServing.protein || '', carbs: n.perServing.carbs || '', fat: n.perServing.fat || '' }); setShowNutriManual(true); }}>
                ✎ Modifier les macros
              </button>
            )}
          </>
        )}
      </div>

      {/* ── Saisie manuelle ─────────────────────────────────────────────── */}
      {showNutriManual && (
        <div className="overlay" style={{ zIndex: 340 }} onClick={() => setShowNutriManual(false)}>
          <div className="sheet" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="sheet__grab" />
            <div className="sheet__head">
              <div className="page-title" style={{ fontSize: 'var(--step-2)' }}>📊 Macros / portion</div>
              <button className="icon-btn" onClick={() => setShowNutriManual(false)}>✕</button>
            </div>
            <div className="sheet__body">
              <div className="macro-inputs">
                <div className="field"><label className="field__label">Calories (kcal)</label><input className="input" type="number" inputMode="decimal" value={nutriForm.kcal} onChange={e => setNutriForm(f => ({ ...f, kcal: e.target.value }))} /></div>
                <div className="field"><label className="field__label">Protéines (g)</label><input className="input" type="number" inputMode="decimal" value={nutriForm.protein} onChange={e => setNutriForm(f => ({ ...f, protein: e.target.value }))} /></div>
                <div className="field"><label className="field__label">Glucides (g)</label><input className="input" type="number" inputMode="decimal" value={nutriForm.carbs} onChange={e => setNutriForm(f => ({ ...f, carbs: e.target.value }))} /></div>
                <div className="field"><label className="field__label">Lipides (g)</label><input className="input" type="number" inputMode="decimal" value={nutriForm.fat} onChange={e => setNutriForm(f => ({ ...f, fat: e.target.value }))} /></div>
              </div>
              <button className="btn btn--primary btn--block" onClick={doManualNutri}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}

      {/* Proportion */}
      <div className="portions-stepper" style={{ marginTop: 'var(--space-m)' }}>
        <span style={{ color: 'var(--ink-2)', fontSize: 'var(--step--1)', flex: 1, fontWeight: 500 }}>Proportions</span>
        <button className="stepper-btn" onClick={() => changeMult(-1)}>−</button>
        <span className="stepper-value">{portions}</span>
        <button className="stepper-btn" onClick={() => changeMult(1)}>+</button>
      </div>

      {/* Ingrédients */}
      <div className="recipe-body">
        <div className="section-title">Ingrédients</div>
        <div className="recipe-bloc">
          <div className="recipe-bloc__body">
            {(recipe.ingredients || []).map((ing, i) => (
              <div className="ing-row" key={i}>
                <span className="ing-row__name">{ing.name}</span>
                <span className="ing-row__qty">{fmtQty(ing.qty)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Étapes */}
        <div className="section-title">Préparation</div>
        {(recipe.steps || []).map((s, i) => (
          <div className="step-card" key={i}>
            <div className="step-card__counter">{i + 1}</div>
            <div style={{ flex: 1 }}>
              <p className="step-card__text">{s.text}</p>
              {s.timer && (
                <button className="timer-trigger" onClick={() => timerCtx.start(s.timer, `Étape ${i + 1} — ${recipe.name}`)}>
                  ⏱ Lancer le minuteur ({Math.floor(s.timer / 60)}m {String(s.timer % 60).padStart(2, '0')}s)
                </button>
              )}
            </div>
          </div>
        ))}

        {/* Notes */}
        {recipe.notes && (
          <>
            <div className="section-title">Notes de l'auteur</div>
            <div className="notes-bloc">{recipe.notes}</div>
          </>
        )}
      </div>

      {/* ── Ajout au planning ─────────────────────────────────────────────── */}
      {showPlanSheet && (
        <AddToPlanSheet
          recipe={recipe}
          onCancel={() => setShowPlanSheet(false)}
          onConfirm={async (opts) => {
            const meal = {
              recipeId: recipe.id,
              name: recipe.name,
              ingredients: recipe.ingredients || [],
              portions: opts.portions,
              omittedIngredients: opts.omittedIngredients,
              qtyOverrides: opts.qtyOverrides,
              macros: macroForMeal(recipe, opts),
            };
            setShowPlanSheet(false);
            await addMealToPlan(opts.day, meal);
          }}
        />
      )}

      {/* Share sheet */}
      {showShare && (
        <div className="overlay" style={{ zIndex: 320 }} onClick={() => setShowShare(false)}>
          <div className="sheet" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div className="sheet__grab" />
            <div className="sheet__head">
              <div className="page-title" style={{ fontSize: 'var(--step-2)' }}>Partager la recette</div>
              <button className="icon-btn" onClick={() => setShowShare(false)}>✕</button>
            </div>
            <div className="sheet__body">
              <div className="eyebrow" style={{ marginBottom: 'var(--space-2xs)' }}>Envoyer à un membre</div>
              {resolvedTargets.length === 0 && (
                <p style={{ color: 'var(--ink-3)', fontSize: 'var(--step--1)', marginBottom: 'var(--space-s)' }}>
                  Suivez des membres pour pouvoir leur partager une recette.
                </p>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {resolvedTargets.map(t => (
                  <button key={t.uid} className="pick-item" style={{ display: 'flex', gap: 'var(--space-xs)', alignItems: 'center', width: '100%', textAlign: 'left' }}
                    disabled={sharingTo === t.uid} onClick={() => shareByMessage(t)}>
                    <span style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--accent)', color: 'var(--on-accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 'var(--step--1)' }}>
                      {t.name[0]?.toUpperCase()}
                    </span>
                    <span style={{ fontWeight: 600 }}>{t.name}</span>
                    {sharingTo === t.uid && <span style={{ marginLeft: 'auto' }}>⟳</span>}
                  </button>
                ))}
              </div>

              <div className="eyebrow" style={{ margin: 'var(--space-s) 0 var(--space-2xs)' }}>Autres options</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-xs)' }}>
                <button className="btn btn--secondary" onClick={async () => {
                  try { await navigator.clipboard.writeText(window.location.href); addToast('Lien copié', 'success'); }
                  catch { addToast('Copie impossible', 'error'); }
                }}>🔗 Copier le lien</button>
                <button className="btn btn--secondary" onClick={handleExport}>{exporting ? '⟳…' : '📄 Export PDF'}</button>
              </div>

              <button className="btn btn--ghost btn--block" style={{ marginTop: 'var(--space-s)' }} onClick={report}>
                ⚠️ Signaler à la modération
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}