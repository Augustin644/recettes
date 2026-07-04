const MODEL = "gemini-2.5-flash";
const STORAGE_KEY = "carnet_gemini_api_key";

/* ─────────────────────────────
   API KEY
───────────────────────────── */

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

/* ─────────────────────────────
   PROMPT SYSTEM
───────────────────────────── */

const SCHEMA_INSTRUCTIONS = `
Tu es une IA qui transforme des recettes en JSON strict.

Réponds UNIQUEMENT en JSON valide :

{
  "name": "nom",
  "cat": "Entrées | Plats | Desserts | Boulangerie | Boissons | Sauces & Condiments | Autre",
  "emoji": "🍽️",
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
- timers en secondes si nécessaire
`;

/* ─────────────────────────────
   CORE CALL
───────────────────────────── */

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

  const clean = text.replace(/```json|```/g, "").trim();

  return JSON.parse(clean);
}

/* ─────────────────────────────
   EXPORTS
───────────────────────────── */

export function extractRecipeFromText(text) {
  return callGemini(`Texte recette :\n${text}`);
}

export function generateRecipe(idea) {
  return callGemini(`Créer une recette : "${idea}"`);
}

export function extractRecipeFromImage(base64, mediaType) {
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
      text: "Analyse cette image et extrait la recette"
    }
  ]);
}
