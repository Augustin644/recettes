import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { CAT_LIST, RECIPE_TYPES } from "../../lib/constants";
import AIPanel from "./AIPanel";

export default function RecipeForm({ initial = {}, title = "Nouvelle recette", recipeId, onSave, onClose }) {
  const navigate = useNavigate();
  const [name, setName] = useState(initial.name || '');
  const [cat, setCat] = useState(initial.cat || 'Desserts');
  const [emoji, setEmoji] = useState(initial.emoji || '');
  const [portions, setPortions] = useState(initial.portions || 4);
  const [time, setTime] = useState(initial.time ? String(initial.time) : '');
  const [diff, setDiff] = useState(initial.diff || 2);
  const [notes, setNotes] = useState(initial.notes || '');
  const [visibility, setVisibility] = useState(initial.visibility || 'private');
  const [ings, setIngs] = useState(
    initial.ingredients?.length ? initial.ingredients : [{ qty: '', name: '' }, { qty: '', name: '' }, { qty: '', name: '' }]
  );
  const [steps, setSteps] = useState(
    initial.steps?.length ? initial.steps : [{ text: '', timer: null }, { text: '', timer: null }]
  );
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(initial.photoURL || null);
  const [photoDeleted, setPhotoDeleted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tags, setTags] = useState(Array.isArray(initial.tags) ? initial.tags : []);

  useEffect(() => {
    if (!photoFile) return;
    const url = URL.createObjectURL(photoFile);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  const addIng = () => setIngs(p => [...p, { qty: '', name: '' }]);
  const rmIng = i => setIngs(p => p.filter((_, j) => j !== i));
  const setIng = (i, field, v) => setIngs(p => p.map((x, j) => j === i ? { ...x, [field]: v } : x));
  const addStep = () => setSteps(p => [...p, { text: '', timer: null }]);
  const rmStep = i => setSteps(p => p.filter((_, j) => j !== i));
  const setStepText = (i, v) => setSteps(p => p.map((x, j) => j === i ? { ...x, text: v } : x));
  const setStepTimer = (i, v) => setSteps(p => p.map((x, j) => j === i ? { ...x, timer: v } : x));

  const applyAIResult = (r) => {
    if (r.name) setName(r.name);
    if (r.cat && CAT_LIST.includes(r.cat)) setCat(r.cat); else if (r.cat) setCat('Autre');
    if (r.emoji) setEmoji(r.emoji);
    if (r.portions) setPortions(r.portions);
    setTime(r.time != null ? String(r.time) : '');
    if (r.diff) setDiff(r.diff);
    if (Array.isArray(r.ingredients) && r.ingredients.length) setIngs(r.ingredients.map(i => ({ qty: i.qty || '', name: i.name || '' })));
    if (Array.isArray(r.steps) && r.steps.length) setSteps(r.steps.map(s => ({ text: s.text || '', timer: s.timer ?? null })));
    if (r.notes) setNotes(r.notes);
  };

  const handleSave = async () => {
    if (!name.trim()) { alert('Indiquez le nom de la recette.'); return; }
    setSaving(true);
    try {
      const result = await onSave({
        name: name.trim(), cat, emoji: emoji || '🍽️',
        portions: parseInt(portions) || 4, time: time ? parseInt(time) : null, diff: parseInt(diff),
        tags,
        ingredients: ings.filter(i => i.name.trim()),
        steps: steps.filter(s => s.text.trim()).map(s => ({ text: s.text.trim(), timer: s.timer || null })),
        notes: notes.trim(),
        visibility,
        existingPhotoURL: photoDeleted ? null : (initial.photoURL || null),
      }, photoFile);
      if (onClose) onClose();
      if (!recipeId && result) navigate(`/recette/${result}`);
    } catch (e) {
      alert("Erreur d'enregistrement : " + e.message);
    } finally { setSaving(false); }
  };

  return (
    <div className="app-main" style={{ maxWidth: 620 }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Fiche recette</div>
          <h1 className="page-title">{title}</h1>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Fermer">✕</button>
      </div>

      <AIPanel onResult={applyAIResult} onUsePhotoAsIllustration={setPhotoFile} />

      {/* Illustration */}
      <div className="field">
        <label className="field__label">Illustration</label>
        {photoPreview ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-s)' }}>
            <img src={photoPreview} alt="" style={{ width: 68, height: 68, objectFit: 'cover', borderRadius: 'var(--radius)', border: '2px solid var(--line)' }} />
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => { setPhotoFile(null); setPhotoPreview(null); setPhotoDeleted(true); }}>
              Supprimer l'image
            </button>
          </div>
        ) : (
          <input type="file" accept="image/*" onChange={e => setPhotoFile(e.target.files[0] || null)} style={{ fontSize: 'var(--step--1)' }} />
        )}
      </div>

      {/* Nom */}
      <div className="field">
        <label className="field__label">Nom de la création</label>
        <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Ex : Risotto crémeux aux morilles" />
      </div>

      <div className="form-grid-2">
        <div className="field">
          <label className="field__label">Catégorie</label>
          <select className="select" value={cat} onChange={e => setCat(e.target.value)}>
            {CAT_LIST.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="field__label">Glyphe / Emoji</label>
          <input className="input" value={emoji} onChange={e => setEmoji(e.target.value)} placeholder="🍽️" maxLength={2} />
        </div>
      </div>

      <div className="form-grid-3">
        <div className="field">
          <label className="field__label">Portions</label>
          <input className="input" type="number" value={portions} onChange={e => setPortions(e.target.value)} min={1} />
        </div>
        <div className="field">
          <label className="field__label">Minutes</label>
          <input className="input" type="number" value={time} onChange={e => setTime(e.target.value)} placeholder="45" />
        </div>
        <div className="field">
          <label className="field__label">Difficulté</label>
          <select className="select" value={diff} onChange={e => setDiff(e.target.value)}>
            <option value={1}>Facile</option>
            <option value={2}>Intermédiaire</option>
            <option value={3}>Difficile</option>
          </select>
        </div>
      </div>

      {/* Type */}
      <div className="field">
        <label className="field__label">Type de recette</label>
        <div className="tag-chips">
          {RECIPE_TYPES.map(t => (
            <button type="button" key={t} className={`type-chip ${tags.includes(t) ? 'active' : ''}`} onClick={() => setTags(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t])}>
              {t}
            </button>
          ))}
        </div>
        <p className="field__hint">Ces étiquettes orientent le fil Découvrir (healthy, végé, sucré…).</p>
      </div>

      {/* Ingrédients */}
      <div className="field">
        <label className="field__label">Ingrédients requis</label>
        {ings.map((ing, i) => (
          <div key={i} className="dyn-row">
            <input className="input dyn-row__qty" value={ing.qty} onChange={e => setIng(i, 'qty', e.target.value)} placeholder="Qté (ex: 200g)" />
            <input className="input dyn-row__main" value={ing.name} onChange={e => setIng(i, 'name', e.target.value)} placeholder="Ingrédient" />
            <button className="remove-row-btn" onClick={() => rmIng(i)} aria-label="Retirer">−</button>
          </div>
        ))}
        <button className="dashed-add" onClick={addIng}>+ Ajouter un ingrédient</button>
      </div>

      {/* Étapes */}
      <div className="field">
        <label className="field__label">Étapes de réalisation</label>
        {steps.map((s, i) => (
          <div key={i} style={{ marginBottom: 'var(--space-2xs)' }}>
            <div className="dyn-row" style={{ alignItems: 'flex-start' }}>
              <div className="step-counter" style={{ marginTop: 12 }}>{i + 1}</div>
              <textarea className="textarea dyn-row__main" style={{ minHeight: 62 }}
                value={s.text} onChange={e => setStepText(i, e.target.value)}
                placeholder={`Instructions détaillées de l'étape ${i + 1}…`} />
              <button className="remove-row-btn" style={{ marginTop: 8 }} onClick={() => rmStep(i)} aria-label="Retirer">−</button>
            </div>
            <input className="input" style={{ marginTop: 4 }} value={s.timer || ''}
              onChange={e => setStepTimer(i, e.target.value ? parseInt(e.target.value) : null)}
              placeholder="Minuteur (secondes) — ex : 600 pour 10 min — laisser vide si rien" />
          </div>
        ))}
        <button className="dashed-add" onClick={addStep}>+ Insérer une étape intermédiaire</button>
      </div>

      {/* Notes */}
      <div className="field">
        <label className="field__label">Notes & Variations éditoriales</label>
        <textarea className="textarea" style={{ minHeight: 80 }} value={notes} onChange={e => setNotes(e.target.value)}
          placeholder="Astuces de cuisson, associations de vins, options de conservation…" />
      </div>

      {/* Visibilité */}
      <div className="field">
        <label className="field__label">Visibilité</label>
        <div className="segmented">
          <button type="button" className={`segmented__btn ${visibility === 'private' ? 'active' : ''}`} onClick={() => setVisibility('private')}>🔒 Privée</button>
          <button type="button" className={`segmented__btn ${visibility === 'public' ? 'active' : ''}`} onClick={() => setVisibility('public')}>🌐 Publique</button>
        </div>
        <p className="field__hint">Une recette publique apparaît dans le fil Découvrir de la communauté.</p>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-xs)', justifyContent: 'flex-end' }}>
        <button className="btn btn--secondary" onClick={onClose}>Annuler</button>
        <button className="btn btn--primary" disabled={saving} onClick={handleSave}>
          {saving ? '⟳ Enregistrement…' : 'Enregistrer la fiche'}
        </button>
      </div>
    </div>
  );
}