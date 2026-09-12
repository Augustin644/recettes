import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, updateProfile, onAuthStateChanged, updatePassword,
  EmailAuthProvider, reauthenticateWithCredential,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyA2Cv_9naa_Atz-gU6zMxsSevp1o9bPKH4",
  authDomain: "mes-recettes-3eb71.firebaseapp.com",
  projectId: "mes-recettes-3eb71",
  storageBucket: "mes-recettes-3eb71.firebasestorage.app",
  messagingSenderId: "93241525587",
  appId: "1:93241525587:web:b4608f07690daa2a54da6",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);

function usernameToEmail(username) {
  return `${username.trim().toLowerCase()}@moncarnet.local`;
}

function validateUsername(username) {
  const u = (username || '').trim();
  if (u.length < 3) throw new Error("Le pseudo doit faire au moins 3 caractères.");
  if (!/^[a-zA-Z0-9_-]+$/.test(u)) throw new Error("Le pseudo ne peut contenir que des lettres, chiffres, - et _.");
  return u;
}

export async function registerUser(username, password) {
  const u = validateUsername(username);
  if (!password || password.length < 6) throw new Error("Le mot de passe doit faire au moins 6 caractères.");
  let cred;
  try {
    cred = await createUserWithEmailAndPassword(auth, usernameToEmail(u), password);
  } catch (e) {
    if (e.code === 'auth/email-already-in-use') throw new Error("Ce pseudo est déjà pris.");
    if (e.code === 'auth/invalid-email') throw new Error("Ce pseudo n'est pas valide.");
    throw new Error("Impossible de créer le compte : " + e.message);
  }
  await updateProfile(cred.user, { displayName: u });
  return cred.user;
}

export async function loginUser(username, password) {
  const u = validateUsername(username);
  try {
    const cred = await signInWithEmailAndPassword(auth, usernameToEmail(u), password);
    return cred.user;
  } catch (e) {
    if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found'].includes(e.code)) {
      throw new Error("Pseudo ou mot de passe incorrect.");
    }
    throw new Error("Connexion impossible : " + e.message);
  }
}

export function logoutUser() {
  return signOut(auth);
}

export function subscribeAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function changePassword(currentPassword, newPassword) {
  const user = auth.currentUser;
  if (!user) throw new Error("Aucune session active.");
  if (!newPassword || newPassword.length < 6) throw new Error("Le mot de passe doit faire au moins 6 caractères.");
  const email = user.email;
  const cred = EmailAuthProvider.credential(email, currentPassword);
  await reauthenticateWithCredential(user, cred);
  await updatePassword(user, newPassword);
}