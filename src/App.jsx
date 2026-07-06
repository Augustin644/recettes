import { useState, useEffect, useCallback, useRef } from "react";
import {
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, where, serverTimestamp, arrayUnion, arrayRemove
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { db, storage, subscribeAuth, registerUser, loginUser, logoutUser } from "./firebase";
import {
  getApiKey, setApiKey, hasApiKey,
  extractRecipeFromText, extractRecipeFromImage, generateRecipe, fileToBase64,
} from "./ai";

// ── DESIGN SYSTEM & THEMES CONFIGURATION ──────────────────────────────────────
// Facile à modifier si tu veux changer l'identité visuelle de l'application !
const THEMES = {
  mine: { // Thème Clair Épuré (Inspiration Apple)
    "--bg-main": "#F5F5F7",
    "--bg-card": "#FFFFFF",
    "--bg-header": "rgba(255, 255, 255, 0.8)",
    "--bg-nav": "#E8E8ED",
    "--text-main": "#1D1D1F",
    "--text-muted": "#86868B",
    "--accent": "#0071E3",
    "--accent-light": "#E8F2FC",
    "--border": "#E5E5EA",
    "--shadow": "0 4px 20px rgba(0, 0, 0, 0.05)",
    "--backdrop": "blur(20px) saturate(180%)",
  },
  public: { // Thème Sombre Feutré (Inspiration Lounge/Cinéma)
    "--bg-main": "#0B0B0C",
    "--bg-card": "#161617",
    "--bg-header": "rgba(22, 22, 23, 0.8)",
    "--bg-nav": "#232324",
    "--text-main": "#F5F5F7",
    "--text-muted": "#86868B",
    "--accent": "#FF9F0A",
    "--accent-light": "#2C1E0A",
    "--border": "#2C2C2E",
    "--shadow": "0 8px 30px rgba(0, 0, 0, 0.3)",
    "--backdrop": "blur(20px) saturate(120%)",
  },
  favorites: { // Thème Douceur Romantique (Pour les Favoris)
    "--bg-main": "#FAF6F6",
    "--bg-card": "#FFFFFF",
    "--bg-header": "rgba(255, 255, 255, 0.8)",
    "--bg-nav": "#F3EBEB",
    "--text-main": "#2C1E1E",
    "--text-muted": "#A28F8F",
    "--accent": "#FF3B30",
    "--accent-light": "#FDE8E8",
    "--border": "#EFE1E1",
    "--shadow": "0 4px 20px rgba(255, 59, 48, 0.05)",
    "--backdrop": "blur(20px) saturate(180%)",
  }
};

const CATEGORIES = ["Toutes","Entrées","Plats","Desserts","Boulangerie","Boissons","Sauces & Condiments","Autre"];
const DIFF_LABELS = ["","⬤○○ Facile","⬤⬤○ Intermédiaire","⬤⬤⬤ Difficile"];

// ── SVG ICONS SYSTEM ──────────────────────────────────────────────────────────
const Icons = {
  Search: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>,
  Settings: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>,
  Heart: ({ filled }) => <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>,
  Plus: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5v14"/></svg>,
  LogOut: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
};

// ── PDF EXPORT (Unchanged Logic) ─────────────────────────────────────────────
async function exportRecipeToPDF(recipe) {
  const { jsPDF } = await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, margin = 20, contentW = W - margin * 2;
  let y = 0;
  const addPage = () => { doc.addPage(); y = margin; };
  const checkY = (needed = 10) => { if (y + needed > 280) addPage(); };

  doc.setFillColor(44, 26, 14); doc.rect(0, 0, W, 42, "F");
  doc.setFillColor(196, 98, 45); doc.rect(0, 38, W, 4, "F");
  doc.setFontSize(28); doc.setTextColor(240, 232, 216); doc.text(recipe.emoji || "🍽️", margin, 22);
  doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(255, 255, 255);
  const titleLines = doc.splitTextToSize(recipe.name, contentW - 20); doc.text(titleLines, margin + 16, 18);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(196, 98, 45); doc.text(recipe.cat.toUpperCase(), margin + 16, 26);
  y = 52;

  const chips = [];
  if (recipe.time) { const t = recipe.time; chips.push("⏱  " + (t < 60 ? `${t} min` : `${Math.floor(t/60)}h${t%60?t%60+'min':''}`)); }
  chips.push(DIFF_LABELS[recipe.diff] || ""); chips.push(`👥  ${recipe.portions} portion${recipe.portions > 1 ? "s" : ""}`);
  let cx = margin;
  chips.forEach(chip => {
    const tw = doc.getTextWidth(chip) + 8; doc.setFillColor(240, 232, 216); doc.roundedRect(cx, y - 5, tw, 8, 2, 2, "F");
    doc.setTextColor(140, 123, 107); doc.setFontSize(8.5); doc.text(chip, cx + 4, y); cx += tw + 4;
  });
  y += 12;

  if (recipe.photoURL) { try { const img = await loadImageAsBase64(recipe.photoURL); const imgH = 55; checkY(imgH + 5); doc.addImage(img, "JPEG", margin, y, contentW, imgH, undefined, "MEDIUM"); y += imgH + 8; } catch {} }
  checkY(20); doc.setFillColor(240, 232, 216); doc.rect(margin, y, contentW, 8, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(44, 26, 14); doc.text("INGRÉDIENTS", margin + 4, y + 5.5); y += 12;
  recipe.ingredients.forEach((ing, i) => { checkY(7); if (i % 2 === 0) { doc.setFillColor(250, 250, 247); doc.rect(margin, y - 3.5, contentW, 7, "F"); } doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(44, 26, 14); doc.text(ing.name, margin + 3, y); doc.setFont("helvetica", "bold"); doc.setTextColor(140, 123, 107); doc.text(ing.qty, margin + contentW - 3, y, { align: "right" }); y += 7; });
  y += 6;

  checkY(20); doc.setFillColor(240, 232, 216); doc.rect(margin, y, contentW, 8, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(44, 26, 14); doc.text("PRÉPARATION", margin + 4, y + 5.5); y += 12;
  recipe.steps.forEach((step, i) => {
    const stepLines = doc.splitTextToSize(step.text, contentW - 16); const stepH = stepLines.length * 5.5 + 8; checkY(stepH);
    doc.setFillColor(196, 98, 45); doc.circle(margin + 5, y + 2, 4.5, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(255, 255, 255); doc.text(String(i + 1), margin + 5, y + 3, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(44, 26, 14); doc.text(stepLines, margin + 13, y);
    if (step.timer) { const mm = Math.floor(step.timer / 60), ss = step.timer % 60; doc.setFont("helvetica", "italic"); doc.setFontSize(8); doc.setTextColor(196, 98, 45); doc.text(`⏱ ${mm}:${String(ss).padStart(2,"0")}`, margin + 13, y + stepLines.length * 5.5); y += 5; }
    doc.setDrawColor(228, 217, 204); doc.setLineWidth(0.3); doc.line(margin + 12, y + stepH - 4, margin + contentW, y + stepH - 4); y += stepH;
  });

  if (recipe.notes) { y += 4; checkY(20); doc.setFillColor(245, 230, 220); const notesLines = doc.splitTextToSize(recipe.notes, contentW - 10); const notesH = notesLines.length * 5.5 + 10; doc.roundedRect(margin, y, contentW, notesH, 3, 3, "F"); doc.setFillColor(196, 98, 45); doc.rect(margin, y, 3, notesH, "F"); doc.setFont("helvetica", "italic"); doc.setFontSize(9); doc.setTextColor(44, 26, 14); doc.text(notesLines, margin + 7, y + 6); y += notesH + 6; }
  const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) { doc.setPage(p); doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(140, 123, 107); doc.text(`Mon Carnet de Recettes  ·  ${recipe.name}`, margin, 292); doc.text(`${p} / ${pageCount}`, W - margin, 292, { align: "right" }); }
  doc.save(`${recipe.name.toLowerCase().replace(/\s+/g, "-")}.pdf`);
}

async function loadImageAsBase64(url) {
  const res = await fetch(url); const blob = await res.blob();
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
}

// ── TIMER HOOK (Unchanged) ──────────────────────────────────────────────────
function useTimer() {
  const [timer, setTimer] = useState(null); const ref_ = useRef(null);
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
  return { timer, start, toggle, cancel, fmt: s => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}` };
}

// ── TOAST ─────────────────────────────────────────────────────────────────────
function Toast({ toasts }) {
  return (
    <div style={{ position:'fixed', bottom:'2rem', left:'50%', transform:'translateX(-50%)', zIndex:1000, display:'flex', flexDirection:'column', gap:'0.5rem', alignItems:'center' }}>
      {toasts.map(t => (
        <div key={t.id} style={{ background: t.type==='error'?'#ff453a':t.type==='success'?'#34c759':'var(--text-main)', color: t.type==='error'||t.type==='success' ? '#fff' : 'var(--bg-main)', padding:'0.7rem 1.4rem', borderRadius:'30px', fontSize:'0.85rem', fontWeight:600, boxShadow:'0 10px 30px rgba(0,0,0,0.15)', backdropFilter:'blur(10px)', transition:'all 0.3s' }}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

// ── RECIPE CARD ───────────────────────────────────────────────────────────────
function RecipeCard({ recipe, onOpen, onDelete, onAddToProfile, isOwner, isLiked, onToggleLike }) {
  const [hovered, setHovered] = useState(false);
  const t = recipe.time;
  const tLabel = t ? (t < 60 ? `${t}min` : `${Math.floor(t/60)}h${t%60?t%60+'min':''}`) : null;
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onOpen(recipe.id)}
      className="recipe-card"
    >
      {/* Boutons d'actions contextuels */}
      <div style={{ position:'absolute', top:12, right:12, display:'flex', gap:'6px', zIndex:5 }}>
        <button onClick={e => { e.stopPropagation(); onToggleLike(recipe.id); }}
          className={`card-action-btn ${isLiked ? 'liked' : ''}`} style={{ color: isLiked ? 'var(--accent)' : 'var(--text-muted)' }}>
          <Icons.Heart filled={isLiked} />
        </button>
        {isOwner ? (
          <button onClick={e => { e.stopPropagation(); onDelete(recipe.id); }} className="card-action-btn delete-btn">✕</button>
        ) : (
          <button onClick={e => { e.stopPropagation(); onAddToProfile(recipe); }} className="card-action-btn add-profile-btn" title="Ajouter à mon profil">+</button>
        )}
      </div>

      {recipe.photoURL ? (
        <div style={{ position:'relative', height:160 }}>
          <img src={recipe.photoURL} alt={recipe.name} style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} />
          <div style={{ position:'absolute', inset:0, background:'linear-gradient(to top, rgba(0,0,0,0.4) 0%, transparent 60%)' }} />
          <span className="card-emoji-badge">{recipe.emoji||'🍽️'}</span>
        </div>
      ) : (
        <div className="card-emoji-placeholder">
          <span className="card-emoji-circle">{recipe.emoji||'🍽️'}</span>
        </div>
      )}
      <div style={{ padding:'1.25rem' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.4rem' }}>
          <div style={{ fontSize:'0.7rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em', color:'var(--accent)' }}>{recipe.cat}</div>
          {recipe.ownerName && <div style={{ fontSize:'0.7rem', color:'var(--text-muted)' }}>par {recipe.ownerName}</div>}
        </div>
        <div style={{ fontSize:'1.05rem', fontWeight:600, color:'var(--text-main)', marginBottom:'0.75rem', lineHeight:1.3 }}>{recipe.name}</div>
        <div style={{ display:'flex', gap:'0.8rem', alignItems:'center', fontSize:'0.78rem', color:'var(--text-muted)' }}>
          {tLabel && <span>⏱ {tLabel}</span>}
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
      const r = await fn(); onResult(r); setMode(null); setText(''); setIdea(''); setPhotoFile(null);
    } catch (e) {
      if (e.code === 'NO_API_KEY' || e.code === 'BAD_KEY') onNeedApiKey();
      else setError(e.message || "Une erreur est survenue.");
    } finally { setLoading(false); }
  };

  return (
    <div style={{ background:'var(--bg-main)', border:'1px solid var(--border)', borderRadius:12, padding:'1rem', marginBottom:'1.5rem' }}>
      <div style={{ fontSize:'0.8rem', fontWeight:600, color:'var(--text-main)', marginBottom:'0.75rem' }}>✨ Remplir intelligemment avec l'IA</div>
      <div style={{ display:'flex', gap:'0.5rem', marginBottom: mode ? '0.75rem' : 0 }}>
        {['text', 'photo', 'idea'].map(m => (
          <button key={m} type="button" className={`tab-btn ${mode === m ? 'active' : ''}`} style={{ flex:1, padding:'0.5rem' }} onClick={()=>setMode(p=>p===m?null:m)}>
            {m === 'text' ? '📝 Texte' : m === 'photo' ? '📷 Photo' : '💡 Idée'}
          </button>
        ))}
      </div>
      {mode==='text' && (
        <div>
          <textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Colle le texte d'une recette ici..." className="form-input" style={{ minHeight:100, resize:'vertical' }} />
          <button type="button" disabled={loading||!text.trim()} onClick={()=>text.trim() && run(()=>extractRecipeFromText(text))} className="primary-btn" style={{ width:'100%', marginTop:'0.5rem' }}>
            {loading ? 'Analyse en cours…' : 'Générer depuis le texte'}
          </button>
        </div>
      )}
      {mode==='photo' && (
        <div>
          <input type="file" accept="image/*" onChange={e=>setPhotoFile(e.target.files[0]||null)} style={{ fontSize:'0.85rem', color:'var(--text-main)' }} />
          <label style={{ display:'flex', alignItems:'center', gap:'0.5rem', fontSize:'0.8rem', color:'var(--text-muted)', marginTop:'0.5rem', cursor:'pointer' }}>
            <input type="checkbox" checked={useAsIllustration} onChange={e=>setUseAsIllustration(e.target.checked)} /> Utiliser comme illustration
          </label>
          <button type="button" disabled={loading||!photoFile} onClick={()=>photoFile && run(async () => {
            const { base64, mediaType } = await fileToBase64(photoFile);
            const result = await extractRecipeFromImage(base64, mediaType);
            if (useAsIllustration) onUsePhotoAsIllustration(photoFile);
            return result;
          })} className="primary-btn" style={{ width:'100%', marginTop:'0.5rem' }}>
            {loading ? 'Lecture optique…' : 'Analyser l\'image'}
          </button>
        </div>
      )}
      {mode==='idea' && (
        <div>
          <input value={idea} onChange={e=>setIdea(e.target.value)} placeholder="Ex: Un goûter sain et rapide avec des pommes" className="form-input" />
          <button type="button" disabled={loading||!idea.trim()} onClick={()=>idea.trim() && run(()=>generateRecipe(idea))} className="primary-btn" style={{ width:'100%', marginTop:'0.5rem' }}>
            {loading ? 'Création culinaire…' : 'Créer une recette unique'}
          </button>
        </div>
      )}
      {error && <div style={{ marginTop:'0.5rem', fontSize:'0.8rem', color:'#ff453a' }}>{error}</div>}
    </div>
  );
}

// ── RECIPE FORM ───────────────────────────────────────────────────────────────
function RecipeForm({ initial = {}, onClose, onSave, onNeedApiKey, title = "Nouvelle recette" }) {
  const [name, setName] = useState(initial.name || '');
  const [cat, setCat] = useState(initial.cat || 'Plats');
  const [emoji, setEmoji] = useState(initial.emoji || '');
  const [portions, setPortions] = useState(initial.portions || 4);
  const [time, setTime] = useState(initial.time ? String(initial.time) : '');
  const [diff, setDiff] = useState(initial.diff || 2);
  const [notes, setNotes] = useState(initial.notes || '');
  const [visibility, setVisibility] = useState(initial.visibility || 'private');
  const [ings, setIngs] = useState(initial.ingredients?.length ? initial.ingredients : [{qty:'',name:''},{qty:'',name:''}]);
  const [steps, setSteps] = useState(initial.steps?.length ? initial.steps : [{text:'',timer:null}]);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(initial.photoURL || null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!photoFile) return;
    const url = URL.createObjectURL(photoFile); setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  const setIng = (i, field, v) => setIngs(p => p.map((x,j) => j===i ? {...x,[field]:v} : x));
  const setStepText = (i, v) => setSteps(p => p.map((x,j) => j===i ? {...x, text:v} : x));

  const applyAIResult = (r) => {
    if (r.name) setName(r.name);
    if (r.cat && CATEGORIES.includes(r.cat)) setCat(r.cat);
    if (r.emoji) setEmoji(r.emoji);
    if (r.portions) setPortions(r.portions);
    setTime(r.time != null ? String(r.time) : '');
    if (r.diff) setDiff(r.diff);
    if (Array.isArray(r.ingredients)) setIngs(r.ingredients.map(i => ({ qty: i.qty||'', name: i.name||'' })));
    if (Array.isArray(r.steps)) setSteps(r.steps.map(s => ({ text: s.text||'', timer: s.timer??null })));
    if (r.notes) setNotes(r.notes);
  };

  const handleSave = async () => {
    if (!name.trim()) { alert('Donne un nom à ta recette !'); return; }
    setSaving(true);
    try {
      await onSave({
        name: name.trim(), cat, emoji: emoji||'🍽️',
        portions: parseInt(portions)||4, time: time?parseInt(time):null, diff: parseInt(diff),
        ingredients: ings.filter(i => i.name.trim()),
        steps: steps.filter(s => s.text.trim()).map(s => ({ text: s.text.trim(), timer: s.timer||null })),
        notes: notes.trim(), visibility, existingPhotoURL: initial.photoURL || null,
      }, photoFile);
    } catch (e) { alert("Erreur : " + e.message); } finally { setSaving(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1.5rem' }}>
          <div style={{ fontSize:'1.4rem', fontWeight:700, color:'var(--text-main)' }}>{title}</div>
          <button onClick={onClose} className="card-action-btn">✕</button>
        </div>

        <AIPanel onResult={applyAIResult} onUsePhotoAsIllustration={setPhotoFile} onNeedApiKey={onNeedApiKey} />

        {/* Photo Section */}
        <div style={{ marginBottom:'1.25rem' }}>
          <label className="form-label">Illustration visuelle</label>
          {photoPreview ? (
            <div style={{ display:'flex', alignItems:'center', gap:'1rem' }}>
              <img src={photoPreview} alt="" style={{ width:80, height:80, objectFit:'cover', borderRadius:12, border:'1px solid var(--border)' }} />
              <button type="button" onClick={()=>{ setPhotoFile(null); setPhotoPreview(null); }} className="secondary-btn" style={{ padding:'0.4rem 0.8rem' }}>Retirer</button>
            </div>
          ) : (
            <input type="file" accept="image/*" onChange={e=>setPhotoFile(e.target.files[0]||null)} style={{ color:'var(--text-main)' }} />
          )}
        </div>

        {/* Inputs Généraux */}
        <div style={{ marginBottom:'1.25rem' }}>
          <label className="form-label">Nom de la création culinaire</label>
          <input className="form-input" value={name} onChange={e=>setName(e.target.value)} placeholder="Ex : Pavé de Saumon rôti" />
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem', marginBottom:'1.25rem' }}>
          <div>
            <label className="form-label">Catégorie</label>
            <select className="form-input" value={cat} onChange={e=>setCat(e.target.value)}>{CATEGORIES.filter(c=>c!=='Toutes').map(c=><option key={c}>{c}</option>)}</select>
          </div>
          <div>
            <label className="form-label">Signe distinctif (Emoji)</label>
            <input className="form-input" value={emoji} onChange={e=>setEmoji(e.target.value)} placeholder="🍋" maxLength={2} />
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'1rem', marginBottom:'1.25rem' }}>
          <div>
            <label className="form-label">Portions</label>
            <input className="form-input" type="number" value={portions} onChange={e=>setPortions(e.target.value)} min={1} />
          </div>
          <div>
            <label className="form-label">Temps (min)</label>
            <input className="form-input" type="number" value={time} onChange={e=>setTime(e.target.value)} placeholder="30" />
          </div>
          <div>
            <label className="form-label">Difficulté</label>
            <select className="form-input" value={diff} onChange={e=>setDiff(e.target.value)}>
              <option value={1}>Facile</option><option value={2}>Intermédiaire</option><option value={3}>Difficile</option>
            </select>
          </div>
        </div>

        {/* Ingredients List */}
        <div style={{ marginBottom:'1.25rem' }}>
          <label className="form-label">Ingrédients requis</label>
          {ings.map((ing, i) => (
            <div key={i} style={{ display:'flex', gap:'0.5rem', marginBottom:'0.5rem' }}>
              <input className="form-input" style={{ width:90 }} value={ing.qty} onChange={e=>setIng(i,'qty',e.target.value)} placeholder="Qté (ex: 200g)" />
              <input className="form-input" style={{ flex:1 }} value={ing.name} onChange={e=>setIng(i,'name',e.target.value)} placeholder="Nom de l'ingrédient" />
              <button onClick={()=>setIngs(p => p.filter((_,j)=>j!==i))} className="secondary-btn" style={{ px: '0.6rem' }}>−</button>
            </div>
          ))}
          <button onClick={()=>setIngs(p => [...p, {qty:'',name:''}])} className="secondary-btn" style={{ width:'100%', borderStyle:'dashed' }}>+ Ajouter un ingrédient</button>
        </div>

        {/* Steps List */}
        <div style={{ marginBottom:'1.25rem' }}>
          <label className="form-label">Étapes de préparation</label>
          {steps.map((s, i) => (
            <div key={i} style={{ display:'flex', gap:'0.75rem', marginBottom:'0.75rem', alignItems:'flex-start' }}>
              <div style={{ background:'var(--accent-light)', color:'var(--accent)', minWidth:28, height:28, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.8rem', fontWeight:700, marginTop:6 }}>{i+1}</div>
              <textarea className="form-input" style={{ flex:1, minHeight:60, resize:'vertical' }} value={s.text} onChange={e=>setStepText(i,e.target.value)} placeholder={`Instructions pour l'étape ${i+1}...`} />
              <button onClick={()=>setSteps(p => p.filter((_,j)=>j!==i))} className="secondary-btn" style={{ marginTop:6 }}>−</button>
            </div>
          ))}
          <button onClick={()=>setSteps(p => [...p, {text:'',timer:null}])} className="secondary-btn" style={{ width:'100%', borderStyle:'dashed' }}>+ Ajouter une étape</button>
        </div>

        <div style={{ marginBottom:'1.5rem' }}>
          <label className="form-label">Notes & Astuces du chef</label>
          <textarea className="form-input" style={{ minHeight:70 }} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Variantes, secrets de cuisson..." />
        </div>

        {/* Visibilité avec boutons premium */}
        <div style={{ marginBottom:'2rem' }}>
          <label className="form-label">Confidentialité de la recette</label>
          <div style={{ display:'flex', gap:'1rem' }}>
            <button type="button" onClick={()=>setVisibility('private')} className={`tab-btn ${visibility==='private' ? 'active' : ''}`} style={{ flex:1, padding:'0.75rem' }}>🔒 Privée</button>
            <button type="button" onClick={()=>setVisibility('public')} className={`tab-btn ${visibility==='public' ? 'active' : ''}`} style={{ flex:1, padding:'0.75rem' }}>🌐 Publique</button>
          </div>
        </div>

        <div style={{ display:'flex', gap:'0.75rem', justifyContent:'flex-end' }}>
          <button onClick={onClose} disabled={saving} className="secondary-btn" style={{ padding:'0.6rem 1.2rem' }}>Annuler</button>
          <button onClick={handleSave} disabled={saving} className="primary-btn" style={{ padding:'0.6rem 1.5rem' }}>
            {saving ? 'Sauvegarde…' : 'Enregistrer la recette'}
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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth:420 }} onClick={e=>e.stopPropagation()}>
        <div style={{ fontSize:'1.3rem', fontWeight:700, color:'var(--text-main)', marginBottom:'0.5rem' }}>Clé d'accès Gemini API</div>
        <p style={{ fontSize:'0.85rem', color:'var(--text-muted)', lineHeight:1.5, marginBottom:'1.25rem' }}>
          Permet d'activer l'analyse photo, texte et la génération automatique. Stockée localement de manière sécurisée.
        </p>
        <input type="password" className="form-input" value={key} onChange={e=>setKey(e.target.value)} placeholder="AIzaSy…" style={{ fontFamily:'monospace' }} />
        <div style={{ display:'flex', gap:'0.75rem', justifyContent:'flex-end', marginTop:'1.5rem' }}>
          <button onClick={onClose} className="secondary-btn">Annuler</button>
          <button onClick={save} className="primary-btn">Sauvegarder</button>
        </div>
      </div>
    </div>
  );
}

// ── DETAIL MODAL ──────────────────────────────────────────────────────────────
function DetailModal({ recipe, onClose, onEdit, onAddToProfile, isOwner, timerCtx }) {
  const [mult, setMult] = useState(1);
  const [exporting, setExporting] = useState(false);
  const portions = Math.round(recipe.portions * mult);

  const fmtQty = qty => {
    if (mult === 1) return qty; const num = parseFloat(qty); if (isNaN(num)) return qty;
    return qty.replace(/[\d.]+/, v => Math.round(parseFloat(v) * mult * 10) / 10);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth:600, padding:0, overflow:'hidden' }} onClick={e=>e.stopPropagation()}>
        <div style={{ position:'relative', height: 240, background:'var(--bg-nav)' }}>
          {recipe.photoURL && <img src={recipe.photoURL} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} />}
          <div style={{ position:'absolute', inset:0, background:'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 70%)' }} />
          <button onClick={onClose} className="card-action-btn" style={{ position:'absolute', top:16, right:16, background:'rgba(255,255,255,0.2)', color:'#fff' }}>✕</button>
          
          <div style={{ position:'absolute', bottom:20, left:24, right:24, color:'#fff' }}>
            <div style={{ fontSize:'0.75rem', fontWeight:700, textTransform:'uppercase', color:'var(--accent)', marginBottom:'0.3rem' }}>{recipe.cat}</div>
            <div style={{ fontSize:'1.8rem', fontWeight:700, lineHeight:1.2, display:'flex', alignItems:'center', gap:'8px' }}>
              <span>{recipe.emoji}</span> {recipe.name}
            </div>
          </div>
        </div>

        <div style={{ padding:'1.5rem 2rem 2rem', maxHeight:'60vh', overflowY:'auto' }}>
          {/* Multiplicateur de portions premium */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', background:'var(--bg-main)', padding:'0.75rem 1.25rem', borderRadius:14, marginBottom:'1.5rem' }}>
            <span style={{ fontSize:'0.85rem', color:'var(--text-muted)' }}>Ajuster les proportions</span>
            <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
              <button onClick={()=>mult*recipe.portions > 1 && setMult((mult*recipe.portions - 1)/recipe.portions)} className="secondary-btn" style={{ borderRadius:'50%', width:28, height:28, padding:0 }}>−</button>
              <span style={{ fontWeight:700, fontSize:'1.1rem', minWidth:24, textAlign:'center', color:'var(--text-main)' }}>{portions} pers.</span>
              <button onClick={()=>setMult((mult*recipe.portions + 1)/recipe.portions)} className="secondary-btn" style={{ borderRadius:'50%', width:28, height:28, padding:0 }}>+</button>
            </div>
          </div>

          {/* Ingrédients */}
          <div style={{ fontSize:'1.05rem', fontWeight:600, color:'var(--text-main)', marginBottom:'0.75rem' }}>Ingrédients</div>
          <div style={{ border:'1px solid var(--border)', borderRadius:12, overflow:'hidden', marginBottom:'1.5rem' }}>
            {recipe.ingredients.map((ing, i) => (
              <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'0.6rem 1.2rem', background: i%2===0?'var(--bg-card)':'var(--bg-main)', borderBottom: i<recipe.ingredients.length-1?'1px solid var(--border)':'none', fontSize:'0.9rem', color:'var(--text-main)' }}>
                <span>{ing.name}</span>
                <span style={{ fontWeight:600, color:'var(--accent)' }}>{fmtQty(ing.qty)}</span>
              </div>
            ))}
          </div>

          {/* Étapes */}
          <div style={{ fontSize:'1.05rem', fontWeight:600, color:'var(--text-main)', marginBottom:'0.75rem' }}>Préparation</div>
          <div style={{ display:'flex', flexDirection:'column', gap:'1rem', marginBottom:'1.5rem' }}>
            {recipe.steps.map((s, i) => (
              <div key={i} style={{ display:'flex', gap:'1rem', background:'var(--bg-main)', padding:'1rem', borderRadius:12, border:'1px solid var(--border)' }}>
                <div style={{ background:'var(--accent)', color:'#fff', width:24, height:24, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.75rem', fontWeight:700, flexShrink:0 }}>{i+1}</div>
                <div style={{ flex:1, fontSize:'0.92rem', lineHeight:1.5, color:'var(--text-main)' }}>
                  {s.text}
                  {s.timer && (
                    <button onClick={() => timerCtx.start(s.timer, `Étape ${i+1} — ${recipe.name}`)} className="secondary-btn" style={{ display:'flex', alignItems:'center', gap:'4px', marginTop:'0.5rem', fontSize:'0.75rem', color:'var(--accent)' }}>⏱ Activer le minuteur</button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {recipe.notes && (
            <div style={{ background:'var(--accent-light)', borderLeft:'4px solid var(--accent)', padding:'1rem', borderRadius:8, fontSize:'0.88rem', color:'var(--text-main)', fontStyle:'italic', marginBottom:'2rem' }}>
              {recipe.notes}
            </div>
          )}

          <div style={{ display:'flex', gap:'0.75rem', justifyContent:'flex-end', borderTop:'1px solid var(--border)', paddingTop:'1.25rem' }}>
            <button onClick={async ()=>{ setExporting(true); try { await exportRecipeToPDF(recipe); } finally { setExporting(false); } }} disabled={exporting} className="secondary-btn">📄 PDF</button>
            {isOwner ? <button onClick={onEdit} className="primary-btn">Modifier</button> : <button onClick={()=>onAddToProfile(recipe)} className="primary-btn">+ Ajouter</button>}
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
    <div style={{ position:'fixed', bottom:'2rem', right:'2rem', background:'var(--text-main)', color:'var(--bg-main)', borderRadius:16, padding:'1.25rem', boxShadow:'0 20px 40px rgba(0,0,0,0.2)', zIndex:500, width:240 }}>
      <div style={{ fontSize:'0.7rem', opacity:0.6, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'0.25rem' }}>{timer.label}</div>
      <div style={{ fontSize:'1.8rem', fontWeight:700, fontVariantNumeric:'tabular-nums' }}>{timer.done ? '✓ Prêt !' : fmt(timer.remaining)}</div>
      <div style={{ display:'flex', gap:'0.5rem', marginTop:'1rem' }}>
        <button onClick={toggle} className="primary-btn" style={{ flex:1, padding:'0.4rem', fontSize:'0.75rem', background:'var(--bg-main)', color:'var(--text-main)' }}>{timer.paused ? 'Relancer' : 'Pause'}</button>
        <button onClick={cancel} className="secondary-btn" style={{ flex:1, padding:'0.4rem', fontSize:'0.75rem' }}>Stop</button>
      </div>
    </div>
  );
}

// ── AUTH SCREEN ───────────────────────────────────────────────────────────────
function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState('login'); const [username, setUsername] = useState('');
  const [password, setPassword] = useState(''); const [password2, setPassword2] = useState('');
  const [loading, setLoading] = useState(false); const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault(); setError('');
    if (mode === 'register' && password !== password2) { setError('Les mots de passe divergent.'); return; }
    setLoading(true);
    try { const user = mode === 'register' ? await registerUser(username, password) : await loginUser(username, password); onAuthed(user); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#F5F5F7', padding:'1.5rem' }}>
      <div style={{ background:'#fff', borderRadius:24, width:'100%', maxWidth:380, padding:'2.5rem 2rem', boxShadow:'0 10px 40px rgba(0,0,0,0.06)' }}>
        <div style={{ textAlign:'center', marginBottom:'2rem' }}>
          <div style={{ fontSize:'2rem', marginBottom:'0.5rem' }}>🍳</div>
          <div style={{ fontSize:'1.4rem', fontWeight:700, color:'#1d1d1f' }}>Mon Carnet Secret</div>
        </div>
        <div style={{ display:'flex', gap:'4px', background:'#E8E8ED', borderRadius:10, padding:3, marginBottom:'1.5rem' }}>
          <button type="button" onClick={()=>setMode('login')} className={`tab-btn ${mode==='login'?'active':''}`} style={{ flex:1, padding:'0.5rem', fontSize:'0.8rem' }}>Connexion</button>
          <button type="button" onClick={()=>setMode('register')} className={`tab-btn ${mode==='register'?'active':''}`} style={{ flex:1, padding:'0.5rem', fontSize:'0.8rem' }}>Inscription</button>
        </div>
        <form onSubmit={submit}>
          <div style={{ marginBottom:'0.75rem' }}><label className="form-label">Identifiant</label><input className="form-input" value={username} onChange={e=>setUsername(e.target.value)} placeholder="Utilisateur" /></div>
          <div style={{ marginBottom:'0.75rem' }}><label className="form-label">Mot de passe</label><input type="password" className="form-input" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••" /></div>
          {mode==='register' && <div style={{ marginBottom:'1.5rem' }}><label className="form-label">Confirmation</label><input type="password" className="form-input" value={password2} onChange={e=>setPassword2(e.target.value)} placeholder="••••••" /></div>}
          {error && <div style={{ color:'#ff3b30', fontSize:'0.8rem', marginBottom:'1rem' }}>{error}</div>}
          <button type="submit" disabled={loading} className="primary-btn" style={{ width:'100%', padding:'0.75rem', marginTop:'0.5rem' }}>{loading?'Validation...':mode==='login'?'Se connecter':'Créer mon compte'}</button>
        </form>
      </div>
    </div>
  );
}

// ── MAIN APPLICATION COMPONENTS ───────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(undefined);
  const [activeTab, setActiveTab] = useState('mine'); // 'mine' | 'public' | 'favorites'
  const [myRecipes, setMyRecipes] = useState([]);
  const [publicRecipes, setPublicRecipes] = useState([]);
  const [activeCategory, setActiveCategory] = useState('Toutes');
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [editId, setEditId] = useState(null);
  const [toasts, setToasts] = useState([]);
  const timerCtx = useTimer();

  const addToast = useCallback((msg, type='info') => {
    const id = Date.now(); setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000);
  }, []);

  // Application dynamique des thèmes au document racine HTML
  useEffect(() => {
    const currentTheme = THEMES[activeTab] || THEMES.mine;
    Object.entries(currentTheme).forEach(([prop, val]) => {
      document.documentElement.style.setProperty(prop, val);
    });
  }, [activeTab]);

  useEffect(() => { const unsub = subscribeAuth(u => setUser(u)); return unsub; }, []);

  // Firestore Snapshot (Mes Recettes)[cite: 13]
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'recipes'), where('ownerId', '==', user.uid), orderBy('createdAt', 'asc'));
    return onSnapshot(q, snap => setMyRecipes(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, [user]);

  // Firestore Snapshot (Recettes Publiques)[cite: 13]
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'recipes'), where('visibility', '==', 'public'), orderBy('createdAt', 'asc'));
    return onSnapshot(q, snap => setPublicRecipes(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, [user]);

  const uploadPhoto = async (id, photoFile) => {
    const sRef = ref(storage, `photos/${user.uid}/${id}`); await uploadBytes(sRef, photoFile);
    return await getDownloadURL(sRef);
  };

  const handleSaveNew = useCallback(async (data, photoFile) => {
    const newRef = doc(collection(db, 'recipes')); let photoURL = null;
    if (photoFile) photoURL = await uploadPhoto(newRef.id, photoFile);
    await setDoc(newRef, { ...data, photoURL, ownerId: user.uid, ownerName: user.displayName, likes: [], createdAt: serverTimestamp() });
    addToast('✓ Recette ajoutée', 'success'); setShowAdd(false);
  }, [user, addToast]);

  const handleSaveEdit = useCallback(async (data, photoFile) => {
    const recipe = myRecipes.find(r => r.id === editId); if (!recipe) return;
    let photoURL = data.existingPhotoURL;
    if (photoFile) {
      if (recipe.photoURL) { try { await deleteObject(ref(storage, `photos/${user.uid}/${editId}`)); } catch {} }
      photoURL = await uploadPhoto(editId, photoFile);
    } else if (data.existingPhotoURL === null && recipe.photoURL) {
      try { await deleteObject(ref(storage, `photos/${user.uid}/${editId}`)); } catch {} photoURL = null;
    }
    const { existingPhotoURL, ...cleanData } = data;
    await updateDoc(doc(db, 'recipes', editId), { ...cleanData, photoURL });
    addToast('✓ Modification enregistrée', 'success'); setEditId(null);
  }, [editId, myRecipes, user, addToast]);

  const handleDelete = useCallback(async (id) => {
    if (!window.confirm('Supprimer définitivement ?')) return;
    const recipe = myRecipes.find(r => r.id === id);
    try {
      await deleteDoc(doc(db, 'recipes', id));
      if (recipe?.photoURL) { try { await deleteObject(ref(storage, `photos/${user.uid}/${id}`)); } catch {} }
      addToast('Recette supprimée'); if (detailId === id) setDetailId(null);
    } catch { addToast('Erreur lors de la suppression', 'error'); }
  }, [myRecipes, detailId, user, addToast]);

  const handleAddToProfile = useCallback(async (recipe) => {
    const newRef = doc(collection(db, 'recipes'));
    const { id, ownerId, ownerName, createdAt, copiedFrom, likes, ...rest } = recipe;
    await setDoc(newRef, { ...rest, visibility: 'private', ownerId: user.uid, ownerName: user.displayName, likes: [], createdAt: serverTimestamp() });
    addToast('✓ Ajoutée à ton espace', 'success'); setDetailId(null);
  }, [user, addToast]);

  // Logique d'ajout/suppression des favoris (Like)
  const handleToggleLike = useCallback(async (id) => {
    // On cherche la recette n'importe où elle se trouve
    const r = [...myRecipes, ...publicRecipes].find(x => x.id === id);
    if (!r) return;
    const isLiked = r.likes?.includes(user.uid);
    await updateDoc(doc(db, 'recipes', id), {
      likes: isLiked ? arrayRemove(user.uid) : arrayUnion(user.uid)
    });
    addToast(isLiked ? 'Retiré des favoris' : 'Ajouté aux favoris ❤️', 'success');
  }, [myRecipes, publicRecipes, user, addToast]);

  // Sélection du catalogue de recettes selon l'onglet actif[cite: 13]
  const baseRecipes = activeTab === 'mine' ? myRecipes : activeTab === 'public' ? publicRecipes : [...myRecipes, ...publicRecipes].filter(r => r.likes?.includes(user.uid));
  
  // Suppression des doublons de la vue favoris (au cas où une recette est à moi et publique)
  const recipes = Array.from(new Map(baseRecipes.map(r => [r.id, r])).values());

  const filtered = recipes.filter(r => {
    const matchCat = activeCategory === 'Toutes' || r.cat === activeCategory;
    const q = search.toLowerCase();
    return matchCat && (!q || r.name.toLowerCase().includes(q) || r.cat.toLowerCase().includes(q) || r.ingredients.some(i => i.name.toLowerCase().includes(q)));
  });

  const cats = ['Toutes', ...new Set(recipes.map(r => r.cat))];
  const byCat = activeCategory === 'Toutes'
    ? Object.fromEntries(cats.filter(c=>c!=='Toutes').map(c => [c, filtered.filter(r=>r.cat===c)]).filter(([,v])=>v.length>0))
    : { [activeCategory]: filtered };

  if (user === undefined) return <div className="loader">Chargement de votre atelier culinaire…</div>;
  if (!user) return <AuthScreen onAuthed={setUser} />;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin:0; padding:0; }
        body { font-family: 'Inter', sans-serif; background: var(--bg-main); color: var(--text-main); transition: background 0.4s ease, color 0.4s ease; min-height: 100vh; -webkit-font-smoothing: antialiased; }
        
        /* Premium Header Styling */
        .glass-header { position: sticky; top:0; z-index:100; background: var(--bg-header); backdrop-filter: var(--backdrop); -webkit-backdrop-filter: var(--backdrop); border-bottom: 1px solid var(--border); transition: all 0.4s ease; }
        
        /* Navigation & Tabs */
        .nav-container { max-width: 1200px; margin: 0 auto; display: flex; align-items: center; gap: 1.5rem; padding: 0.75rem 1.5rem; flex-wrap: wrap; }
        .tab-btn { background: none; border: none; padding: 0.5rem 1rem; font-size: 0.88rem; font-weight: 500; color: var(--text-muted); cursor: pointer; border-radius: 8px; transition: all 0.2s ease; display: flex; align-items: center; gap: 6px; }
        .tab-btn.active { background: var(--bg-nav); color: var(--text-main); font-weight: 600; }
        
        /* Premium Buttons */
        .primary-btn { background: var(--accent); color: #fff; border: none; padding: 0.55rem 1.1rem; border-radius: 10px; font-weight: 600; font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: opacity 0.15s; }
        .primary-btn:hover { opacity: 0.9; }
        .secondary-btn { background: var(--bg-nav); color: var(--text-main); border: 1px solid var(--border); padding: 0.55rem 1.1rem; border-radius: 10px; font-weight: 500; font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: background 0.2s; }
        .secondary-btn:hover { background: var(--border); }
        
        /* Search Box */
        .search-wrapper { position: relative; flex: 1; min-width: 200px; }
        .search-input { width: 100%; padding: 0.55rem 1rem 0.55rem 2.2rem; border-radius: 10px; border: 1px solid var(--border); background: var(--bg-main); color: var(--text-main); font-size: 0.88rem; outline: none; transition: all 0.2s; }
        .search-input:focus { border-color: var(--accent); background: var(--bg-card); }
        
        /* Recipe Grid & Cards */
        .recipe-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 20px; overflow: hidden; cursor: pointer; position: relative; transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.25s ease, border-color 0.25s ease; box-shadow: var(--shadow); }
        .recipe-card:hover { transform: translateY(-4px); border-color: var(--text-muted); }
        .card-action-btn { background: rgba(255,255,255,0.9); border: 1px solid #E5E5EA; border-radius: 50%; width: 32px; height: 32px; display: flex; alignItems: center; justifyContent: center; cursor: pointer; color: #1c1c1e; transition: all 0.15s; box-shadow: 0 4px 12px rgba(0,0,0,0.08); font-size: 0.85rem; font-weight:600; }
        .card-action-btn:hover { transform: scale(1.05); background: #fff; }
        .card-action-btn.liked { background: var(--accent-light) !important; border-color: var(--accent) !important; }
        
        /* Beautiful Badge & Circle System */
        .card-emoji-badge { position: absolute; bottom:-16px; left: 16px; width: 38px; height: 38px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; box-shadow: var(--shadow); }
        .card-emoji-placeholder { height: 110px; background: linear-gradient(135deg, var(--bg-nav) 0%, var(--bg-main) 100%); display: flex; align-items: center; justify-content: center; }
        .card-emoji-circle { width: 56px; height: 56px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.6rem; box-shadow: var(--shadow); }
        
        /* Modals Structure */
        .modal-backdrop { position: fixed; inset:0; background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); z-index: 200; display: flex; align-items: center; justify-content: center; padding: 1.5rem; }
        .modal-content { background: var(--bg-card); border: 1px solid var(--border); border-radius: 24px; width: 100%; maxWidth: 520px; maxHeight: 90vh; overflow-Y: auto; padding: 2rem; box-shadow: 0 30px 70px rgba(0,0,0,0.3); transition: background 0.3s ease; }
        
        /* Inputs Formulaires */
        .form-label { display: block; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.02em; color: var(--text-muted); margin-bottom: 0.4rem; }
        .form-input { width: 100%; padding: 0.65rem 0.9rem; border: 1px solid var(--border); borderRadius: 10px; background: var(--bg-main); color: var(--text-main); font-family: inherit; font-size: 0.9rem; outline: none; transition: all 0.2s; }
        .form-input:focus { border-color: var(--accent); background: var(--bg-card); }
        
        /* Helpers */
        .loader { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #000; color: #fff; font-size: 0.9rem; font-weight: 500; }
      `}</style>

      {/* HEADER PREMIUM */}
      <header className="glass-header">
        <div className="nav-container">
          <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>🍳</span> Mon Carnet
          </div>
          
          {/* Menu de navigation global */}
          <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-main)', padding: '4px', borderRadius: '10px', border: '1px solid var(--border)' }}>
            <button onClick={() => { setActiveTab('mine'); setActiveCategory('Toutes'); }} className={`tab-btn ${activeTab === 'mine' ? 'active' : ''}`}>📕 Atelier</button>
            <button onClick={() => { setActiveTab('public'); setActiveCategory('Toutes'); }} className={`tab-btn ${activeTab === 'public' ? 'active' : ''}`}>🌐 Découvrir</button>
            <button onClick={() => { setActiveTab('favorites'); setActiveCategory('Toutes'); }} className={`tab-btn ${activeTab === 'favorites' ? 'active' : ''}`}>❤️ Favoris</button>
          </div>

          <div className="search-wrapper">
            <span style={{ position: 'absolute', left: 10, top: '55%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}><Icons.Search /></span>
            <input className="search-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher une recette, un ingrédient..." />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button onClick={() => setShowSettings(true)} className="secondary-btn" style={{ padding: '0.6rem' }} title="Réglages de l'IA"><Icons.Settings /></button>
            <button onClick={() => setShowAdd(true)} className="primary-btn"><Icons.Plus /> Ajouter</button>
            <button onClick={() => logoutUser()} className="secondary-btn" style={{ fontSize: '0.78rem' }}><Icons.LogOut /></button>
          </div>
        </div>

        {/* Barre des catégories */}
        <div style={{ borderTop: '1px solid var(--border)', overflowX: 'auto', background: 'var(--bg-card)' }}>
          <div style={{ maxW: 1200, margin: '0 auto', display: 'flex', gap: '6px', padding: '0.5rem 1.5rem' }}>
            {cats.map(c => (
              <button key={c} onClick={() => setActiveCategory(c)} className={`tab-btn ${c === activeCategory ? 'active' : ''}`} style={{ fontSize: '0.8rem', padding: '0.35rem 0.85rem', borderRadius: '15px' }}>{c}</button>
            ))}
          </div>
        </div>
      </header>

      {/* GRILLE DE CONTENU PRINCIPALE */}
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '2.5rem 1.5rem' }}>
        {Object.entries(byCat).map(([catName, list]) => list.length === 0 ? null : (
          <div key={catName} style={{ marginBottom: '2.5rem' }}>
            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
              {catName}
              <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1.5rem' }}>
              {list.map(r => (
                <RecipeCard key={r.id} recipe={r} onOpen={setDetailId} onDelete={handleDelete} onAddToProfile={handleAddToProfile} isOwner={r.ownerId === user.uid} isLiked={r.likes?.includes(user.uid)} onToggleLike={handleToggleLike} />
              ))}
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '6rem 2rem', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🍽️</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-main)' }}>Aucun élément trouvé</div>
            <p style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}>Modifiez vos filtres ou ajoutez une nouvelle recette pour commencer.</p>
          </div>
        )}
      </main>

      {/* SYSTEM CONTROLLERS (MODALS & WIDGETS) */}
      {showAdd && <RecipeForm title="Nouvelle Recette" onClose={() => setShowAdd(false)} onSave={handleSaveNew} onNeedApiKey={() => { addToast('Clé API requise', 'error'); setShowSettings(true); }} />}
      {editId && <RecipeForm title="Modifier la Recette" initial={myRecipes.find(r => r.id === editId)} onClose={() => setEditId(null)} onSave={handleSaveEdit} onNeedApiKey={() => setShowSettings(true)} />}
      {detailId && <DetailModal recipe={[...myRecipes, ...publicRecipes].find(r => r.id === detailId)} isOwner={[...myRecipes, ...publicRecipes].find(r => r.id === detailId)?.ownerId === user.uid} onClose={() => setDetailId(null)} onEdit={() => { const id = detailId; setDetailId(null); setEditId(id); }} onAddToProfile={handleAddToProfile} timerCtx={timerCtx} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      
      <TimerWidget timer={timerCtx.timer} fmt={timerCtx.fmt} toggle={timerCtx.toggle} cancel={timerCtx.cancel} />
      <Toast toasts={toasts} />
    </>
  );
}
