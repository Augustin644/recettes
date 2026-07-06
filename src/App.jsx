import { useState, useEffect, useCallback, useRef } from "react";
import {
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, where, serverTimestamp,
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

// ── THEMES SYSTEM (25% CONTRAST & ACCORDED PALETTES) ─────────────────────────
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
    "--bg-main": "#EAE3E3",          // Rouge lin / rosé doux désaturé
    "--bg-card": "#FFFFFF",
    "--bg-header": "rgba(234, 227, 227, 0.85)",
    "--bg-nav": "#DACDCD",
    "--text-main": "#241111",        // Grenat très sombre
    "--text-muted": "#685353",       // Lie de vin poudré
    "--accent": "#A93838",           // Rouge garance / opéra mat
    "--accent-light": "#F6EEEE",
    "--border": "#D2BFBF",
    "--shadow": "0 6px 20px rgba(36, 17, 17, 0.05)",
  }
};

// ── PDF EXPORT ────────────────────────────────────────────────────────────────
async function exportRecipeToPDF(recipe) {
  const { jsPDF } = await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm");

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, margin = 20, contentW = W - margin * 2;
  let y = 0;

  const addPage = () => { doc.addPage(); y = margin; };
  const checkY = (needed = 10) => { if (y + needed > 280) addPage(); };

  doc.setFillColor(44, 26, 14);
  doc.rect(0, 0, W, 42, "F");
  doc.setFillColor(196, 98, 45);
  doc.rect(0, 38, W, 4, "F");

  doc.setFontSize(28);
  doc.setTextColor(240, 232, 216);
  doc.text(recipe.emoji || "🍽️", margin, 22);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(255, 255, 255);
  const titleLines = doc.splitTextToSize(recipe.name, contentW - 20);
  doc.text(titleLines, margin + 16, 18);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(196, 98, 45);
  doc.text(recipe.cat.toUpperCase(), margin + 16, 26);

  y = 52;

  const chips = [];
  if (recipe.time) {
    const t = recipe.time;
    chips.push("⏱  " + (t < 60 ? `${t} min` : `${Math.floor(t/60)}h${t%60?t%60+'min':''}`));
  }
  chips.push(DIFF_LABELS[recipe.diff] || "");
  chips.push(`👥  ${recipe.portions} portion${recipe.portions > 1 ? "s" : ""}`);

  let cx = margin;
  chips.forEach(chip => {
    const tw = doc.getTextWidth(chip) + 8;
    doc.setFillColor(240, 232, 216);
    doc.roundedRect(cx, y - 5, tw, 8, 2, 2, "F");
    doc.setTextColor(140, 123, 107);
    doc.setFontSize(8.5);
    doc.text(chip, cx + 4, y);
    cx += tw + 4;
  });

  y += 12;

  if (recipe.photoURL) {
    try {
      const img = await loadImageAsBase64(recipe.photoURL);
      const imgH = 55;
      checkY(imgH + 5);
      doc.addImage(img, "JPEG", margin, y, contentW, imgH, undefined, "MEDIUM");
      y += imgH + 8;
    } catch { /* skip photo if load fails */ }
  }

  checkY(20);
  doc.setFillColor(240, 232, 216);
  doc.rect(margin, y, contentW, 8, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(44, 26, 14);
  doc.text("INGRÉDIENTS", margin + 4, y + 5.5);
  y += 12;

  recipe.ingredients.forEach((ing, i) => {
    checkY(7);
    const isEven = i % 2 === 0;
    if (isEven) {
      doc.setFillColor(250, 250, 247);
      doc.rect(margin, y - 3.5, contentW, 7, "F");
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(44, 26, 14);
    doc.text(ing.name, margin + 3, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(140, 123, 107);
    doc.text(ing.qty, margin + contentW - 3, y, { align: "right" });
    y += 7;
  });

  y += 6;

  checkY(20);
  doc.setFillColor(240, 232, 216);
  doc.rect(margin, y, contentW, 8, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(44, 26, 14);
  doc.text("PRÉPARATION", margin + 4, y + 5.5);
  y += 12;

  recipe.steps.forEach((step, i) => {
    const stepLines = doc.splitTextToSize(step.text, contentW - 16);
    const stepH = stepLines.length * 5.5 + 8;
    checkY(stepH);

    doc.setFillColor(196, 98, 45);
    doc.circle(margin + 5, y + 2, 4.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text(String(i + 1), margin + 5, y + 3, { align: "center" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(44, 26, 14);
    doc.text(stepLines, margin + 13, y);

    if (step.timer) {
      const mm = Math.floor(step.timer / 60), ss = step.timer % 60;
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.setTextColor(196, 98, 45);
      doc.text(`⏱ ${mm}:${String(ss).padStart(2,"0")}`, margin + 13, y + stepLines.length * 5.5);
      y += 5;
    }

    doc.setDrawColor(228, 217, 204);
    doc.setLineWidth(0.3);
    doc.line(margin + 12, y + stepH - 4, margin + contentW, y + stepH - 4);
    y += stepH;
  });

  if (recipe.notes) {
    y += 4;
    checkY(20);
    doc.setFillColor(245, 230, 220);
    const notesLines = doc.splitTextToSize(recipe.notes, contentW - 10);
    const notesH = notesLines.length * 5.5 + 10;
    doc.roundedRect(margin, y, contentW, notesH, 3, 3, "F");
    doc.setFillColor(196, 98, 45);
    doc.rect(margin, y, 3, notesH, "F");
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(44, 26, 14);
    doc.text(notesLines, margin + 7, y + 6);
    y += notesH + 6;
  }

  const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(140, 123, 107);
    doc.text(`Mon Carnet de Recettes  ·  ${recipe.name}`, margin, 292);
    doc.text(`${p} / ${pageCount}`, W - margin, 292, { align: "right" });
  }

  doc.save(`${recipe.name.toLowerCase().replace(/\s+/g, "-")}.pdf`);
}

async function loadImageAsBase64(url) {
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ── TIMER HOOK ────────────────────────────────────────────────────────────────
function useTimer() {
  const [timer, setTimer] = useState(null);
  const ref_ = useRef(null);
  const start = useCallback((seconds, label) => {
    if (ref_.current) clearInterval(ref_.current);
    setTimer({ remaining: seconds, label, paused: false });
    ref_.current = setInterval(() => {
      setTimer(t => {
        if (!t || t.paused) return t;
        if (t.remaining <= 1) { clearInterval(ref_.current); return { ...t, remaining: 0, done: true }; }
        return { ...t, remaining: t.remaining - 1 };
      });
    }, 1000);
  }, []);
  const toggle = useCallback(() => setTimer(t => t ? { ...t, paused: !t.paused } : t), []);
  const cancel = useCallback(() => { if (ref_.current) clearInterval(ref_.current); setTimer(null); }, []);
  useEffect(() => () => { if (ref_.current) clearInterval(ref_.current); }, []);
  const fmt = s => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  return { timer, start, toggle, cancel, fmt };
}

// ── TOAST ─────────────────────────────────────────────────────────────────────
function Toast({ toasts }) {
  return (
    <div style={{ position:'fixed', bottom:'2rem', left:'50%', transform:'translateX(-50%)', zIndex:1000, display:'flex', flexDirection:'column', gap:'0.5rem', alignItems:'center', width:'90%', maxWidth:'400px' }}>
      {toasts.map(t => (
        <div key={t.id} style={{ background: t.type==='error'?'#dc2626':t.type==='success'?'#2E623E':'var(--text-main)', color:'#fff', padding:'0.6rem 1.4rem', borderRadius:'25px', fontSize:'0.85rem', fontWeight:500, boxShadow:'var(--shadow)', border:'1px solid var(--border)', textTransform:'capitalize', textAlign:'center', width:'100%' }}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

function DiffDots({ d }) {
  return (
    <span style={{ display:'flex', gap:4, alignItems:'center' }}>
      {[1,2,3].map(i => <span key={i} style={{ width:7, height:7, borderRadius:'50%', background: i<=d?'var(--accent)':'var(--border)', display:'inline-block' }} />)}
    </span>
  );
}

// ── RECIPE CARD (WITH SCROLL INERTIA ANIMATION HAUT/BAS) ──────────────────────
function RecipeCard({ recipe, onOpen, onDelete, onAddToProfile, isOwner, isFav, onToggleFav }) {
  const cardRef = useRef(null);
  const t = recipe.time;
  const tLabel = t ? (t < 60 ? `${t}min` : `${Math.floor(t/60)}h${t%60?t%60+'min':''}`) : null;

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
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
    return () => { if (cardRef.current) observer.unobserve(cardRef.current); };
  }, [recipe.id]);

  return (
    <div
      ref={cardRef}
      onClick={() => onOpen(recipe.id)}
      className="recipe-card"
    >
      <div className="card-actions-container" style={{ position:'absolute', top:10, right:10, display:'flex', gap:6, zIndex:5 }}>
        <button className="card-action-inline-btn fav-btn" style={{ color: isFav ? '#dc2626' : 'var(--text-muted)' }} onClick={e => { e.stopPropagation(); onToggleFav(recipe.id); }} title="Favoris">
          {isFav ? '❤️' : '🤍'}
        </button>
        {isOwner ? (
          <button className="card-action-inline-btn delete-btn" onClick={e => { e.stopPropagation(); onDelete(recipe.id); }} title="Supprimer">✕</button>
        ) : (
          <button className="card-action-inline-btn add-btn" onClick={e => { e.stopPropagation(); onAddToProfile(recipe); }}>+ Profil</button>
        )}
      </div>

      {recipe.photoURL ? (
        <div style={{ position:'relative', height:140, overflow:'hidden', borderRadius:'14px 14px 0 0', borderBottom:'1px dashed var(--border)' }}>
          <img src={recipe.photoURL} alt={recipe.name} style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} />
          <div style={{ position:'absolute', inset:0, background:'linear-gradient(to top, rgba(0,0,0,0.3) 0%, transparent 60%)' }} />
          <span style={{ position:'absolute', bottom:8, left:12, fontSize:'1.5rem' }}>{recipe.emoji||'🍽️'}</span>
        </div>
      ) : (
        <div className="card-illustration-sketch">
          <div className="sketch-shape" style={{ borderRadius: recipe.id.charCodeAt(0) % 2 === 0 ? '55% 45% 42% 58% / 40% 50% 50% 60%' : '35% 65% 55% 45% / 60% 40% 60% 40%' }}>
            <span>{recipe.emoji||'🍽️'}</span>
          </div>
        </div>
      )}

      <div style={{ padding:'1.2rem' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:'0.5rem', marginBottom:'0.4rem' }}>
          <div style={{ fontSize:'0.7rem', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--accent)' }}>{recipe.cat}</div>
          {recipe.ownerName && <div style={{ fontSize:'0.7rem', color:'var(--text-muted)' }}>par {recipe.ownerName}</div>}
        </div>
        <div className="card-title">{recipe.name}</div>
        <div style={{ display:'flex', gap:'0.8rem', alignItems:'center', fontSize:'0.8rem', color:'var(--text-muted)', flexWrap:'wrap', marginTop:'0.6rem' }}>
          {tLabel && <span style={{ display:'flex', alignItems:'center', gap:3 }}>⏱ {tLabel}</span>}
          <DiffDots d={recipe.diff} />
          <span>👥 {recipe.portions}</span>
        </div>
      </div>
    </div>
  );
}

// ── AI ASSIST PANEL ──────────────────────────────────────────────────────────
function AIPanel({ onResult, onUsePhotoAsIllustration, onNeedApiKey }) {
  const [mode, setMode] = useState(null);
  const [text, setText] = useState('');
  const [idea, setIdea] = useState('');
  const [photoFile, setPhotoFile] = useState(null);
  const [useAsIllustration, setUseAsIllustration] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const run = async (fn) => {
    if (!hasApiKey()) { onNeedApiKey(); return; }
    setLoading(true); setError('');
    try {
      const r = await fn();
      onResult(r);
      setMode(null); setText(''); setIdea(''); setPhotoFile(null);
    } catch (e) {
      if (e.code === 'NO_API_KEY' || e.code === 'BAD_KEY') onNeedApiKey();
      else setError(e.message || "Une erreur est survenue.");
    } finally { setLoading(false); }
  };

  return (
    <div style={{ background:'var(--accent-light)', border:'1.5px dashed var(--border)', borderRadius:12, padding:'1rem', marginBottom:'1.5rem' }}>
      <div style={{ fontSize:'0.8rem', fontWeight:600, color:'var(--text-main)', marginBottom:'0.8rem' }}>
        ✨ Assisté par l'IA <span style={{ fontWeight:400, color:'var(--text-muted)' }}>(génère tes structures)</span>
      </div>
      <div style={{ display:'flex', gap:'0.5rem', marginBottom: mode ? '1rem' : 0 }}>
        <button type="button" className={`form-tab-btn ${mode==='text'?'active':''}`} onClick={()=>setMode(m=>m==='text'?null:'text')}>📝 Texte</button>
        <button type="button" className={`form-tab-btn ${mode==='photo'?'active':''}`} onClick={()=>setMode(m=>m==='photo'?null:'photo')}>📷 Image</button>
        <button type="button" className={`form-tab-btn ${mode==='idea'?'active':''}`} onClick={()=>setMode(m=>m==='idea'?null:'idea')}>💡 Idée</button>
      </div>
      {mode==='text' && (
        <div>
          <textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Colle ici le bloc de texte brut d'une recette…" className="form-input" style={{ minHeight:100, resize:'vertical', marginBottom:'0.5rem' }} />
          <button type="button" disabled={loading||!text.trim()} onClick={()=>text.trim() && run(()=>extractRecipeFromText(text))} className="form-submit-btn-accent">
            {loading ? '⟳ Analyse intelligente…' : 'Générer la fiche recette'}
          </button>
        </div>
      )}
      {mode==='photo' && (
        <div>
          <input type="file" accept="image/*" onChange={e=>setPhotoFile(e.target.files[0]||null)} style={{ fontSize:'0.85rem', width:'100%' }} />
          <label style={{ display:'flex', alignItems:'center', gap:'0.5rem', fontSize:'0.8rem', color:'var(--text-muted)', marginTop:'0.6rem' }}>
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
      {error && <div style={{ marginTop:'0.6rem', fontSize:'0.8rem', color:'#dc2626', fontWeight:500 }}>{error}</div>}
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
        existingPhotoURL: initial.photoURL || null,
      }, photoFile);
    } catch (e) {
      alert("Erreur d'enregistrement : " + e.message);
    } finally { setSaving(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box form-layout" onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1.5rem' }}>
          <div className="editorial-title" style={{ fontSize:'1.4rem' }}>{title}</div>
          <button onClick={onClose} className="close-square-btn">✕</button>
        </div>

        <AIPanel onResult={applyAIResult} onUsePhotoAsIllustration={setPhotoFile} onNeedApiKey={needApiKey} />

        {/* Photo input */}
        <div style={{ marginBottom:'1.2rem' }}>
          <label className="form-label">Illustration</label>
          {photoPreview ? (
            <div style={{ display:'flex', alignItems:'center', gap:'1rem' }}>
              <img src={photoPreview} alt="" style={{ width:65, height:65, objectFit:'cover', borderRadius:10, border:'2px solid var(--border)' }} />
              <button type="button" onClick={()=>{ setPhotoFile(null); setPhotoPreview(null); }} className="secondary-action-btn">Supprimer l'image</button>
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

        {/* Visibility Buttons Toggle */}
        <div style={{ marginBottom:'1.8rem' }}>
          <label className="form-label">Statut de partage</label>
          <div className="visibility-toggle-container">
            <button type="button" onClick={()=>setVisibility('private')} className={`visibility-toggle-btn ${visibility==='private'?'active':''}`}>
              🔒 Atelier Privé <span style={{fontWeight:400, opacity:0.8}}>(Personnel)</span>
            </button>
            <button type="button" onClick={()=>setVisibility('public')} className={`visibility-toggle-btn ${visibility==='public'?'active':''}`}>
              🌐 Publication Collective <span style={{fontWeight:400, opacity:0.8}}>(Public)</span>
            </button>
          </div>
        </div>

        <div className="form-actions-footer">
          <button onClick={onClose} disabled={saving} className="secondary-action-btn">Annuler</button>
          <button onClick={handleSave} disabled={saving} className="primary-action-btn">
            {saving ? '⟳ Traitement Firebase…' : 'Valider & Sauvegarder'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── SETTINGS MODAL ────────────────────────────────────────────────────────────
function SettingsModal({ onClose }) {
  const [key, setKey] = useState(getApiKey());
  const save = () => { setApiKey(key); onClose(); };
  return (
    <div className="modal-backdrop" style={{ zIndex: 300 }} onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 440, padding: '2rem' }} onClick={e=>e.stopPropagation()}>
        <div className="editorial-title" style={{ fontSize:'1.4rem', marginBottom:'0.6rem' }}>Configuration IA</div>
        <p style={{ fontSize:'0.88rem', color:'var(--text-muted)', lineHeight:1.6, marginBottom:'1.2rem' }}>
          Votre clé Google Gemini active l'extraction et l'idéation automatisée. Sauvegardée localement dans votre propre navigateur.
        </p>
        <input type="password" value={key} onChange={setKey(e.target.value)} placeholder="AIzaSy…" className="form-input" style={{ fontFamily:'monospace', marginBottom:'1.5rem' }} />
        <div style={{ display:'flex', gap:'1rem', justifyContent:'flex-end' }}>
          <button onClick={onClose} className="secondary-action-btn">Fermer</button>
          <button onClick={save} className="primary-action-btn">Enregistrer les paramètres</button>
        </div>
      </div>
    </div>
  );
}

// ── DETAIL MODAL ──────────────────────────────────────────────────────────────
function DetailModal({ recipe, onClose, onEdit, onAddToProfile, isOwner, timerCtx, isFav, onToggleFav }) {
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
        
        {/* Detail Hero Cover */}
        <div style={{ background:'var(--bg-nav)', textAlign:'center', borderBottom:'2px solid var(--border)', position:'relative', overflow:'hidden' }}>
          {recipe.photoURL ? (
            <>
              <img src={recipe.photoURL} alt={recipe.name} style={{ width:'100%', height:240, objectFit:'cover', display:'block' }} />
              <div style={{ position:'absolute', inset:0, background:'linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 60%)' }} />
            </>
          ) : null}
          <div className="detail-hero-overlay-content" style={{ padding: recipe.photoURL ? '1.5rem' : '2.5rem 1.5rem 1.5rem', position: recipe.photoURL ? 'absolute' : 'relative', bottom:0, left:0, right:0, textAlign:'left' }}>
            {!recipe.photoURL && <div style={{ fontSize:'3.5rem', marginBottom:'0.6rem' }}>{recipe.emoji||'🍽️'}</div>}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.3rem' }}>
              <div style={{ fontSize:'0.72rem', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.1em', color: recipe.photoURL ? '#E8F0EA' : 'var(--accent)' }}>{recipe.cat}</div>
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
                Rédigé par {recipe.ownerName}
                {recipe.copiedFrom?.ownerName && ` · Importé depuis le carnet de ${recipe.copiedFrom.ownerName}`}
              </div>
            )}
          </div>
        </div>

        <div style={{ padding:'1.5rem' }}>
          {/* Servings Adjuster */}
          <div style={{ display:'flex', alignItems:'center', gap:'1rem', background:'var(--bg-nav)', border:'1px solid var(--border)', borderRadius:12, padding:'0.6rem 1.2rem', marginBottom:'1.5rem' }}>
            <span style={{ fontSize:'0.85rem', fontWeight:500, color:'var(--text-muted)', flex:1 }}>Proportions</span>
            <div style={{ display:'flex', alignItems:'center', gap:'0.8rem' }}>
              <button onClick={()=>changeMult(-1)} className="portions-round-btn">−</button>
              <span style={{ fontWeight:700, fontSize:'1.1rem', minWidth:'1.5rem', textAlign:'center' }}>{portions}</span>
              <button onClick={()=>changeMult(1)} className="portions-round-btn">+</button>
            </div>
          </div>

          {/* Ingredients Segment */}
          <div className="editorial-title" style={{ fontSize:'1.2rem', marginBottom:'0.6rem' }}>Ingrédients</div>
          <div style={{ background:'var(--bg-main)', borderRadius:12, overflow:'hidden', marginBottom:'1.8rem', border:'1px solid var(--border)' }}>
            {recipe.ingredients.map((ing, i) => (
              <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'0.6rem 1.2rem', borderBottom: i<recipe.ingredients.length-1?'1px dashed var(--border)':'none', fontSize:'0.9rem', background: i%2===0?'#fff':'transparent' }}>
                <span style={{ color:'var(--text-main)', paddingRight:'0.5rem' }}>{ing.name}</span>
                <span style={{ color:'var(--accent)', fontWeight:600, flexShrink:0 }}>{fmtQty(ing.qty)}</span>
              </div>
            ))}
          </div>

          {/* Steps Instructions Segment */}
          <div className="editorial-title" style={{ fontSize:'1.2rem', marginBottom:'0.6rem' }}>Préparation</div>
          <div style={{ marginBottom:'1.8rem' }}>
            {recipe.steps.map((s, i) => (
              <div key={i} style={{ display:'flex', gap:'1.2rem', marginBottom:'1rem', alignItems:'flex-start', padding:'1rem', background: i%2===0?'#fff':'var(--bg-main)', borderRadius:12, border:'1px solid var(--border)' }}>
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
      <div style={{ fontSize:'2.2rem', fontWeight:700, letterSpacing:'-0.02em', fontVariantNumeric:'tabular-nums' }}>
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
  const [mode, setMode] = useState('login');
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
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#EFECE6', padding:'1rem' }}>
      <div className="modal-box" style={{ maxWidth:400, padding:'2.2rem', boxShadow:'0 15px 40px rgba(0,0,0,0.06)', borderRadius:'20px 40px 20px 40px / 40px 20px 40px 20px' }}>
        <div style={{ textAlign:'center', marginBottom:'2rem' }}>
          <div style={{ fontSize:'2rem', marginBottom:'0.3rem' }}>📖</div>
          <div className="editorial-title" style={{ fontSize:'1.6rem' }}>
            Mon Carnet <span style={{ color:'#C85329', fontStyle:'italic' }}>Culinaire</span>
          </div>
        </div>

        <div style={{ display:'flex', gap:'0.4rem', marginBottom:'1.5rem', background:'#DFD9CE', borderRadius:12, padding:4, border:'1px solid #D5CEBF' }}>
          <button type="button" onClick={()=>{setMode('login'); setError('');}} className={`form-tab-btn ${mode==='login'?'active':''}`} style={{fontSize:'0.85rem'}}>
            Connexion
          </button>
          <button type="button" onClick={()=>{setMode('register'); setError('');}} className={`form-tab-btn ${mode==='register'?'active':''}`} style={{fontSize:'0.85rem'}}>
            Créer un compte
          </button>
        </div>

        <form onSubmit={submit}>
          <div style={{ marginBottom:'1rem' }}>
            <label className="form-label">Identifiant unique (Pseudo)</label>
            <input className="form-input" value={username} onChange={e=>setUsername(e.target.value)} placeholder="Ex: augustin_b" autoComplete="username" />
          </div>
          <div style={{ marginBottom: mode==='register' ? '1rem' : '1.5rem' }}>
            <label className="form-label">Mot de passe</label>
            <input type="password" className="form-input" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Minimum 6 caractères" autoComplete={mode==='register'?'new-password':'current-password'} />
          </div>
          {mode==='register' && (
            <div style={{ marginBottom:'1.5rem' }}>
              <label className="form-label">Confirmation du mot de passe</label>
              <input type="password" className="form-input" value={password2} onChange={e=>setPassword2(e.target.value)} autoComplete="new-password" />
            </div>
          )}

          {error && <div style={{ marginBottom:'1rem', fontSize:'0.82rem', color:'#dc2626', background:'#fef2f2', padding:'0.6rem 0.8rem', borderRadius:8, border:'1px solid #fee2e2', fontWeight:500 }}>{error}</div>}

          <button type="submit" disabled={loading || !username.trim() || !password} className="primary-action-btn" style={{ width:'100%', padding:'0.8rem', fontSize:'0.9rem' }}>
            {loading ? '⟳ Traitement des accès…' : (mode==='register' ? "Valider l'inscription" : 'Entrer dans le carnet')}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
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

  const addToast = useCallback((msg, type='info', duration=3500) => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), duration);
  }, []);

  // Save favorites to local storage whenever they change
  useEffect(() => {
    localStorage.setItem("culinary_favs", JSON.stringify(favIds));
  }, [favIds]);

  // Injection des variables CSS du thème selon l'onglet actif
  useEffect(() => {
    const root = document.documentElement;
    const theme = THEMES[activeTab];
    if (theme) {
      Object.keys(theme).forEach((key) => {
        root.style.setProperty(key, theme[key]);
      });
    }
  }, [activeTab]);

  useEffect(() => {
    const unsub = subscribeAuth((u) => setUser(u));
    return unsub;
  }, []);

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
      createdAt: serverTimestamp(),
    });
    addToast('Recette ajoutée au carnet', 'success');
    setShowAdd(false);
  }, [addToast, user]);

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
    recipes = publicRecipes;
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
    loading: { color:'#C85329', icon:'⟳', label:'Liaison…' },
    synced:  { color:'#2E623E', icon:'✓', label:'Profil Synchronisé' },
    error:   { color:'#dc2626', icon:'⚠', label:'Déconnecté' },
  }[syncStatus];

  const allCombined = [...myRecipes, ...publicRecipes];
  const detailRecipe = allCombined.find(r => r.id === detailId);
  const editRecipe = myRecipes.find(r => r.id === editId);
  const needApiKey = () => { addToast("Clé API absente. Ouvrez les réglages (⚙️).", 'error'); setShowSettings(true); };

  if (user === undefined) {
    return (
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#EFECE6', color:'#6E655F', fontSize:'0.95rem', fontWeight:500 }}>
        ⟳ Initialisation du carnet...
      </div>
    );
  }
  if (!user) {
    return <AuthScreen onAuthed={setUser} />;
  }

  return (
    <>
      <StylesStructure />

      <div className="app-container">
        {/* EDITORIAL HEADER BLOCK */}
        <header className="app-header">
          <div className="header-content">
            <div className="logo-area">
              <span style={{ fontSize: '1.4rem' }}>📖</span>
              <h1 className="logo">Carnet.</h1>
            </div>

            {/* Functional Search Field */}
            <div className="search-wrapper">
              <input 
                value={search} 
                onChange={e=>setSearch(e.target.value)} 
                placeholder="Rechercher un ingrédient, un nom..." 
                className="search-input"
              />
            </div>

            {/* Sync Profile Badge & Meta Controls */}
            <div className="user-profile-bar">
              <div className="user-profile-meta-row">
                <span className="sync-badge" style={{ color: statusInfo.color }}>
                  <span>{statusInfo.icon}</span>{statusInfo.label}
                </span>
                <span className="user-name-tag">👤 {user.displayName}</span>
                <button onClick={()=>setShowSettings(true)} className="header-icon-btn" title="Paramètres d'API">⚙️</button>
              </div>
              
              <div className="user-profile-actions-row">
                <button onClick={()=>logoutUser()} className="secondary-action-btn logout-btn">
                  Quitter
                </button>
                <button onClick={()=>setShowAdd(true)} className="primary-action-btn add-recipe-btn">
                  + Ajouter
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* WORKSPACE PROFILE TABS */}
        <div style={{ borderBottom:'1px dashed var(--border)', background:'var(--bg-header)' }}>
          <div className="tabs-container">
            {[
              {k:'mine', label:'📕 Mon Atelier'}, 
              {k:'public', label:'🌐 Répertoire'},
              {k:'favorites', label:'❤️ Favoris'}
            ].map(t => (
              <button key={t.k} onClick={()=>{ setActiveTab(t.k); setActiveCategory('Toutes'); setDetailId(null); }}
                className={`tab-btn ${activeTab===t.k ? 'active' : ''}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* HORIZONTAL CATEGORIES BAR */}
        <div className="categories-outer-bar">
          <div className="categories-inner-container">
            {cats.map(c => (
              <button key={c} onClick={()=>setActiveCategory(c)} className={`category-pill ${c===activeCategory?'active':''}`}>
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* MAIN DISPLAY ENGINE */}
        <main className="main-content">
          {Object.entries(byCat).map(([cat, rs]) => rs.length === 0 ? null : (
            <div key={cat} style={{ marginBottom:'2.5rem' }}>
              <div className="category-section-title">
                {cat}
                <div className="title-decorative-line" />
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
              <div style={{ fontSize:'2.5rem', marginBottom:'0.5rem' }}>📖</div>
              <p className="editorial-title" style={{ fontSize:'1.2rem', marginBottom:'0.2rem' }}>Aucune fiche disponible</p>
              <p style={{ fontSize:'0.9rem', color:'var(--text-muted)' }}>
                {activeTab === 'mine' && "Ajoutez votre première création culinaire à l'Atelier."}
                {activeTab === 'public' && "Aucun partage public ne correspond à vos critères."}
                {activeTab === 'favorites' && "Marquez vos recettes favorites d'un cœur pour les retrouver ici."}
              </p>
            </div>
          )}
        </main>
      </div>

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
          onClose={()=>setDetailId(null)}
          onEdit={() => { setDetailId(null); setEditId(detailId); }}
          onAddToProfile={handleAddToProfile}
          timerCtx={timerCtx}
          isFav={favIds.includes(detailRecipe.id)}
          onToggleFav={toggleFavorite}
        />
      )}

      {showSettings && <SettingsModal onClose={()=>setShowSettings(false)} />}

      <TimerWidget timer={timerCtx.timer} fmt={timerCtx.fmt} toggle={timerCtx.toggle} cancel={timerCtx.cancel} />
      <Toast toasts={toasts} />
    </>
  );
}

// ── CUSTOM EMBEDDED CSS GRAPHIC ENGINE ───────────────────────────────────────
function StylesStructure() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,600;1,400&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');

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

      /* Sticky Top Navigation Bar */
      .app-header {
        position: sticky;
        top: 0;
        z-index: 100;
        background-color: var(--bg-header);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border-bottom: 1px dashed var(--border);
        transition: background-color 0.6s;
      }

      .header-content {
        max-width: 1100px;
        margin: 0 auto;
        padding: 1rem 2rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 1.2rem;
      }

      .logo-area {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .logo {
        font-family: 'Playfair Display', serif;
        font-weight: 600;
        font-style: italic;
        font-size: 1.6rem;
        letter-spacing: -0.5px;
        color: var(--text-main);
      }

      /* Editorial Core Text Typography */
      .editorial-title {
        font-family: 'Playfair Display', serif;
        font-weight: 600;
        color: var(--text-main);
      }

      /* Functional Search Box Context */
      .search-wrapper {
        flex-grow: 1;
        max-width: 320px;
      }

      .search-input {
        width: 100%;
        padding: 10px 16px;
        background: var(--bg-card);
        border: 1.5px solid var(--border);
        font-family: inherit;
        font-size: 0.88rem;
        color: var(--text-main);
        outline: none;
        transition: all 0.3s ease;
        border-radius: 9px 13px 10px 12px / 12px 9px 14px 10px;
      }

      .search-input:focus {
        border-color: var(--accent);
        box-shadow: var(--shadow);
      }

      /* Management Bar Controls */
      .user-profile-bar {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        flex-wrap: wrap;
      }

      .user-profile-meta-row, .user-profile-actions-row {
        display: flex;
        align-items: center;
        gap: 0.6rem;
      }

      .sync-badge {
        font-size: 0.72rem;
        font-weight: 700;
        background: var(--bg-card);
        padding: 5px 12px;
        border-radius: 20px;
        border: 1px solid var(--border);
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .user-name-tag {
        font-size: 0.8rem;
        font-weight: 500;
        color: var(--text-muted);
      }

      /* Custom Handmade Controls */
      .tabs-container {
        max-width: 1100px;
        margin: 0 auto;
        display: flex;
        padding: 0 2rem;
      }

      .tab-btn {
        background: transparent;
        border: none;
        padding: 0.8rem 1.2rem;
        font-family: inherit;
        font-size: 0.9rem;
        font-weight: 600;
        color: var(--text-muted);
        cursor: pointer;
        position: relative;
        border-bottom: 3px solid transparent;
        transition: all 0.3s ease;
      }

      .tab-btn.active {
        color: var(--accent);
        border-bottom-color: var(--accent);
      }

      .categories-outer-bar {
        background: var(--bg-nav);
        border-bottom: 1px solid var(--border);
        overflow-x: auto;
        scrollbar-width: none;
      }
      .categories-outer-bar::-webkit-scrollbar {
        display: none;
      }

      .categories-inner-container {
        max-width: 1100px;
        margin: 0 auto;
        display: flex;
        gap: 0.4rem;
        padding: 0.6rem 2rem;
      }

      .category-pill {
        background: transparent;
        color: var(--text-muted);
        border: none;
        padding: 0.4rem 1.1rem;
        border-radius: 20px;
        font-family: inherit;
        font-size: 0.83rem;
        font-weight: 500;
        cursor: pointer;
        white-space: nowrap;
        transition: all 0.2s ease;
      }

      .category-pill.active {
        background: var(--text-main);
        color: var(--bg-card);
      }

      /* Main Application Framework Workspace */
      .main-content {
        max-width: 1100px;
        margin: 0 auto;
        width: 100%;
        padding: 2rem;
        flex-grow: 1;
      }

      .category-section-title {
        font-family: 'Playfair Display', serif;
        font-size: 1.3rem;
        font-weight: 600;
        color: var(--text-main);
        margin-bottom: 1.2rem;
        display: flex;
        align-items: center;
        gap: 1rem;
      }

      .title-decorative-line {
        flex: 1;
        height: 1px;
        background: linear-gradient(to right, var(--border), transparent);
      }

      .recipes-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
        gap: 1.8rem;
      }

      /* HYBRID CARDS ENGINE : Structural, Fluid Continuous Inertia Scroll Hook */
      .recipe-card {
        position: relative;
        background: var(--bg-card);
        border: 2px solid var(--border);
        border-radius: 25px 12px 20px 15px / 12px 20px 15px 25px;
        box-shadow: var(--shadow);
        cursor: pointer;
        overflow: hidden;
        
        /* Inertia Parameters Initiation */
        opacity: 0;
        transform: translateY(40px) scale(0.97) rotate(0.5deg);
        transition: opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1), 
                    transform 0.8s cubic-bezier(0.16, 1, 0.3, 1), 
                    background-color 0.4s, border-color 0.4s;
      }

      .recipe-card.is-visible {
        opacity: 1;
        transform: translateY(0) scale(1) rotate(0deg);
      }

      .recipe-card:hover {
        transform: translateY(-5px) scale(1.01) rotate(-0.5deg) !important;
        border-color: var(--accent);
      }

      /* Handmade Shape Generation Context */
      .card-illustration-sketch {
        padding: 1.5rem 1.5rem 0.5rem;
        display: flex;
        justify-content: center;
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
        font-size: 1.8rem;
        transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      }

      .recipe-card:hover .sketch-shape {
        border-style: solid;
        transform: scale(1.05) rotate(8deg);
      }

      .card-title {
        font-family: 'Playfair Display', serif;
        font-size: 1.15rem;
        font-weight: 600;
        line-height: 1.3;
        color: var(--text-main);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        height: 44px;
      }

      /* Inline actions layout on cards */
      .card-action-inline-btn {
        border: 1px solid var(--border);
        cursor: pointer;
        font-weight: 600;
        box-shadow: 0 2px 6px rgba(0,0,0,0.05);
        transition: transform 0.2s, background-color 0.2s;
        background: #ffffff;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .card-action-inline-btn:hover { transform: scale(1.08); }

      .delete-btn {
        color: var(--text-muted);
        width: 28px;
        height: 28px;
        border-radius: 6px;
      }
      .delete-btn:hover { color: #dc2626; border-color: #fca5a5; }

      .fav-btn {
        width: 28px;
        height: 28px;
        border-radius: 6px;
        font-size: 0.9rem;
      }

      .add-btn {
        background: var(--accent);
        color: #fff;
        border: none;
        padding: 4px 10px;
        border-radius: 8px;
        font-size: 0.72rem;
        height: 28px;
      }

      /* Structural Overlay Overlays Mechanics */
      .modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(31, 26, 23, 0.4);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        z-index: 200;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1.5rem;
      }

      .modal-box {
        background: #ffffff;
        border: 2px solid var(--border);
        border-radius: 20px;
        width: 100%;
        max-height: 88vh;
        overflow-Y: auto;
        box-shadow: 0 20px 50px rgba(0,0,0,0.1);
      }
      
      .form-layout { max-width: 530px; padding: 2rem; }
      .detail-layout { max-width: 630px; }

      /* Form Elements Typography & Styling */
      .form-label {
        display: block;
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-muted);
        margin-bottom: 0.35rem;
      }

      .form-input {
        width: 100%;
        padding: 0.65rem 0.85rem;
        border: 1.5px solid var(--border);
        border-radius: 10px;
        font-family: inherit;
        font-size: 0.9rem;
        color: var(--text-main);
        background: #FAF9F6;
        outline: none;
      }
      .form-input:focus { border-color: var(--accent); background: #fff; }

      .form-grid-2 {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1rem;
        margin-bottom: 1.2rem;
      }

      .form-grid-3 {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 0.8rem;
        margin-bottom: 1.2rem;
      }

      .form-tab-btn {
        flex: 1;
        padding: 0.55rem;
        border-radius: 8px;
        font-family: inherit;
        font-size: 0.82rem;
        font-weight: 600;
        cursor: pointer;
        background: #fff;
        border: 1.5px solid var(--border);
        color: var(--text-muted);
        transition: all 0.15s ease;
      }
      .form-tab-btn.active {
        background: var(--accent-light);
        border-color: var(--accent);
        color: var(--accent);
      }

      /* Functional Interactive Controls Buttons */
      .primary-action-btn {
        background: var(--accent);
        color: #fff;
        border: none;
        padding: 0.6rem 1.3rem;
        border-radius: 10px;
        font-family: inherit;
        font-size: 0.88rem;
        font-weight: 600;
        cursor: pointer;
        box-shadow: var(--shadow);
        white-space: nowrap;
      }
      .primary-action-btn:hover { opacity: 0.9; }

      .secondary-action-btn {
        background: #fff;
        border: 1.5px solid var(--border);
        color: var(--text-muted);
        padding: 0.55rem 1.1rem;
        border-radius: 10px;
        font-family: inherit;
        font-size: 0.88rem;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
      }
      .secondary-action-btn:hover { border-color: var(--text-main); color: var(--text-main); }

      .form-submit-btn-accent {
        width: 100%;
        padding: 0.6rem;
        border-radius: 8px;
        border: none;
        background: var(--text-main);
        color: #fff;
        font-weight: 600;
        font-size: 0.85rem;
        cursor: pointer;
      }

      .close-square-btn {
        background: var(--bg-nav);
        border: none;
        border-radius: 8px;
        width: 32px;
        height: 32px;
        cursor: pointer;
        color: var(--text-muted);
      }

      .line-item-remove-btn {
        background: transparent;
        border: 1.5px solid var(--border);
        border-radius: 8px;
        width: 34px;
        height: 34px;
        cursor: pointer;
        color: var(--text-muted);
        font-size: 1.1rem;
      }
      .line-item-remove-btn:hover { color: #dc2626; border-color: #fca5a5; }

      .dashed-add-btn {
        width: 100%;
        background: transparent;
        border: 1.5px dashed var(--border);
        border-radius: 10px;
        padding: 0.6rem;
        font-family: inherit;
        font-size: 0.85rem;
        color: var(--text-muted);
        font-weight: 500;
        cursor: pointer;
      }
      .dashed-add-btn:hover { border-color: var(--accent); color: var(--accent); }

      .step-badge-counter {
        width: 26px;
        height: 26px;
        border-radius: 50%;
        background: var(--bg-nav);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.75rem;
        font-weight: 700;
        color: var(--text-main);
        margin-top: 6px;
      }

      .visibility-toggle-container {
        display: flex;
        gap: 0.8rem;
      }

      .visibility-toggle-btn {
        flex: 1;
        padding: 0.7rem;
        border-radius: 10px;
        font-family: inherit;
        font-size: 0.85rem;
        font-weight: 600;
        cursor: pointer;
        border: 1.5px solid var(--border);
        background: #fff;
        color: var(--text-muted);
        text-align: left;
      }
      .visibility-toggle-btn.active {
        border-color: var(--accent);
        background: var(--accent-light);
        color: var(--accent);
      }

      .form-actions-footer {
        display: flex;
        gap: 1rem;
        justify-content: flex-end;
      }

      /* Detail Presentation Elements Module */
      .detail-meta-pill {
        background: rgba(255,255,255,0.85);
        border: 1px solid var(--border);
        border-radius: 20px;
        padding: 0.35rem 0.9rem;
        font-size: 0.8rem;
        color: var(--text-main);
        font-weight: 500;
      }

      .portions-round-btn {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: 1.5px solid var(--border);
        background: #fff;
        cursor: pointer;
        font-size: 1.1rem;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .portions-round-btn:hover { border-color: var(--accent); color: var(--accent); }

      .timer-trigger-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        margin-top: 0.6rem;
        background: var(--accent-light);
        border: 1px solid var(--border);
        color: var(--accent);
        border-radius: 8px;
        padding: 0.4rem 0.85rem;
        font-family: inherit;
        font-size: 0.8rem;
        font-weight: 600;
        cursor: pointer;
      }

      .editorial-notes-block {
        background: var(--accent-light);
        border-radius: 12px;
        padding: 1.1rem;
        font-size: 0.9rem;
        line-height: 1.6;
        color: var(--text-main);
        font-style: italic;
        border-left: 4px solid var(--accent);
        margin-bottom: 1.5rem;
      }

      .modal-actions-drawer {
        display: flex;
        gap: 0.8rem;
        flex-wrap: wrap;
        justify-content: flex-end;
        padding-top: 1rem;
        border-top: 1px dashed var(--border);
      }

      /* Floating Active Core Countdown Component */
      .timer-floating-widget {
        position: fixed;
        bottom: 2rem;
        right: 2rem;
        background: #1F1A17;
        color: #EFECE6;
        border: 1px solid #6E655F;
        border-radius: 16px;
        padding: 1.2rem;
        box-shadow: 0 10px 30px rgba(0,0,0,0.25);
        z-index: 500;
        min-width: 230px;
      }

      .timer-widget-btn {
        flex: 1;
        padding: 0.4rem;
        border-radius: 8px;
        border: none;
        background: rgba(255,255,255,0.12);
        color: #fff;
        font-family: inherit;
        font-size: 0.8rem;
        font-weight: 600;
        cursor: pointer;
      }

      .header-icon-btn {
        background: transparent;
        border: 1px solid var(--border);
        border-radius: 10px;
        width: 36px;
        height: 36px;
        cursor: pointer;
        font-size: 1rem;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .header-icon-btn:hover { background: var(--bg-nav); }

      .empty-state {
        text-align: center;
        padding: 5rem 2rem;
        color: var(--text-muted);
      }

      /* ── RESPONSIVE ENGINE (MOBILE & TABLETS AUTOMATION) ── */
      @media (max-width: 850px) {
        .header-content {
          flex-direction: column;
          align-items: stretch;
          padding: 1rem;
          gap: 0.8rem;
        }
        .search-wrapper {
          max-width: 100%;
        }
        .user-profile-bar {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          width: 100%;
          gap: 0.6rem;
        }
        .user-profile-meta-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          width: 100%;
        }
        .user-profile-actions-row {
          display: flex;
          gap: 0.6rem;
          width: 100%;
        }
        .user-profile-actions-row button {
          flex: 1;
          text-align: center;
          justify-content: center;
        }
        .add-recipe-btn, .logout-btn {
          padding: 0.6rem 1rem;
          font-size: 0.85rem;
        }
        .tabs-container {
          padding: 0 1rem;
          justify-content: space-between;
        }
        .tab-btn {
          padding: 0.8rem 0.5rem;
          font-size: 0.85rem;
          flex: 1;
          text-align: center;
        }
        .categories-inner-container {
          padding: 0.6rem 1rem;
        }
        .main-content {
          padding: 1rem;
        }
      }

      @media (max-width: 550px) {
        .form-grid-2, .form-grid-3 {
          grid-template-columns: 1fr;
          gap: 0.8rem;
          margin-bottom: 0.8rem;
        }
        .form-ingredient-row {
          flex-wrap: nowrap !important;
        }
        .form-ingredient-row .qty-input {
          width: 75px !important;
          flex-shrink: 0;
        }
        .visibility-toggle-container {
          flex-direction: column;
          gap: 0.6rem;
        }
        .form-layout {
          padding: 1.2rem;
        }
        .modal-backdrop {
          padding: 0.5rem;
        }
        .modal-box {
          max-height: 93vh;
        }
        .form-actions-footer {
          flex-direction: column-reverse;
          gap: 0.6rem;
        }
        .form-actions-footer button {
          width: 100%;
          padding: 0.75rem;
        }
        .modal-actions-drawer {
          flex-direction: column;
          gap: 0.6rem;
        }
        .modal-actions-drawer button {
          width: 100%;
          padding: 0.75rem;
          text-align: center;
        }
        .detail-hero-overlay-content {
          position: relative !important;
          background: var(--bg-card) !important;
          color: var(--text-main) !important;
          padding: 1.2rem 1rem !important;
        }
        .detail-hero-overlay-content h1 {
          color: var(--text-main) !important;
          text-shadow: none !important;
          font-size: 1.5rem !important;
        }
        .detail-meta-pill {
          background: var(--bg-nav) !important;
        }
        .timer-floating-widget {
          left: 1rem;
          right: 1rem;
          bottom: 1rem;
          min-width: auto;
        }
      }
    `}</style>
  );
}
