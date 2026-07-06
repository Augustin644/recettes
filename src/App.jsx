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

// ── PDF EXPORT ────────────────────────────────────────────────────────────────
async function exportRecipeToPDF(recipe) {
  const { jsPDF } = await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm");

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, margin = 20, contentW = W - margin * 2;
  let y = 0;

  const addPage = () => { doc.addPage(); y = margin; };
  const checkY = (needed = 10) => { if (y + needed > 280) addPage(); };

  // ── En-tête colorée
  doc.setFillColor(44, 26, 14);
  doc.rect(0, 0, W, 42, "F");
  doc.setFillColor(196, 98, 45);
  doc.rect(0, 38, W, 4, "F");

  // Emoji + titre
  doc.setFontSize(28);
  doc.setTextColor(240, 232, 216);
  doc.text(recipe.emoji || "🍽️", margin, 22);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(255, 255, 255);
  const titleLines = doc.splitTextToSize(recipe.name, contentW - 20);
  doc.text(titleLines, margin + 16, 18);

  // Catégorie
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(196, 98, 45);
  doc.text(recipe.cat.toUpperCase(), margin + 16, 26);

  y = 52;

  // ── Chips infos
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

  // ── Photo si disponible
  if (recipe.photoURL) {
    try {
      const img = await loadImageAsBase64(recipe.photoURL);
      const imgH = 55;
      checkY(imgH + 5);
      doc.addImage(img, "JPEG", margin, y, contentW, imgH, undefined, "MEDIUM");
      y += imgH + 8;
    } catch { /* skip photo if load fails */ }
  }

  // ── Ingrédients
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

  // ── Préparation
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

    // Numéro cerclé
    doc.setFillColor(196, 98, 45);
    doc.circle(margin + 5, y + 2, 4.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text(String(i + 1), margin + 5, y + 3, { align: "center" });

    // Texte
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(44, 26, 14);
    doc.text(stepLines, margin + 13, y);

    // Timer si présent
    if (step.timer) {
      const mm = Math.floor(step.timer / 60), ss = step.timer % 60;
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.setTextColor(196, 98, 45);
      doc.text(`⏱ ${mm}:${String(ss).padStart(2,"0")}`, margin + 13, y + stepLines.length * 5.5);
      y += 5;
    }

    // Séparateur
    doc.setDrawColor(228, 217, 204);
    doc.setLineWidth(0.3);
    doc.line(margin + 12, y + stepH - 4, margin + contentW, y + stepH - 4);
    y += stepH;
  });

  // ── Notes
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

  // ── Pied de page
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
    <div style={{ position:'fixed', bottom:'5rem', left:'50%', transform:'translateX(-50%)', zIndex:1000, display:'flex', flexDirection:'column', gap:'0.5rem', alignItems:'center' }}>
      {toasts.map(t => (
        <div key={t.id} style={{ background: t.type==='error'?'#dc2626':t.type==='success'?'#15803d':'#2C1A0E', color:'#fff', padding:'0.6rem 1.2rem', borderRadius:'20px', fontSize:'0.85rem', fontWeight:500, boxShadow:'0 4px 16px rgba(0,0,0,0.2)', whiteSpace:'nowrap', maxWidth:'88vw', textAlign:'center' }}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

function DiffDots({ d }) {
  return (
    <span style={{ display:'flex', gap:3 }}>
      {[1,2,3].map(i => <span key={i} style={{ width:7, height:7, borderRadius:'50%', background: i<=d?'#C4622D':'#E4D9CC', display:'inline-block' }} />)}
    </span>
  );
}

// ── RECIPE CARD ───────────────────────────────────────────────────────────────
function RecipeCard({ recipe, onOpen, onDelete, onEdit, onAddToProfile, isOwner }) {
  const [hovered, setHovered] = useState(false);
  const t = recipe.time;
  const tLabel = t ? (t < 60 ? `${t}min` : `${Math.floor(t/60)}h${t%60?t%60+'min':''}`) : null;
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onOpen(recipe.id)}
      style={{ background:'#fff', border:'1px solid #E4D9CC', borderRadius:16, overflow:'hidden', cursor:'pointer', position:'relative', transition:'transform 0.18s, box-shadow 0.18s', transform: hovered?'translateY(-4px)':'none', boxShadow: hovered?'0 12px 32px rgba(44,26,14,0.14)':'0 2px 8px rgba(44,26,14,0.06)' }}
    >
      {hovered && isOwner && (
        <button onClick={e => { e.stopPropagation(); onDelete(recipe.id); }}
          style={{ position:'absolute', top:8, right:8, background:'rgba(255,255,255,0.95)', border:'1px solid #E4D9CC', borderRadius:6, width:28, height:28, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.8rem', color:'#8C7B6B', zIndex:2, boxShadow:'0 1px 4px rgba(0,0,0,0.1)' }}>✕</button>
      )}
      {hovered && !isOwner && (
        <button onClick={e => { e.stopPropagation(); onAddToProfile(recipe); }}
          style={{ position:'absolute', top:8, right:8, background:'#C4622D', color:'#fff', border:'none', borderRadius:8, padding:'0.3rem 0.6rem', cursor:'pointer', fontSize:'0.72rem', fontWeight:600, zIndex:2, boxShadow:'0 1px 4px rgba(0,0,0,0.2)' }}>+ Mon profil</button>
      )}
      {recipe.photoURL ? (
        <div style={{ position:'relative', height:130, borderBottom:'1px solid #E4D9CC' }}>
          <img src={recipe.photoURL} alt={recipe.name} style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} />
          <div style={{ position:'absolute', inset:0, background:'linear-gradient(to top, rgba(44,26,14,0.5) 0%, transparent 60%)' }} />
          <span style={{ position:'absolute', bottom:8, left:10, fontSize:'1.4rem', filter:'drop-shadow(0 1px 3px rgba(0,0,0,0.5))' }}>{recipe.emoji||'🍽️'}</span>
        </div>
      ) : (
        <div style={{ background:'linear-gradient(135deg, #F0E8D8 0%, #E8D8C4 100%)', padding:'1.6rem', textAlign:'center', fontSize:'2.8rem', borderBottom:'1px solid #E4D9CC' }}>{recipe.emoji||'🍽️'}</div>
      )}
      <div style={{ padding:'1rem 1.1rem' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:'0.5rem' }}>
          <div style={{ fontSize:'0.67rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.09em', color:'#C4622D', marginBottom:'0.3rem' }}>{recipe.cat}</div>
          {recipe.ownerName && (
            <div style={{ fontSize:'0.68rem', color:'#8C7B6B', whiteSpace:'nowrap' }}>par {recipe.ownerName}</div>
          )}
        </div>
        <div style={{ fontFamily:"'Playfair Display',serif", fontSize:'1rem', fontWeight:600, color:'#2C1A0E', marginBottom:'0.55rem', lineHeight:1.3 }}>{recipe.name}</div>
        <div style={{ display:'flex', gap:'0.7rem', alignItems:'center', fontSize:'0.78rem', color:'#8C7B6B', flexWrap:'wrap' }}>
          {tLabel && <span>⏱ {tLabel}</span>}
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

  const btnStyle = active => ({
    flex:1, padding:'0.55rem 0.4rem', borderRadius:9, cursor:'pointer', fontFamily:"'Inter',sans-serif",
    fontSize:'0.8rem', fontWeight:600, border: active ? '1.5px solid #C4622D' : '1.5px solid #E4D9CC',
    background: active ? '#F5E6DC' : '#fff', color: active ? '#C4622D' : '#8C7B6B',
    transition:'all 0.15s',
  });

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
    <div style={{ background:'#FAFAF7', border:'1.5px dashed #E4D9CC', borderRadius:12, padding:'0.9rem', marginBottom:'1.25rem' }}>
      <div style={{ fontSize:'0.78rem', fontWeight:600, color:'#2C1A0E', marginBottom:'0.6rem', display:'flex', alignItems:'center', gap:'0.4rem' }}>
        ✨ Remplir avec l'IA <span style={{ fontWeight:400, color:'#8C7B6B' }}>(optionnel)</span>
      </div>
      <div style={{ display:'flex', gap:'0.5rem', marginBottom: mode ? '0.75rem' : 0 }}>
        <button type="button" style={btnStyle(mode==='text')} onClick={()=>setMode(m=>m==='text'?null:'text')}>📝 Texte</button>
        <button type="button" style={btnStyle(mode==='photo')} onClick={()=>setMode(m=>m==='photo'?null:'photo')}>📷 Photo</button>
        <button type="button" style={btnStyle(mode==='idea')} onClick={()=>setMode(m=>m==='idea'?null:'idea')}>💡 Idée</button>
      </div>
      {mode==='text' && (
        <div>
          <textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Colle ici le texte d'une recette…"
            style={{ width:'100%', minHeight:100, padding:'0.6rem 0.75rem', border:'1.5px solid #E4D9CC', borderRadius:9, fontFamily:"'Inter',sans-serif", fontSize:'0.85rem', resize:'vertical', outline:'none' }} />
          <button type="button" disabled={loading||!text.trim()} onClick={()=>text.trim() && run(()=>extractRecipeFromText(text))}
            style={{ marginTop:'0.5rem', width:'100%', padding:'0.55rem', borderRadius:9, border:'none', background:'#C4622D', color:'#fff', fontWeight:600, fontSize:'0.85rem', cursor: loading?'default':'pointer', opacity: loading||!text.trim()?0.6:1 }}>
            {loading ? '⟳ Analyse…' : 'Générer la recette'}
          </button>
        </div>
      )}
      {mode==='photo' && (
        <div>
          <input type="file" accept="image/*" onChange={e=>setPhotoFile(e.target.files[0]||null)} style={{ width:'100%', fontSize:'0.82rem' }} />
          <label style={{ display:'flex', alignItems:'center', gap:'0.4rem', fontSize:'0.78rem', color:'#8C7B6B', marginTop:'0.5rem' }}>
            <input type="checkbox" checked={useAsIllustration} onChange={e=>setUseAsIllustration(e.target.checked)} />
            Utiliser aussi comme illustration
          </label>
          <button type="button" disabled={loading||!photoFile} onClick={()=>photoFile && run(async () => {
            const { base64, mediaType } = await fileToBase64(photoFile);
            const result = await extractRecipeFromImage(base64, mediaType);
            if (useAsIllustration) onUsePhotoAsIllustration(photoFile);
            return result;
          })} style={{ marginTop:'0.5rem', width:'100%', padding:'0.55rem', borderRadius:9, border:'none', background:'#C4622D', color:'#fff', fontWeight:600, fontSize:'0.85rem', cursor: loading?'default':'pointer', opacity: loading||!photoFile?0.6:1 }}>
            {loading ? '⟳ Lecture…' : 'Lire et générer'}
          </button>
        </div>
      )}
      {mode==='idea' && (
        <div>
          <input value={idea} onChange={e=>setIdea(e.target.value)} placeholder="Ex : un curry de légumes rapide et épicé"
            style={{ width:'100%', padding:'0.6rem 0.75rem', border:'1.5px solid #E4D9CC', borderRadius:9, fontFamily:"'Inter',sans-serif", fontSize:'0.85rem', outline:'none' }} />
          <button type="button" disabled={loading||!idea.trim()} onClick={()=>idea.trim() && run(()=>generateRecipe(idea))}
            style={{ marginTop:'0.5rem', width:'100%', padding:'0.55rem', borderRadius:9, border:'none', background:'#C4622D', color:'#fff', fontWeight:600, fontSize:'0.85rem', cursor: loading?'default':'pointer', opacity: loading||!idea.trim()?0.6:1 }}>
            {loading ? '⟳ Création…' : "Créer la recette"}
          </button>
        </div>
      )}
      {error && <div style={{ marginTop:'0.6rem', fontSize:'0.78rem', color:'#dc2626' }}>{error}</div>}
    </div>
  );
}

// ── RECIPE FORM (shared Add + Edit) ──────────────────────────────────────────
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
    if (!name.trim()) { alert('Donne un nom à ta recette !'); return; }
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
      alert("Erreur : " + e.message);
    } finally { setSaving(false); }
  };

  const inp = (extra={}) => ({
    style: { width:'100%', padding:'0.6rem 0.85rem', border:'1.5px solid #E4D9CC', borderRadius:9, fontFamily:"'Inter',sans-serif", fontSize:'0.88rem', color:'#2C1A0E', background:'#FAFAF7', outline:'none', ...extra.style },
    onFocus: e => e.target.style.borderColor='#C4622D',
    onBlur: e => e.target.style.borderColor='#E4D9CC',
    ...extra
  });

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(44,26,14,0.45)', backdropFilter:'blur(3px)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem' }} onClick={onClose}>
      <div style={{ background:'#fff', borderRadius:18, width:'100%', maxWidth:540, maxHeight:'90vh', overflowY:'auto', padding:'1.75rem', boxShadow:'0 20px 60px rgba(44,26,14,0.25)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1.4rem' }}>
          <div style={{ fontFamily:"'Playfair Display',serif", fontSize:'1.35rem', color:'#2C1A0E' }}>{title}</div>
          <button onClick={onClose} style={{ background:'#F0E8D8', border:'none', borderRadius:8, width:34, height:34, cursor:'pointer', fontSize:'1rem', color:'#8C7B6B' }}>✕</button>
        </div>

        <AIPanel onResult={applyAIResult} onUsePhotoAsIllustration={setPhotoFile} onNeedApiKey={onNeedApiKey} />

        {/* Photo */}
        <div style={{ marginBottom:'1rem' }}>
          <label style={{ display:'block', fontSize:'0.75rem', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', color:'#8C7B6B', marginBottom:'0.35rem' }}>Photo (optionnel)</label>
          {photoPreview ? (
            <div style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>
              <img src={photoPreview} alt="" style={{ width:70, height:70, objectFit:'cover', borderRadius:9, border:'1px solid #E4D9CC' }} />
              <button type="button" onClick={()=>{ setPhotoFile(null); setPhotoPreview(null); }} style={{ background:'none', border:'1.5px solid #E4D9CC', borderRadius:8, padding:'0.4rem 0.8rem', fontSize:'0.8rem', color:'#8C7B6B', cursor:'pointer' }}>Retirer</button>
            </div>
          ) : (
            <input type="file" accept="image/*" onChange={e=>setPhotoFile(e.target.files[0]||null)} style={{ fontSize:'0.85rem' }} />
          )}
        </div>

        {/* Nom */}
        <div style={{ marginBottom:'1rem' }}>
          <label style={{ display:'block', fontSize:'0.75rem', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', color:'#8C7B6B', marginBottom:'0.35rem' }}>Nom</label>
          <input {...inp()} value={name} onChange={e=>setName(e.target.value)} placeholder="Ex : Tarte au citron" />
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem', marginBottom:'1rem' }}>
          <div>
            <label style={{ display:'block', fontSize:'0.75rem', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', color:'#8C7B6B', marginBottom:'0.35rem' }}>Catégorie</label>
            <select {...inp()} value={cat} onChange={e=>setCat(e.target.value)}>{CATEGORIES.filter(c=>c!=='Toutes').map(c=><option key={c}>{c}</option>)}</select>
          </div>
          <div>
            <label style={{ display:'block', fontSize:'0.75rem', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', color:'#8C7B6B', marginBottom:'0.35rem' }}>Emoji</label>
            <input {...inp()} value={emoji} onChange={e=>setEmoji(e.target.value)} placeholder="🍰" maxLength={2} />
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'0.75rem', marginBottom:'1rem' }}>
          <div>
            <label style={{ display:'block', fontSize:'0.75rem', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', color:'#8C7B6B', marginBottom:'0.35rem' }}>Portions</label>
            <input {...inp()} type="number" value={portions} onChange={e=>setPortions(e.target.value)} min={1} />
          </div>
          <div>
            <label style={{ display:'block', fontSize:'0.75rem', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', color:'#8C7B6B', marginBottom:'0.35rem' }}>Temps (min)</label>
            <input {...inp()} type="number" value={time} onChange={e=>setTime(e.target.value)} placeholder="60" />
          </div>
          <div>
            <label style={{ display:'block', fontSize:'0.75rem', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', color:'#8C7B6B', marginBottom:'0.35rem' }}>Difficulté</label>
            <select {...inp()} value={diff} onChange={e=>setDiff(e.target.value)}>
              <option value={1}>Facile</option><option value={2}>Intermédiaire</option><option value={3}>Difficile</option>
            </select>
          </div>
        </div>

        {/* Ingrédients */}
        <div style={{ marginBottom:'1rem' }}>
          <label style={{ display:'block', fontSize:'0.75rem', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', color:'#8C7B6B', marginBottom:'0.35rem' }}>Ingrédients</label>
          {ings.map((ing, i) => (
            <div key={i} style={{ display:'flex', gap:'0.4rem', marginBottom:'0.4rem', alignItems:'center' }}>
              <input {...inp({style:{width:80}})} value={ing.qty} onChange={e=>setIng(i,'qty',e.target.value)} placeholder="Qté" />
              <input {...inp({style:{flex:1}})} value={ing.name} onChange={e=>setIng(i,'name',e.target.value)} placeholder="Ingrédient" />
              <button onClick={()=>rmIng(i)} style={{ background:'none', border:'1px solid #E4D9CC', borderRadius:6, width:30, height:30, cursor:'pointer', color:'#8C7B6B', fontSize:'1rem', flexShrink:0 }}>−</button>
            </div>
          ))}
          <button onClick={addIng} style={{ width:'100%', background:'none', border:'1.5px dashed #E4D9CC', borderRadius:8, padding:'0.45rem', fontSize:'0.82rem', color:'#8C7B6B', cursor:'pointer', fontFamily:"'Inter',sans-serif" }}>+ Ingrédient</button>
        </div>

        {/* Étapes */}
        <div style={{ marginBottom:'1rem' }}>
          <label style={{ display:'block', fontSize:'0.75rem', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', color:'#8C7B6B', marginBottom:'0.35rem' }}>Étapes</label>
          {steps.map((s, i) => (
            <div key={i} style={{ display:'flex', gap:'0.4rem', marginBottom:'0.4rem', alignItems:'flex-start' }}>
              <div style={{ width:26, height:26, borderRadius:'50%', background:'#F0E8D8', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.72rem', fontWeight:700, color:'#8C7B6B', flexShrink:0, marginTop:6 }}>{i+1}</div>
              <textarea {...inp({style:{flex:1,minHeight:60,resize:'vertical',lineHeight:1.5}})} value={s.text} onChange={e=>setStepText(i,e.target.value)} placeholder={`Étape ${i+1}…`} />
              <button onClick={()=>rmStep(i)} style={{ background:'none', border:'1px solid #E4D9CC', borderRadius:6, width:30, height:30, cursor:'pointer', color:'#8C7B6B', fontSize:'1rem', flexShrink:0, marginTop:4 }}>−</button>
            </div>
          ))}
          <button onClick={addStep} style={{ width:'100%', background:'none', border:'1.5px dashed #E4D9CC', borderRadius:8, padding:'0.45rem', fontSize:'0.82rem', color:'#8C7B6B', cursor:'pointer', fontFamily:"'Inter',sans-serif" }}>+ Étape</button>
        </div>

        {/* Notes */}
        <div style={{ marginBottom:'1.25rem' }}>
          <label style={{ display:'block', fontSize:'0.75rem', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', color:'#8C7B6B', marginBottom:'0.35rem' }}>Notes & conseils</label>
          <textarea {...inp({style:{minHeight:80,resize:'vertical',lineHeight:1.5}})} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Astuces, variantes, conservation…" />
        </div>

        {/* Visibilité */}
        <div style={{ marginBottom:'1.5rem' }}>
          <label style={{ display:'block', fontSize:'0.75rem', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', color:'#8C7B6B', marginBottom:'0.4rem' }}>Visibilité</label>
          <div style={{ display:'flex', gap:'0.6rem' }}>
            <button type="button" onClick={()=>setVisibility('private')}
              style={{ flex:1, padding:'0.6rem', borderRadius:9, cursor:'pointer', fontFamily:"'Inter',sans-serif", fontSize:'0.85rem', fontWeight:600, border: visibility==='private' ? '1.5px solid #C4622D' : '1.5px solid #E4D9CC', background: visibility==='private' ? '#F5E6DC' : '#fff', color: visibility==='private' ? '#C4622D' : '#8C7B6B' }}>
              🔒 Privée <span style={{fontWeight:400}}>(rien que moi)</span>
            </button>
            <button type="button" onClick={()=>setVisibility('public')}
              style={{ flex:1, padding:'0.6rem', borderRadius:9, cursor:'pointer', fontFamily:"'Inter',sans-serif", fontSize:'0.85rem', fontWeight:600, border: visibility==='public' ? '1.5px solid #C4622D' : '1.5px solid #E4D9CC', background: visibility==='public' ? '#F5E6DC' : '#fff', color: visibility==='public' ? '#C4622D' : '#8C7B6B' }}>
              🌐 Publique <span style={{fontWeight:400}}>(visible par tous)</span>
            </button>
          </div>
        </div>

        <div style={{ display:'flex', gap:'0.75rem', justifyContent:'flex-end' }}>
          <button onClick={onClose} disabled={saving} style={{ padding:'0.6rem 1.1rem', borderRadius:9, border:'1.5px solid #E4D9CC', background:'none', fontFamily:"'Inter',sans-serif", fontSize:'0.88rem', color:'#8C7B6B', cursor:'pointer' }}>Annuler</button>
          <button onClick={handleSave} disabled={saving} style={{ padding:'0.6rem 1.4rem', borderRadius:9, border:'none', background:'#C4622D', color:'#fff', fontFamily:"'Inter',sans-serif", fontSize:'0.88rem', fontWeight:600, cursor:'pointer', opacity: saving?0.7:1 }}>
            {saving ? '⟳ Enregistrement…' : 'Enregistrer'}
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
    <div style={{ position:'fixed', inset:0, background:'rgba(44,26,14,0.45)', backdropFilter:'blur(3px)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem' }} onClick={onClose}>
      <div style={{ background:'#fff', borderRadius:18, width:'100%', maxWidth:440, padding:'1.75rem', boxShadow:'0 20px 60px rgba(44,26,14,0.25)' }} onClick={e=>e.stopPropagation()}>
        <div style={{ fontFamily:"'Playfair Display',serif", fontSize:'1.3rem', color:'#2C1A0E', marginBottom:'0.75rem' }}>Clé API Google Gemini</div>
        <p style={{ fontSize:'0.85rem', color:'#8C7B6B', lineHeight:1.6, marginBottom:'1rem' }}>
          Nécessaire pour les fonctionnalités IA. Enregistrée uniquement dans ce navigateur. Crée-la gratuitement sur <span style={{color:'#C4622D'}}>Google AI Studio</span>.
        </p>
        <input type="password" value={key} onChange={e=>setKey(e.target.value)} placeholder="AIzaSy…"
          style={{ width:'100%', padding:'0.65rem 0.85rem', border:'1.5px solid #E4D9CC', borderRadius:9, fontFamily:"monospace", fontSize:'0.85rem', outline:'none', marginBottom:'1.25rem' }} />
        <div style={{ display:'flex', gap:'0.75rem', justifyContent:'flex-end' }}>
          <button onClick={onClose} style={{ padding:'0.6rem 1.1rem', borderRadius:9, border:'1.5px solid #E4D9CC', background:'none', fontSize:'0.88rem', color:'#8C7B6B', cursor:'pointer' }}>Annuler</button>
          <button onClick={save} style={{ padding:'0.6rem 1.4rem', borderRadius:9, border:'none', background:'#C4622D', color:'#fff', fontSize:'0.88rem', fontWeight:600, cursor:'pointer' }}>Enregistrer</button>
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
    catch (e) { alert("Erreur PDF : " + e.message); }
    finally { setExporting(false); }
  };

  const btnBase = { borderRadius:9, border:'none', fontFamily:"'Inter',sans-serif", fontSize:'0.85rem', fontWeight:600, cursor:'pointer', padding:'0.55rem 1.1rem', display:'flex', alignItems:'center', gap:'0.4rem' };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(44,26,14,0.45)', backdropFilter:'blur(3px)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem' }} onClick={onClose}>
      <div style={{ background:'#fff', borderRadius:18, width:'100%', maxWidth:640, maxHeight:'92vh', overflowY:'auto', boxShadow:'0 20px 60px rgba(44,26,14,0.25)' }} onClick={e=>e.stopPropagation()}>

        {/* Hero */}
        <div style={{ background:'linear-gradient(135deg, #F0E8D8 0%, #E8D8C4 100%)', textAlign:'center', borderBottom:'1px solid #E4D9CC', overflow:'hidden', position:'relative' }}>
          {recipe.photoURL && (
            <>
              <img src={recipe.photoURL} alt={recipe.name} style={{ width:'100%', height:230, objectFit:'cover', display:'block' }} />
              <div style={{ position:'absolute', inset:0, background:'linear-gradient(to top, rgba(44,26,14,0.7) 0%, transparent 50%)' }} />
            </>
          )}
          <div style={{ padding: recipe.photoURL ? '1.25rem 1.5rem 1.5rem' : '2rem 1.5rem 1.5rem', position: recipe.photoURL ? 'absolute' : 'relative', bottom:0, left:0, right:0 }}>
            {!recipe.photoURL && <div style={{ fontSize:'3.8rem', marginBottom:'0.6rem' }}>{recipe.emoji||'🍽️'}</div>}
            <div style={{ fontSize:'0.7rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color: recipe.photoURL ? 'rgba(255,255,255,0.8)' : '#C4622D', marginBottom:'0.4rem' }}>{recipe.cat}</div>
            <div style={{ fontFamily:"'Playfair Display',serif", fontSize:'1.8rem', color: recipe.photoURL ? '#fff' : '#2C1A0E', marginBottom:'0.9rem', lineHeight:1.2, textShadow: recipe.photoURL ? '0 1px 4px rgba(0,0,0,0.4)' : 'none' }}>
              {recipe.photoURL && <span style={{marginRight:'0.5rem'}}>{recipe.emoji||'🍽️'}</span>}
              {recipe.name}
            </div>
            <div style={{ display:'flex', justifyContent:'center', gap:'0.75rem', flexWrap:'wrap' }}>
              {recipe.time && <span style={{ background:'rgba(255,255,255,0.9)', border:'1px solid rgba(255,255,255,0.5)', borderRadius:20, padding:'0.3rem 0.85rem', fontSize:'0.78rem', color:'#8C7B6B' }}>⏱ {recipe.time < 60 ? recipe.time+'min' : Math.floor(recipe.time/60)+'h'+(recipe.time%60?recipe.time%60+'min':'')}</span>}
              <span style={{ background:'rgba(255,255,255,0.9)', border:'1px solid rgba(255,255,255,0.5)', borderRadius:20, padding:'0.3rem 0.85rem', fontSize:'0.78rem', color:'#8C7B6B' }}>{DIFF_LABELS[recipe.diff]}</span>
            </div>
            {recipe.ownerName && (
              <div style={{ marginTop:'0.6rem', fontSize:'0.78rem', color: recipe.photoURL ? 'rgba(255,255,255,0.85)' : '#8C7B6B' }}>
                par {recipe.ownerName}
                {recipe.copiedFrom?.ownerName && ` · d'après une recette de ${recipe.copiedFrom.ownerName}`}
              </div>
            )}
          </div>
        </div>

        <div style={{ padding:'1.5rem' }}>
          {/* Portions */}
          <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', background:'#F0E8D8', borderRadius:12, padding:'0.7rem 1rem', marginBottom:'1.5rem' }}>
            <span style={{ fontSize:'0.85rem', color:'#8C7B6B', flex:1 }}>Portions</span>
            <div style={{ display:'flex', alignItems:'center', gap:'0.6rem' }}>
              <button onClick={()=>changeMult(-1)} style={{ width:30, height:30, borderRadius:'50%', border:'1.5px solid #E4D9CC', background:'#fff', cursor:'pointer', fontSize:'1.1rem', display:'flex', alignItems:'center', justifyContent:'center', color:'#2C1A0E' }}>−</button>
              <span style={{ fontWeight:700, fontSize:'1.1rem', minWidth:'1.5rem', textAlign:'center' }}>{portions}</span>
              <button onClick={()=>changeMult(1)} style={{ width:30, height:30, borderRadius:'50%', border:'1.5px solid #E4D9CC', background:'#fff', cursor:'pointer', fontSize:'1.1rem', display:'flex', alignItems:'center', justifyContent:'center', color:'#2C1A0E' }}>+</button>
            </div>
          </div>

          {/* Ingrédients */}
          <div style={{ fontFamily:"'Playfair Display',serif", fontSize:'1.05rem', fontWeight:600, color:'#2C1A0E', marginBottom:'0.75rem' }}>Ingrédients</div>
          <div style={{ background:'#FAFAF7', borderRadius:12, overflow:'hidden', marginBottom:'1.5rem', border:'1px solid #E4D9CC' }}>
            {recipe.ingredients.map((ing, i) => (
              <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'0.55rem 1rem', borderBottom: i<recipe.ingredients.length-1?'1px solid #E4D9CC':'none', fontSize:'0.88rem', background: i%2===0?'#fff':'#FAFAF7' }}>
                <span style={{ color:'#2C1A0E' }}>{ing.name}</span>
                <span style={{ color:'#C4622D', fontWeight:600 }}>{fmtQty(ing.qty)}</span>
              </div>
            ))}
          </div>

          {/* Étapes */}
          <div style={{ fontFamily:"'Playfair Display',serif", fontSize:'1.05rem', fontWeight:600, color:'#2C1A0E', marginBottom:'0.75rem' }}>Préparation</div>
          <div style={{ marginBottom:'1.5rem' }}>
            {recipe.steps.map((s, i) => (
              <div key={i} style={{ display:'flex', gap:'1rem', marginBottom:'1.1rem', alignItems:'flex-start', padding:'0.75rem', background: i%2===0?'#FAFAF7':'#fff', borderRadius:10, border:'1px solid #E4D9CC' }}>
                <div style={{ width:32, height:32, borderRadius:'50%', background:'#C4622D', color:'#fff', fontSize:'0.82rem', fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, boxShadow:'0 2px 6px rgba(196,98,45,0.3)' }}>{i+1}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:'0.9rem', lineHeight:1.6, color:'#2C1A0E' }}>{s.text}</div>
                  {s.timer && (
                    <button onClick={() => timerCtx.start(s.timer, `Étape ${i+1} — ${recipe.name}`)}
                      style={{ display:'inline-flex', alignItems:'center', gap:'0.3rem', marginTop:'0.5rem', background:'#F5E6DC', border:'1px solid #e8c4ac', color:'#C4622D', borderRadius:6, padding:'0.3rem 0.75rem', fontSize:'0.78rem', fontWeight:600, cursor:'pointer', fontFamily:"'Inter',sans-serif" }}>
                      ⏱ {Math.floor(s.timer/60)}:{String(s.timer%60).padStart(2,'0')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Notes */}
          {recipe.notes && (
            <>
              <div style={{ fontFamily:"'Playfair Display',serif", fontSize:'1.05rem', fontWeight:600, color:'#2C1A0E', marginBottom:'0.5rem' }}>Notes</div>
              <div style={{ background:'#F5E6DC', borderRadius:12, padding:'1rem 1.1rem', fontSize:'0.88rem', lineHeight:1.7, color:'#6B4C2A', fontStyle:'italic', borderLeft:'3px solid #C4622D', marginBottom:'1.5rem' }}>{recipe.notes}</div>
            </>
          )}

          {/* Boutons d'action */}
          <div style={{ display:'flex', gap:'0.75rem', flexWrap:'wrap', justifyContent:'flex-end', paddingTop:'0.5rem', borderTop:'1px solid #E4D9CC' }}>
            <button onClick={onClose} style={{ ...btnBase, background:'none', border:'1.5px solid #E4D9CC', color:'#8C7B6B' }}>Fermer</button>
            <button onClick={handleExport} disabled={exporting} style={{ ...btnBase, background:'#F0E8D8', color:'#2C1A0E', border:'1.5px solid #E4D9CC', opacity: exporting?0.7:1 }}>
              {exporting ? '⟳ Export…' : '📄 Exporter PDF'}
            </button>
            {isOwner ? (
              <button onClick={onEdit} style={{ ...btnBase, background:'#C4622D', color:'#fff' }}>
                ✏️ Modifier
              </button>
            ) : (
              <button onClick={() => onAddToProfile(recipe)} style={{ ...btnBase, background:'#C4622D', color:'#fff' }}>
                + Ajouter à mon profil
              </button>
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
    <div style={{ position:'fixed', bottom:'1.5rem', right:'1.5rem', background:'#2C1A0E', color:'#fff', borderRadius:14, padding:'1rem 1.25rem', boxShadow:'0 8px 28px rgba(44,26,14,0.35)', zIndex:500, minWidth:220 }}>
      <div style={{ fontSize:'0.7rem', color:'rgba(255,255,255,0.5)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:'0.2rem' }}>{timer.label}</div>
      <div style={{ fontSize:'2rem', fontWeight:700, letterSpacing:'-0.02em', fontVariantNumeric:'tabular-nums' }}>
        {timer.done ? '✓ Terminé !' : fmt(timer.remaining)}
      </div>
      <div style={{ display:'flex', gap:'0.5rem', marginTop:'0.65rem' }}>
        <button onClick={toggle} style={{ flex:1, padding:'0.35rem', borderRadius:7, border:'none', background:'rgba(255,255,255,0.15)', color:'#fff', fontSize:'0.78rem', fontWeight:600, cursor:'pointer', fontFamily:"'Inter',sans-serif" }}>
          {timer.paused ? 'Reprendre' : 'Pause'}
        </button>
        <button onClick={cancel} style={{ flex:1, padding:'0.35rem', borderRadius:7, border:'none', background:'rgba(255,100,100,0.2)', color:'#fca5a5', fontSize:'0.78rem', fontWeight:600, cursor:'pointer', fontFamily:"'Inter',sans-serif" }}>Arrêter</button>
      </div>
    </div>
  );
}

// ── LOGIN / SIGNUP SCREEN ─────────────────────────────────────────────────────
function AuthScreen({ onAuthed }) {
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

  const inp = {
    width:'100%', padding:'0.7rem 0.9rem', border:'1.5px solid #E4D9CC', borderRadius:9,
    fontFamily:"'Inter',sans-serif", fontSize:'0.9rem', color:'#2C1A0E', background:'#FAFAF7', outline:'none',
  };

  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#FAFAF7', padding:'1.5rem' }}>
      <div style={{ background:'#fff', borderRadius:18, width:'100%', maxWidth:400, padding:'2rem', boxShadow:'0 20px 60px rgba(44,26,14,0.12)' }}>
        <div style={{ textAlign:'center', marginBottom:'1.75rem' }}>
          <div style={{ fontSize:'1.8rem', marginBottom:'0.4rem' }}>📖</div>
          <div style={{ fontFamily:"'Playfair Display',serif", fontSize:'1.5rem', color:'#2C1A0E' }}>
            Mon <span style={{ color:'#C4622D', fontStyle:'italic' }}>Carnet</span>
          </div>
        </div>

        <div style={{ display:'flex', gap:'0.4rem', marginBottom:'1.5rem', background:'#F0E8D8', borderRadius:10, padding:4 }}>
          <button type="button" onClick={()=>{setMode('login'); setError('');}}
            style={{ flex:1, padding:'0.5rem', borderRadius:8, border:'none', cursor:'pointer', fontFamily:"'Inter',sans-serif", fontWeight:600, fontSize:'0.85rem', background: mode==='login'?'#fff':'transparent', color: mode==='login'?'#2C1A0E':'#8C7B6B', boxShadow: mode==='login'?'0 1px 4px rgba(0,0,0,0.08)':'none' }}>
            Connexion
          </button>
          <button type="button" onClick={()=>{setMode('register'); setError('');}}
            style={{ flex:1, padding:'0.5rem', borderRadius:8, border:'none', cursor:'pointer', fontFamily:"'Inter',sans-serif", fontWeight:600, fontSize:'0.85rem', background: mode==='register'?'#fff':'transparent', color: mode==='register'?'#2C1A0E':'#8C7B6B', boxShadow: mode==='register'?'0 1px 4px rgba(0,0,0,0.08)':'none' }}>
            Inscription
          </button>
        </div>

        <form onSubmit={submit}>
          <div style={{ marginBottom:'0.9rem' }}>
            <label style={{ display:'block', fontSize:'0.75rem', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', color:'#8C7B6B', marginBottom:'0.35rem' }}>Pseudo</label>
            <input style={inp} value={username} onChange={e=>setUsername(e.target.value)} placeholder="ex : augustin" autoComplete="username" />
          </div>
          <div style={{ marginBottom: mode==='register' ? '0.9rem' : '1.5rem' }}>
            <label style={{ display:'block', fontSize:'0.75rem', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', color:'#8C7B6B', marginBottom:'0.35rem' }}>Mot de passe</label>
            <input type="password" style={inp} value={password} onChange={e=>setPassword(e.target.value)} placeholder="6 caractères minimum" autoComplete={mode==='register'?'new-password':'current-password'} />
          </div>
          {mode==='register' && (
            <div style={{ marginBottom:'1.5rem' }}>
              <label style={{ display:'block', fontSize:'0.75rem', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', color:'#8C7B6B', marginBottom:'0.35rem' }}>Confirmer le mot de passe</label>
              <input type="password" style={inp} value={password2} onChange={e=>setPassword2(e.target.value)} autoComplete="new-password" />
            </div>
          )}

          {error && <div style={{ marginBottom:'1rem', fontSize:'0.82rem', color:'#dc2626', background:'#fef2f2', padding:'0.6rem 0.8rem', borderRadius:8 }}>{error}</div>}

          <button type="submit" disabled={loading || !username.trim() || !password}
            style={{ width:'100%', padding:'0.75rem', borderRadius:9, border:'none', background:'#C4622D', color:'#fff', fontFamily:"'Inter',sans-serif", fontWeight:600, fontSize:'0.9rem', cursor: loading?'default':'pointer', opacity: loading?0.7:1 }}>
            {loading ? '⟳ Un instant…' : (mode==='register' ? "S'inscrire" : 'Se connecter')}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(undefined); // undefined = chargement, null = déconnecté
  const [activeTab, setActiveTab] = useState('mine'); // 'mine' | 'public'
  const [myRecipes, setMyRecipes] = useState([]);
  const [publicRecipes, setPublicRecipes] = useState([]);
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

  // Suivi de l'état de connexion
  useEffect(() => {
    const unsub = subscribeAuth((u) => setUser(u));
    return unsub;
  }, []);

  // Mes recettes (privées + publiques) en temps réel
  useEffect(() => {
    if (!user) { setMyRecipes([]); return; }
    const q = query(collection(db, 'recipes'), where('ownerId', '==', user.uid), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      setMyRecipes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setSyncStatus('synced');
    }, (err) => {
      console.error(err);
      setSyncStatus('error');
      addToast('Erreur Firebase', 'error');
    });
    return unsub;
  }, [user, addToast]);

  // Recettes publiques de tout le monde, en temps réel
  useEffect(() => {
    if (!user) { setPublicRecipes([]); return; }
    const q = query(collection(db, 'recipes'), where('visibility', '==', 'public'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      setPublicRecipes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => {
      console.error(err);
      addToast('Erreur Firebase (recettes publiques)', 'error');
    });
    return unsub;
  }, [user, addToast]);

  // Sauvegarder photo (rangée par propriétaire pour matcher les règles Storage)
  const uploadPhoto = async (id, photoFile) => {
    const sRef = ref(storage, `photos/${user.uid}/${id}`);
    await uploadBytes(sRef, photoFile);
    return await getDownloadURL(sRef);
  };

  // Ajouter recette
  const handleSaveNew = useCallback(async (data, photoFile) => {
    const newRef = doc(collection(db, 'recipes'));
    let photoURL = null;
    if (photoFile) photoURL = await uploadPhoto(newRef.id, photoFile);
    await setDoc(newRef, {
      ...data, photoURL,
      ownerId: user.uid, ownerName: user.displayName,
      createdAt: serverTimestamp(),
    });
    addToast('✓ Recette enregistrée', 'success');
    setShowAdd(false);
  }, [addToast, user]);

  // Modifier recette
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
    addToast('✓ Recette modifiée', 'success');
    setEditId(null);
  }, [editId, myRecipes, addToast, user]);

  // Supprimer recette
  const handleDelete = useCallback(async (id) => {
    if (!window.confirm('Supprimer cette recette ?')) return;
    const recipe = myRecipes.find(r => r.id === id);
    try {
      await deleteDoc(doc(db, 'recipes', id));
      if (recipe?.photoURL) { try { await deleteObject(ref(storage, `photos/${user.uid}/${id}`)); } catch {} }
      addToast('Recette supprimée', 'info');
      if (detailId === id) setDetailId(null);
    } catch { addToast('Erreur de suppression', 'error'); }
  }, [myRecipes, addToast, detailId, user]);

  // Ajouter la recette publique d'un autre à mon profil (copie indépendante)
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
      addToast('✓ Ajoutée à ton profil', 'success');
      setDetailId(null);
    } catch {
      addToast("Erreur lors de l'ajout", 'error');
    }
  }, [addToast, user]);

  const recipes = activeTab === 'mine' ? myRecipes : publicRecipes;

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
    loading: { color:'#D4A017', icon:'⟳', label:'Connexion…' },
    synced:  { color:'#4A7C59', icon:'✓', label:'Synchronisé' },
    error:   { color:'#dc2626', icon:'⚠', label:'Erreur Firebase' },
  }[syncStatus];

  const detailRecipe = recipes.find(r => r.id === detailId);
  const editRecipe = myRecipes.find(r => r.id === editId);
  const needApiKey = () => { addToast("Ajoute ta clé API dans ⚙️", 'error'); setShowSettings(true); };

  if (user === undefined) {
    return (
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#FAFAF7', color:'#8C7B6B', fontFamily:"'Inter',sans-serif", fontSize:'0.9rem' }}>
        ⟳ Chargement…
      </div>
    );
  }
  if (!user) {
    return <AuthScreen onAuthed={setUser} />;
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&family=Inter:wght@300;400;500;600&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{font-family:'Inter',sans-serif;background:#FAFAF7;color:#2C1A0E;min-height:100vh}
        ::-webkit-scrollbar{width:6px} ::-webkit-scrollbar-track{background:#F0E8D8} ::-webkit-scrollbar-thumb{background:#C4622D;border-radius:3px}
      `}</style>

      {/* HEADER */}
      <header style={{ background:'linear-gradient(135deg, #2C1A0E 0%, #3D2414 100%)', padding:'1rem 1.5rem', position:'sticky', top:0, zIndex:100, boxShadow:'0 2px 16px rgba(44,26,14,0.25)' }}>
        <div style={{ maxWidth:1100, margin:'0 auto', display:'flex', alignItems:'center', gap:'1rem', flexWrap:'wrap' }}>
          <div style={{ fontFamily:"'Playfair Display',serif", fontSize:'1.5rem', color:'#F0E8D8', whiteSpace:'nowrap', display:'flex', alignItems:'center', gap:'0.5rem' }}>
            <span style={{ fontSize:'1.3rem' }}>📖</span>
            Mon <span style={{ color:'#C4622D', fontStyle:'italic' }}>Carnet</span>
          </div>
          <div style={{ flex:1, minWidth:180, position:'relative' }}>
            <svg style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', opacity:0.4 }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher une recette…" style={{ width:'100%', padding:'0.6rem 1rem 0.6rem 2.4rem', borderRadius:10, border:'none', background:'rgba(255,255,255,0.12)', color:'#fff', fontFamily:"'Inter',sans-serif", fontSize:'0.88rem', outline:'none', transition:'background 0.2s' }}
              onFocus={e=>e.target.style.background='rgba(255,255,255,0.2)'}
              onBlur={e=>e.target.style.background='rgba(255,255,255,0.12)'}
            />
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
            <span style={{ fontSize:'0.72rem', color: statusInfo.color, display:'flex', alignItems:'center', gap:'0.25rem', whiteSpace:'nowrap', background:'rgba(0,0,0,0.2)', padding:'0.3rem 0.7rem', borderRadius:20 }}>
              <span>{statusInfo.icon}</span>{statusInfo.label}
            </span>
            <span style={{ fontSize:'0.78rem', color:'#F0E8D8', whiteSpace:'nowrap' }}>👤 {user.displayName}</span>
            <button onClick={()=>logoutUser()} title="Se déconnecter" style={{ background:'rgba(255,255,255,0.1)', color:'#F0E8D8', border:'none', borderRadius:8, padding:'0.5rem 0.7rem', cursor:'pointer', fontSize:'0.78rem', fontFamily:"'Inter',sans-serif" }}>
              Déconnexion
            </button>
            <button onClick={()=>setShowSettings(true)} title="Réglages IA" style={{ background:'rgba(255,255,255,0.1)', color:'#F0E8D8', border:'none', borderRadius:8, width:38, height:38, cursor:'pointer', fontSize:'1rem', transition:'background 0.15s' }}
              onMouseEnter={e=>e.target.style.background='rgba(255,255,255,0.2)'}
              onMouseLeave={e=>e.target.style.background='rgba(255,255,255,0.1)'}>⚙️</button>
            <button onClick={()=>setShowAdd(true)} style={{ background:'#C4622D', color:'#fff', border:'none', borderRadius:10, padding:'0.6rem 1.2rem', fontFamily:"'Inter',sans-serif", fontWeight:600, fontSize:'0.86rem', cursor:'pointer', display:'flex', alignItems:'center', gap:'0.35rem', whiteSpace:'nowrap', boxShadow:'0 2px 8px rgba(196,98,45,0.4)', transition:'background 0.15s' }}
              onMouseEnter={e=>e.currentTarget.style.background='#a84f23'}
              onMouseLeave={e=>e.currentTarget.style.background='#C4622D'}>
              + Ajouter
            </button>
          </div>
        </div>
      </header>

      {/* TABS Mes recettes / Publiques */}
      <div style={{ background:'#2C1A0E', borderBottom:'1px solid #E4D9CC' }}>
        <div style={{ maxWidth:1100, margin:'0 auto', display:'flex', padding:'0 1.5rem' }}>
          {[{k:'mine', label:'📕 Mes recettes'}, {k:'public', label:'🌐 Recettes publiques'}].map(t => (
            <button key={t.k} onClick={()=>{ setActiveTab(t.k); setActiveCategory('Toutes'); setDetailId(null); }}
              style={{ background:'none', border:'none', borderBottom: activeTab===t.k ? '2.5px solid #C4622D' : '2.5px solid transparent', color: activeTab===t.k ? '#F0E8D8' : 'rgba(240,232,216,0.55)', padding:'0.75rem 1.1rem', fontSize:'0.86rem', fontWeight:600, cursor:'pointer', fontFamily:"'Inter',sans-serif" }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* CATS */}
      <div style={{ background:'#F0E8D8', borderBottom:'1px solid #E4D9CC', overflowX:'auto', scrollbarWidth:'none' }}>
        <div style={{ maxWidth:1100, margin:'0 auto', display:'flex', gap:'0.25rem', padding:'0.65rem 1.5rem' }}>
          {cats.map(c => (
            <button key={c} onClick={()=>setActiveCategory(c)} style={{ background: c===activeCategory?'#2C1A0E':'transparent', color: c===activeCategory?'#F0E8D8':'#8C7B6B', border:'none', padding:'0.4rem 1rem', borderRadius:20, fontSize:'0.83rem', cursor:'pointer', whiteSpace:'nowrap', fontFamily:"'Inter',sans-serif", fontWeight:500, transition:'all 0.15s' }}>
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* CONTENT */}
      <main style={{ maxWidth:1100, margin:'0 auto', padding:'2rem 1.5rem' }}>
        {Object.entries(byCat).map(([cat, rs]) => rs.length === 0 ? null : (
          <div key={cat}>
            <div style={{ fontFamily:"'Playfair Display',serif", fontSize:'1.25rem', color:'#2C1A0E', marginBottom:'1.1rem', display:'flex', alignItems:'center', gap:'0.75rem' }}>
              {cat}
              <div style={{ flex:1, height:1, background:'linear-gradient(to right, #E4D9CC, transparent)', marginLeft:'0.25rem' }} />
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))', gap:'1.25rem', marginBottom:'2.5rem' }}>
              {rs.map(r => (
                <RecipeCard key={r.id} recipe={r} onOpen={setDetailId} onDelete={handleDelete}
                  onAddToProfile={handleAddToProfile} isOwner={r.ownerId === user.uid} />
              ))}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={{ textAlign:'center', padding:'4rem 2rem', color:'#8C7B6B' }}>
            <div style={{ fontSize:'3rem', marginBottom:'0.75rem' }}>📖</div>
            <div style={{ fontFamily:"'Playfair Display',serif", fontSize:'1.1rem', marginBottom:'0.4rem', color:'#2C1A0E' }}>
              {activeTab === 'mine' ? 'Aucune recette ici' : 'Aucune recette publique pour le moment'}
            </div>
            <p style={{ fontSize:'0.88rem' }}>{activeTab === 'mine' ? 'Ajoute ta première recette !' : 'Sois le premier à en partager une !'}</p>
          </div>
        )}
      </main>

      {/* MODALS */}
      {showAdd && <RecipeForm title="Nouvelle recette" onClose={()=>setShowAdd(false)} onSave={handleSaveNew} onNeedApiKey={needApiKey} />}

      {editRecipe && (
        <RecipeForm
          title="Modifier la recette"
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
        />
      )}

      {showSettings && <SettingsModal onClose={()=>setShowSettings(false)} />}

      <TimerWidget timer={timerCtx.timer} fmt={timerCtx.fmt} toggle={timerCtx.toggle} cancel={timerCtx.cancel} />
      <Toast toasts={toasts} />
    </>
  );
}
