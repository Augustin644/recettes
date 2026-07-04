// ── IA (Google Gemini API) ──────────────────────────────────────────────────
// Appel DIRECT depuis le navigateur avec ta propre clé API Google AI Studio.
// La clé est stockée uniquement dans le localStorage de TON navigateur.

const MODEL = "gemini-2.5-flash";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const STORAGE_KEY = "carnet_gemini_api_key";

export function getApiKey() {
  return localStorage.getItem(STORAGE_KEY) || "";
}

export function setApiKey(key) {
  if (key && key.trim()) localStorage.setItem(STORAGE_KEY, key.trim());
  else localStorage.removeItem(STORAGE_KEY);
}

export function hasApiKey() {
  return !!getApiKey();
}

const SCHEMA_INSTRUCTIONS = `Tu structures des recettes de cuisine pour une application. Réponds UNIQUEMENT avec un objet JSON valide (aucun texte autour, aucun markdown, aucun \`\`\`), respectant EXACTEMENT ce format :
{
  "name": "nom de la recette",
  "cat": "une valeur EXACTE parmi : Entrées, Plats, Desserts, Boulangerie, Boissons, Sauces & Condiments, Autre",
  "emoji": "un seul emoji représentatif du plat",
  "portions": nombre entier de portions,
  "time": nombre entier de minutes (temps total préparation + cuisson), ou null si inconnu,
  "diff": 1, 2 ou 3 (1 = facile, 2 = intermédiaire, 3 = difficile),
  "ingredients": [{"name": "nom de l'ingrédient", "qty": "quantité en texte, ex '200 g' ou '2 c.à.s'"}],
  "steps": [{"text": "texte de l'étape", "timer": nombre_de_secondes_ou_null}],
  "notes": "astuces, variantes ou conseils de conservation (peut être une chaîne vide)"
}
Règles importantes :
- Mets un "timer" (en secondes) dès qu'une étape comporte une attente réelle : cuisson, repos, réfrigération, fermentation, pousse, marinade, etc. Sinon mets null.
- Sois précis et réaliste sur les quantités et temps, quitte à estimer raisonnablement si l'info manque.
- Le texte doit être en français.`;

async function callGemini(contents) {
  const apiKey = getApiKey();
  if (!apiKey) {
    const err = new Error("Aucune clé API Gemini enregistrée.");
    err.code = "NO_API_KEY";
    throw err;
  }

  let res;
  try {
    res = await fetch(`${API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: contents,
        generationConfig: {
          responseMimeType: "application/json",
        },
      }),
    });
  } catch {
    const err = new Error("Impossible de contacter l'API Gemini (réseau).");
    err.code = "NETWORK";
    throw err;
  }

  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json())?.error?.message || ""; } catch {}
    const err = new Error(
      res.status === 400 && detail.includes("API key")
        ? "Clé API invalide ou refusée."
        : `Erreur API Gemini (${res.status}) ${detail}`
    );
    err.code = res.status === 400 ? "BAD_KEY" : "API_ERROR";
    throw err;
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const clean = text.trim();

  try {
    return JSON.parse(clean);
  } catch {
    const err = new Error("La réponse de l'IA n'était pas un JSON valide.");
    err.code = "BAD_JSON";
    throw err;
  }
}

export async function extractRecipeFromText(text) {
  return callGemini([
    {
      parts: [
        { text: `${SCHEMA_INSTRUCTIONS}\n\nVoici le texte brut d'une recette à structurer :\n\n${text}` }
      ]
    }
  ]);
}

export async function generateRecipe(idea) {
  return callGemini([
    {
      parts: [
        { text: `${SCHEMA_INSTRUCTIONS}\n\nInvente une recette originale et réaliste correspondant à cette demande : "${idea}"` }
      ]
    }
  ]);
}

export async function extractRecipeFromImage(base64, mediaType) {
  return callGemini([
    {
      parts: [
        { inlineData: { mimeType: mediaType, data: base64 } },
        { text: `${SCHEMA_INSTRUCTIONS}\n\nCette image est une capture d'écran (Instagram, un site, une photo de livre de cuisine...) contenant une recette. Lis attentivement les ingrédients, les quantités et les étapes visibles, puis structure-les.` }
      ]
    }
  ]);
}

// Convertit un File en {base64, mediaType} pour l'envoi à l'API vision.
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const match = result.match(/^data:(.*);base64,(.*)$/);
      if (!match) { reject(new Error("Lecture du fichier impossible")); return; }
      resolve({ mediaType: match[1], base64: match[2] });
    };
    reader.onerror = () => reject(new Error("Lecture du fichier impossible"));
    reader.readAsDataURL(file);
  });
}
