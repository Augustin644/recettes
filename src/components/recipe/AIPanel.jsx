import { useState } from "react";
import { hasApiKey, extractRecipeFromText, extractRecipeFromImage, generateRecipe, fileToBase64 } from "../../lib/ai";
import { useApp } from "../../context/AppContext";

export default function AIPanel({ onResult, onUsePhotoAsIllustration }) {
  const { addToast } = useApp();
  const [mode, setMode] = useState('text');
  const [text, setText] = useState('');
  const [photoFile, setPhotoFile] = useState(null);
  const [useAsIllo, setUseAsIllo] = useState(true);
  const [idea, setIdea] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const needApiKey = () => addToast("Clé API absente. Ouvrez les Réglages.", 'error');

  const run = async (fn) => {
    if (!hasApiKey()) { needApiKey(); return; }
    setLoading(true); setError('');
    try {
      const result = await fn();
      onResult(result);
      addToast('Analyse IA réussie, formulaire prérempli', 'success');
    } catch (e) {
      setError(e.message || 'Une erreur est survenue.');
    } finally { setLoading(false); }
  };

  return (
    <div className="ai-panel">
      <div className="ai-panel__head">
        <span className="ai-panel__spark">✦</span> Assistant IA
      </div>
      <div className="segmented" style={{ marginBottom: 'var(--space-s)' }}>
        {[{ k: 'text', l: 'Coller un texte' }, { k: 'photo', l: 'Depuis une photo' }, { k: 'idea', l: "D'une idée" }].map(m => (
          <button key={m.k} type="button" onClick={() => setMode(m.k)} className={`segmented__btn ${mode === m.k ? 'active' : ''}`}>{m.l}</button>
        ))}
      </div>

      {mode === 'text' && (
        <div>
          <textarea className="textarea" style={{ minHeight: 84 }} value={text} onChange={e => setText(e.target.value)}
            placeholder="Collez ici le texte brut d'une recette (site web, message, notes…)" />
          <button type="button" disabled={loading || !text.trim()} className="btn btn--primary btn--block" style={{ marginTop: 'var(--space-xs)' }}
            onClick={() => text.trim() && run(() => extractRecipeFromText(text))}>
            {loading ? '⟳ Analyse en cours…' : 'Analyser le texte'}
          </button>
        </div>
      )}

      {mode === 'photo' && (
        <div>
          <input type="file" accept="image/*" onChange={e => setPhotoFile(e.target.files[0] || null)} style={{ fontSize: 'var(--step--1)', marginBottom: 'var(--space-2xs)' }} />
          <label className="field__hint" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={useAsIllo} onChange={e => setUseAsIllo(e.target.checked)} />
            Conserver comme photo d'illustration
          </label>
          <button type="button" disabled={loading || !photoFile} className="btn btn--primary btn--block" style={{ marginTop: 'var(--space-2xs)' }}
            onClick={() => photoFile && run(async () => {
              const { base64, mediaType } = await fileToBase64(photoFile);
              const result = await extractRecipeFromImage(base64, mediaType);
              if (useAsIllo) onUsePhotoAsIllustration(photoFile);
              return result;
            })}>
            {loading ? '⟳ Numérisation…' : "Analyser l'image et préremplir"}
          </button>
        </div>
      )}

      {mode === 'idea' && (
        <div>
          <input className="input" value={idea} onChange={e => setIdea(e.target.value)} placeholder="Ex : un dessert léger aux fraises et basilic" />
          <button type="button" disabled={loading || !idea.trim()} className="btn btn--primary btn--block" style={{ marginTop: 'var(--space-xs)' }}
            onClick={() => idea.trim() && run(() => generateRecipe(idea))}>
            {loading ? '⟳ Création de la recette…' : 'Créer de toutes pièces'}
          </button>
        </div>
      )}

      {error && <p style={{ marginTop: 'var(--space-xs)', fontSize: 'var(--step--1)', color: 'var(--danger)', fontWeight: 600 }}>{error}</p>}
    </div>
  );
}