const MODEL = "gemini-2.5-flash";
const STORAGE_KEY = "carnet_gemini_api_key";

/* ─────────────────────────────────────────────
   API KEY
───────────────────────────────────────────── */

export function getApiKey() {
  return localStorage.getItem(STORAGE_KEY) || "";
}

export function setApiKey(key) {
  if (key && key.trim()) {
    localStorage.setItem(STORAGE_KEY, key.trim());
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export function hasApiKey() {
  return !!getApiKey();
}

/* ─────────────────────────────────────────────
   PROMPT SYSTEM
───────────────────────────────────────────── */

const SCHEMA_INSTRUCTIONS = `
Tu structures des recettes de cuisine pour une application.

Réponds UNIQUEMENT avec un JSON valide, sans texte autour.

Format EXACT :

{
  "name": "nom",
  "cat": "Entrées | Plats | Desserts | Boulangerie | Boissons | Sauces & Condiments | Autre",
  "emoji": "🍝",
  "portions": 2,
  "time": 30,
  "diff": 1,
  "ingredients": [
    { "name": "ingrédient", "qty": "quantité" }
  ],
  "steps": [
    { "text": "étape", "timer": 0 }
  ],
  "notes": ""
}

Règles :
- JSON strict uniquement
- français
- timers en secondes si attente réelle
`;

/* ─────────────────────────────────────────────
   CORE GEMINI CALL
───────────────────────────────────────────── */

async function callGemini(userContent) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Aucune clé Gemini enregistrée.");

  const parts = [{ text: SCHEMA_INSTRUCTIONS }];

  if (typeof userContent === "string") {
    parts.push({ text: userContent });
  } else {
    for (const item of userContent) {
      if (item.type === "text") {
        parts.push({ text: item.text });
      }

      if (item.type === "image") {
        parts.push({
          inlineData: {
            mimeType: item.source.media_type,
            data: item.source.data
          }
        });
      }
    }
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [{ parts }]
      })
    }
  );

  if (!res.ok) {
    throw new Error(await res.text());
  }

  const data = await res.json();

  const text =
    data.candidates?.[0]?.content?.parts
      ?.map(p => p.text)
      .join("") || "";

  const clean = text
    .replace(/```json|```/g, "")
    .trim();

  try {
    return JSON.parse(clean);
  } catch (e) {
    throw new Error("Réponse IA invalide JSON");
  }
}

/* ─────────────────────────────────────────────
   PUBLIC FUNCTIONS
───────────────────────────────────────────── */

export async function extractRecipeFromText(text) {
  return callGemini(
    `Voici une recette brute à structurer :\n\n${text}`
  );
}

export async function generateRecipe(idea) {
  return callGemini(
    `Crée une recette originale : "${idea}"`
  );
}

export async function extractRecipeFromImage(base64, mediaType) {
  return callGemini([
    {
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType,
        data: base64
      }
    },
    {
      type: "text",
      text: "Analyse l'image et extrait la recette."
    }
  ]);
}

/* ─────────────────────────────────────────────
   FILE HELPERS
───────────────────────────────────────────── */

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = reader.result;
      const match = result.match(/^data:(.*);base64,(.*)$/);

      if (!match) {
        reject(new Error("Erreur lecture fichier"));
        return;
      }

      resolve({
        mediaType: match[1],
        base64: match[2]
      });
    };

    reader.onerror = () =>
      reject(new Error("Erreur lecture fichier"));

    reader.readAsDataURL(file);
  });
}
export default App;
