import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";

// Config de ton projet Firebase "mes-recettes-3eb71".
// Ces clés ne sont PAS secrètes (c'est normal qu'elles soient dans le code
// côté client) : la vraie protection se fait via les règles Firestore/Storage,
// voir firestore.rules et storage.rules.
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

// On utilise l'authentification anonyme : pas d'écran de connexion à gérer,
// mais ça permet aux règles Firestore/Storage d'exiger `request.auth != null`,
// ce qui bloque déjà les robots/scrapers qui tapent directement l'API REST.
// (Ce n'est pas une vraie authentification personnelle : n'importe qui qui
// ouvre l'app peut lire/écrire. Si tu veux un jour réserver l'app à toi seul,
// il faudra passer à une vraie connexion email/mot de passe.)
export function ensureAuth() {
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(
      auth,
      (user) => {
        unsub();
        if (user) {
          resolve(user);
        } else {
          signInAnonymously(auth).then((cred) => resolve(cred.user)).catch(reject);
        }
      },
      reject
    );
  });
}
