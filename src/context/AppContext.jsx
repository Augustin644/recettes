import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, where,
  serverTimestamp, getDoc, increment, writeBatch,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { db, storage, subscribeAuth, logoutUser } from "../lib/firebase";
import { ensureUserDoc, propagatePrivacyToRecipes } from "../lib/utils";
import { FAVS_KEY, THEME_KEY } from "../lib/constants";
import { applyAdaptations } from "../lib/nutrition";

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

/* ── Timer hook ─────────────────────────────────────────────────────────── */
function useTimer() {
  const [timer, setTimer] = useState(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!timer || timer.paused || timer.done) return;
    intervalRef.current = setInterval(() => {
      setTimer(t => {
        if (!t) return t;
        if (t.remaining <= 1) {
          try { new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=').play().catch(() => {}); } catch {}
          return { ...t, remaining: 0, done: true };
        }
        return { ...t, remaining: t.remaining - 1 };
      });
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, [timer?.paused, timer?.done, !!timer]);

  const start = useCallback((seconds, label) => {
    setTimer({ total: seconds, remaining: seconds, label, paused: false, done: false });
  }, []);
  const toggle = useCallback(() => setTimer(t => (t ? { ...t, paused: !t.paused } : t)), []);
  const cancel = useCallback(() => setTimer(null), []);
  const fmt = useCallback((s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, []);

  return { timer, start, toggle, cancel, fmt };
}

/* ── Theme hook ─────────────────────────────────────────────────────────── */
function useTheme() {
  const [dark, setDark] = useState(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved) return saved === "dark";
    } catch {}
    return typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false;
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    try { localStorage.setItem(THEME_KEY, dark ? "dark" : "light"); } catch {}
  }, [dark]);

  return [dark, setDark];
}

export function AppProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = session en cours de chargement
  const [dark, setDark] = useTheme();
  const [ourRecipes, setOurRecipes] = useState([]);
  const [publicRecipes, setPublicRecipes] = useState([]);
  const [syncStatus, setSyncStatus] = useState("loading");
  const [myProfile, setMyProfile] = useState(null);
  const [myFollows, setMyFollows] = useState([]);
  const [incomingRequests, setIncomingRequests] = useState([]);
  const [hasUnreadMsgs, setHasUnreadMsgs] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [plan, setPlan] = useState({});
  const planRef = useRef({});
  const timerCtx = useTimer();

  const [favIds, setFavIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem(FAVS_KEY) || "[]"); } catch { return []; }
  });

  const addToast = useCallback((msg, type = "info", duration = 3400) => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), duration);
  }, []);

  /* Favoris persistants */
  useEffect(() => {
    localStorage.setItem(FAVS_KEY, JSON.stringify(favIds));
  }, [favIds]);

  const toggleFavorite = useCallback((id) => {
    setFavIds(prev => {
      const exists = prev.includes(id);
      addToast(exists ? "Retiré des favoris" : "Ajouté aux favoris", exists ? "info" : "success");
      return exists ? prev.filter(x => x !== id) : [...prev, id];
    });
  }, [addToast]);

  /* Auth */
  useEffect(() => {
    const unsub = subscribeAuth(u => setUser(u));
    return unsub;
  }, []);

  /* Profil + social, à chaque chang de user */
  useEffect(() => {
    if (!user) {
      setMyProfile(null); setMyFollows([]); setIncomingRequests([]); setHasUnreadMsgs(false);
      return;
    }
    ensureUserDoc(user);
    const unsubProfile = onSnapshot(doc(db, 'users', user.uid), snap => setMyProfile(snap.exists() ? snap.data() : null));
    const unsubFollows = onSnapshot(
      query(collection(db, 'follows'), where('followerId', '==', user.uid)),
      snap => setMyFollows(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    const unsubRequests = onSnapshot(
      query(collection(db, 'follows'), where('followingId', '==', user.uid), where('status', '==', 'pending')),
      async snap => {
        const reqs = await Promise.all(snap.docs.map(async d => {
          const data = d.data();
          const uSnap = await getDoc(doc(db, 'users', data.followerId));
          return { id: d.id, ...data, followerName: uSnap.exists() ? uSnap.data().displayName : 'Utilisateur' };
        }));
        setIncomingRequests(reqs);
      }
    );
    const unsubConvos = onSnapshot(
      query(collection(db, 'conversations'), where('participants', 'array-contains', user.uid)),
      snap => setHasUnreadMsgs(snap.docs.some(d => d.data().lastMessage?.senderId && d.data().lastMessage.senderId !== user.uid))
    );

    return () => { unsubProfile(); unsubFollows(); unsubRequests(); unsubConvos(); };
  }, [user]);

  /* Mes recettes */
  useEffect(() => {
    if (!user) { setOurRecipes([]); return; }
    const q = query(collection(db, 'recipes'), where('ownerId', '==', user.uid), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, snap => {
      setOurRecipes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setSyncStatus('synced');
    }, err => {
      console.error(err);
      setSyncStatus('error');
      addToast('Problème de liaison avec la base de données.', 'error');
    });
    return unsub;
  }, [user, addToast]);

  /* Flux public */
  useEffect(() => {
    if (!user) { setPublicRecipes([]); return; }
    const q = query(collection(db, 'recipes'), where('visibility', '==', 'public'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, snap => {
      setPublicRecipes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => {
      console.error(err);
      addToast('Impossible de synchroniser le flux public.', 'error');
    });
    return unsub;
  }, [user, addToast]);

  const myFollowsMap = useMemo(() => Object.fromEntries(myFollows.map(f => [f.followingId, f.status])), [myFollows]);
  const followingIds = useMemo(() => myFollows.filter(f => f.status === 'accepted').map(f => f.followingId), [myFollows]);

  /* Planning repas (partagé : PlanningPage + fiches recette) */
  useEffect(() => {
    if (!user) { setPlan({}); return; }
    const unsub = onSnapshot(doc(db, 'meal_plans', user.uid), snap => {
      const p = snap.exists() ? (snap.data().plan || {}) : {};
      setPlan(p);
      planRef.current = p;
    });
    return unsub;
  }, [user]);

  useEffect(() => { planRef.current = plan; }, [plan]);

  const persistPlan = useCallback(async (next) => {
    const ref_ = doc(db, 'meal_plans', user.uid);
    const write = () => setDoc(ref_, { plan: next }, { merge: true });
    try {
      await write();
      return true;
    } catch {
      try { await write(); return true; } catch { }
      addToast("Échec de la mise à jour du planning", 'error');
      return false;
    }
  }, [user, addToast]);

  const addMealToPlan = useCallback(async (day, meal) => {
    const next = { ...planRef.current, [day]: [...(planRef.current[day] || []), meal] };
    setPlan(next);
    const ok = await persistPlan(next);
    if (ok) addToast(`Ajouté au planning (${day})`, 'success');
    return ok;
  }, [persistPlan, addToast]);

  const updatePlanMeal = useCallback(async (day, idx, meal) => {
    const meals = (planRef.current[day] || []).map((m, i) => (i === idx ? meal : m));
    const next = { ...planRef.current, [day]: meals };
    setPlan(next);
    return persistPlan(next);
  }, [persistPlan]);

  const removePlanMeal = useCallback(async (day, idx) => {
    const meals = (planRef.current[day] || []).filter((_, i) => i !== idx);
    const next = { ...planRef.current, [day]: meals };
    setPlan(next);
    return persistPlan(next);
  }, [persistPlan]);

  const isAdmin = !!myProfile?.role && myProfile.role === 'admin';
  const isBanned = !!myProfile?.banned;
  const sportif = myProfile?.sportif || null;

  /* ── Actions recettes ──────────────────────────────────────────────── */
  const uploadPhoto = useCallback(async (id, photoFile) => {
    const sRef = ref(storage, `photos/${user.uid}/${id}`);
    await uploadBytes(sRef, photoFile);
    return await getDownloadURL(sRef);
  }, [user]);

  const saveNewRecipe = useCallback(async (data, photoFile) => {
    const newRef = doc(collection(db, 'recipes'));
    let photoURL = null;
    if (photoFile) photoURL = await uploadPhoto(newRef.id, photoFile);
    await setDoc(newRef, {
      ...data, photoURL,
      ownerId: user.uid, ownerName: user.displayName,
      ownerIsPrivate: !!myProfile?.isPrivate,
      createdAt: serverTimestamp(),
    });
    addToast('Recette ajoutée à l’Atelier', 'success');
    return newRef.id;
  }, [user, myProfile, uploadPhoto, addToast]);

  const updateRecipe = useCallback(async (recipeId, data, photoFile) => {
    const recipe = ourRecipes.find(r => r.id === recipeId);
    if (!recipe) return;
    let photoURL = data.existingPhotoURL;
    if (photoFile) {
      if (recipe.photoURL) { try { await deleteObject(ref(storage, `photos/${user.uid}/${recipeId}`)); } catch {} }
      photoURL = await uploadPhoto(recipeId, photoFile);
    } else if (data.existingPhotoURL === null && recipe.photoURL) {
      try { await deleteObject(ref(storage, `photos/${user.uid}/${recipeId}`)); } catch {}
      photoURL = null;
    }
    const { existingPhotoURL, ...cleanData } = data;
    await updateDoc(doc(db, 'recipes', recipeId), { ...cleanData, photoURL });
    addToast('Recette mise à jour', 'success');
  }, [ourRecipes, user, uploadPhoto, addToast]);

  const deleteRecipe = useCallback(async (id, ownerId) => {
    if (!window.confirm('Confirmez-vous la suppression définitive de cette fiche ?')) return;
    const recipe = ourRecipes.find(r => r.id === id);
    const uid = ownerId && ownerId !== user.uid ? ownerId : user.uid;
    try {
      await deleteDoc(doc(db, 'recipes', id));
      if (recipe?.photoURL) { try { await deleteObject(ref(storage, `photos/${uid}/${id}`)); } catch {} }
      addToast('Fiche effacée', 'info');
      return true;
    } catch { addToast('Échec de la suppression', 'error'); return false; }
  }, [ourRecipes, user, addToast]);

  const addToProfile = useCallback(async (recipe) => {
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
      return newRef.id;
    } catch {
      addToast("Erreur d'importation", 'error');
      return null;
    }
  }, [user, addToast]);

  /* ── Actions profil ─────────────────────────────────────────────────── */
  const updateMyProfile = useCallback(async (fields) => {
    await setDoc(doc(db, 'users', user.uid), fields, { merge: true });
  }, [user]);

  const uploadAvatar = useCallback(async (file) => {
    const sRef = ref(storage, `avatars/${user.uid}`);
    await uploadBytes(sRef, file);
    const url = await getDownloadURL(sRef);
    await updateDoc(doc(db, 'users', user.uid), { avatarURL: url });
    return url;
  }, [user]);

  const togglePrivacy = useCallback(async (isPrivate) => {
    await setDoc(doc(db, 'users', user.uid), { isPrivate }, { merge: true });
    await propagatePrivacyToRecipes(user.uid, isPrivate);
  }, [user]);

  /* ── Admin ──────────────────────────────────────────────────────────── */
  const banUser = useCallback(async (uid, banned) => {
    await updateDoc(doc(db, 'users', uid), { banned });
    addToast(banned ? 'Compte suspendu' : 'Compte réactivé', banned ? 'info' : 'success');
  }, [addToast]);

  const adminDeleteRecipe = useCallback(async (recipe) => {
    if (!window.confirm(`Supprimer définitivement « ${recipe.name} » (modération) ?`)) return;
    try {
      await deleteDoc(doc(db, 'recipes', recipe.id));
      if (recipe.photoURL) { try { await deleteObject(ref(storage, `photos/${recipe.ownerId}/${recipe.id}`)); } catch {} }
      addToast('Recette supprimée', 'success');
      return true;
    } catch { addToast('Échec de la suppression', 'error'); return false; }
  }, [addToast]);

  /* ── Mode sportif ──────────────────────────────────────────────────── */
  const updateSportif = useCallback(async (sportifData) => {
    await setDoc(doc(db, 'users', user.uid), { sportif: sportifData }, { merge: true });
  }, [user]);

  const saveEnrichedNutrition = useCallback(async (recipeId, nutrition) => {
    await updateDoc(doc(db, 'recipes', recipeId), { nutrition });
    addToast('Fiche enrichie (macros et score santé)', 'success');
  }, [addToast]);

  const clearNutrition = useCallback(async (recipeId) => {
    await updateDoc(doc(db, 'recipes', recipeId), { nutrition: false });
    addToast('Enrichissement retiré', 'info');
  }, [addToast]);

  const createHealthyVariant = useCallback(async (recipe, adaptations) => {
    try {
      const variant = applyAdaptations(recipe, adaptations);
      const newRef = doc(collection(db, 'recipes'));
      await setDoc(newRef, {
        name: `${variant.name}`,
        cat: recipe.cat || 'Autre',
        emoji: recipe.emoji || '🥗',
        portions: recipe.portions || 4,
        time: recipe.time ?? null,
        diff: recipe.diff ?? 2,
        ingredients: variant.ingredients || [],
        steps: variant.steps || [],
        notes: variant.notes || '',
        visibility: 'private',
        photoURL: recipe.photoURL || null,
        ownerId: user.uid,
        ownerName: user.displayName,
        ownerIsPrivate: !!myProfile?.isPrivate,
        copiedFrom: { id: recipe.id, ownerName: recipe.ownerName || null, variant: true },
        createdAt: serverTimestamp(),
      });
      addToast('Variante saine créée dans votre Atelier', 'success');
      return newRef.id;
    } catch {
      addToast("Échec de la création de la variante", 'error');
      return null;
    }
  }, [user, myProfile, addToast]);

  const logWeighIn = useCallback(async (kg) => {
    const date = new Date().toISOString().slice(0, 10);
    const prev = Array.isArray(myProfile?.weighIns) ? myProfile.weighIns.filter(w => w.at !== date) : [];
    const next = [...prev, { at: date, kg: Number(kg) }].sort((a, b) => a.at.localeCompare(b.at));
    await updateDoc(doc(db, 'users', user.uid), { weighIns: next });
    addToast('Poids enregistré', 'success');
  }, [user, myProfile, addToast]);

  const value = {
    user, setUser,
    dark, setDark,
    toggleFavorite,
    myRecipes: ourRecipes, publicRecipes, syncStatus,
    favIds, addToast, toasts,
    timerCtx,
    myProfile, myFollowsMap, followingIds, myFollows,
    incomingRequests, hasUnreadMsgs,
    isAdmin, isBanned, sportif,
    saveNewRecipe, updateRecipe, deleteRecipe, addToProfile,
    uploadAvatar, updateMyProfile, togglePrivacy,
    banUser, adminDeleteRecipe,
    updateSportif, saveEnrichedNutrition, clearNutrition, createHealthyVariant, logWeighIn,
    plan, addMealToPlan, updatePlanMeal, removePlanMeal,
    logoutUser,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}