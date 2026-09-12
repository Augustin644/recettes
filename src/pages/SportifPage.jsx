import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { collection, query, where, onSnapshot, doc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useApp } from "../context/AppContext";
import EmptyState from "../components/ui/EmptyState";
import {
  ACTIVITY_LEVELS, GOALS, computeTargets, dayTotals,
  todayStr, addDaysToDate, dateLabel,
} from "../lib/nutrition";

function Chart({ data, target, height = 120 }) {
  const max = Math.max(target, ...data.map(d => d.value), 1) * 1.15;
  return (
    <div className="chart">
      {data.map((d, i) => {
        const h = target > 0 ? (d.value / max) * height : 0;
        const over = d.value > target;
        return (
          <div key={d.date} className="chart__col" title={`${dateLabel(d.date)} : ${Math.round(d.value)} kcal`}>
            <div className="chart__bar-wrap" style={{ height }}>
              <div className="chart__bar" style={{ height: `${Math.max(2, h)}px`, background: over ? 'var(--danger)' : 'var(--accent)', opacity: d.hasData ? 1 : 0.25 }} />
            </div>
            <div className="chart__lbl">{i % 4 === 0 || i === data.length - 1 ? d.short : ''}</div>
          </div>
        );
      })}
      <div className="chart__target" style={{ bottom: `calc(18px + ${height}px - ${(target / max) * height}px)` }}>
        <span>Objectif {Math.round(target)} kcal</span>
      </div>
    </div>
  );
}

function StatStat({ label, consumed, target, color }) {
  const pct = target > 0 ? Math.round(consumed / target * 100) : 0;
  return (
    <div className="stat-stat">
      <span className="stat-stat__label">{label}</span>
      <b>{Math.round(consumed)} <small>/ {Math.round(target || 0)}</small></b>
      <span className="stat-stat__pct" style={{ color }}>{pct}%</span>
    </div>
  );
}

export default function SportifPage() {
  const navigate = useNavigate();
  const { user, myProfile, sportif, updateSportif, logWeighIn, addToast } = useApp();

  const [plan, setPlan] = useState({});
  const [dayMap, setDayMap] = useState({}); // date -> entries[]
  const [showWelcomeForm, setShowWelcomeForm] = useState(false);
  const active = !!sportif?.active;

  const [form, setForm] = useState({
    sex: 'male', birthYear: 1998, heightCm: 175, weightKg: 70,
    activityLevel: 'moderate', goal: 'maintain',
  });
  const [targets, setTargets] = useState({
    kcal: 2200, protein: 150, carbs: 220, fat: 60, bmr: 0, tdee: 0,
  });

  useEffect(() => {
    if (!sportif) return;
    setForm({
      sex: sportif.sex || 'male',
      birthYear: sportif.birthYear || 1998,
      heightCm: sportif.heightCm || 175,
      weightKg: sportif.weightKg || 70,
      activityLevel: sportif.activityLevel || 'moderate',
      goal: sportif.goal || 'maintain',
    });
    setTargets({
      kcal: sportif.targets?.kcal || 2200,
      protein: sportif.targets?.protein || 150,
      carbs: sportif.targets?.carbs || 220,
      fat: sportif.targets?.fat || 60,
      bmr: sportif.targets?.bmr || 0,
      tdee: sportif.targets?.tdee || 0,
    });
  }, [sportif]);

  const [weighIn, setWeighIn] = useState(sportif?.weightKg ? String(sportif.weightKg) : '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    const unsubPlan = onSnapshot(doc(db, 'meal_plans', user.uid), snap => {
      if (snap.exists()) setPlan(snap.data().plan || {});
    });
    const unsubDays = onSnapshot(
      query(collection(db, 'macro_days'), where('uid', '==', user.uid)),
      snap => {
        const map = {};
        snap.docs.forEach(d => { const data = d.data(); map[data.date] = data.entries || []; });
        setDayMap(map);
      }
    );
    return () => { unsubPlan(); unsubDays(); };
  }, [user]);

  const recompute = (partial = {}) => {
    setForm(f => {
      const merged = { ...f, ...partial };
      const t = computeTargets(merged);
      setTargets({
        kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat, bmr: t.bmr, tdee: t.tdee,
      });
      return merged;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      await updateSportif({
        active: true,
        sex: form.sex, birthYear: parseInt(form.birthYear) || 1990,
        heightCm: parseFloat(form.heightCm) || 175,
        weightKg: parseFloat(form.weightKg) || 70,
        activityLevel: form.activityLevel, goal: form.goal,
        targets,
      });
      addToast('Profil sportif enregistré', 'success');
    } catch {
      addToast("Erreur d'enregistrement", 'error');
    } finally { setSaving(false); }
  };

  const saveWeighIn = async () => {
    const kg = parseFloat(weighIn);
    if (!kg || kg < 20 || kg > 400) { addToast('Poids invalide', 'error'); return; }
    await logWeighIn(kg);
    setWeighIn('');
  };

  const timeline = useMemo(() => {
    const today = todayStr();
    const out = [];
    for (let i = 0; i < 30; i++) {
      const d = addDaysToDate(today, -i);
      const { totals, hasData } = dayTotals(plan, d, dayMap[d] || []);
      out.push({ date: d, short: d.slice(8), ...totals, hasData });
    }
    return out.reverse();
  }, [plan, dayMap]);

  const week = timeline.slice(-7);
  const month = timeline;

  const stats = useMemo(() => {
    const withData = month.filter(d => d.hasData);
    const avg = (k) => withData.length ? withData.reduce((s, d) => s + d[k], 0) / withData.length : 0;
    const target = targets;
    const adherence = withData.length
      ? Math.round(withData.filter(d => d.kcal >= target.kcal * 0.9 && d.kcal <= target.kcal * 1.1).length / withData.length * 100)
      : 0;
    return {
      avgKcal: avg('kcal'), avgProtein: avg('protein'), avgCarbs: avg('carbs'), avgFat: avg('fat'),
      adherence, loggedDays: withData.length,
    };
  }, [month, targets]);

  const weighIns = Array.isArray(myProfile?.weighIns) ? myProfile.weighIns : [];
  const lastWeigh = weighIns.length ? weighIns[weighIns.length - 1] : null;

  if (!active && !showWelcomeForm) {
    return (
      <div className="app-main" style={{ maxWidth: 560 }}>
        <div className="page-head">
          <div><div className="eyebrow">Performance</div><h1 className="page-title">Mode sportif</h1></div>
        </div>
        <EmptyState emoji="🏋️" title="Prêt à performer ?"
          text="Activez le mode sportif pour entrer vos objectifs (poids, taille, activité) et suivre vos calories et macros chaque jour.">
          <button className="btn btn--primary" onClick={() => setShowWelcomeForm(true)}>Configurer mon profil sportif</button>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="app-main" style={{ maxWidth: 720 }}>
      <div className="page-head">
        <div><div className="eyebrow">Performance</div><h1 className="page-title">Mode sportif</h1></div>
      </div>

      {/* ── Profil & objectifs ─────────────────────────────────────────── */}
      <div className="sportif-card">
        <div className="section-title">Profil & objectifs</div>
        <div className="form-grid">
          <div className="field">
            <label className="field__label">Sexe</label>
            <select className="select" value={form.sex} onChange={e => recompute({ sex: e.target.value })}>
              <option value="male">Homme</option>
              <option value="female">Femme</option>
            </select>
          </div>
          <div className="field">
            <label className="field__label">Année de naissance</label>
            <input className="input" type="number" value={form.birthYear} onChange={e => recompute({ birthYear: e.target.value })} />
          </div>
          <div className="field">
            <label className="field__label">Taille (cm)</label>
            <input className="input" type="number" value={form.heightCm} onChange={e => recompute({ heightCm: e.target.value })} />
          </div>
          <div className="field">
            <label className="field__label">Poids (kg)</label>
            <input className="input" type="number" value={form.weightKg} onChange={e => recompute({ weightKg: e.target.value })} />
          </div>
          <div className="field">
            <label className="field__label">Activité physique</label>
            <select className="select" value={form.activityLevel} onChange={e => recompute({ activityLevel: e.target.value })}>
              {Object.entries(ACTIVITY_LEVELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="field__label">Objectif</label>
            <select className="select" value={form.goal} onChange={e => recompute({ goal: e.target.value })}>
              {Object.entries(GOALS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
        </div>

        {targets.bmr > 0 && (
          <p style={{ fontSize: 'var(--step--1)', color: 'var(--ink-3)', margin: 'var(--space-xs) 0' }}>
            Métabolisme de base ≈ <b>{targets.bmr} kcal</b> · Dépense totale ≈ <b>{targets.tdee} kcal</b>
          </p>
        )}

        <div className="section-title" style={{ marginTop: 'var(--space-s)' }}>Cibles journalières</div>
        <div className="form-grid">
          <div className="field"><label className="field__label">Calories</label><input className="input" type="number" value={targets.kcal} onChange={e => setTargets(t => ({ ...t, kcal: e.target.value }))} /></div>
          <div className="field"><label className="field__label">Protéines (g)</label><input className="input" type="number" value={targets.protein} onChange={e => setTargets(t => ({ ...t, protein: e.target.value }))} /></div>
          <div className="field"><label className="field__label">Glucides (g)</label><input className="input" type="number" value={targets.carbs} onChange={e => setTargets(t => ({ ...t, carbs: e.target.value }))} /></div>
          <div className="field"><label className="field__label">Lipides (g)</label><input className="input" type="number" value={targets.fat} onChange={e => setTargets(t => ({ ...t, fat: e.target.value }))} /></div>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-xs)', marginTop: 'var(--space-s)' }}>
          <button className="btn btn--secondary" onClick={() => recompute()}>Réinitialiser (auto)</button>
          <button className="btn btn--primary" disabled={saving} onClick={save}>{saving ? '⟳…' : 'Enregistrer'}</button>
        </div>
      </div>

      {/* ── Résumé & adhérence ─────────────────────────────────────────── */}
      <div className="sportif-card">
        <div className="section-title">Résumé du mois</div>
        {stats.loggedDays === 0 ? (
          <p style={{ color: 'var(--ink-3)', fontSize: 'var(--step--1)' }}>
            Aucune journée renseignée pour l'instant. Ajoutez des repas au planning et des aliments ponctuels pour alimenter les statistiques.
          </p>
        ) : (
          <>
            <div className="stat-stats">
              <StatStat label="Moy. calories/j" consumed={stats.avgKcal} target={targets.kcal} color="var(--accent)" />
              <StatStat label="Protéines" consumed={stats.avgProtein} target={targets.protein} color="var(--success)" />
              <StatStat label="Glucides" consumed={stats.avgCarbs} target={targets.carbs} color="var(--info)" />
              <StatStat label="Lipides" consumed={stats.avgFat} target={targets.fat} color="#E8A33D" />
            </div>
            <div className="adherence">
              <div>
                <b>{stats.adherence}%</b>
                <span>de jours dans l'objectif calorique (±10%)</span>
              </div>
              <div>
                <b>{stats.loggedDays} / 30</b>
                <span>jours suivis</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Courbes ────────────────────────────────────────────────────── */}
      <div className="sportif-card">
        <div className="section-title">Dernière semaine</div>
        <Chart data={week.map(d => ({ date: d.date, short: d.short, value: d.kcal, hasData: d.hasData }))} target={targets.kcal} height={110} />
      </div>

      <div className="sportif-card">
        <div className="section-title">Dernier mois</div>
        <Chart data={month.map(d => ({ date: d.date, short: d.short, value: d.kcal, hasData: d.hasData }))} target={targets.kcal} height={130} />
      </div>

      {/* ── Poids ──────────────────────────────────────────────────────── */}
      <div className="sportif-card">
        <div className="section-title">Suivi du poids</div>
        {lastWeigh && (
          <p style={{ fontSize: 'var(--step--1)', color: 'var(--ink-3)', marginBottom: 'var(--space-xs)' }}>
            Dernière pesée : <b>{lastWeigh.kg} kg</b> le {lastWeigh.at}
          </p>
        )}
        {weighIns.length > 1 && (
          <div className="weight-spark">
            {weighIns.slice(-14).map((w, i, arr) => {
              const kgs = arr.map(x => x.kg);
              const min = Math.min(...kgs), max = Math.max(...kgs);
              const h = max === min ? 50 : ((w.kg - min) / (max - min)) * 44 + 6;
              return <span key={w.at} title={`${w.at} : ${w.kg} kg`} style={{ height: `${h}px` }} />;
            })}
          </div>
        )}
        <div style={{ display: 'flex', gap: 'var(--space-xs)', marginTop: 'var(--space-s)' }}>
          <input className="input" type="number" inputMode="decimal" value={weighIn} onChange={e => setWeighIn(e.target.value)} placeholder="Poids d'aujourd'hui (kg)" style={{ flex: 1 }} />
          <button className="btn btn--primary" disabled={!weighIn} onClick={saveWeighIn}>Enregistrer</button>
        </div>
      </div>

      <button className="btn btn--secondary btn--block" style={{ marginTop: 'var(--space-s)' }} onClick={() => navigate('/planning')}>
        📅 Retour au planning
      </button>
    </div>
  );
}