// ── SETTINGS MODAL (clé API) ──────────────────────────────────────────────────
function SettingsModal({ onClose }) {
  const [key, setKey] = useState(getApiKey());

  const save = () => { setApiKey(key); onClose(); };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(44,26,14,0.45)', backdropFilter:'blur(3px)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem' }} onClick={onClose}>
      <div style={{ background:'#fff', borderRadius:18, width:'100%', maxWidth:440, padding:'1.75rem', boxShadow:'0 20px 60px rgba(44,26,14,0.25)' }} onClick={e=>e.stopPropagation()}>
        <div style={{ fontFamily:"'Playfair Display',serif", fontSize:'1.3rem', color:'#2C1A0E', marginBottom:'0.75rem' }}>Clé API Google Gemini</div>
        <p style={{ fontSize:'0.85rem', color:'#8C7B6B', lineHeight:1.6, marginBottom:'1rem' }}>
          Nécessaire pour les fonctionnalités IA (texte, photo, génération). Elle est enregistrée uniquement dans le stockage local de ce navigateur — jamais dans le code de l'app.
          Tu peux en créer une gratuitement sur <span style={{color:'#C4622D'}}>aistudio.google.com</span>.
        </p>
        <input
          type="password"
          value={key}
          onChange={e=>setKey(e.target.value)}
          placeholder="AIzaSy..."
          style={{ width:'100%', padding:'0.65rem 0.85rem', border:'1.5px solid #E4D9CC', borderRadius:9, fontFamily:"monospace", fontSize:'0.85rem', outline:'none', marginBottom:'1.25rem' }}
        />
        <div style={{ display:'flex', gap:'0.75rem', justifyContent:'flex-end' }}>
          <button onClick={onClose} style={{ padding:'0.6rem 1.1rem', borderRadius:9, border:'1.5px solid #E4D9CC', background:'none', fontSize:'0.88rem', color:'#8C7B6B', cursor:'pointer' }}>Annuler</button>
          <button onClick={save} style={{ padding:'0.6rem 1.4rem', borderRadius:9, border:'none', background:'#C4622D', color:'#fff', fontSize:'0.88rem', fontWeight:600, cursor:'pointer' }}>Enregistrer</button>
        </div>
      </div>
    </div>
  ); 
}
export default App;
