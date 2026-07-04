import React, { useState } from 'react';
import { getApiKey, setApiKey } from './ai';

// ── COMPOSANT PRINCIPAL (Exporté par défaut pour Vite) ────────────────────────
export default function AppRecettes() {
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div style={{ minHeight: '100vh', background: '#FDFBF7', color: '#2C1A0E', fontFamily: "system-ui, sans-serif" }}>
      {/* Barre de navigation / En-tête */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', borderBottom: '1px solid #E4D9CC', background: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '1.5rem' }}>📖</span>
          <h1 style={{ margin: 0, fontFamily: "'Playfair Display', serif", fontSize: '1.25rem', fontWeight: 700 }}>Mon Carnet de Recettes</h1>
        </div>
        <button 
          onClick={() => setShowSettings(true)} 
          style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', padding: '0.25rem' }}
          title="Réglages"
        >
          ⚙️
        </button>
      </header>

      {/* Contenu de ton application */}
      <main style={{ padding: '1.5rem', maxWidth: '800px', margin: '0 auto' }}>
        <p style={{ textAlign: 'center', color: '#8C7B6B', marginTop: '2rem' }}>
          Bienvenue dans ton carnet de recettes intelligent. Rentre ta clé Gemini dans les réglages pour commencer à utiliser l'IA.
        </p>
      </main>

      {/* Fenêtre des réglages de la Clé API */}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}

// ── COMPOSANT MODAL RÉGLAGES (Google Gemini API) ──────────────────────────────
function SettingsModal({ onClose }) {
  const [key, setKeyState] = useState(getApiKey());

  const save = () => { 
    setApiKey(key); 
    onClose(); 
  };

  return (
    <div 
      style={{ position: 'fixed', inset: 0, background: 'rgba(44,26,14,0.45)', backdropFilter: 'blur(3px)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} 
      onClick={onClose}
    >
      <div 
        style={{ background: '#fff', borderRadius: 18, width: '100%', maxWidth: 440, padding: '1.75rem', boxShadow: '0 20px 60px rgba(44,26,14,0.25)' }} 
        onClick={e => e.stopPropagation()}
      >
        <div style={{ fontFamily: "'Playfair Display',serif", fontSize: '1.3rem', color: '#2C1A0E', marginBottom: '0.75rem' }}>
          Clé API Google Gemini
        </div>
        <p style={{ fontSize: '0.85rem', color: '#8C7B6B', lineHeight: 1.6, marginBottom: '1rem' }}>
          Nécessaire pour les fonctionnalités IA (texte, photo, génération). Elle est enregistrée uniquement dans le stockage local de ce navigateur — jamais stockée sur le code de l'app.
          Tu peux en créer une gratuitement sur <a href="https://aistudio.google.com" target="_blank" rel="noreferrer" style={{ color: '#C4622D', textDecoration: 'underline' }}>aistudio.google.com</a>.
        </p>
        <input
          type="password"
          value={key}
          onChange={e => setKeyState(e.target.value)}
          placeholder="AIzaSy..."
          style={{ width: '100%', padding: '0.65rem 0.85rem', border: '1.5px solid #E4D9CC', borderRadius: 9, fontFamily: "monospace", fontSize: '0.85rem', outline: 'none', marginBottom: '1.25rem', boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <button 
            onClick={onClose} 
            style={{ padding: '0.6rem 1.1rem', borderRadius: 9, border: '1.5px solid #E4D9CC', background: 'none', fontSize: '0.88rem', color: '#8C7B6B', cursor: 'pointer' }}
          >
            Annuler
          </button>
          <button 
            onClick={save} 
            style={{ padding: '0.6rem 1.4rem', borderRadius: 9, border: 'none', background: '#C4622D', color: '#fff', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer' }}
          >
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}
