import { useState, useEffect, useCallback, useRef } from "react";
import {
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, where, serverTimestamp,
  getDoc, getDocs, addDoc, increment, limit, writeBatch,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { db, storage, subscribeAuth, registerUser, loginUser, logoutUser } from "./firebase";
import {
  getApiKey, setApiKey, hasApiKey,
  extractRecipeFromText, extractRecipeFromImage, generateRecipe, fileToBase64,
} from "./ai";

// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const CATEGORIES = ["Toutes","Entrées","Plats","Desserts","Boulangerie","Boissons","Sauces & Condiments","Autre"];
const DIFF_LABELS = ["","⬤○○ Facile","⬤⬤○ Intermédiaire","⬤⬤⬤ Difficile"];

// Une pastille de couleur stable par catégorie, pour l'onglet "carnet" des fiches
// (signature visuelle : chaque fiche porte la couleur de son rayon, comme un
// classeur à onglets — la couleur encode l'information, elle ne décore pas).
const CAT_TAB_COLORS = {
  "Entrées": "#3DA5D9", "Plats": "#FF5A36", "Desserts": "#C9518B",
  "Boulangerie": "#C98A2C", "Boissons": "#33A16B", "Sauces & Condiments": "#7C6AE8",
  "Autre": "#6E6E73",
};
const catColor = (c) => CAT_TAB_COLORS[c] || "#6E6E73";

// ── SOCIAL HELPERS (profils, abonnements, messagerie) ────────────────────────
// Assure l'existence d'un document users/{uid} à chaque connexion, sans
// dépendre de ce que fait firebase.js en interne.
async function ensureUserDoc(user) {
  if (!user) return;
  const ref_ = doc(db, 'users', user.uid);
  const snap = await getDoc(ref_);
  if (!snap.exists()) {
    await setDoc(ref_, {
      displayName: user.displayName || 'Utilisateur',
      displayNameLower: (user.displayName || '').toLowerCase(),
      isPrivate: false,
      followersCount: 0,
      followingCount: 0,
      createdAt: serverTimestamp(),
    });
  } else if (snap.data().displayNameLower === undefined) {
    await setDoc(ref_, { displayNameLower: (user.displayName || '').toLowerCase() }, { merge: true });
  }
}

const followDocId = (followerId, followingId) => `${followerId}__${followingId}`;
const conversationId = (a, b) => [a, b].sort().join('__');

// Applique en masse le nouveau statut de confidentialité sur toutes les
// recettes déjà publiées par l'utilisateur (dénormalisation pour filtrer
// le flux "Découvrir" sans multiplier les lectures).
async function propagatePrivacyToRecipes(uid, isPrivate) {
  const snap = await getDocs(query(collection(db, 'recipes'), where('ownerId', '==', uid)));
  const batch = writeBatch(db);
  snap.docs.forEach(d => batch.update(d.ref, { ownerIsPrivate: isPrivate }));
  await batch.commit();
}


// ── THEME (clair / sombre, palette unique) ──────────────────────────────────
function useDarkMode() {
  const [dark, setDark] = useState(() => {
    try {
      const saved = localStorage.getItem("carnet_theme");
      if (saved) return saved === "dark";
    } catch {}
    return typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false;
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    try { localStorage.setItem("carnet_theme", dark ? "dark" : "light"); } catch {}
  }, [dark]);
  return [dark, setDark];
}

function ThemeToggleBtn({ dark, onToggle, style }) {
  return (
    <button onClick={onToggle} className="theme-toggle-btn" style={style} title={dark ? "Passer au mode clair" : "Passer au mode sombre"} aria-label="Changer de thème">
      {dark ? '☀️' : '🌙'}
    </button>
  );
}

// ── PDF EXPORT ────────────────────────────────────────────────────────────────
async function loadImageAsBase64(url) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

async function exportRecipeToPDF(recipe) {
  const { jsPDF } = await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm");
  const docPdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = docPdf.internal.pageSize.getWidth();
  const margin = 48;
  let y = margin;

  const INK = [29, 29, 31];
  const MUTED = [110, 110, 115];
  const SIGNAL = [255, 90, 54];
  const MIST = [245, 245, 247];

  // Bandeau supérieur
  docPdf.setFillColor(...SIGNAL);
  docPdf.rect(0, 0, pageW, 8, 'F');
  y += 20;

  if (recipe.photoURL) {
    const b64 = await loadImageAsBase64(recipe.photoURL);
    if (b64) {
      try {
        const imgW = pageW - margin * 2;
        const imgH = imgW * 0.55;
        docPdf.addImage(b64, 'JPEG', margin, y, imgW, imgH, undefined, 'FAST');
        y += imgH + 20;
      } catch {}
    }
  }

  docPdf.setFont('helvetica', 'bold');
  docPdf.setFontSize(24);
  docPdf.setTextColor(...INK);
  docPdf.text(`${recipe.emoji || '🍽️'}  ${recipe.name}`, margin, y);
  y += 22;

  docPdf.setFont('helvetica', 'normal');
  docPdf.setFontSize(10.5);
  docPdf.setTextColor(...MUTED);
  const metaLine = [
    recipe.cat,
    `${recipe.portions || 4} portions`,
    recipe.time ? `${recipe.time} min` : null,
    DIFF_LABELS[recipe.diff] ? DIFF_LABELS[recipe.diff].replace(/⬤|○/g, '').trim() : null,
  ].filter(Boolean).join('   ·   ');
  docPdf.text(metaLine, margin, y);
  y += 24;

  docPdf.setDrawColor(...MIST);
  docPdf.setLineWidth(1);
  docPdf.line(margin, y, pageW - margin, y);
  y += 22;

  docPdf.setFont('helvetica', 'bold');
  docPdf.setFontSize(13);
  docPdf.setTextColor(...INK);
  docPdf.text('Ingrédients', margin, y);
  y += 18;

  docPdf.setFont('helvetica', 'normal');
  docPdf.setFontSize(10.5);
  (recipe.ingredients || []).forEach(ing => {
    if (y > 760) { docPdf.addPage(); y = margin; }
    docPdf.setTextColor(...SIGNAL);
    docPdf.circle(margin + 2, y - 3, 1.6, 'F');
    docPdf.setTextColor(...INK);
    docPdf.text(`${ing.qty ? ing.qty + '  ' : ''}${ing.name}`, margin + 12, y);
    y += 16;
  });
  y += 14;

  docPdf.setFont('helvetica', 'bold');
  docPdf.setFontSize(13);
  docPdf.setTextColor(...INK);
  docPdf.text('Préparation', margin, y);
  y += 18;

  docPdf.setFont('helvetica', 'normal');
  docPdf.setFontSize(10.5);
  (recipe.steps || []).forEach((s, i) => {
    const lines = docPdf.splitTextToSize(s.text, pageW - margin * 2 - 24);
    if (y + lines.length * 14 > 780) { docPdf.addPage(); y = margin; }
    docPdf.setFont('helvetica', 'bold');
    docPdf.setTextColor(...SIGNAL);
    docPdf.text(String(i + 1), margin, y);
    docPdf.setFont('helvetica', 'normal');
    docPdf.setTextColor(...INK);
    docPdf.text(lines, margin + 18, y);
    y += lines.length * 14 + 8;
  });

  if (recipe.notes) {
    y += 10;
    if (y > 740) { docPdf.addPage(); y = margin; }
    docPdf.setFont('helvetica', 'bold');
    docPdf.setFontSize(13);
    docPdf.setTextColor(...INK);
    docPdf.text("Notes de l'auteur", margin, y);
    y += 18;
    docPdf.setFont('helvetica', 'italic');
    docPdf.setFontSize(10.5);
    docPdf.setTextColor(...MUTED);
    const noteLines = docPdf.splitTextToSize(recipe.notes, pageW - margin * 2);
    docPdf.text(noteLines, margin, y);
  }

  docPdf.save(`${recipe.name.replace(/[^a-z0-9]+/gi, '_')}.pdf`);
}

// ── TIMER HOOK ────────────────────────────────────────────────────────────────
function useTimer() {
  const [timer, setTimer] = useState(null); // { total, remaining, label, paused, done }
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!timer || timer.paused || timer.done) return;
    intervalRef.current = setInterval(() => {
      setTimer(t => {
        if (!t) return t;
        if (t.remaining <= 1) {
          try { new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=').play().catch(()=>{}); } catch {}
          return { ...t, remaining: 0, done: true };
        }
        return { ...t, remaining: t.remaining - 1 };
      });
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, [timer?.paused, timer?.done, !!timer]);

  const start = useCallback((seconds, label) => {
    setTimer({ total: seconds, remaining: seconds, label, paused: false, done: false });
  }, []);
  const toggle = useCallback(() => setTimer(t => t ? { ...t, paused: !t.paused } : t), []);
  const cancel = useCallback(() => setTimer(null), []);
  const fmt = (s) => `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;

  return { timer, start, toggle, cancel, fmt };
}

// ── TOAST ─────────────────────────────────────────────────────────────────────
function Toast({ toasts }) {
  return (
    <div className="toast-stack">
      {toasts.map(t => (
        <div key={t.id} className={`toast-pill toast-${t.type}`}>
          <span className="toast-dot" />
          {t.msg}
        </div>
      ))}
    </div>
  );
}

// ── DIFFICULTY DOTS ───────────────────────────────────────────────────────────
function DiffDots({ diff }) {
  return (
    <span className="diff-dots" title={DIFF_LABELS[diff]}>
      {[1,2,3].map(i => <span key={i} className={`diff-dot ${i<=diff?'on':''}`} />)}
    </span>
  );
}

// ── RECIPE CARD ───────────────────────────────────────────────────────────────
function RecipeCard({ recipe, onOpen, onDelete, onAddToProfile, isOwner, isFav, onToggleFav }) {
  return (
    <div className="recipe-card" onClick={() => onOpen(recipe.id)}>
      <span className="card-tab" style={{ background: catColor(recipe.cat) }} />
      <div className="card-thumb">
        {recipe.photoURL ? <img src={recipe.photoURL} alt="" /> : <span>{recipe.emoji || '🍽️'}</span>}
      </div>
      <div className="card-body-ios">
        <div className="card-title">{recipe.name}</div>
        <div className="card-subtitle-ios">
          <span className="card-cat-tag" style={{ color: catColor(recipe.cat) }}>{recipe.cat}</span>
          {recipe.time && <span>· {recipe.time} min</span>}
          <DiffDots diff={recipe.diff} />
        </div>
      </div>
      <div className="card-actions-container" onClick={e => e.stopPropagation()}>
        <button onClick={() => onToggleFav(recipe.id)} className="card-action-inline-btn fav-btn" title="Favori">
          {isFav ? '❤️' : '🤍'}
        </button>
        {isOwner ? (
          <button onClick={() => onDelete(recipe.id)} className="card-action-inline-btn delete-btn" title="Supprimer">✕</button>
        ) : (
          <button onClick={() => onAddToProfile(recipe)} className="add-btn" title="Ajouter au carnet">＋</button>
        )}
      </div>
    </div>
  );
}

// ── AI PANEL ──────────────────────────────────────────────────────────────────
function AIPanel({ onResult, onUsePhotoAsIllustration, onNeedApiKey }) {
  const [mode, setMode] = useState('text'); // 'text' | 'photo' | 'idea'
  const [text, setText] = useState('');
  const [photoFile, setPhotoFile] = useState(null);
  const [useAsIllustration, setUseAsIllustration] = useState(true);
  const [idea, setIdea] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const run = async (fn) => {
    if (!hasApiKey()) { onNeedApiKey(); return; }
    setLoading(true); setError('');
    try {
      const result = await fn();
      onResult(result);
    } catch (e) {
      setError(e.message || 'Une erreur est survenue.');
    } finally { setLoading(false); }
  };

  return (
    <div className="ai-panel">
      <div className="ai-panel-head">
        <span className="ai-spark">✦</span> Assistant IA
      </div>
      <div className="form-tab-row">
        {[{k:'text',l:'Coller un texte'},{k:'photo',l:'Depuis une photo'},{k:'idea',l:"À partir d'une idée"}].map(m => (
          <button key={m.k} type="button" onClick={()=>setMode(m.k)} className={`form-tab-btn ${mode===m.k?'active':''}`}>{m.l}</button>
        ))}
      </div>
      {mode==='text' && (
        <div>
          <textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Collez ici le texte brut d'une recette (site web, message, notes…)" className="form-input" style={{ minHeight:80, resize:'vertical', marginBottom:'0.5rem' }} />
          <button type="button" disabled={loading||!text.trim()} onClick={()=>text.trim() && run(()=>extractRecipeFromText(text))} className="form-submit-btn-accent">
            {loading ? '⟳ Analyse en cours…' : 'Analyser le texte'}
          </button>
        </div>
      )}
      {mode==='photo' && (
        <div>
          <input type="file" accept="image/*" onChange={e=>setPhotoFile(e.target.files[0]||null)} style={{ fontSize:'0.85rem', marginBottom:'0.5rem' }} />
          <label style={{ display:'flex', alignItems:'center', gap:'0.4rem', fontSize:'0.8rem', color:'var(--text-muted)', marginBottom:'0.5rem' }}>
            <input type="checkbox" checked={useAsIllustration} onChange={e=>setUseAsIllustration(e.target.checked)} />
            Conserver comme photo d'illustration
          </label>
          <button type="button" disabled={loading||!photoFile} onClick={()=>photoFile && run(async () => {
            const { base64, mediaType } = await fileToBase64(photoFile);
            const result = await extractRecipeFromImage(base64, mediaType);
            if (useAsIllustration) onUsePhotoAsIllustration(photoFile);
            return result;
          })} className="form-submit-btn-accent" style={{ marginTop:'0.6rem' }}>
            {loading ? '⟳ Numérisation…' : 'Analyser l\'image et préremplir'}
          </button>
        </div>
      )}
      {mode==='idea' && (
        <div>
          <input value={idea} onChange={e=>setIdea(e.target.value)} placeholder="Ex : un dessert léger aux fraises et basilic" className="form-input" style={{ marginBottom:'0.5rem' }} />
          <button type="button" disabled={loading||!idea.trim()} onClick={()=>idea.trim() && run(()=>generateRecipe(idea))} className="form-submit-btn-accent">
            {loading ? '⟳ Création de la recette…' : "Créer de toutes pièces"}
          </button>
        </div>
      )}
      {error && <div style={{ marginTop:'0.6rem', fontSize:'0.8rem', color:'var(--ios-red)', fontWeight:500 }}>{error}</div>}
    </div>
  );
}

// ── RECIPE FORM (SHARED MULTI-INPUTS FORM) ──────────────────────────────────
function RecipeForm({ initial = {}, onClose, onSave, onNeedApiKey, title = "Nouvelle recette" }) {
  const [name, setName] = useState(initial.name || '');
  const [cat, setCat] = useState(initial.cat || 'Desserts');
  const [emoji, setEmoji] = useState(initial.emoji || '');
  const [portions, setPortions] = useState(initial.portions || 4);
  const [time, setTime] = useState(initial.time ? String(initial.time) : '');
  const [diff, setDiff] = useState(initial.diff || 2);
  const [notes, setNotes] = useState(initial.notes || '');
  const [visibility, setVisibility] = useState(initial.visibility || 'private');
  const [ings, setIngs] = useState(
    initial.ingredients?.length ? initial.ingredients : [{qty:'',name:''},{qty:'',name:''},{qty:'',name:''}]
  );
  const [steps, setSteps] = useState(
    initial.steps?.length ? initial.steps : [{text:'',timer:null},{text:'',timer:null}]
  );
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(initial.photoURL || null);
  const [photoDeleted, setPhotoDeleted] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!photoFile) return;
    const url = URL.createObjectURL(photoFile);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  const addIng = () => setIngs(p => [...p, {qty:'',name:''}]);
  const rmIng = i => setIngs(p => p.filter((_,j)=>j!==i));
  const setIng = (i, field, v) => setIngs(p => p.map((x,j) => j===i ? {...x,[field]:v} : x));
  const addStep = () => setSteps(p => [...p, {text:'',timer:null}]);
  const rmStep = i => setSteps(p => p.filter((_,j)=>j!==i));
  const setStepText = (i, v) => setSteps(p => p.map((x,j) => j===i ? {...x, text:v} : x));

  const applyAIResult = (r) => {
    if (r.name) setName(r.name);
    if (r.cat && CATEGORIES.includes(r.cat)) setCat(r.cat); else if (r.cat) setCat('Autre');
    if (r.emoji) setEmoji(r.emoji);
    if (r.portions) setPortions(r.portions);
    setTime(r.time != null ? String(r.time) : '');
    if (r.diff) setDiff(r.diff);
    if (Array.isArray(r.ingredients) && r.ingredients.length) setIngs(r.ingredients.map(i => ({ qty: i.qty||'', name: i.name||'' })));
    if (Array.isArray(r.steps) && r.steps.length) setSteps(r.steps.map(s => ({ text: s.text||'', timer: s.timer??null })));
    if (r.notes) setNotes(r.notes);
  };

  const handleSave = async () => {
    if (!name.trim()) { alert('Indiquez le nom de la recette.'); return; }
    setSaving(true);
    try {
      await onSave({
        name: name.trim(), cat, emoji: emoji||'🍽️',
        portions: parseInt(portions)||4, time: time?parseInt(time):null, diff: parseInt(diff),
        ingredients: ings.filter(i => i.name.trim()),
        steps: steps.filter(s => s.text.trim()).map(s => ({ text: s.text.trim(), timer: s.timer||null })),
        notes: notes.trim(),
        visibility,
        existingPhotoURL: photoDeleted ? null : (initial.photoURL || null),
      }, photoFile);
    } catch (e) {
      alert("Erreur d'enregistrement : " + e.message);
    } finally { setSaving(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box form-layout" onClick={e => e.stopPropagation()}>
        <div className="modal-drag-indicator" />
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1.5rem' }}>
          <div className="editorial-title" style={{ fontSize:'1.4rem' }}>{title}</div>
          <button onClick={onClose} className="close-square-btn">✕</button>
        </div>

        <AIPanel onResult={applyAIResult} onUsePhotoAsIllustration={setPhotoFile} onNeedApiKey={onNeedApiKey} />

        {/* Photo input */}
        <div style={{ marginBottom:'1.2rem' }}>
          <label className="form-label">Illustration</label>
          {photoPreview ? (
            <div style={{ display:'flex', alignItems:'center', gap:'1rem' }}>
              <img src={photoPreview} alt="" style={{ width:65, height:65, objectFit:'cover', borderRadius:14, border:'2px solid var(--border)' }} />
              <button type="button" onClick={()=>{ setPhotoFile(null); setPhotoPreview(null); setPhotoDeleted(true); }} className="secondary-action-btn">Supprimer l'image</button>
            </div>
          ) : (
            <input type="file" accept="image/*" onChange={e=>setPhotoFile(e.target.files[0]||null)} style={{ fontSize:'0.85rem' }} />
          )}
        </div>

        {/* Name Input */}
        <div style={{ marginBottom:'1.2rem' }}>
          <label className="form-label">Nom de la création</label>
          <input className="form-input" value={name} onChange={e=>setName(e.target.value)} placeholder="Ex: Risotto crémeux aux morilles" />
        </div>

        <div className="form-grid-2">
          <div>
            <label className="form-label">Catégorie</label>
            <select className="form-input" value={cat} onChange={e=>setCat(e.target.value)}>{CATEGORIES.filter(c=>c!=='Toutes').map(c=><option key={c}>{c}</option>)}</select>
          </div>
          <div>
            <label className="form-label">Glyphe / Emoji</label>
            <input className="form-input" value={emoji} onChange={e=>setEmoji(e.target.value)} placeholder="🍽️" maxLength={2} />
          </div>
        </div>

        <div className="form-grid-3">
          <div>
            <label className="form-label">Portions</label>
            <input className="form-input" type="number" value={portions} onChange={e=>setPortions(e.target.value)} min={1} />
          </div>
          <div>
            <label className="form-label">Minutes</label>
            <input className="form-input" type="number" value={time} onChange={e=>setTime(e.target.value)} placeholder="45" />
          </div>
          <div>
            <label className="form-label">Difficulté</label>
            <select className="form-input" value={diff} onChange={e=>setDiff(e.target.value)}>
              <option value={1}>Facile</option><option value={2}>Intermédiaire</option><option value={3}>Difficile</option>
            </select>
          </div>
        </div>

        {/* Ingredients Array */}
        <div style={{ marginBottom:'1.2rem' }}>
          <label className="form-label">Ingrédients requis</label>
          {ings.map((ing, i) => (
            <div key={i} className="form-ingredient-row" style={{ display:'flex', gap:'0.5rem', marginBottom:'0.4rem', alignItems:'center' }}>
              <input className="form-input qty-input" style={{ width:85 }} value={ing.qty} onChange={e=>setIng(i,'qty',e.target.value)} placeholder="Qté (ex: 200g)" />
              <input className="form-input name-input" style={{ flex:1 }} value={ing.name} onChange={e=>setIng(i,'name',e.target.value)} placeholder="Ingrédient" />
              <button onClick={()=>rmIng(i)} className="line-item-remove-btn">−</button>
            </div>
          ))}
          <button onClick={addIng} className="dashed-add-btn">+ Ajouter un ingrédient</button>
        </div>

        {/* Steps Array */}
        <div style={{ marginBottom:'1.2rem' }}>
          <label className="form-label">Étapes de réalisation</label>
          {steps.map((s, i) => (
            <div key={i} style={{ display:'flex', gap:'0.6rem', marginBottom:'0.5rem', alignItems:'flex-start' }}>
              <div className="step-badge-counter">{i+1}</div>
              <textarea className="form-input" style={{ flex:1, minHeight:65, resize:'vertical', lineHeight:1.5 }} value={s.text} onChange={e=>setStepText(i,e.target.value)} placeholder={`Instructions détaillées de l'étape ${i+1}…`} />
              <button onClick={()=>rmStep(i)} className="line-item-remove-btn" style={{ marginTop:6 }}>−</button>
            </div>
          ))}
          <button onClick={addStep} className="dashed-add-btn">+ Insérer une étape intermédiaire</button>
        </div>

        {/* Notes Input */}
        <div style={{ marginBottom:'1.5rem' }}>
          <label className="form-label">Notes & Variations éditoriales</label>
          <textarea className="form-input" style={{ minHeight:80, resize:'vertical', lineHeight:1.5 }} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Astuces de cuisson, associations de vins, options de conservation…" />
        </div>

        {/* Visibility Toggle */}
        <div style={{ marginBottom:'1.5rem' }}>
          <label className="form-label">Visibilité</label>
          <div className="form-tab-row">
            <button type="button" onClick={()=>setVisibility('private')} className={`form-tab-btn ${visibility==='private'?'active':''}`}>🔒 Privée</button>
            <button type="button" onClick={()=>setVisibility('public')} className={`form-tab-btn ${visibility==='public'?'active':''}`}>🌐 Publique</button>
          </div>
        </div>

        <div className="modal-actions-drawer">
          <button onClick={onClose} className="secondary-action-btn">Annuler</button>
          <button onClick={handleSave} disabled={saving} className="primary-action-btn">
            {saving ? '⟳ Enregistrement…' : 'Enregistrer la fiche'}
          </button>
        </div>
      </div>
    </div>
  );
}
// ── SETTINGS MODAL ────────────────────────────────────────────────────────────
function SettingsModal({ onClose, myUid, myProfile, onToast }) {
  const [key, setKey] = useState(getApiKey());
  const [isPrivate, setIsPrivate] = useState(!!myProfile?.isPrivate);
  const [savingPrivacy, setSavingPrivacy] = useState(false);
  const save = () => { setApiKey(key); onClose(); };

  const togglePrivacy = async () => {
    const next = !isPrivate;
    setIsPrivate(next);
    setSavingPrivacy(true);
    try {
      await updateDoc(doc(db, 'users', myUid), { isPrivate: next });
      await propagatePrivacyToRecipes(myUid, next);
      onToast(next ? 'Compte passé en privé' : 'Compte passé en public', 'success');
    } catch {
      setIsPrivate(!next);
      onToast('Erreur de mise à jour de la confidentialité', 'error');
    } finally { setSavingPrivacy(false); }
  };

  return (
    <div className="modal-backdrop" style={{ zIndex: 300 }} onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 440, padding: '2rem' }} onClick={e=>e.stopPropagation()}>
        <div className="editorial-title" style={{ fontSize:'1.4rem', marginBottom:'0.6rem' }}>Réglages</div>

        <div className="privacy-toggle-row">
          <div>
            <div style={{ fontSize:'0.9rem', fontWeight:700, color:'var(--text-main)' }}>Compte privé</div>
            <div style={{ fontSize:'0.78rem', color:'var(--text-muted)', marginTop:'0.15rem' }}>
              Seuls vos abonnés acceptés verront vos recettes publiques.
            </div>
          </div>
          <button onClick={togglePrivacy} disabled={savingPrivacy} className={`switch-toggle ${isPrivate?'on':''}`}>
            <span className="switch-toggle-knob" />
          </button>
        </div>

        <div style={{ height:1, background:'var(--border)', margin:'1.4rem 0' }} />

        <div className="editorial-title" style={{ fontSize:'1.05rem', marginBottom:'0.4rem' }}>Configuration IA</div>
        <p style={{ fontSize:'0.85rem', color:'var(--text-muted)', lineHeight:1.6, marginBottom:'1rem' }}>
          Votre clé Google Gemini active l'extraction et l'idéation automatisée. Sauvegardée localement dans votre propre navigateur.
        </p>
        <input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder="AIzaSy…" className="form-input" style={{ fontFamily:'monospace', marginBottom:'1.5rem' }} />
        <div style={{ display:'flex', gap:'1rem', justifyContent:'flex-end' }}>
          <button onClick={onClose} className="secondary-action-btn">Fermer</button>
          <button onClick={save} className="primary-action-btn">Enregistrer les paramètres</button>
        </div>
      </div>
    </div>
  );
}

// ── DETAIL MODAL ──────────────────────────────────────────────────────────────
function DetailModal({ recipe, onClose, onEdit, onAddToProfile, onOpenProfile, isOwner, timerCtx, isFav, onToggleFav }) {
  const [mult, setMult] = useState(1);
  const [exporting, setExporting] = useState(false);
  const portions = Math.round(recipe.portions * mult);
  const changeMult = d => { const np = recipe.portions * mult + d; if (np < 1) return; setMult(np / recipe.portions); };
  const fmtQty = qty => {
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box detail-layout" onClick={e=>e.stopPropagation()}>
        <div className="modal-drag-indicator" />
        {/* Detail Hero Cover */}
        <div style={{ background:'var(--bg-nav)', textAlign:'center', borderBottom:'2px solid var(--border)', position:'relative', overflow:'hidden' }}>
          <span className="card-tab" style={{ background: catColor(recipe.cat), top:0, height:6, width:'100%', borderRadius:0 }} />
          {recipe.photoURL ? (
            <>
              <img src={recipe.photoURL} alt={recipe.name} style={{ width:'100%', height:240, objectFit:'cover', display:'block' }} />
              <div style={{ position:'absolute', inset:0, background:'linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 60%)' }} />
            </>
          ) : null}
          <div className="detail-hero-overlay-content" style={{ padding: recipe.photoURL ? '1.5rem' : '2.5rem 1.5rem 1.5rem', position: recipe.photoURL ? 'absolute' : 'relative', bottom:0, left:0, right:0, textAlign:'left' }}>
            {!recipe.photoURL && <div style={{ fontSize:'3.5rem', marginBottom:'0.6rem' }}>{recipe.emoji||'🍽️'}</div>}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.3rem' }}>
              <div style={{ fontSize:'0.72rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color: recipe.photoURL ? '#fff' : catColor(recipe.cat) }}>{recipe.cat}</div>
              <button style={{ background:'transparent', border:'none', fontSize:'1.4rem', cursor:'pointer' }} onClick={() => onToggleFav(recipe.id)}>
                {isFav ? '❤️' : '🤍'}
              </button>
            </div>
            <div className="editorial-title" style={{ fontSize:'1.8rem', color: recipe.photoURL ? '#fff' : 'var(--text-main)', marginBottom:'0.8rem', textShadow: recipe.photoURL ? '0 2px 8px rgba(0,0,0,0.5)' : 'none' }}>
              {recipe.photoURL && <span style={{marginRight:'0.6rem'}}>{recipe.emoji||'🍽️'}</span>}
              {recipe.name}
            </div>
            <div style={{ display:'flex', gap:'0.6rem', flexWrap:'wrap' }}>
              {recipe.time && <span className="detail-meta-pill">⏱ {recipe.time < 60 ? recipe.time+'min' : Math.floor(recipe.time/60)+'h'+(recipe.time%60?recipe.time%60+'min':'')}</span>}
              <span className="detail-meta-pill">{DIFF_LABELS[recipe.diff]}</span>
            </div>
            {recipe.ownerName && (
              <div style={{ marginTop:'0.8rem', fontSize:'0.8rem', color: recipe.photoURL ? 'rgba(255,255,255,0.9)' : 'var(--text-muted)' }}>
                Rédigé par {!isOwner && onOpenProfile ? (
                  <span onClick={() => onOpenProfile(recipe.ownerId)} style={{ fontWeight:700, textDecoration:'underline', cursor:'pointer', color:'inherit' }}>{recipe.ownerName}</span>
                ) : recipe.ownerName}
                {recipe.copiedFrom?.ownerName && ` · Importé depuis le carnet de ${recipe.copiedFrom.ownerName}`}
              </div>
            )}
          </div>
        </div>

        <div style={{ padding:'1.5rem' }}>
          {/* Servings Adjuster */}
          <div style={{ display:'flex', alignItems:'center', gap:'1rem', background:'var(--bg-nav)', border:'1px solid var(--border)', borderRadius:14, padding:'0.6rem 1.2rem', marginBottom:'1.5rem' }}>
            <span style={{ fontSize:'0.85rem', fontWeight:500, color:'var(--text-muted)', flex:1 }}>Proportions</span>
            <div style={{ display:'flex', alignItems:'center', gap:'0.8rem' }}>
              <button onClick={()=>changeMult(-1)} className="portions-round-btn">−</button>
              <span style={{ fontWeight:700, fontSize:'1.1rem', minWidth:'1.5rem', textAlign:'center' }}>{portions}</span>
              <button onClick={()=>changeMult(1)} className="portions-round-btn">+</button>
            </div>
          </div>

          {/* Ingredients Segment */}
          <div className="editorial-title" style={{ fontSize:'1.2rem', marginBottom:'0.6rem' }}>Ingrédients</div>
          <div style={{ background:'var(--bg-main)', borderRadius:14, overflow:'hidden', marginBottom:'1.8rem', border:'1px solid var(--border)' }}>
            {recipe.ingredients.map((ing, i) => (
              <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'0.6rem 1.2rem', borderBottom: i<recipe.ingredients.length-1?'1px dashed var(--border)':'none', fontSize:'0.9rem', background: i%2===0?'var(--bg-card)':'transparent' }}>
                <span style={{ color:'var(--text-main)', paddingRight:'0.5rem' }}>{ing.name}</span>
                <span style={{ color:'var(--accent)', fontWeight:700, flexShrink:0 }}>{fmtQty(ing.qty)}</span>
              </div>
            ))}
          </div>

          {/* Steps Instructions Segment */}
          <div className="editorial-title" style={{ fontSize:'1.2rem', marginBottom:'0.6rem' }}>Préparation</div>
          <div style={{ marginBottom:'1.8rem' }}>
            {recipe.steps.map((s, i) => (
              <div key={i} style={{ display:'flex', gap:'1.2rem', marginBottom:'1rem', alignItems:'flex-start', padding:'1rem', background: i%2===0?'var(--bg-card)':'var(--bg-main)', borderRadius:14, border:'1px solid var(--border)' }}>
                <div className="step-badge-counter" style={{ background:'var(--accent)', color:'#fff', width:28, height:28, flexShrink:0 }}>{i+1}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:'0.92rem', lineHeight:1.6, color:'var(--text-main)' }}>{s.text}</div>
                  {s.timer && (
                    <button onClick={() => timerCtx.start(s.timer, `Étape ${i+1} — ${recipe.name}`)} className="timer-trigger-btn">
                      ⏱ Lancer le minuteur ({Math.floor(s.timer/60)}m {String(s.timer%60).padStart(2,'0')}s)
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Editorial Notes Block */}
          {recipe.notes && (
            <>
              <div className="editorial-title" style={{ fontSize:'1.1rem', marginBottom:'0.5rem' }}>Notes de l'auteur</div>
              <div className="editorial-notes-block">{recipe.notes}</div>
            </>
          )}

          {/* Bottom Dialog Action Drawer */}
          <div className="modal-actions-drawer">
            <button onClick={onClose} className="secondary-action-btn">Fermer</button>
            <button onClick={handleExport} disabled={exporting} className="secondary-action-btn" style={{ background:'var(--bg-nav)', color:'var(--text-main)' }}>
              {exporting ? '⟳ Compilation PDF…' : '📄 Exporter PDF'}
            </button>
            {isOwner ? (
              <button onClick={onEdit} className="primary-action-btn">✏️ Éditer</button>
            ) : (
              <button onClick={() => onAddToProfile(recipe)} className="primary-action-btn">💾 Ajouter au carnet</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── TIMER WIDGET ──────────────────────────────────────────────────────────────
function TimerWidget({ timer, fmt, toggle, cancel }) {
  if (!timer) return null;
  return (
    <div className="timer-floating-widget">
      <div style={{ fontSize:'0.72rem', color:'rgba(255,255,255,0.6)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:'0.2rem', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{timer.label}</div>
      <div style={{ fontSize:'2.2rem', fontWeight:800, letterSpacing:'-0.02em', fontVariantNumeric:'tabular-nums' }}>
        {timer.done ? '✓ Prêt !' : fmt(timer.remaining)}
      </div>
      <div style={{ display:'flex', gap:'0.5rem', marginTop:'0.8rem' }}>
        <button onClick={toggle} className="timer-widget-btn">{timer.paused ? 'Reprendre' : 'Suspendre'}</button>
        <button onClick={cancel} className="timer-widget-btn" style={{ background:'rgba(255,100,100,0.2)', color:'#fca5a5' }}>Arrêter</button>
      </div>
    </div>
  );
}

// ── LOGIN / SIGNUP SCREEN ─────────────────────────────────────────────────────
function AuthScreen({ onAuthed }) {
  const [dark, setDark] = useDarkMode();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (mode === 'register' && password !== password2) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }
    setLoading(true);
    try {
      const user = mode === 'register'
        ? await registerUser(username, password)
        : await loginUser(username, password);
      onAuthed(user);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <StylesStructure />
      <div className="auth-screen">
        <ThemeToggleBtn dark={dark} onToggle={()=>setDark(d=>!d)} style={{ position:'absolute', top:20, right:20 }} />
        <div className="auth-card">
          <div className="auth-brand">
            <span className="auth-brand-dot" />
            <div className="auth-brand-word">Mon <span>Carnet</span></div>
            <p className="auth-brand-tagline">Vos recettes, toujours à portée de main.</p>
          </div>

          <div className="form-tab-row" style={{ marginBottom:'1.5rem' }}>
            <button type="button" onClick={()=>{setMode('login'); setError('');}} className={`form-tab-btn ${mode==='login'?'active':''}`}>
              Connexion
            </button>
            <button type="button" onClick={()=>{setMode('register'); setError('');}} className={`form-tab-btn ${mode==='register'?'active':''}`}>
              Inscription
            </button>
          </div>

          <form onSubmit={submit}>
            <div style={{ marginBottom:'0.9rem' }}>
              <label className="form-label">Pseudo</label>
              <input className="form-input" value={username} onChange={e=>setUsername(e.target.value)} placeholder="ex : augustin" autoComplete="username" />
            </div>
            <div style={{ marginBottom: mode==='register' ? '0.9rem' : '1.5rem' }}>
              <label className="form-label">Mot de passe</label>
              <input type="password" className="form-input" value={password} onChange={e=>setPassword(e.target.value)} placeholder="6 caractères minimum" autoComplete={mode==='register'?'new-password':'current-password'} />
            </div>
            {mode==='register' && (
              <div style={{ marginBottom:'1.5rem' }}>
                <label className="form-label">Confirmer le mot de passe</label>
                <input type="password" className="form-input" value={password2} onChange={e=>setPassword2(e.target.value)} autoComplete="new-password" />
              </div>
            )}

            {error && <div style={{ marginBottom:'1rem', fontSize:'0.82rem', color:'var(--ios-red)', background:'var(--accent-light)', padding:'0.6rem 0.8rem', borderRadius:10, fontWeight:500 }}>{error}</div>}

            <button type="submit" disabled={loading || !username.trim() || !password} className="form-submit-btn-accent">
              {loading ? '⟳ Un instant…' : (mode==='register' ? "S'inscrire" : 'Se connecter')}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}

// ── PROFILE MENU ──────────────────────────────────────────────────────────────
function ProfileMenu({ user, statusInfo, onSettings, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref_ = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref_.current && !ref_.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const initial = user?.displayName?.[0]?.toUpperCase() || '?';

  return (
    <div ref={ref_} style={{ position:'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Profil & réglages"
        className="profile-avatar-btn" style={{ width:36, height:36 }}
      >
        {initial}
      </button>

      {open && (
        <div className="profile-dropdown">
          {/* Infos utilisateur */}
          <div style={{ padding:'0.9rem 1rem', borderBottom:'1px solid var(--border)', background:'var(--accent-light)' }}>
            <div style={{ fontSize:'0.85rem', fontWeight:700, color:'var(--text-main)' }}>👤 {user?.displayName}</div>
            <div style={{ fontSize:'0.72rem', color:statusInfo.color, marginTop:'0.2rem', display:'flex', alignItems:'center', gap:'0.3rem' }}>
              <span>{statusInfo.icon}</span>{statusInfo.label}
            </div>
          </div>

          {/* Actions */}
          <button onClick={() => { onSettings(); setOpen(false); }} className="profile-dropdown-item">
            ⚙️ Réglages IA
          </button>

          <div style={{ height:1, background:'var(--border)', margin:'0 1rem' }} />

          <button onClick={() => { onLogout(); setOpen(false); }} className="profile-dropdown-item" style={{ color:'var(--ios-red)' }}>
            🚪 Se déconnecter
          </button>
        </div>
      )}
    </div>
  );
}

// ── BOTTOM TAB BAR (navigation principale + bouton d'ajout central) ──────────
const NAV_TABS = [
  { k:'mine',      label:'Atelier',    icon:'📕' },
  { k:'public',    label:'Communauté', icon:'🌐' },
  { k:'favorites', label:'Favoris',    icon:'❤️' },
  { k:'planning',  label:'Planning',   icon:'📅' },
];

function BottomTabBar({ activeTab, onChangeTab, onAdd }) {
  const left = NAV_TABS.slice(0, 2);
  const right = NAV_TABS.slice(2);
  return (
    <nav className="bottom-tab-bar">
      {left.map(t => (
        <button key={t.k} onClick={() => onChangeTab(t.k)} className={`bottom-tab-btn ${activeTab===t.k?'active':''}`}>
          <span className="bottom-tab-icon">{t.icon}</span>
          <span>{t.label}</span>
        </button>
      ))}

      <div className="fab-slot">
        {activeTab !== 'planning' && (
          <button onClick={onAdd} className="fab-add-btn" title="Ajouter une recette" aria-label="Ajouter une recette">＋</button>
        )}
      </div>

      {right.map(t => (
        <button key={t.k} onClick={() => onChangeTab(t.k)} className={`bottom-tab-btn ${activeTab===t.k?'active':''}`}>
          <span className="bottom-tab-icon">{t.icon}</span>
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

// ── FOLLOW BUTTON ─────────────────────────────────────────────────────────────
// relation: undefined (aucun lien) | 'pending' | 'accepted'
function FollowButton({ myUid, targetUid, targetIsPrivate, relation, onToast }) {
  const [busy, setBusy] = useState(false);
  if (myUid === targetUid) return null;

  const follow = async () => {
    setBusy(true);
    try {
      const id = followDocId(myUid, targetUid);
      const status = targetIsPrivate ? 'pending' : 'accepted';
      await setDoc(doc(db, 'follows', id), { followerId: myUid, followingId: targetUid, status, createdAt: serverTimestamp() });
      if (status === 'accepted') {
        await updateDoc(doc(db, 'users', myUid), { followingCount: increment(1) });
        await updateDoc(doc(db, 'users', targetUid), { followersCount: increment(1) });
        onToast('Abonnement confirmé', 'success');
      } else {
        onToast('Demande envoyée', 'info');
      }
    } catch { onToast("Erreur lors de l'abonnement", 'error'); }
    finally { setBusy(false); }
  };

  const unfollowOrCancel = async () => {
    const wasAccepted = relation === 'accepted';
    if (wasAccepted && !window.confirm('Ne plus suivre ce compte ?')) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, 'follows', followDocId(myUid, targetUid)));
      if (wasAccepted) {
        await updateDoc(doc(db, 'users', myUid), { followingCount: increment(-1) });
        await updateDoc(doc(db, 'users', targetUid), { followersCount: increment(-1) });
      }
      onToast(wasAccepted ? 'Abonnement retiré' : 'Demande annulée', 'info');
    } catch { onToast("Erreur", 'error'); }
    finally { setBusy(false); }
  };

  if (relation === 'accepted') {
    return <button disabled={busy} onClick={unfollowOrCancel} className="follow-btn following">✓ Abonné(e)</button>;
  }
  if (relation === 'pending') {
    return <button disabled={busy} onClick={unfollowOrCancel} className="follow-btn pending">Demande envoyée</button>;
  }
  return <button disabled={busy} onClick={follow} className="follow-btn">{targetIsPrivate ? "🔒 S'abonner" : "S'abonner"}</button>;
}

// ── PROFILE VIEW ──────────────────────────────────────────────────────────────
function ProfileView({ uid, myUid, myFollowsMap, onClose, onToggleFav, favIds, onAddToProfile, onOpenChat, onToast, onOpenRecipe }) {
  const [profile, setProfile] = useState(null);
  const [recipes, setRecipes] = useState([]);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'users', uid), snap => setProfile(snap.exists() ? snap.data() : null));
    return unsub;
  }, [uid]);

  useEffect(() => {
    const q = query(collection(db, 'recipes'), where('ownerId', '==', uid), where('visibility', '==', 'public'));
    const unsub = onSnapshot(q, snap => setRecipes(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    return unsub;
  }, [uid]);

  if (!profile) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal-box" style={{ padding: '2rem', textAlign: 'center' }} onClick={e => e.stopPropagation()}>Chargement…</div>
      </div>
    );
  }

  const relation = myFollowsMap[uid];
  const isMe = uid === myUid;
  const canSeeRecipes = isMe || !profile.isPrivate || relation === 'accepted';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box detail-layout" onClick={e => e.stopPropagation()}>
        <div className="modal-drag-indicator" />
        <div style={{ padding: '0 1.5rem 1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={onClose} className="close-square-btn">✕</button>
          </div>

          <div style={{ textAlign: 'center', marginBottom: '1.2rem' }}>
            <div className="profile-avatar-btn" style={{ width: 76, height: 76, fontSize: '1.8rem', margin: '0 auto 0.8rem', cursor: 'default' }}>
              {profile.displayName?.[0]?.toUpperCase() || '?'}
            </div>
            <div className="editorial-title" style={{ fontSize: '1.3rem' }}>
              {profile.displayName} {profile.isPrivate && <span title="Compte privé" style={{ fontSize: '0.9rem' }}>🔒</span>}
            </div>
          </div>

          <div className="profile-stats-row">
            <div className="profile-stat"><b>{recipes.length}</b><span>Recettes</span></div>
            <div className="profile-stat"><b>{profile.followersCount || 0}</b><span>Abonnés</span></div>
            <div className="profile-stat"><b>{profile.followingCount || 0}</b><span>Abonnements</span></div>
          </div>

          {!isMe && (
            <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1.4rem' }}>
              <FollowButton myUid={myUid} targetUid={uid} targetIsPrivate={profile.isPrivate} relation={relation} onToast={onToast} />
              <button onClick={() => onOpenChat(uid, profile.displayName)} className="secondary-action-btn" style={{ flex: 1 }}>💬 Message</button>
            </div>
          )}

          {!canSeeRecipes ? (
            <div className="empty-state" style={{ padding: '2.5rem 1rem' }}>
              <div className="empty-state-emoji">🔒</div>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Ce compte est privé. Abonnez-vous pour voir ses recettes.</p>
            </div>
          ) : recipes.length === 0 ? (
            <div className="empty-state" style={{ padding: '2.5rem 1rem' }}>
              <div className="empty-state-emoji">📖</div>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Aucune recette publique pour l'instant.</p>
            </div>
          ) : (
            <div className="recipes-grid">
              {recipes.map(r => (
                <RecipeCard key={r.id} recipe={r} onOpen={() => onOpenRecipe(r)} onDelete={() => {}}
                  onAddToProfile={onAddToProfile} isOwner={false}
                  isFav={favIds.includes(r.id)} onToggleFav={onToggleFav} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── FOLLOW REQUESTS PANEL ─────────────────────────────────────────────────────
function FollowRequestsPanel({ myUid, requests, onClose, onToast, onOpenProfile }) {
  const respond = async (req, accept) => {
    try {
      if (accept) {
        await updateDoc(doc(db, 'follows', req.id), { status: 'accepted' });
        await updateDoc(doc(db, 'users', myUid), { followersCount: increment(1) });
        await updateDoc(doc(db, 'users', req.followerId), { followingCount: increment(1) });
        onToast('Demande acceptée', 'success');
      } else {
        await deleteDoc(doc(db, 'follows', req.id));
        onToast('Demande refusée', 'info');
      }
    } catch { onToast('Erreur', 'error'); }
  };

  return (
    <div className="modal-backdrop" style={{ zIndex: 300 }} onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 440, padding: '1.5rem' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem' }}>
          <div className="editorial-title" style={{ fontSize: '1.3rem' }}>Demandes d'abonnement</div>
          <button onClick={onClose} className="close-square-btn">✕</button>
        </div>
        {requests.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>Aucune demande en attente.</div>
        ) : requests.map(req => (
          <div key={req.id} style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', padding: '0.6rem 0', borderBottom: '1px solid var(--border)' }}>
            <div className="profile-avatar-btn" style={{ width: 38, height: 38, fontSize: '1rem', cursor: 'pointer' }} onClick={() => { onOpenProfile(req.followerId); onClose(); }}>
              {req.followerName?.[0]?.toUpperCase() || '?'}
            </div>
            <span style={{ flex: 1, fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-main)' }}>{req.followerName}</span>
            <button onClick={() => respond(req, false)} className="card-action-inline-btn delete-btn" style={{ width: 30, height: 30 }}>✕</button>
            <button onClick={() => respond(req, true)} className="add-btn">✓ Accepter</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── MEMBERS SEARCH (rechercher des membres à suivre) ─────────────────────────
function MembersSearch({ myUid, onOpenProfile }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const term = q.trim().toLowerCase();
    if (!term) { setResults([]); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const snap = await getDocs(query(
          collection(db, 'users'),
          orderBy('displayNameLower'),
          where('displayNameLower', '>=', term),
          where('displayNameLower', '<=', term + '\uf8ff'),
          limit(12)
        ));
        setResults(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(u => u.id !== myUid));
      } catch { setResults([]); }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q, myUid]);

  return (
    <div style={{ marginBottom: '0.5rem' }}>
      <div className="search-wrapper">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Chercher un membre par pseudo…" className="search-input" />
      </div>
      {q.trim() && (
        <div style={{ marginTop: '0.5rem' }}>
          {searching && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', padding: '0.4rem' }}>Recherche…</div>}
          {!searching && results.length === 0 && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', padding: '0.4rem' }}>Aucun membre trouvé.</div>}
          {results.map(u => (
            <div key={u.id} onClick={() => onOpenProfile(u.id)} className="member-search-row">
              <div className="profile-avatar-btn" style={{ width: 34, height: 34, fontSize: '0.9rem', cursor: 'pointer' }}>
                {u.displayName?.[0]?.toUpperCase() || '?'}
              </div>
              <span style={{ flex: 1, fontSize: '0.86rem', fontWeight: 600 }}>{u.displayName}</span>
              {u.isPrivate && <span style={{ fontSize: '0.85rem' }}>🔒</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── MESSAGING : liste des conversations ───────────────────────────────────────
function MessagesOverlay({ myUid, onClose, onOpenChat }) {
  const [convos, setConvos] = useState([]);

  useEffect(() => {
    const q = query(collection(db, 'conversations'), where('participants', 'array-contains', myUid), orderBy('updatedAt', 'desc'));
    const unsub = onSnapshot(q, snap => setConvos(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    return unsub;
  }, [myUid]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box detail-layout" onClick={e => e.stopPropagation()}>
        <div className="modal-drag-indicator" />
        <div style={{ padding: '0 1.25rem 1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div className="editorial-title" style={{ fontSize: '1.3rem' }}>Messages</div>
            <button onClick={onClose} className="close-square-btn">✕</button>
          </div>

          {convos.length === 0 ? (
            <div className="empty-state" style={{ padding: '2.5rem 1rem' }}>
              <div className="empty-state-emoji">✉️</div>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Aucune conversation. Ouvrez un profil pour envoyer un message.</p>
            </div>
          ) : convos.map(c => {
            const otherUid = c.participants.find(p => p !== myUid);
            const otherName = c.participantNames?.[otherUid] || 'Utilisateur';
            const unread = c.lastMessage && c.lastMessage.senderId !== myUid;
            return (
              <div key={c.id} onClick={() => onOpenChat(otherUid, otherName)} className="conversation-row">
                <div className="profile-avatar-btn" style={{ width: 44, height: 44, fontSize: '1.1rem', cursor: 'pointer' }}>{otherName[0]?.toUpperCase()}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-main)' }}>{otherName}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.lastMessage?.recipeShare ? `🍽️ ${c.lastMessage.recipeShare.name}` : (c.lastMessage?.text || '…')}
                  </div>
                </div>
                {unread && <span className="unread-dot" />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── MESSAGING : conversation 1-à-1 ────────────────────────────────────────────
function ChatView({ myUid, myName, otherUid, otherName, myRecipes, onClose, onOpenRecipe, onToast }) {
  const cid = conversationId(myUid, otherUid);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    const q = query(collection(db, 'conversations', cid, 'messages'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, snap => setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    return unsub;
  }, [cid]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  const send = async (recipeShare = null) => {
    if (!recipeShare && !text.trim()) return;
    const payload = { senderId: myUid, text: recipeShare ? '' : text.trim(), recipeShare, createdAt: serverTimestamp() };
    try {
      await setDoc(doc(db, 'conversations', cid), {
        participants: [myUid, otherUid],
        participantNames: { [myUid]: myName, [otherUid]: otherName },
        updatedAt: serverTimestamp(),
        lastMessage: { senderId: myUid, text: payload.text, recipeShare },
      }, { merge: true });
      await addDoc(collection(db, 'conversations', cid, 'messages'), payload);
      setText('');
      setShowPicker(false);
    } catch { onToast("Échec de l'envoi du message", 'error'); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box chat-layout" onClick={e => e.stopPropagation()}>
        <div className="modal-drag-indicator" />
        <div className="chat-head">
          <div className="profile-avatar-btn" style={{ width: 34, height: 34, fontSize: '0.9rem', cursor: 'default' }}>{otherName[0]?.toUpperCase()}</div>
          <div className="editorial-title" style={{ fontSize: '1.05rem', flex: 1 }}>{otherName}</div>
          <button onClick={onClose} className="close-square-btn">✕</button>
        </div>

        <div className="chat-messages">
          {messages.map(m => (
            <div key={m.id} className={`chat-bubble-row ${m.senderId === myUid ? 'me' : ''}`}>
              {m.recipeShare ? (
                <div className="chat-bubble chat-bubble-recipe" onClick={() => onOpenRecipe(m.recipeShare.id)}>
                  <span style={{ fontSize: '1.4rem' }}>{m.recipeShare.emoji || '🍽️'}</span>
                  <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>{m.recipeShare.name}</span>
                </div>
              ) : (
                <div className="chat-bubble">{m.text}</div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {showPicker && (
          <div className="chat-recipe-picker">
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.4rem' }}>Partager une recette</div>
            <div style={{ maxHeight: 140, overflowY: 'auto' }}>
              {myRecipes.map(r => (
                <div key={r.id} onClick={() => send({ id: r.id, name: r.name, emoji: r.emoji, photoURL: r.photoURL || null })} className="planner-pick-item">
                  {r.emoji || '🍽️'} {r.name}
                </div>
              ))}
              {myRecipes.length === 0 && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '0.4rem' }}>Aucune recette à partager.</div>}
            </div>
          </div>
        )}

        <div className="chat-input-row">
          <button onClick={() => setShowPicker(p => !p)} className="close-square-btn" title="Partager une recette">📎</button>
          <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder="Votre message…" className="form-input" style={{ flex: 1 }} />
          <button onClick={() => send()} className="primary-action-btn" style={{ padding: '11px 16px' }}>➤</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [dark, setDark] = useDarkMode();
  const [user, setUser] = useState(undefined);
  const [activeTab, setActiveTab] = useState('mine');
  const [myRecipes, setMyRecipes] = useState([]);
  const [publicRecipes, setPublicRecipes] = useState([]);
  const [favIds, setFavIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem("culinary_favs") || "[]"); } catch { return []; }
  });
  const [activeCategory, setActiveCategory] = useState('Toutes');
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [editId, setEditId] = useState(null);
  const [syncStatus, setSyncStatus] = useState('loading');
  const [toasts, setToasts] = useState([]);
  const timerCtx = useTimer();

  // ── Social : profil, abonnements, messagerie ────────────────────────────
  const [myProfile, setMyProfile] = useState(null);
  const [communityMode, setCommunityMode] = useState('discover'); // 'discover' | 'following'
  const [myFollows, setMyFollows] = useState([]); // mes relations sortantes (accepted + pending)
  const [incomingRequests, setIncomingRequests] = useState([]);
  const [profileViewId, setProfileViewId] = useState(null);
  const [showFollowRequests, setShowFollowRequests] = useState(false);
  const [showMessages, setShowMessages] = useState(false);
  const [activeChat, setActiveChat] = useState(null); // { uid, name }
  const [viewingRecipe, setViewingRecipe] = useState(null); // recette ouverte hors des listes locales
  const [hasUnreadMsgs, setHasUnreadMsgs] = useState(false);

  const myFollowsMap = Object.fromEntries(myFollows.map(f => [f.followingId, f.status]));
  const followingIds = myFollows.filter(f => f.status === 'accepted').map(f => f.followingId);

  const addToast = useCallback((msg, type='info', duration=3500) => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), duration);
  }, []);

  // Save favorites to local storage whenever they change
  useEffect(() => {
    localStorage.setItem("culinary_favs", JSON.stringify(favIds));
  }, [favIds]);

  useEffect(() => {
    const unsub = subscribeAuth((u) => setUser(u));
    return unsub;
  }, []);

  useEffect(() => {
    if (!user) { setMyProfile(null); setMyFollows([]); setIncomingRequests([]); return; }
    ensureUserDoc(user);

    const unsubProfile = onSnapshot(doc(db, 'users', user.uid), snap => setMyProfile(snap.exists() ? snap.data() : null));

    const unsubFollows = onSnapshot(
      query(collection(db, 'follows'), where('followerId', '==', user.uid)),
      snap => setMyFollows(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );

    const unsubRequests = onSnapshot(
      query(collection(db, 'follows'), where('followingId', '==', user.uid), where('status', '==', 'pending')),
      async snap => {
        const reqs = await Promise.all(snap.docs.map(async d => {
          const data = d.data();
          const userSnap = await getDoc(doc(db, 'users', data.followerId));
          return { id: d.id, ...data, followerName: userSnap.exists() ? userSnap.data().displayName : 'Utilisateur' };
        }));
        setIncomingRequests(reqs);
      }
    );

    const unsubConvos = onSnapshot(
      query(collection(db, 'conversations'), where('participants', 'array-contains', user.uid)),
      snap => setHasUnreadMsgs(snap.docs.some(d => d.data().lastMessage?.senderId && d.data().lastMessage.senderId !== user.uid))
    );

    return () => { unsubProfile(); unsubFollows(); unsubRequests(); unsubConvos(); };
  }, [user]);

  const needApiKey = useCallback(() => {
    addToast("Clé API absente. Ouvrez les réglages (⚙️).", 'error');
    setShowSettings(true);
  }, [addToast]);

  useEffect(() => {
    if (!user) { setMyRecipes([]); return; }
    const q = query(collection(db, 'recipes'), where('ownerId', '==', user.uid), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      setMyRecipes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setSyncStatus('synced');
    }, (err) => {
      console.error(err);
      setSyncStatus('error');
      addToast('Problème de liaison avec la base de données.', 'error');
    });
    return unsub;
  }, [user, addToast]);

  useEffect(() => {
    if (!user) { setPublicRecipes([]); return; }
    const q = query(collection(db, 'recipes'), where('visibility', '==', 'public'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      setPublicRecipes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => {
      console.error(err);
      addToast('Impossible de synchroniser le flux public.', 'error');
    });
    return unsub;
  }, [user, addToast]);

  const uploadPhoto = async (id, photoFile) => {
    const sRef = ref(storage, `photos/${user.uid}/${id}`);
    await uploadBytes(sRef, photoFile);
    return await getDownloadURL(sRef);
  };

  const handleSaveNew = useCallback(async (data, photoFile) => {
    const newRef = doc(collection(db, 'recipes'));
    let photoURL = null;
    if (photoFile) photoURL = await uploadPhoto(newRef.id, photoFile);
    await setDoc(newRef, {
      ...data, photoURL,
      ownerId: user.uid, ownerName: user.displayName,
      ownerIsPrivate: !!myProfile?.isPrivate,
      createdAt: serverTimestamp(),
    });
    addToast('Recette ajoutée au carnet', 'success');
    setShowAdd(false);
  }, [addToast, user, myProfile]);

  const handleSaveEdit = useCallback(async (data, photoFile) => {
    const recipe = myRecipes.find(r => r.id === editId);
    if (!recipe) return;
    let photoURL = data.existingPhotoURL;
    if (photoFile) {
      if (recipe.photoURL) { try { await deleteObject(ref(storage, `photos/${user.uid}/${editId}`)); } catch {} }
      photoURL = await uploadPhoto(editId, photoFile);
    } else if (data.existingPhotoURL === null && recipe.photoURL) {
      try { await deleteObject(ref(storage, `photos/${user.uid}/${editId}`)); } catch {}
      photoURL = null;
    }
    const { existingPhotoURL, ...cleanData } = data;
    await updateDoc(doc(db, 'recipes', editId), { ...cleanData, photoURL });
    addToast('Recette mise à jour avec succès', 'success');
    setEditId(null);
  }, [editId, myRecipes, addToast, user]);

  const handleDelete = useCallback(async (id) => {
    if (!window.confirm('Confirmez-vous la suppression définitive de cette fiche ?')) return;
    const recipe = myRecipes.find(r => r.id === id);
    try {
      await deleteDoc(doc(db, 'recipes', id));
      if (recipe?.photoURL) { try { await deleteObject(ref(storage, `photos/${user.uid}/${id}`)); } catch {} }
      addToast('Fiche effacée', 'info');
      if (detailId === id) setDetailId(null);
    } catch { addToast('Échec de la suppression', 'error'); }
  }, [myRecipes, addToast, detailId, user]);

  const handleAddToProfile = useCallback(async (recipe) => {
    try {
      const newRef = doc(collection(db, 'recipes'));
      const { id, ownerId, ownerName, createdAt, copiedFrom, ...rest } = recipe;
      await setDoc(newRef, {
        ...rest,
        visibility: 'private',
        ownerId: user.uid,
        ownerName: user.displayName,
        copiedFrom: { id: recipe.id, ownerName: recipe.ownerName || null },
        createdAt: serverTimestamp(),
      });
      addToast('Recette importée dans votre Atelier', 'success');
      setDetailId(null);
    } catch {
      addToast("Erreur d'importation", 'error');
    }
  }, [addToast, user]);

  const toggleFavorite = useCallback((id) => {
    setFavIds(prev => {
      const exists = prev.includes(id);
      if (exists) {
        addToast('Retiré des favoris', 'info');
        return prev.filter(x => x !== id);
      } else {
        addToast('Ajouté aux favoris', 'success');
        return [...prev, id];
      }
    });
  }, [addToast]);

  // Sélection de la source des données selon l'onglet
  let recipes = [];
  if (activeTab === 'mine') {
    recipes = myRecipes;
  } else if (activeTab === 'public') {
    if (communityMode === 'following') {
      recipes = publicRecipes.filter(r => followingIds.includes(r.ownerId));
    } else {
      // Découvrir : tout le flux public, sauf les comptes privés qu'on ne suit pas
      recipes = publicRecipes.filter(r => !r.ownerIsPrivate || r.ownerId === user.uid || followingIds.includes(r.ownerId));
    }
  } else if (activeTab === 'favorites') {
    // Fusionne toutes les sources connues pour retrouver l'objet complet favori
    const allKnown = [...myRecipes, ...publicRecipes];
    recipes = favIds.map(id => allKnown.find(r => r.id === id)).filter(Boolean);
  }

  const filtered = recipes.filter(r => {
    const matchCat = activeCategory === 'Toutes' || r.cat === activeCategory;
    const q = search.toLowerCase();
    return matchCat && (!q || r.name.toLowerCase().includes(q) || r.cat.toLowerCase().includes(q) || r.ingredients.some(i => i.name.toLowerCase().includes(q)));
  });

  const cats = ['Toutes', ...new Set(recipes.map(r => r.cat))];
  const byCat = activeCategory === 'Toutes'
    ? Object.fromEntries(cats.filter(c=>c!=='Toutes').map(c => [c, filtered.filter(r=>r.cat===c)]).filter(([,v])=>v.length>0))
    : { [activeCategory]: filtered };

  const statusInfo = {
    loading: { color:'var(--accent)', icon:'⟳', label:'Liaison…' },
    synced:  { color:'var(--ios-green)', icon:'✓', label:'Profil Synchronisé' },
    error:   { color:'var(--ios-red)', icon:'⚠', label:'Déconnecté' },
  }[syncStatus];

  const allCombined = [...myRecipes, ...publicRecipes];
  const detailRecipe = viewingRecipe || allCombined.find(r => r.id === detailId);
  const editRecipe = myRecipes.find(r => r.id === editId);

  const openRecipeById = useCallback(async (id) => {
    const known = allCombined.find(r => r.id === id);
    if (known) { setDetailId(id); return; }
    try {
      const snap = await getDoc(doc(db, 'recipes', id));
      if (snap.exists()) setViewingRecipe({ id: snap.id, ...snap.data() });
      else addToast('Cette recette a été supprimée', 'error');
    } catch { addToast('Impossible de charger la recette', 'error'); }
  }, [allCombined, addToast]);

  const closeDetail = () => { setDetailId(null); setViewingRecipe(null); };

  if (user === undefined) {
    return (
      <>
        <StylesStructure />
        <div className="boot-screen">⟳ Initialisation du carnet…</div>
      </>
    );
  }
  if (!user) {
    return <AuthScreen onAuthed={setUser} />;
  }

  return (
    <>
      <StylesStructure />

      <div className="app-container">
        {/* HEADER */}
        <header className="app-header">
          <div className="header-content">
            <div className="header-top-row">
              <div className="logo-area">
                <span className="logo-dot" />
                <h1 className="logo">Carnet.</h1>
              </div>

              <div className="header-right-actions">
                <ThemeToggleBtn dark={dark} onToggle={()=>setDark(d=>!d)} />
                <button onClick={() => setShowFollowRequests(true)} className="theme-toggle-btn" title="Demandes d'abonnement" style={{ position:'relative' }}>
                  👥
                  {incomingRequests.length > 0 && <span className="header-badge-dot">{incomingRequests.length}</span>}
                </button>
                <button onClick={() => setShowMessages(true)} className="theme-toggle-btn" title="Messages" style={{ position:'relative' }}>
                  ✉️
                  {hasUnreadMsgs && <span className="header-badge-dot" />}
                </button>
                <ProfileMenu
                  user={user}
                  statusInfo={statusInfo}
                  onSettings={() => setShowSettings(true)}
                  onLogout={() => logoutUser()}
                />
              </div>
            </div>

            <div className="search-wrapper header-search-full">
              <input
                value={search}
                onChange={e=>setSearch(e.target.value)}
                placeholder="Rechercher un ingrédient, un nom..."
                className="search-input"
              />
            </div>
          </div>
        </header>

        {/* SOUS-ONGLET COMMUNAUTÉ : Découvrir / Abonnements */}
        {activeTab === 'public' && (
          <div className="community-subtabs-wrap">
            <div className="form-tab-row" style={{ maxWidth: 1100, margin: '0 auto' }}>
              <button type="button" onClick={() => setCommunityMode('discover')} className={`form-tab-btn ${communityMode==='discover'?'active':''}`}>🔭 Découvrir</button>
              <button type="button" onClick={() => setCommunityMode('following')} className={`form-tab-btn ${communityMode==='following'?'active':''}`}>👥 Abonnements</button>
            </div>
            {communityMode === 'discover' && (
              <div style={{ maxWidth: 1100, margin: '0.7rem auto 0' }}>
                <MembersSearch myUid={user.uid} onOpenProfile={setProfileViewId} />
              </div>
            )}
          </div>
        )}

        {/* HORIZONTAL CATEGORIES BAR */}
        {activeTab !== 'planning' && (
          <div className="categories-outer-bar">
            <div className="categories-inner-container">
              {cats.map(c => (
                <button key={c} onClick={()=>setActiveCategory(c)} className={`category-pill ${c===activeCategory?'active':''}`}>
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* MAIN DISPLAY ENGINE */}
        {activeTab === 'planning' ? (
          <MealPlanner recipes={myRecipes} db={db} userId={user.uid} />
        ) : (
        <main className="main-content">
          {Object.entries(byCat).map(([cat, rs]) => rs.length === 0 ? null : (
            <div key={cat} style={{ marginBottom:'2rem' }}>
              <div className="category-section-title">
                <span className="cat-dot" style={{ background: catColor(cat) }} />
                {cat}
              </div>
              <div className="recipes-grid">
                {rs.map(r => (
                  <RecipeCard key={r.id} recipe={r} onOpen={setDetailId} onDelete={handleDelete}
                    onAddToProfile={handleAddToProfile} isOwner={r.ownerId === user.uid}
                    isFav={favIds.includes(r.id)} onToggleFav={toggleFavorite} />
                ))}
              </div>
            </div>
          ))}

          {filtered.length === 0 && (
            <div className="empty-state">
              <div className="empty-state-emoji">📖</div>
              <p className="editorial-title" style={{ fontSize:'1.2rem', marginBottom:'0.3rem' }}>Aucune fiche disponible</p>
              <p style={{ fontSize:'0.9rem', color:'var(--text-muted)' }}>
                {activeTab === 'mine' && "Ajoutez votre première création culinaire à l'Atelier."}
                {activeTab === 'public' && communityMode === 'discover' && "Aucun partage public ne correspond à vos critères."}
                {activeTab === 'public' && communityMode === 'following' && "Abonnez-vous à des membres pour voir leurs recettes ici."}
                {activeTab === 'favorites' && "Marquez vos recettes favorites d'un cœur pour les retrouver ici."}
              </p>
            </div>
          )}
        </main>
        )}
      </div>

      {!(showAdd || editRecipe || detailRecipe || showSettings || profileViewId || showFollowRequests || showMessages || activeChat) && (
        <BottomTabBar
          activeTab={activeTab}
          onChangeTab={(k) => { setActiveTab(k); setActiveCategory('Toutes'); setDetailId(null); }}
          onAdd={() => setShowAdd(true)}
        />
      )}

      {/* OVERLAYS DISPLAY SWITCH ENGINE */}
      {showAdd && <RecipeForm title="Créer une fiche recette" onClose={()=>setShowAdd(false)} onSave={handleSaveNew} onNeedApiKey={needApiKey} />}

      {editRecipe && (
        <RecipeForm
          title="Modifier les données de la fiche"
          initial={editRecipe}
          onClose={()=>setEditId(null)}
          onSave={handleSaveEdit}
          onNeedApiKey={needApiKey}
        />
      )}

      {detailRecipe && (
        <DetailModal
          recipe={detailRecipe}
          isOwner={detailRecipe.ownerId === user.uid}
          onClose={closeDetail}
          onEdit={() => { closeDetail(); setEditId(detailId); }}
          onAddToProfile={handleAddToProfile}
          onOpenProfile={(uid) => { closeDetail(); setProfileViewId(uid); }}
          timerCtx={timerCtx}
          isFav={favIds.includes(detailRecipe.id)}
          onToggleFav={toggleFavorite}
        />
      )}

      {showSettings && <SettingsModal onClose={()=>setShowSettings(false)} myUid={user.uid} myProfile={myProfile} onToast={addToast} />}

      {profileViewId && (
        <ProfileView
          uid={profileViewId}
          myUid={user.uid}
          myFollowsMap={myFollowsMap}
          favIds={favIds}
          onClose={() => setProfileViewId(null)}
          onToggleFav={toggleFavorite}
          onAddToProfile={handleAddToProfile}
          onToast={addToast}
          onOpenRecipe={(r) => { setProfileViewId(null); setViewingRecipe(r); }}
          onOpenChat={(uid, name) => { setProfileViewId(null); setActiveChat({ uid, name }); }}
        />
      )}

      {showFollowRequests && (
        <FollowRequestsPanel
          myUid={user.uid}
          requests={incomingRequests}
          onClose={() => setShowFollowRequests(false)}
          onToast={addToast}
          onOpenProfile={setProfileViewId}
        />
      )}

      {showMessages && (
        <MessagesOverlay
          myUid={user.uid}
          onClose={() => setShowMessages(false)}
          onOpenChat={(uid, name) => { setShowMessages(false); setActiveChat({ uid, name }); }}
        />
      )}

      {activeChat && (
        <ChatView
          myUid={user.uid}
          myName={user.displayName}
          otherUid={activeChat.uid}
          otherName={activeChat.name}
          myRecipes={myRecipes}
          onClose={() => setActiveChat(null)}
          onOpenRecipe={(id) => { setActiveChat(null); openRecipeById(id); }}
          onToast={addToast}
        />
      )}

      <TimerWidget timer={timerCtx.timer} fmt={timerCtx.fmt} toggle={timerCtx.toggle} cancel={timerCtx.cancel} />
      <Toast toasts={toasts} />
    </>
  );
}

// ── MEAL PLANNER ──────────────────────────────────────────────────────────────
const DAYS = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];

function MealPlanner({ recipes, db, userId }) {
  const [plan, setPlan] = useState({}); // { 'Lundi': [{recipeId, label}] }
  const [showShoppingList, setShowShoppingList] = useState(false);
  const [addingTo, setAddingTo] = useState(null); // day name
  const [search, setSearch] = useState('');
  const [checkedItems, setCheckedItems] = useState({});

  // Load from Firestore
  useEffect(() => {
    if (!userId) return;
    const ref_ = doc(db, 'meal_plans', userId);
    const unsub = onSnapshot(ref_, snap => {
      if (snap.exists()) setPlan(snap.data().plan || {});
    });
    return unsub;
  }, [userId]);

  const savePlan = async (newPlan) => {
    const ref_ = doc(db, 'meal_plans', userId);
    await setDoc(ref_, { plan: newPlan }, { merge: true });
  };

  const addMeal = async (day, recipe) => {
    const newPlan = {
      ...plan,
      [day]: [...(plan[day] || []), { recipeId: recipe.id, name: recipe.name, ingredients: recipe.ingredients }]
    };
    setPlan(newPlan);
    await savePlan(newPlan);
    setAddingTo(null);
    setSearch('');
  };

  const removeMeal = async (day, idx) => {
    const newPlan = { ...plan, [day]: (plan[day] || []).filter((_,i) => i !== idx) };
    setPlan(newPlan);
    await savePlan(newPlan);
  };

  // Build shopping list: aggregate all ingredients
  const shoppingList = () => {
    const map = {};
    Object.values(plan).forEach(meals => {
      (meals || []).forEach(meal => {
        (meal.ingredients || []).forEach(ing => {
          const key = ing.name.toLowerCase().trim();
          if (!map[key]) map[key] = { name: ing.name, quantities: [] };
          if (ing.qty) map[key].quantities.push(ing.qty);
        });
      });
    });
    return Object.values(map);
  };

  const toggleCheck = (key) => setCheckedItems(p => ({ ...p, [key]: !p[key] }));

  const filteredRecipes = recipes.filter(r =>
    !search || r.name.toLowerCase().includes(search.toLowerCase())
  );

  const items = shoppingList();
  const unchecked = items.filter(i => !checkedItems[i.name.toLowerCase()]);
  const checked = items.filter(i => checkedItems[i.name.toLowerCase()]);

  return (
    <div className="planner-wrap">
      {/* Header */}
      <div className="planner-head">
        <div>
          <div className="editorial-title" style={{ fontSize:'1.4rem' }}>Planning repas</div>
          <div style={{ fontSize:'0.8rem', color:'var(--text-muted)', marginTop:'0.2rem' }}>Semaine en cours</div>
        </div>
        <button onClick={() => setShowShoppingList(true)} className="primary-action-btn">
          🛒 Liste de courses {items.length > 0 && `(${items.length})`}
        </button>
      </div>

      {/* Days grid */}
      <div className="planner-days-grid">
        {DAYS.map(day => (
          <div key={day} className="planner-day-card">
            {/* Day header */}
            <div className="planner-day-head">
              <span>{day}</span>
              <button onClick={() => setAddingTo(addingTo === day ? null : day)} className="planner-day-add-btn">+</button>
            </div>

            {/* Meals */}
            <div style={{ padding:'0.5rem', minHeight:60 }}>
              {(plan[day] || []).length === 0 && (
                <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', textAlign:'center', padding:'0.75rem 0', fontStyle:'italic' }}>Vide</div>
              )}
              {(plan[day] || []).map((meal, i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:'0.3rem', marginBottom:'0.3rem', background:'var(--accent-light)', borderRadius:9, padding:'0.35rem 0.5rem' }}>
                  <span style={{ flex:1, fontSize:'0.72rem', color:'var(--text-main)', fontWeight:500, lineHeight:1.3, overflow:'hidden', textOverflow:'ellipsis', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical' }}>{meal.name}</span>
                  <button onClick={() => removeMeal(day, i)}
                    style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', fontSize:'0.65rem', flexShrink:0, padding:'0 2px' }}>✕</button>
                </div>
              ))}
            </div>

            {/* Recipe picker */}
            {addingTo === day && (
              <div style={{ borderTop:'1px solid var(--border)', padding:'0.5rem' }}>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher…"
                  style={{ width:'100%', padding:'0.35rem 0.5rem', border:'1px solid var(--border)', borderRadius:8, fontFamily:'inherit', fontSize:'0.75rem', outline:'none', marginBottom:'0.4rem', color:'var(--text-main)', background:'var(--bg-main)' }} />
                <div style={{ maxHeight:140, overflowY:'auto' }}>
                  {filteredRecipes.slice(0,20).map(r => (
                    <div key={r.id} onClick={() => addMeal(day, r)} className="planner-pick-item">
                      {r.emoji || '🍽️'} {r.name}
                    </div>
                  ))}
                  {filteredRecipes.length === 0 && <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', padding:'0.4rem' }}>Aucune recette</div>}
                </div>
                <button onClick={() => { setAddingTo(null); setSearch(''); }}
                  style={{ width:'100%', marginTop:'0.4rem', background:'none', border:'1px solid var(--border)', borderRadius:8, padding:'0.3rem', fontSize:'0.72rem', color:'var(--text-muted)', cursor:'pointer', fontFamily:'inherit' }}>Fermer</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Shopping List Modal */}
      {showShoppingList && (
        <div className="modal-backdrop" style={{ zIndex:300 }} onClick={() => setShowShoppingList(false)}>
          <div className="modal-box" style={{ maxWidth:440, padding:'1.75rem' }} onClick={e => e.stopPropagation()}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1.25rem' }}>
              <div className="editorial-title" style={{ fontSize:'1.3rem' }}>🛒 Liste de courses</div>
              <button onClick={() => setShowShoppingList(false)} className="close-square-btn">✕</button>
            </div>

            {items.length === 0 ? (
              <div style={{ textAlign:'center', padding:'2rem', color:'var(--text-muted)', fontSize:'0.9rem' }}>
                Ajoute des repas au planning pour générer ta liste !
              </div>
            ) : (
              <>
                <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', marginBottom:'0.75rem', textTransform:'uppercase', letterSpacing:'0.08em', fontWeight:700 }}>
                  {unchecked.length} article{unchecked.length !== 1 ? 's' : ''} restant{unchecked.length !== 1 ? 's' : ''}
                </div>

                {unchecked.map(item => (
                  <div key={item.name} onClick={() => toggleCheck(item.name.toLowerCase())}
                    style={{ display:'flex', alignItems:'center', gap:'0.75rem', padding:'0.65rem 0', borderBottom:'1px solid var(--border)', cursor:'pointer' }}>
                    <div style={{ width:20, height:20, borderRadius:6, border:'2px solid var(--border)', flexShrink:0 }} />
                    <span style={{ flex:1, fontSize:'0.9rem', color:'var(--text-main)' }}>{item.name}</span>
                    {item.quantities.length > 0 && (
                      <span style={{ fontSize:'0.8rem', color:'var(--accent)', fontWeight:700 }}>{item.quantities.join(' + ')}</span>
                    )}
                  </div>
                ))}

                {checked.length > 0 && (
                  <>
                    <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', margin:'1rem 0 0.5rem', textTransform:'uppercase', letterSpacing:'0.08em', fontWeight:700 }}>
                      ✓ Déjà dans le panier
                    </div>
                    {checked.map(item => (
                      <div key={item.name} onClick={() => toggleCheck(item.name.toLowerCase())}
                        style={{ display:'flex', alignItems:'center', gap:'0.75rem', padding:'0.55rem 0', cursor:'pointer', opacity:0.45 }}>
                        <div style={{ width:20, height:20, borderRadius:6, border:'2px solid var(--accent)', background:'var(--accent)', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
                          <span style={{ color:'#fff', fontSize:'0.7rem' }}>✓</span>
                        </div>
                        <span style={{ flex:1, fontSize:'0.88rem', color:'var(--text-muted)', textDecoration:'line-through' }}>{item.name}</span>
                      </div>
                    ))}
                  </>
                )}

                <button onClick={() => setCheckedItems({})}
                  style={{ width:'100%', marginTop:'1.25rem', padding:'0.6rem', background:'none', border:'1px dashed var(--border)', borderRadius:12, fontFamily:'inherit', fontSize:'0.82rem', color:'var(--text-muted)', cursor:'pointer' }}>
                  Tout réinitialiser
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── DESIGN SYSTEM ─────────────────────────────────────────────────────────────
function StylesStructure() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap');

      /* ── TOKENS : palette neutre + un seul accent franc ─────────────── */
      :root {
        --bg-main:      #F5F5F7;
        --bg-card:      #FFFFFF;
        --bg-header:    rgba(245,245,247,0.82);
        --bg-nav:       #ECECEE;
        --text-main:    #1D1D1F;
        --text-muted:   #6E6E73;
        --accent:       #FF5A36;
        --accent-ink:   #B23D22;
        --accent-light: #FFEEE6;
        --border:       #E4E4E7;
        --shadow:       0 10px 30px rgba(29,29,31,0.07), 0 2px 8px rgba(29,29,31,0.04);
        --radius-lg: 22px; --radius-md: 16px; --radius-sm: 11px;

        --ios-label:      var(--text-main);
        --ios-label2:     var(--text-muted);
        --ios-label3:     rgba(110,110,115,0.65);
        --ios-separator:  var(--border);
        --ios-fill:       rgba(0,0,0,0.05);
        --ios-fill2:      rgba(0,0,0,0.045);
        --ios-blue:       #0A84FF;
        --ios-red:        #E4362A;
        --ios-green:      #23A566;
        --ios-orange:     #FF9500;
        --ios-teal:       #2AA9C4;
        --ios-accent:     var(--accent);
        --ios-grouped-bg: var(--bg-main);
        --ios-grouped-card: var(--bg-card);
        --ios-nav-bg:     var(--bg-header);
        --ios-shadow:     var(--shadow);
      }

      :root[data-theme="dark"] {
        --bg-main:      #000000;
        --bg-card:      #1C1C1E;
        --bg-header:    rgba(17,17,19,0.82);
        --bg-nav:       #232325;
        --text-main:    #F5F5F7;
        --text-muted:   #98989D;
        --accent:       #FF6B49;
        --accent-ink:   #FFB199;
        --accent-light: rgba(255,107,73,0.16);
        --border:       #2C2C2E;
        --shadow:       0 10px 30px rgba(0,0,0,0.55), 0 2px 10px rgba(0,0,0,0.35);

        --ios-label3:     rgba(152,152,157,0.7);
        --ios-fill:       rgba(255,255,255,0.09);
        --ios-fill2:      rgba(255,255,255,0.07);
        --ios-blue:       #409CFF;
        --ios-red:        #FF6961;
        --ios-green:      #32D883;
        --ios-orange:     #FFB340;
        --ios-teal:       #52C7DE;
      }

      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

      html { color-scheme: light; }
      html[data-theme="dark"] { color-scheme: dark; }

      html, body { overscroll-behavior-y: none; }

      body {
        font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif;
        background: var(--bg-main);
        color: var(--text-main);
        -webkit-font-smoothing: antialiased;
        -webkit-text-size-adjust: 100%;
        overflow-x: hidden;
        transition: background 0.25s ease, color 0.25s ease;
      }

      ::-webkit-scrollbar { width: 0px; }

      button, input, select, textarea { font-family: inherit; }
      button { -webkit-tap-highlight-color: transparent; }

      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }
      }

      /* ── BOOT SCREEN ─────────────────────────────────────────────────── */
      .boot-screen {
        min-height: 100vh; display:flex; align-items:center; justify-content:center;
        background: var(--bg-main); color: var(--text-muted); font-size:0.95rem; font-weight:600;
      }

      /* ── APP CONTAINER ───────────────────────────────────────────────── */
      .app-container {
        min-height: 100vh;
        background: var(--bg-main);
        display: flex;
        flex-direction: column;
        padding-bottom: calc(84px + env(safe-area-inset-bottom, 0px));
      }

      /* ── HEADER ───────────────────────────────────────────────────────── */
      .app-header {
        position: sticky;
        top: 0;
        z-index: 100;
        background: var(--bg-header);
        backdrop-filter: saturate(180%) blur(20px);
        -webkit-backdrop-filter: saturate(180%) blur(20px);
        border-bottom: 1px solid var(--border);
      }

      .header-content {
        max-width: 1100px;
        margin: 0 auto;
        padding: env(safe-area-inset-top, 0px) 16px 0;
      }

      .header-top-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 52px;
      }

      .logo-area { display: flex; align-items: center; gap: 8px; }

      .logo-dot {
        width: 10px; height: 10px; border-radius: 50%;
        background: var(--accent);
        box-shadow: 0 0 0 4px var(--accent-light);
        animation: pulseDot 2.4s ease-in-out infinite;
      }
      @keyframes pulseDot {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.25); }
      }

      .logo {
        font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
        font-size: 1.3rem;
        font-weight: 800;
        color: var(--text-main);
        letter-spacing: -0.02em;
      }

      .header-right-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .theme-toggle-btn {
        width: 36px; height: 36px; border-radius: 50%;
        border: 1px solid var(--border);
        background: var(--bg-card);
        display: flex; align-items: center; justify-content: center;
        font-size: 1rem; cursor: pointer;
        transition: transform 0.15s ease, background 0.2s ease;
      }
      .theme-toggle-btn:active { transform: scale(0.9); }

      .header-search-full { padding-bottom: 12px; margin-top: 8px; }

      .search-wrapper { position: relative; }

      .search-input {
        width: 100%;
        height: 40px;
        background: var(--ios-fill2);
        border: 1px solid transparent;
        border-radius: var(--radius-sm);
        padding: 0 14px 0 34px;
        font-size: 0.94rem;
        color: var(--text-main);
        outline: none;
        -webkit-appearance: none;
        transition: background 0.2s ease, border-color 0.2s ease;
      }
      .search-input:focus { background: var(--bg-card); border-color: var(--accent); }
      .search-input::placeholder { color: var(--ios-label3); }

      .search-wrapper::before {
        content: '⌕';
        position: absolute;
        left: 12px;
        top: 50%;
        transform: translateY(-50%);
        font-size: 1.05rem;
        font-weight: 700;
        color: var(--text-muted);
        pointer-events: none;
      }

      /* ── CATEGORIES BAR ───────────────────────────────────────────────── */
      .categories-outer-bar {
        background: var(--bg-main);
        border-bottom: 1px solid var(--border);
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
      }
      .categories-outer-bar::-webkit-scrollbar { display: none; }

      .categories-inner-container {
        display: flex;
        gap: 8px;
        padding: 12px 16px;
        max-width: 1100px;
        margin: 0 auto;
      }

      .category-pill {
        padding: 7px 16px;
        border-radius: 20px;
        border: 1px solid var(--border);
        font-size: 0.82rem;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
        background: var(--bg-card);
        color: var(--text-muted);
        transition: all 0.15s ease;
      }
      .category-pill.active {
        background: var(--accent);
        border-color: var(--accent);
        color: #fff;
      }

      /* ── MAIN CONTENT ─────────────────────────────────────────────────── */
      .main-content {
        max-width: 1100px;
        margin: 0 auto;
        width: 100%;
        padding: 4px 16px 24px;
      }

      .category-section-title {
        display: flex; align-items: center; gap: 8px;
        padding: 18px 4px 10px;
        font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
        font-size: 1.02rem;
        font-weight: 800;
        color: var(--text-main);
        letter-spacing: -0.01em;
      }
      .cat-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink:0; }

      /* ── RECIPE CARDS ─────────────────────────────────────────────────── */
      .recipes-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 12px;
        margin-bottom: 4px;
      }

      .recipe-card {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        cursor: pointer;
        position: relative;
        overflow: hidden;
        box-shadow: var(--shadow);
        transition: transform 0.16s cubic-bezier(.2,.8,.2,1), box-shadow 0.16s ease, border-color 0.16s ease;
      }
      .recipe-card:hover { transform: translateY(-2px); border-color: var(--accent); }
      .recipe-card:active { transform: scale(0.98); }

      /* Onglet de classeur, couleur = catégorie */
      .card-tab {
        position: absolute; left: 0; top: 14px; bottom: 14px; width: 4px;
        border-radius: 0 4px 4px 0;
      }

      .card-thumb {
        width: 60px; height: 60px;
        border-radius: 14px;
        flex-shrink: 0;
        overflow: hidden;
        background: var(--bg-nav);
        display: flex; align-items: center; justify-content: center;
        font-size: 1.7rem;
        margin-left: 6px;
      }
      .card-thumb img { width: 100%; height: 100%; object-fit: cover; }

      .card-body-ios { flex: 1; min-width: 0; }

      .card-title {
        font-size: 0.98rem;
        font-weight: 700;
        color: var(--text-main);
        line-height: 1.3;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        margin-bottom: 3px;
      }

      .card-subtitle-ios {
        font-size: 0.78rem;
        color: var(--text-muted);
        display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
      }
      .card-cat-tag { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; }

      .diff-dots { display: inline-flex; gap: 2px; }
      .diff-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--border); }
      .diff-dot.on { background: var(--accent); }

      .card-actions-container { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }

      .card-action-inline-btn {
        border: none; cursor: pointer; border-radius: 10px;
        background: var(--ios-fill2);
        display: flex; align-items: center; justify-content: center;
        transition: transform 0.12s ease;
      }
      .card-action-inline-btn:active { transform: scale(0.85); }

      .delete-btn { width: 30px; height: 30px; color: var(--ios-red); font-size: 0.8rem; }
      .fav-btn { width: 30px; height: 30px; font-size: 0.9rem; }
      .add-btn {
        background: var(--accent); color: #fff;
        padding: 5px 12px; border-radius: 10px;
        font-size: 0.78rem; font-weight: 700; height: 30px;
        border: none; cursor: pointer;
      }

      /* ── EMPTY STATE ──────────────────────────────────────────────────── */
      .empty-state { text-align:center; padding: 4rem 1.5rem; }
      .empty-state-emoji { font-size: 2.8rem; margin-bottom: 0.6rem; animation: floatY 3s ease-in-out infinite; }
      @keyframes floatY { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }

      /* ── MODALS ───────────────────────────────────────────────────────── */
      .modal-backdrop {
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.45);
        backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
        z-index: 260;
        display: flex; align-items: flex-end; justify-content: center;
        padding: 0;
        animation: fadeIn 0.18s ease;
      }
      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

      @media (min-width: 600px) {
        .modal-backdrop { align-items: center; padding: 1.5rem; }
      }

      .modal-box {
        background: var(--bg-card);
        border-radius: var(--radius-lg) var(--radius-lg) 0 0;
        width: 100%;
        max-height: 92vh;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        box-shadow: 0 -8px 50px rgba(0,0,0,0.25);
        animation: slideUp 0.2s cubic-bezier(.2,.8,.2,1);
      }
      @keyframes slideUp { from { transform: translateY(24px); opacity:0.4; } to { transform: translateY(0); opacity:1; } }

      @media (min-width: 600px) {
        .modal-box { border-radius: var(--radius-lg); max-height: 88vh; }
      }

      .form-layout { max-width: 560px; padding: 22px; }
      .detail-layout { max-width: 640px; width: 100%; }

      .modal-drag-indicator {
        width: 36px; height: 4px; background: var(--border); border-radius: 2px; margin: 10px auto 16px;
      }
      @media (min-width: 600px) { .modal-drag-indicator { display: none; } }

      /* ── AI PANEL ─────────────────────────────────────────────────────── */
      .ai-panel {
        background: var(--accent-light);
        border: 1px solid var(--accent);
        border-radius: var(--radius-md);
        padding: 14px;
        margin-bottom: 1.4rem;
      }
      .ai-panel-head {
        font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
        font-weight: 800; font-size: 0.92rem; color: var(--accent-ink);
        display: flex; align-items: center; gap: 6px; margin-bottom: 10px;
      }
      .ai-spark { display:inline-block; animation: spin 3s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }

      /* ── FORM ELEMENTS ────────────────────────────────────────────────── */
      .form-label {
        display: block; font-size: 0.78rem; font-weight: 700;
        color: var(--text-muted); margin-bottom: 5px; padding-left: 2px;
      }

      .form-input {
        width: 100%; padding: 12px 14px; border: 1.5px solid transparent;
        border-radius: var(--radius-sm);
        font-size: 0.95rem; color: var(--text-main);
        background: var(--ios-fill2);
        outline: none; -webkit-appearance: none; appearance: none;
        transition: background 0.15s ease, border-color 0.15s ease;
      }
      .form-input:focus { background: var(--bg-card); border-color: var(--accent); }

      .form-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px; }
      .form-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 14px; }

      .form-tab-row { display: flex; gap: 6px; background: var(--bg-nav); border-radius: 12px; padding: 4px; }
      .form-tab-btn {
        flex: 1; padding: 9px; border-radius: 9px;
        font-size: 0.82rem; font-weight: 600; cursor: pointer;
        background: transparent; border: none; color: var(--text-muted);
        transition: all 0.15s ease;
      }
      .form-tab-btn.active { background: var(--bg-card); color: var(--text-main); font-weight: 700; box-shadow: 0 1px 4px rgba(0,0,0,0.1); }

      .step-badge-counter {
        width: 24px; height: 24px; border-radius: 50%;
        background: var(--accent); color: #fff;
        display: flex; align-items: center; justify-content: center;
        font-size: 0.75rem; font-weight: 700; flex-shrink: 0;
      }

      .line-item-remove-btn {
        width: 30px; height: 40px; border-radius: 9px; border: none;
        background: var(--ios-fill2); color: var(--ios-red);
        font-size: 1.1rem; cursor: pointer; flex-shrink: 0;
      }

      .dashed-add-btn {
        width: 100%; margin-top: 4px; padding: 9px;
        border: 1.5px dashed var(--border); border-radius: var(--radius-sm);
        background: none; color: var(--accent); font-weight: 700; font-size: 0.82rem;
        cursor: pointer;
      }

      /* ── BUTTONS ──────────────────────────────────────────────────────── */
      .primary-action-btn {
        background: var(--accent); color: #fff; border: none;
        padding: 11px 20px; border-radius: var(--radius-sm);
        font-size: 0.9rem; font-weight: 700; cursor: pointer;
        transition: transform 0.12s ease, opacity 0.15s ease;
      }
      .primary-action-btn:active { transform: scale(0.97); }
      .primary-action-btn:disabled { opacity: 0.5; cursor: default; }

      .secondary-action-btn {
        background: var(--ios-fill2); border: none; color: var(--text-main);
        padding: 11px 18px; border-radius: var(--radius-sm);
        font-size: 0.88rem; font-weight: 600; cursor: pointer;
      }
      .secondary-action-btn:active { opacity: 0.7; }

      .form-submit-btn-accent {
        width: 100%; padding: 13px; border-radius: var(--radius-sm); border: none;
        background: var(--accent); color: #fff; font-weight: 700; font-size: 0.92rem; cursor: pointer;
        transition: transform 0.12s ease;
      }
      .form-submit-btn-accent:active { transform: scale(0.98); }
      .form-submit-btn-accent:disabled { opacity: 0.5; }

      .close-square-btn {
        background: var(--ios-fill2); border: none; border-radius: 50%;
        width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
        cursor: pointer; font-size: 0.8rem; color: var(--text-muted); font-weight: 700; flex-shrink: 0;
      }

      .portions-round-btn {
        width: 30px; height: 30px; border-radius: 50%; border: 1.5px solid var(--border);
        background: var(--bg-card); color: var(--text-main); font-size: 1.1rem; font-weight: 700;
        cursor: pointer; display:flex; align-items:center; justify-content:center;
      }

      /* ── DETAIL MODAL ─────────────────────────────────────────────────── */
      .editorial-title {
        font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
        font-size: 1.1rem; font-weight: 800; color: var(--text-main); letter-spacing: -0.01em;
      }

      .detail-meta-pill {
        display: inline-flex; align-items: center;
        background: rgba(255,255,255,0.22); backdrop-filter: blur(6px);
        padding: 5px 12px; border-radius: 20px;
        font-size: 0.78rem; color: #fff; font-weight: 600;
      }

      .modal-actions-drawer {
        display: flex; gap: 8px; justify-content: flex-end;
        padding-top: 18px; border-top: 1px solid var(--border);
        margin-top: 20px; flex-wrap: wrap;
      }

      .editorial-notes-block {
        background: var(--bg-nav); border-radius: var(--radius-md);
        padding: 14px 16px; font-size: 0.88rem; line-height: 1.6; color: var(--text-main);
        white-space: pre-wrap;
      }

      .timer-trigger-btn {
        margin-top: 8px; background: var(--accent-light); color: var(--accent-ink);
        border: 1px solid var(--accent); border-radius: 9px;
        padding: 6px 12px; font-size: 0.78rem; font-weight: 700; cursor: pointer;
      }

      /* ── TIMER WIDGET ─────────────────────────────────────────────────── */
      .timer-floating-widget {
        position: fixed;
        left: 16px;
        bottom: calc(84px + env(safe-area-inset-bottom, 0px) + 12px);
        background: rgba(29,29,31,0.92);
        backdrop-filter: blur(16px);
        color: #fff;
        border-radius: 20px;
        padding: 14px 18px;
        min-width: 170px;
        box-shadow: 0 12px 34px rgba(0,0,0,0.35);
        z-index: 150;
        animation: slideUp 0.2s ease;
      }
      .timer-widget-btn {
        flex: 1; background: rgba(255,255,255,0.14); border: none; color: #fff;
        padding: 7px; border-radius: 9px; font-size: 0.76rem; font-weight: 700; cursor: pointer;
      }

      /* ── TOASTS ───────────────────────────────────────────────────────── */
      .toast-stack {
        position: fixed; top: calc(env(safe-area-inset-top, 0px) + 12px); left: 50%;
        transform: translateX(-50%);
        display: flex; flex-direction: column; gap: 8px; z-index: 400; align-items: center;
      }
      .toast-pill {
        display: flex; align-items: center; gap: 8px;
        background: rgba(29,29,31,0.94); color: #fff;
        padding: 10px 16px; border-radius: 20px; font-size: 0.85rem; font-weight: 600;
        box-shadow: 0 8px 24px rgba(0,0,0,0.3);
        animation: slideDown 0.2s ease;
        white-space: nowrap;
      }
      @keyframes slideDown { from { transform: translateY(-12px); opacity:0; } to { transform: translateY(0); opacity:1; } }
      .toast-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink:0; }
      .toast-success .toast-dot { background: var(--ios-green); }
      .toast-error .toast-dot { background: var(--ios-red); }
      .toast-info .toast-dot { background: var(--ios-blue); }

      /* ── PROFILE ──────────────────────────────────────────────────────── */
      .profile-avatar-btn {
        border-radius: 50%; border: none; background: var(--accent); color: #fff;
        font-weight: 800; font-size: 0.95rem; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
      }
      .profile-dropdown {
        position: absolute; top: calc(100% + 8px); right: 0;
        background: var(--bg-card); border: 1px solid var(--border);
        border-radius: var(--radius-md); box-shadow: var(--shadow);
        min-width: 220px; z-index: 200; overflow: hidden;
        animation: slideDown 0.15s ease;
      }
      .profile-dropdown-item {
        width: 100%; padding: 0.8rem 1rem; background: none; border: none; text-align: left;
        font-size: 0.85rem; font-weight: 600; color: var(--text-main); cursor: pointer;
        display: flex; align-items: center; gap: 0.5rem;
      }
      .profile-dropdown-item:hover { background: var(--accent-light); }

      /* ── BOTTOM TAB BAR + FAB ─────────────────────────────────────────── */
      .bottom-tab-bar {
        position: fixed; left: 0; right: 0; bottom: 0; z-index: 250;
        display: grid; grid-template-columns: 1fr 1fr 76px 1fr 1fr;
        align-items: center;
        background: var(--bg-header);
        backdrop-filter: saturate(180%) blur(20px);
        -webkit-backdrop-filter: saturate(180%) blur(20px);
        border-top: 1px solid var(--border);
        padding: 6px 6px calc(6px + env(safe-area-inset-bottom, 0px));
        max-width: 640px; margin: 0 auto;
        width: 100%;
      }
      @media (min-width: 640px) {
        .bottom-tab-bar { border-radius: 24px 24px 0 0; box-shadow: 0 -6px 30px rgba(0,0,0,0.08); }
      }

      .bottom-tab-btn {
        display: flex; flex-direction: column; align-items: center; gap: 2px;
        background: none; border: none; cursor: pointer;
        padding: 6px 2px; border-radius: 12px;
        color: var(--text-muted); font-size: 0.66rem; font-weight: 700;
        transition: color 0.15s ease, transform 0.12s ease;
      }
      .bottom-tab-btn:active { transform: scale(0.92); }
      .bottom-tab-btn.active { color: var(--accent); }
      .bottom-tab-icon { font-size: 1.2rem; line-height: 1; }

      .fab-slot { display: flex; align-items: center; justify-content: center; }
      .fab-add-btn {
        width: 54px; height: 54px; border-radius: 50%;
        background: var(--accent); color: #fff; border: none;
        font-size: 1.6rem; font-weight: 400; line-height: 1;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer;
        box-shadow: 0 8px 20px rgba(255,90,54,0.4);
        transform: translateY(-14px);
        transition: transform 0.15s cubic-bezier(.34,1.56,.64,1);
      }
      .fab-add-btn:active { transform: translateY(-14px) scale(0.9); }

      /* ── AUTH SCREEN ──────────────────────────────────────────────────── */
      .auth-screen {
        position: relative; min-height: 100vh;
        display: flex; align-items: center; justify-content: center;
        background: var(--bg-main); padding: 1.5rem;
      }
      .auth-card {
        background: var(--bg-card); border: 1px solid var(--border);
        border-radius: 26px; width: 100%; max-width: 400px; padding: 2.2rem 2rem;
        box-shadow: var(--shadow);
        animation: slideUp 0.25s ease;
      }
      .auth-brand { text-align: center; margin-bottom: 1.9rem; }
      .auth-brand-dot {
        display: inline-block; width: 14px; height: 14px; border-radius: 50%;
        background: var(--accent); margin-bottom: 0.7rem;
        box-shadow: 0 0 0 6px var(--accent-light);
      }
      .auth-brand-word {
        font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
        font-size: 1.6rem; font-weight: 800; color: var(--text-main); letter-spacing: -0.02em;
      }
      .auth-brand-word span { color: var(--accent); }
      .auth-brand-tagline { font-size: 0.85rem; color: var(--text-muted); margin-top: 0.4rem; }

      /* ── HEADER BADGES ────────────────────────────────────────────────── */
      .header-badge-dot {
        position: absolute; top: -2px; right: -2px;
        min-width: 16px; height: 16px; padding: 0 3px; border-radius: 8px;
        background: var(--ios-red); color: #fff;
        font-size: 0.6rem; font-weight: 800;
        display: flex; align-items: center; justify-content: center;
        border: 2px solid var(--bg-header);
      }

      /* ── COMMUNITY SUBTABS ────────────────────────────────────────────── */
      .community-subtabs-wrap {
        background: var(--bg-main); border-bottom: 1px solid var(--border);
        padding: 10px 16px;
      }

      /* ── FOLLOW BUTTON ────────────────────────────────────────────────── */
      .follow-btn {
        flex: 1; border: none; border-radius: var(--radius-sm);
        padding: 11px 14px; font-size: 0.86rem; font-weight: 700; cursor: pointer;
        background: var(--accent); color: #fff;
        transition: opacity 0.15s ease;
      }
      .follow-btn.following { background: var(--ios-fill2); color: var(--text-main); }
      .follow-btn.pending { background: var(--ios-fill2); color: var(--text-muted); }
      .follow-btn:disabled { opacity: 0.6; }

      /* ── PROFILE VIEW ─────────────────────────────────────────────────── */
      .profile-stats-row {
        display: flex; justify-content: center; gap: 2rem;
        padding: 1rem 0; margin-bottom: 1.2rem;
        border-top: 1px solid var(--border); border-bottom: 1px solid var(--border);
      }
      .profile-stat { text-align: center; }
      .profile-stat b { display: block; font-size: 1.05rem; font-weight: 800; color: var(--text-main); }
      .profile-stat span { font-size: 0.72rem; color: var(--text-muted); font-weight: 600; }

      .member-search-row, .conversation-row {
        display: flex; align-items: center; gap: 0.7rem;
        padding: 0.6rem 0.3rem; cursor: pointer; border-radius: 12px;
      }
      .member-search-row:hover, .conversation-row:hover { background: var(--accent-light); }

      .unread-dot {
        width: 10px; height: 10px; border-radius: 50%; background: var(--accent); flex-shrink: 0;
      }

      /* ── PRIVACY SWITCH ───────────────────────────────────────────────── */
      .privacy-toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
      .switch-toggle {
        width: 46px; height: 28px; border-radius: 14px; border: none; cursor: pointer;
        background: var(--ios-fill2); position: relative; flex-shrink: 0;
        transition: background 0.2s ease;
      }
      .switch-toggle.on { background: var(--accent); }
      .switch-toggle-knob {
        position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%;
        background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.25);
        transition: transform 0.2s cubic-bezier(.34,1.56,.64,1);
      }
      .switch-toggle.on .switch-toggle-knob { transform: translateX(18px); }

      /* ── CHAT ─────────────────────────────────────────────────────────── */
      .chat-layout { max-width: 520px; width: 100%; height: 78vh; display: flex; flex-direction: column; }
      .chat-head {
        display: flex; align-items: center; gap: 0.7rem;
        padding: 0 1.25rem 1rem; border-bottom: 1px solid var(--border);
      }
      .chat-messages { flex: 1; overflow-y: auto; padding: 1rem 1.25rem; display: flex; flex-direction: column; gap: 0.5rem; }
      .chat-bubble-row { display: flex; }
      .chat-bubble-row.me { justify-content: flex-end; }
      .chat-bubble {
        max-width: 75%; padding: 0.6rem 0.9rem; border-radius: 16px;
        background: var(--bg-nav); color: var(--text-main); font-size: 0.88rem; line-height: 1.4;
      }
      .chat-bubble-row.me .chat-bubble { background: var(--accent); color: #fff; }
      .chat-bubble-recipe {
        display: flex; align-items: center; gap: 0.5rem; cursor: pointer;
        background: var(--accent-light) !important; color: var(--text-main) !important;
        border: 1px solid var(--accent);
      }
      .chat-recipe-picker {
        border-top: 1px solid var(--border); padding: 0.7rem 1.25rem; background: var(--bg-nav);
      }
      .chat-input-row {
        display: flex; align-items: center; gap: 0.5rem;
        padding: 0.8rem 1.25rem; border-top: 1px solid var(--border);
      }

      /* ── PLANNER ──────────────────────────────────────────────────────── */
      .planner-wrap { max-width: 1100px; margin: 0 auto; padding: 1.2rem 16px 2rem; }
      .planner-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:1.4rem; flex-wrap:wrap; gap:0.75rem; }
      .planner-days-grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 0.8rem; }
      .planner-day-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden; box-shadow: var(--shadow); }
      .planner-day-head {
        background: var(--bg-nav); padding: 0.55rem 0.8rem; border-bottom: 1px solid var(--border);
        display: flex; justify-content: space-between; align-items: center;
        font-size: 0.78rem; font-weight: 800; color: var(--text-main);
      }
      .planner-day-add-btn {
        background: var(--accent); color: #fff; border: none; border-radius: 7px;
        width: 22px; height: 22px; cursor: pointer; font-size: 0.9rem;
        display: flex; align-items: center; justify-content: center; flex-shrink: 0;
      }
      .planner-pick-item { padding: 0.4rem 0.5rem; font-size: 0.78rem; cursor: pointer; border-radius: 8px; color: var(--text-main); }
      .planner-pick-item:hover { background: var(--accent-light); }
    `}</style>
  );
}
