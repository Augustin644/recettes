import { useState, useEffect, useCallback, useRef } from "react";

// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const DRIVE_FILENAME = "mon-carnet-recettes.json";

const DEFAULT_RECIPES = [
  {
    id: 1, name: "Meringue Pavlova", cat: "Desserts", emoji: "🍓",
    portions: 8, time: 105, diff: 2,
    ingredients: [
      { name: "Blancs d'œufs", qty: "4" },
      { name: "Sucre en poudre fin", qty: "200 g" },
      { name: "Maïzena", qty: "1 c.à.c" },
      { name: "Vinaigre blanc", qty: "1 c.à.c" },
      { name: "Extrait de vanille", qty: "1 c.à.c" }
    ],
    steps: [
      { text: "Préchauffer le four à 120 °C. Tracer un cercle de 22 cm sur du papier cuisson.", timer: null },
      { text: "Fouetter les blancs à vitesse moyenne jusqu'à pics mous (~2 min).", timer: null },
      { text: "Augmenter la vitesse et ajouter le sucre cuillère par cuillère. Battre 8–10 min.", timer: 600 },
      { text: "Incorporer délicatement la maïzena, le vinaigre et la vanille à la spatule.", timer: null },
      { text: "Façonner sur le cercle avec les bords légèrement plus hauts que le centre.", timer: null },
      { text: "Cuire 1h15 sans ouvrir le four.", timer: 4500 },
      { text: "Éteindre le four, entrouvrir la porte et laisser refroidir au minimum 1h.", timer: 3600 }
    ],
    notes: "La clé : ne jamais ouvrir le four pendant la cuisson et toujours refroidir dans le four."
  },
  {
    id: 2, name: "Caramel Beurre Salé", cat: "Sauces & Condiments", emoji: "🍯",
    portions: 1, time: 20, diff: 2,
    ingredients: [
      { name: "Sucre en poudre", qty: "200 g" },
      { name: "Beurre demi-sel froid", qty: "80 g" },
      { name: "Crème liquide entière", qty: "200 ml" },
      { name: "Fleur de sel", qty: "1 c.à.c" }
    ],
    steps: [
      { text: "Chauffer la crème jusqu'à frémissement, réserver au chaud.", timer: null },
      { text: "Faire fondre le sucre à sec en 3 fois à feu moyen, sans remuer.", timer: 300 },
      { text: "Attendre la couleur ambre foncé, retirer du feu.", timer: 120 },
      { text: "Verser la crème chaude en filet (attention aux projections !), mélanger.", timer: null },
      { text: "Ajouter le beurre en dés et la fleur de sel. Remettre sur feu doux 2–3 min.", timer: 180 }
    ],
    notes: "La crème doit être chaude sinon le caramel fige. Se conserve 3 semaines au frigo."
  }
];

const CATEGORIES = ["Toutes","Entrées","Plats","Desserts","Boulangerie","Boissons","Sauces & Condiments","Autre"];
const DIFF_LABELS = ["","⬤○○ Facile","⬤⬤○ Intermédiaire","⬤⬤⬤ Difficile"];

// ── DRIVE HELPERS via Claude API + MCP ───────────────────────────────────────
async function callDriveAPI(prompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system: `Tu es un assistant qui gère un fichier JSON sur Google Drive nommé "${DRIVE_FILENAME}". 
Réponds UNIQUEMENT en JSON valide, sans markdown, sans commentaires, sans texte autour.
Pour les opérations de lecture, retourne le contenu JSON du fichier.
Pour les opérations d'écriture, retourne {"success": true} après avoir sauvegardé.
Si le fichier n'existe pas encore, retourne {"recipes": []}.`,
      messages: [{ role: "user", content: prompt }],
      mcp_servers: [{
        type: "url",
        url: "https://drivemcp.googleapis.com/mcp/v1",
        name: "google-drive"
      }]
    })
  });
  const data = await res.json();
  // Extract text from all content blocks
  const text = data.content
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("");
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

async function loadFromDrive() {
  try {
    const result = await callDriveAPI(
      `Cherche le fichier "${DRIVE_FILENAME}" dans Google Drive et retourne son contenu JSON complet. Si le fichier n'existe pas, retourne {"recipes": []}.`
    );
    return result.recipes || null;
  } catch {
    return null;
  }
}

async function saveToDrive(recipes) {
  try {
    const json = JSON.stringify({ recipes }, null, 2);
    await callDriveAPI(
      `Sauvegarde ce JSON dans un fichier nommé "${DRIVE_FILENAME}" sur Google Drive (crée-le s'il n'existe pas, remplace-le s'il existe) :\n${json}\n\nRéponds avec {"success": true}.`
    );
    return true;
  } catch {
    return false;
  }
}

// ── STYLES ────────────────────────────────────────────────────────────────────
const S = {
  vars: `
    :root {
      --bg:#FAFAF7;--card:#fff;--brown:#2C1A0E;--cream:#F0E8D8;
      --accent:#C4622D;--accent-light:#F5E6DC;--muted:#8C7B6B;
      --border:#E4D9CC;--green:#4A7C59;
    }
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Inter',sans-serif;background:var(--bg);color:var(--brown);min-height:100vh}
    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&family=Inter:wght@300;400;500;600&display=swap');
  `
};

// ── TIMER HOOK ────────────────────────────────────────────────────────────────
function useTimer() {
  const [timer, setTimer] = useState(null); // {remaining, label, paused}
  const ref = useRef(null);

  const start = useCallback((seconds, label) => {
    if (ref.current) clearInterval(ref.current);
    setTimer({ remaining: seconds, label, paused: false });
    ref.current = setInterval(() => {
      setTimer(t => {
        if (!t || t.paused) return t;
        if (t.remaining <= 1) { clearInterval(ref.current); return { ...t, remaining: 0, done: true }; }
        return { ...t, remaining: t.remaining - 1 };
      });
    }, 1000);
  }, []);

  const toggle = useCallback(() => setTimer(t => t ? { ...t, paused: !t.paused } : t), []);
  const cancel = useCallback(() => { if (ref.current) clearInterval(ref.current); setTimer(null); }, []);
  useEffect(() => () => { if (ref.current) clearInterval(ref.current); }, []);

  const fmt = s => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  return { timer, start, toggle, cancel, fmt };
}

// ── TOAST ─────────────────────────────────────────────────────────────────────
function Toast({ toasts }) {
  return (
    <div style={{ position:'fixed', bottom:'5rem', left:'50%', transform:'translateX(-50%)', zIndex:1000, display:'flex', flexDirection:'column', gap:'0.5rem', alignItems:'center' }}>
      {toasts.map(t => (
        <div key={t.id} style={{ background: t.type==='error'?'#dc2626':t.type==='success'?'#15803d':'#2C1A0E', color:'#fff', padding:'0.6rem 1.2rem', borderRadius:'20px', fontSize:'0.85rem', fontWeight:500, boxShadow:'0 4px 16px rgba(0,0,0,0.2)', whiteSpace:'nowrap' }}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

// ── DIFF DOTS ─────────────────────────────────────────────────────────────────
function DiffDots({ d }) {
  return (
    <span style={{ display:'flex', gap:3 }}>
      {[1,2,3].map(i => <span key={i} style={{ width:7, height:7, borderRadius:'50%', background: i<=d?'#C4622D':'#E4D9CC', display:'inline-block' }} />)}
    </span>
  );
}

// ── RECIPE CARD ───────────────────────────────────────────────────────────────
function RecipeCard({ recipe, onOpen, onDelete }) {
  const [hovered, setHovered] = useState(false);
  const t = recipe.time;
  const tLabel = t ? (t < 60 ? `${t}min` : `${Math.floor(t/60)}h${t%60?t%60+'min':''}`) : null;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onOpen(recipe.id)}
      style={{ background:'#fff', border:'1px solid #E4D9CC', borderRadius:14, overflow:'hidden', cursor:'pointer', position:'relative', transition:'transform 0.18s, box-shadow 0.18s', transform: hovered?'translateY(-3px)':'none', boxShadow: hovered?'0 8px 28px rgba(44,26,14,0.12)':'none' }}
    >
      {hovered && (
        <button onClick={e => { e.stopPropagation(); onDelete(recipe.id); }}
          style={{ position:'absolute', top:8, right:8, background:'rgba(255,255,255,0.9)', border:'1px solid #E4D9CC', borderRadius:6, width:28, height:28, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.8rem', color:'#8C7B6B', zIndex:2 }}>✕</button>
      )}
      <div style={{ background:'#F0E8D8', padding:'1.4rem', textAlign:'center', fontSize:'2.6rem', borderBottom:'1px solid #E4D9CC' }}>{recipe.emoji||'🍽️'}</div>
      <div style={{ padding:'1rem' }}>
        <div style={{ fontSize:'0.68rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'#C4622D', marginBottom:'0.3rem' }}>{recipe.cat}</div>
        <div style={{ fontFamily:"'Playfair Display',serif", fontSize:'1rem', fontWeight:600, color:'#2C1A0E', marginBottom:'0.5rem', lineHeight:1.3 }}>{recipe.name}</div>
        <div style={{ display:'flex', gap:'0.7rem', alignItems:'center', fontSize:'0.78rem', color:'#8C7B6B', flexWrap:'wrap' }}>
          {tLabel && <span>⏱ {tLabel}</span>}
          <DiffDots d={recipe.diff} />
          <span>👥 {recipe.portions}</span>
        </div>
      </div>
    </div>
  );
}

// ── ADD MODAL ─────────────────────────────────────────────────────────────────
function AddModal({ onClose, onSave }) {
  const [name, setName] = useState('');
  const [cat, setCat] = useState('Desserts');
  const [emoji, setEmoji] = useState('');
  const [portions, setPortions] = useState(4);
  const [time, setTime] = useState('');
  const [diff, setDiff] = useState(2);
  const [notes, setNotes] = useState('');
  const [ings, setIngs] = useState([{qty:'',name:''},{qty:'',name:''},{qty:'',name:''}]);
  const [steps, setSteps] = useState(['','']);

  const addIng = () => setIngs(p => [...p, {qty:'',name:''}]);
  const rmIng = i => setIngs(p => p.filter((_,j)=>j!==i));
  const setIng = (i, field, v) => setIngs(p => p.map((x,j) => j===i ? {...x,[field]:v} : x));
  const addStep = () => setSteps(p => [...p, '']);
  const rmStep = i => setSteps(p => p.filter((_,j)=>j!==i));
  const setStep = (i, v) => setSteps(p => p.map((x,j) => j===i ? v : x));

  const handleSave = () => {
    if (!name.trim()) { alert('Donne un nom à ta recette !'); return; }
    onSave({
      id: Date.now(), name: name.trim(), cat, emoji: emoji||'🍽️',
      portions: parseInt(portions)||4, time: parseInt(time)||null, diff: parseInt(diff),
      ingredients: ings.filter(i => i.name.trim()),
      steps: steps.filter(s => s.trim()).map(text => ({ text, timer: null })),
      notes: notes.trim()
    });
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
          <div style={{ fontFamily:"'Playfair Display',serif", fontSize:'1.35rem', color:'#2C1A0E' }}>Nouvelle recette</div>
          <button onClick={onClose} style={{ background:'#F0E8D8', border:'none', borderRadius:8, width:34, height:34, cursor:'pointer', fontSize:'1rem', color:'#8C7B6B' }}>✕</button>
        </div>

        {/* Champs */}
        {[
          { label:'Nom', el: <input {...inp()} value={name} onChange={e=>setName(e.target.value)} placeholder="Ex : Tarte au citron" /> },
        ].map(({label,el}) => (
          <div key={label} style={{ marginBottom:'1rem' }}>
            <label style={{ display:'block', fontSize:'0.75rem', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', color:'#8C7B6B', marginBottom:'0.35rem' }}>{label}</label>
            {el}
          </div>
        ))}

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem', marginBottom:'1rem' }}>
          <div>
            <label style={{ display:'block', fontSize:'0.75rem', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', color:'#8C7B6B', marginBottom:'0.35rem' }}>Catégorie</label>
            <select {...inp()} value={cat} onChange={e=>setCat(e.target.value)}>
              {CATEGORIES.filter(c=>c!=='Toutes').map(c=><option key={c}>{c}</option>)}
            </select>
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
              <option value={1}>Facile</option>
              <option value={2}>Intermédiaire</option>
              <option value={3}>Difficile</option>
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
              <textarea {...inp({style:{flex:1,minHeight:60,resize:'vertical',lineHeight:1.5}})} value={s} onChange={e=>setStep(i,e.target.value)} placeholder={`Étape ${i+1}…`} />
              <button onClick={()=>rmStep(i)} style={{ background:'none', border:'1px solid #E4D9CC', borderRadius:6, width:30, height:30, cursor:'pointer', color:'#8C7B6B', fontSize:'1rem', flexShrink:0, marginTop:4 }}>−</button>
            </div>
          ))}
          <button onClick={addStep} style={{ width:'100%', background:'none', border:'1.5px dashed #E4D9CC', borderRadius:8, padding:'0.45rem', fontSize:'0.82rem', color:'#8C7B6B', cursor:'pointer', fontFamily:"'Inter',sans-serif" }}>+ Étape</button>
        </div>

        {/* Notes */}
        <div style={{ marginBottom:'1.5rem' }}>
          <label style={{ display:'block', fontSize:'0.75rem', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em', color:'#8C7B6B', marginBottom:'0.35rem' }}>Notes & conseils</label>
          <textarea {...inp({style:{minHeight:80,resize:'vertical',lineHeight:1.5}})} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Astuces, variantes, conservation…" />
        </div>

        <div style={{ display:'flex', gap:'0.75rem', justifyContent:'flex-end' }}>
          <button onClick={onClose} style={{ padding:'0.6rem 1.1rem', borderRadius:9, border:'1.5px solid #E4D9CC', background:'none', fontFamily:"'Inter',sans-serif", fontSize:'0.88rem', color:'#8C7B6B', cursor:'pointer' }}>Annuler</button>
          <button onClick={handleSave} style={{ padding:'0.6rem 1.4rem', borderRadius:9, border:'none', background:'#C4622D', color:'#fff', fontFamily:"'Inter',sans-serif", fontSize:'0.88rem', fontWeight:600, cursor:'pointer' }}>Enregistrer</button>
        </div>
      </div>
    </div>
  );
}

// ── DETAIL MODAL ──────────────────────────────────────────────────────────────
function DetailModal({ recipe, onClose, timerCtx }) {
  const [mult, setMult] = useState(1);
  const portions = Math.round(recipe.portions * mult);

  const changeMult = d => {
    const np = recipe.portions * mult + d;
    if (np < 1) return;
    setMult(np / recipe.portions);
  };

  const fmtQty = qty => {
    if (mult === 1) return qty;
    const num = parseFloat(qty);
    if (isNaN(num)) return qty;
    return qty.replace(/[\d.]+/, v => Math.round(parseFloat(v) * mult * 10) / 10);
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(44,26,14,0.45)', backdropFilter:'blur(3px)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem', overflowY:'auto' }} onClick={onClose}>
      <div style={{ background:'#fff', borderRadius:18, width:'100%', maxWidth:620, maxHeight:'92vh', overflowY:'auto', boxShadow:'0 20px 60px rgba(44,26,14,0.25)' }} onClick={e=>e.stopPropagation()}>
        {/* Hero */}
        <div style={{ background:'#F0E8D8', padding:'2rem 1.5rem 1.5rem', textAlign:'center', borderBottom:'1px solid #E4D9CC' }}>
          <div style={{ fontSize:'3.5rem', marginBottom:'0.6rem' }}>{recipe.emoji||'🍽️'}</div>
          <div style={{ fontSize:'0.7rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'#C4622D', marginBottom:'0.4rem' }}>{recipe.cat}</div>
          <div style={{ fontFamily:"'Playfair Display',serif", fontSize:'1.7rem', color:'#2C1A0E', marginBottom:'0.9rem', lineHeight:1.2 }}>{recipe.name}</div>
          <div style={{ display:'flex', justifyContent:'center', gap:'0.75rem', flexWrap:'wrap' }}>
            {recipe.time && <span style={{ background:'#fff', border:'1px solid #E4D9CC', borderRadius:20, padding:'0.3rem 0.85rem', fontSize:'0.78rem', color:'#8C7B6B' }}>⏱ {recipe.time < 60 ? recipe.time+'min' : Math.floor(recipe.time/60)+'h'+(recipe.time%60?recipe.time%60+'min':'')}</span>}
            <span style={{ background:'#fff', border:'1px solid #E4D9CC', borderRadius:20, padding:'0.3rem 0.85rem', fontSize:'0.78rem', color:'#8C7B6B' }}>{DIFF_LABELS[recipe.diff]}</span>
          </div>
        </div>

        <div style={{ padding:'1.5rem' }}>
          {/* Portions */}
          <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', background:'#F0E8D8', borderRadius:10, padding:'0.65rem 1rem', marginBottom:'1.25rem' }}>
            <span style={{ fontSize:'0.85rem', color:'#8C7B6B', flex:1 }}>Portions</span>
            <div style={{ display:'flex', alignItems:'center', gap:'0.6rem' }}>
              <button onClick={()=>changeMult(-1)} style={{ width:28, height:28, borderRadius:'50%', border:'1.5px solid #E4D9CC', background:'#fff', cursor:'pointer', fontSize:'1rem', display:'flex', alignItems:'center', justifyContent:'center', color:'#2C1A0E' }}>−</button>
              <span style={{ fontWeight:700, fontSize:'1rem', minWidth:'1.5rem', textAlign:'center' }}>{portions}</span>
              <button onClick={()=>changeMult(1)} style={{ width:28, height:28, borderRadius:'50%', border:'1.5px solid #E4D9CC', background:'#fff', cursor:'pointer', fontSize:'1rem', display:'flex', alignItems:'center', justifyContent:'center', color:'#2C1A0E' }}>+</button>
            </div>
          </div>

          {/* Ingrédients */}
          <div style={{ fontFamily:"'Playfair Display',serif", fontSize:'1rem', fontWeight:600, color:'#2C1A0E', marginBottom:'0.65rem' }}>Ingrédients</div>
          <ul style={{ listStyle:'none', marginBottom:'1.5rem' }}>
            {recipe.ingredients.map((ing, i) => (
              <li key={i} style={{ display:'flex', justifyContent:'space-between', padding:'0.4rem 0', borderBottom: i<recipe.ingredients.length-1?'1px solid #E4D9CC':'none', fontSize:'0.88rem' }}>
                <span>{ing.name}</span>
                <span style={{ color:'#8C7B6B', fontWeight:500 }}>{fmtQty(ing.qty)}</span>
              </li>
            ))}
          </ul>

          {/* Étapes */}
          <div style={{ fontFamily:"'Playfair Display',serif", fontSize:'1rem', fontWeight:600, color:'#2C1A0E', marginBottom:'0.75rem' }}>Préparation</div>
          <ul style={{ listStyle:'none' }}>
            {recipe.steps.map((s, i) => (
              <li key={i} style={{ display:'flex', gap:'0.85rem', marginBottom:'1.1rem', alignItems:'flex-start' }}>
                <div style={{ width:30, height:30, borderRadius:'50%', background:'#C4622D', color:'#fff', fontSize:'0.78rem', fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, marginTop:2 }}>{i+1}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:'0.88rem', lineHeight:1.6 }}>{s.text}</div>
                  {s.timer && (
                    <button
                      onClick={() => timerCtx.start(s.timer, `Étape ${i+1} — ${recipe.name}`)}
                      style={{ display:'inline-flex', alignItems:'center', gap:'0.3rem', marginTop:'0.45rem', background:'#F5E6DC', border:'1px solid #e8c4ac', color:'#C4622D', borderRadius:6, padding:'0.25rem 0.65rem', fontSize:'0.76rem', fontWeight:600, cursor:'pointer', fontFamily:"'Inter',sans-serif" }}
                    >
                      ⏱ {Math.floor(s.timer/60)}:{String(s.timer%60).padStart(2,'0')}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {recipe.notes && (
            <>
              <div style={{ fontFamily:"'Playfair Display',serif", fontSize:'1rem', fontWeight:600, color:'#2C1A0E', margin:'1.25rem 0 0.5rem' }}>Notes</div>
              <div style={{ background:'#F0E8D8', borderRadius:10, padding:'0.9rem 1rem', fontSize:'0.86rem', lineHeight:1.6, color:'#8C7B6B', fontStyle:'italic' }}>{recipe.notes}</div>
            </>
          )}

          <div style={{ textAlign:'center', marginTop:'1.5rem' }}>
            <button onClick={onClose} style={{ padding:'0.55rem 1.5rem', borderRadius:9, border:'1.5px solid #E4D9CC', background:'none', fontFamily:"'Inter',sans-serif", fontSize:'0.85rem', color:'#8C7B6B', cursor:'pointer' }}>Fermer</button>
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

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [recipes, setRecipes] = useState([]);
  const [activeCategory, setActiveCategory] = useState('Toutes');
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [driveStatus, setDriveStatus] = useState('loading'); // loading | synced | saving | error | offline
  const [toasts, setToasts] = useState([]);
  const timerCtx = useTimer();
  const saveTimeout = useRef(null);

  const addToast = useCallback((msg, type='info', duration=3000) => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), duration);
  }, []);

  // Load from Drive on mount
  useEffect(() => {
    (async () => {
      setDriveStatus('loading');
      const driveRecipes = await loadFromDrive();
      if (driveRecipes !== null) {
        setRecipes(driveRecipes.length > 0 ? driveRecipes : DEFAULT_RECIPES);
        setDriveStatus('synced');
        addToast('✓ Recettes chargées depuis Drive', 'success');
      } else {
        setRecipes(DEFAULT_RECIPES);
        setDriveStatus('offline');
        addToast('Drive non disponible — mode local', 'error');
      }
    })();
  }, []);

  // Auto-save to Drive when recipes change
  const triggerSave = useCallback((newRecipes) => {
    if (driveStatus === 'offline') return;
    setDriveStatus('saving');
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(async () => {
      const ok = await saveToDrive(newRecipes);
      setDriveStatus(ok ? 'synced' : 'error');
      if (ok) addToast('✓ Sauvegardé sur Drive', 'success');
      else addToast('Erreur de sauvegarde Drive', 'error');
    }, 1200);
  }, [driveStatus, addToast]);

  const updateRecipes = useCallback((newRecipes) => {
    setRecipes(newRecipes);
    triggerSave(newRecipes);
  }, [triggerSave]);

  const handleSave = useCallback((recipe) => {
    const newRecipes = [...recipes, recipe];
    updateRecipes(newRecipes);
    setShowAdd(false);
  }, [recipes, updateRecipes]);

  const handleDelete = useCallback((id) => {
    if (!window.confirm('Supprimer cette recette ?')) return;
    updateRecipes(recipes.filter(r => r.id !== id));
  }, [recipes, updateRecipes]);

  // Filter
  const filtered = recipes.filter(r => {
    const matchCat = activeCategory === 'Toutes' || r.cat === activeCategory;
    const q = search.toLowerCase();
    const matchQ = !q || r.name.toLowerCase().includes(q) || r.cat.toLowerCase().includes(q) || r.ingredients.some(i => i.name.toLowerCase().includes(q));
    return matchCat && matchQ;
  });

  const cats = ['Toutes', ...new Set(recipes.map(r => r.cat))];
  const byCat = activeCategory === 'Toutes'
    ? Object.fromEntries(cats.filter(c=>c!=='Toutes').map(c => [c, filtered.filter(r=>r.cat===c)]).filter(([,v])=>v.length>0))
    : { [activeCategory]: filtered };

  const statusInfo = {
    loading: { color:'#D4A017', icon:'⟳', label:'Chargement…' },
    saving:  { color:'#D4A017', icon:'⟳', label:'Sauvegarde…' },
    synced:  { color:'#4A7C59', icon:'✓', label:'Synchronisé' },
    error:   { color:'#dc2626', icon:'⚠', label:'Erreur Drive' },
    offline: { color:'#8C7B6B', icon:'○', label:'Mode local' },
  }[driveStatus];

  const detailRecipe = recipes.find(r => r.id === detailId);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&family=Inter:wght@300;400;500;600&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{font-family:'Inter',sans-serif;background:#FAFAF7;color:#2C1A0E;min-height:100vh}
        ::-webkit-scrollbar{width:6px} ::-webkit-scrollbar-track{background:#F0E8D8} ::-webkit-scrollbar-thumb{background:#C4622D;border-radius:3px}
      `}</style>

      {/* HEADER */}
      <header style={{ background:'#2C1A0E', padding:'1rem 1.5rem', position:'sticky', top:0, zIndex:100, boxShadow:'0 2px 12px rgba(44,26,14,0.2)' }}>
        <div style={{ maxWidth:1100, margin:'0 auto', display:'flex', alignItems:'center', gap:'1rem', flexWrap:'wrap' }}>
          <div style={{ fontFamily:"'Playfair Display',serif", fontSize:'1.5rem', color:'#F0E8D8', whiteSpace:'nowrap' }}>
            Mon <span style={{ color:'#C4622D', fontStyle:'italic' }}>Carnet</span>
          </div>
          <div style={{ flex:1, minWidth:180, position:'relative' }}>
            <svg style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', opacity:0.4 }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher…" style={{ width:'100%', padding:'0.55rem 1rem 0.55rem 2.3rem', borderRadius:8, border:'none', background:'rgba(255,255,255,0.1)', color:'#fff', fontFamily:"'Inter',sans-serif", fontSize:'0.88rem', outline:'none' }} />
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
            <span style={{ fontSize:'0.72rem', color: statusInfo.color, display:'flex', alignItems:'center', gap:'0.25rem', whiteSpace:'nowrap' }}>
              <span style={{ fontSize:'0.8rem' }}>{statusInfo.icon}</span>{statusInfo.label}
            </span>
            <button onClick={()=>setShowAdd(true)} style={{ background:'#C4622D', color:'#fff', border:'none', borderRadius:8, padding:'0.55rem 1.1rem', fontFamily:"'Inter',sans-serif", fontWeight:600, fontSize:'0.86rem', cursor:'pointer', display:'flex', alignItems:'center', gap:'0.35rem', whiteSpace:'nowrap' }}>
              + Ajouter
            </button>
          </div>
        </div>
      </header>

      {/* CATS */}
      <div style={{ background:'#F0E8D8', borderBottom:'1px solid #E4D9CC', overflowX:'auto' }}>
        <div style={{ maxWidth:1100, margin:'0 auto', display:'flex', gap:'0.2rem', padding:'0.6rem 1.5rem' }}>
          {cats.map(c => (
            <button key={c} onClick={()=>setActiveCategory(c)} style={{ background: c===activeCategory?'#2C1A0E':'none', color: c===activeCategory?'#F0E8D8':'#8C7B6B', border:'none', padding:'0.38rem 0.9rem', borderRadius:20, fontSize:'0.83rem', cursor:'pointer', whiteSpace:'nowrap', fontFamily:"'Inter',sans-serif", fontWeight:500, transition:'all 0.15s' }}>
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* CONTENT */}
      <main style={{ maxWidth:1100, margin:'0 auto', padding:'1.75rem 1.5rem' }}>
        {Object.entries(byCat).map(([cat, rs]) => rs.length === 0 ? null : (
          <div key={cat}>
            <div style={{ fontFamily:"'Playfair Display',serif", fontSize:'1.2rem', color:'#2C1A0E', marginBottom:'1rem', display:'flex', alignItems:'center', gap:'0.5rem' }}>
              {cat}
              <div style={{ flex:1, height:1, background:'#E4D9CC', marginLeft:'0.5rem' }} />
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))', gap:'1.1rem', marginBottom:'2.5rem' }}>
              {rs.map(r => <RecipeCard key={r.id} recipe={r} onOpen={setDetailId} onDelete={handleDelete} />)}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={{ textAlign:'center', padding:'3rem', color:'#8C7B6B' }}>
            <div style={{ fontSize:'2rem' }}>📖</div>
            <p style={{ marginTop:'0.5rem', fontSize:'0.9rem' }}>Aucune recette ici. Ajoute-en une !</p>
          </div>
        )}
      </main>

      {/* MODALS */}
      {showAdd && <AddModal onClose={()=>setShowAdd(false)} onSave={handleSave} />}
      {detailRecipe && <DetailModal recipe={detailRecipe} onClose={()=>setDetailId(null)} timerCtx={timerCtx} />}

      {/* TIMER */}
      <TimerWidget timer={timerCtx.timer} fmt={timerCtx.fmt} toggle={timerCtx.toggle} cancel={timerCtx.cancel} />

      {/* TOASTS */}
      <Toast toasts={toasts} />
    </>
  );
}
