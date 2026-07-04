# Mise en route

## 1. Dans la console Firebase (console.firebase.google.com → projet "mes-recettes-3eb71")

- **Firestore Database** → Créer la base (mode production) si ce n'est pas déjà fait.
  Onglet "Règles" → colle le contenu de `firestore.rules` → Publier.
- **Storage** → Créer le bucket si ce n'est pas déjà fait.
  Onglet "Règles" → colle le contenu de `storage.rules` → Publier.
- **Authentication** → Sign-in method → active le fournisseur **Anonyme**.
  (L'app s'y connecte automatiquement, aucun écran de connexion à créer.)

## 2. En local

```bash
npm install
npm run dev
```

## 3. Clé API pour les fonctionnalités IA

Dans l'app, clique sur ⚙️ en haut à droite et colle une clé API Anthropic
(créée sur console.anthropic.com → API Keys). Elle est stockée uniquement
dans le navigateur (localStorage), jamais dans le code ni sur GitHub.

⚠️ Comme la clé reste côté navigateur, ne partage pas le lien de ton app
publiquement une fois la clé enregistrée sur un poste que d'autres utilisent.
Pour un usage perso (toi seul, sur tes appareils), c'est la solution la plus
simple sans avoir à monter un serveur.

## 4. Déploiement

Le push sur `main` déclenche `.github/workflows/deploy.yml` qui build et publie
sur GitHub Pages automatiquement, comme avant — rien à changer côté CI.
