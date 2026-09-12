import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getApiKey, setApiKey } from "../lib/ai";
import { changePassword } from "../lib/firebase";
import { useApp } from "../context/AppContext";

function SettingsGroup({ label, children }) {
  return (
    <div style={{ marginBottom: 'var(--space-m)' }}>
      <div className="settings-group__label">{label}</div>
      <div className="settings-group">{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const { myProfile, sportif, updateSportif, togglePrivacy, addToast, isAdmin } = useApp();
  const [key, setKey] = useState(getApiKey());
  const [isPrivate, setIsPrivate] = useState(!!myProfile?.isPrivate);
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const [sportifBusy, setSportifBusy] = useState(false);

  const [curPwd, setCurPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);

  const saveKey = () => { setApiKey(key); addToast('Clé IA enregistrée', 'success'); };

  const doTogglePrivacy = async () => {
    const next = !isPrivate;
    setIsPrivate(next);
    setPrivacyBusy(true);
    try {
      await togglePrivacy(next);
      addToast(next ? 'Compte passé en privé' : 'Compte passé en public', 'success');
    } catch {
      setIsPrivate(!next);
      addToast('Erreur de mise à jour de la confidentialité', 'error');
    } finally { setPrivacyBusy(false); }
  };

  const doChangePassword = async () => {
    if (newPwd !== pwd2) { addToast('Les mots de passe ne correspondent pas', 'error'); return; }
    setPwdBusy(true);
    try {
      await changePassword(curPwd, newPwd);
      addToast('Mot de passe modifié', 'success');
      setCurPwd(''); setNewPwd(''); setPwd2('');
    } catch (e) {
      addToast(e.message || 'Échec du changement', 'error');
    } finally { setPwdBusy(false); }
  };

  return (
    <div className="app-main" style={{ maxWidth: 560 }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Compte</div>
          <h1 className="page-title">Réglages</h1>
        </div>
      </div>

      <SettingsGroup label="Mode sportif">
        <div className="switch-row">
          <div className="switch-row__text">
            <div className="switch-row__title">Suivi nutritionnel sportif</div>
            <div className="switch-row__desc">
              {sportif?.active
                ? 'Actif : macros des recettes, objectifs journaliers et suivi jour/semaine/mois.'
                : 'Inactif : macros, objectifs et suivi des performances désactivés.'}
            </div>
          </div>
          <button
            className={`switch ${sportif?.active ? 'on' : ''}`}
            disabled={sportifBusy}
            onClick={async () => {
              setSportifBusy(true);
              try {
                if (sportif?.active) await updateSportif({ ...sportif, active: false });
                else navigate('/sportif');
              } finally { setSportifBusy(false); }
            }}
            aria-label="Basculer le mode sportif"
          />
        </div>
        {sportif?.active && (
          <button className="settings-row" onClick={() => navigate('/sportif')}>
            <span className="settings-row__icon settings-row__icon--green">🏋️</span>
            <span className="settings-row__label">Mes objectifs & statistiques</span>
            <span className="settings-row__hint">›</span>
          </button>
        )}
      </SettingsGroup>

      <SettingsGroup label="Confidentialité">
        <div className="switch-row">
          <div className="switch-row__text">
            <div className="switch-row__title">Compte privé</div>
            <div className="switch-row__desc">Seuls vos abonnés acceptés verront vos recettes publiques.</div>
          </div>
          <button className={`switch ${isPrivate ? 'on' : ''}`} onClick={doTogglePrivacy} disabled={privacyBusy} aria-label="Basculer le compte privé" />
        </div>
      </SettingsGroup>

      <SettingsGroup label="Sécurité">
        <div className="settings-group">
          <div style={{ padding: 'var(--space-s)' }}>
            <label className="field__label">Changer le mot de passe</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2xs)' }}>
              <input className="input" type="password" value={curPwd} onChange={e => setCurPwd(e.target.value)} placeholder="Mot de passe actuel" autoComplete="current-password" />
              <input className="input" type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="Nouveau mot de passe (6 caractères min.)" autoComplete="new-password" />
              <input className="input" type="password" value={pwd2} onChange={e => setPwd2(e.target.value)} placeholder="Confirmer le nouveau mot de passe" autoComplete="new-password" />
              <button className="btn btn--primary" disabled={pwdBusy || !curPwd || !newPwd} onClick={doChangePassword}>
                {pwdBusy ? '⟳…' : 'Mettre à jour le mot de passe'}
              </button>
            </div>
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup label="Assistant IA (Gemini)">
        <div style={{ padding: 'var(--space-s)' }}>
          <p style={{ fontSize: 'var(--step--1)', color: 'var(--ink-3)', lineHeight: 1.6, marginBottom: 'var(--space-2xs)' }}>
            Votre clé Google Gemini active l'extraction et l'idéation automatisée. Elle est sauvegardée uniquement dans ce navigateur.
          </p>
          <input className="input" type="password" value={key} onChange={e => setKey(e.target.value)} placeholder="AIzaSy…" style={{ fontFamily: 'monospace', marginBottom: 'var(--space-2xs)' }} />
          <button className="btn btn--primary btn--block" onClick={saveKey}>Enregistrer la clé</button>
        </div>
      </SettingsGroup>

      <SettingsGroup label="Raccourcis">
        <button className="settings-row" onClick={() => navigate('/profil')}>
          <span className="settings-row__icon">👤</span>
          <span className="settings-row__label">Modifier mon profil</span>
          <span className="settings-row__hint">›</span>
        </button>
        {isAdmin && (
          <button className="settings-row" onClick={() => navigate('/admin')}>
            <span className="settings-row__icon settings-row__icon--red">🛡️</span>
            <span className="settings-row__label">Modération (Admin)</span>
            <span className="settings-row__hint">›</span>
          </button>
        )}
        <button className="settings-row" onClick={() => navigate('/atelier')}>
          <span className="settings-row__icon">📖</span>
          <span className="settings-row__label">Mon Atelier</span>
          <span className="settings-row__hint">›</span>
        </button>
      </SettingsGroup>
    </div>
  );
}