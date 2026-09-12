import { useState } from "react";
import { registerUser, loginUser } from "../lib/firebase";

export default function AuthScreen() {
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
      if (mode === 'register') await registerUser(username, password);
      else await loginUser(username, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="auth-brand__dot" />
          <div className="auth-brand__word">Mon <span>Carnet</span></div>
          <p className="auth-brand__tagline">Vos recettes, toujours à portée de main.</p>
        </div>

        <div className="segmented" style={{ marginBottom: 'var(--space-m)' }}>
          <button type="button" className={`segmented__btn ${mode === 'login' ? 'active' : ''}`} onClick={() => { setMode('login'); setError(''); }}>Connexion</button>
          <button type="button" className={`segmented__btn ${mode === 'register' ? 'active' : ''}`} onClick={() => { setMode('register'); setError(''); }}>Inscription</button>
        </div>

        <form onSubmit={submit}>
          <div className="field">
            <label className="field__label">Pseudo</label>
            <input className="input" value={username} onChange={e => setUsername(e.target.value)} placeholder="ex : augustin" autoComplete="username" />
          </div>
          <div className="field">
            <label className="field__label">Mot de passe</label>
            <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="6 caractères minimum" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} />
          </div>
          {mode === 'register' && (
            <div className="field">
              <label className="field__label">Confirmer le mot de passe</label>
              <input className="input" type="password" value={password2} onChange={e => setPassword2(e.target.value)} autoComplete="new-password" />
            </div>
          )}

          {error && (
            <p style={{ marginBottom: 'var(--space-s)', fontSize: 'var(--step--1)', color: 'var(--danger)', background: 'var(--accent-soft)', padding: '10px 12px', borderRadius: 'var(--radius)', fontWeight: 500 }}>
              {error}
            </p>
          )}

          <button type="submit" disabled={loading || !username.trim() || !password} className="btn btn--primary btn--block btn--lg">
            {loading ? '⟳ Un instant…' : (mode === 'register' ? "S'inscrire" : 'Se connecter')}
          </button>
        </form>
      </div>
    </div>
  );
}