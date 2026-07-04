const MODEL = "gemini-2.5-flash";
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

const SCHEMA_INSTRUCTIONS = `
Tu structures des recettes de cuisine pour une application. Réponds UNIQUEMENT avec un objet JSON valide (aucun texte autour, aucun markdown, aucun \`\`\`), respectant EXACTEMENT ce format :

{
  "name": "nom de la recette",
  "cat": "une valeur EXACTE parmi : Entrées, Plats, Desserts, Boulangerie, Boissons, Sauces & Condiments, Autre",
  "emoji": "un seul emoji représentatif du plat",
  "portions": nombre entier de portions,
  "time": nombre entier de minutes (temps total préparation + cuisson), ou null si inconnu,
  "diff": 1, 2 ou 3,
  "ingredients": [{"name": "nom de l'ingrédient", "qty": "quantité en texte"}],
  "steps": [{"text": "texte de l'étape", "timer": nombre_de_secondes_ou_null}],
  "notes": "texte"
}

Règles :
- timers en secondes si attente réelle
- réponse en français
`;

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
        contents: [
          { parts }
        ]
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
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  return JSON.parse(clean);
}

export async function extractRecipeFromText(text) {
  return callGemini(
    `Voici le texte brut d'une recette à structurer :\n\n${text}`
  );
}

export async function generateRecipe(idea) {
  return callGemini(
    `Invente une recette originale et réaliste correspondant à : "${idea}"`
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
      text: "Lis cette image et extrais la recette."
    }
  ]);
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = reader.result;
      const match = result.match(/^data:(.*);base64,(.*)$/);

      if (!match) {
        reject(new Error("Lecture impossible"));
        return;
      }

      resolve({
        mediaType: match[1],
        base64: match[2]
      });
    };

    reader.onerror = () =>
      reject(new Error("Lecture fichier impossible"));

    reader.readAsDataURL(file);
  });
}
