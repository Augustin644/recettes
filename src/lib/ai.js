const MODEL = "gemini-2.5-flash";
const API_URL = "https://generativelanguage.googleapis.com/v1beta/models";
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

const NUTRITION_SCHEMA = `Tu es un nutritionniste. À partir d'une fiche recette, tu estimes la valeur nutritionnelle de chaque ingrédient POUR LA QUANTITÉ INDIQUÉE dans la recette. Réponds UNIQUEMENT avec un objet JSON valide (aucun texte autour, aucun markdown), respectant EXACTEMENT ce format :
{
  "ingredients": [
    {"name": "nom exact de l'ingrédient tel qu'indiqué", "grams": 200, "kcal": 330, "protein": 38, "carbs": 0, "fat": 19}
  ],
  "healthScore": 72,
  "healthNote": "1-2 phrases sur le profil nutritionnel du plat",
  "adaptations": [{"from": "ingrédient d'origine", "to": "alternative plus saine", "reason": "pourquoi cette substitution"}]
}
Règles importantes :
- "grams" : quantité en grammes de l'ingrédient TEL QU'UTILISÉ dans la recette. Estime si besoin (1 œuf ≈ 50 g, 1 c.à.s d'huile ≈ 12 g, une gousse d'ail ≈ 3 g). Ne mets JAMAIS 0.
- kcal/protein/carbs/fat : macros POUR CETTE QUANTITÉ en grammes de l'ingrédient, sur une base alimentaire française réaliste.
- Ignore les épices, herbes, eau et sel (< 1 g).
- healthScore : entier 0-100, note du plat selon l'équilibre protéines/fibres/légumes vs gras saturés/sucre/sel.
- adaptations : 2 à 4 suggestions d'échange d'ingrédients pour un plat plus sain, "from" = nom EXACT d'un ingrédient de la recette.
- Le texte doit être en français.`;

const FOOD_GUESS_SCHEMA = `Tu estimes les macros d'un aliment pour la quantité indiquée. Réponds UNIQUEMENT avec un objet JSON valide :
{
  "name": "nom court de l'aliment",
  "grams": 50,
  "kcal": 200,
  "protein": 15,
  "carbs": 2,
  "fat": 14
}
Règles :
- "grams" : quantité en grammes correspondant à la description (50 g, 1 banane ≈ 120 g, 1 verre de lait ≈ 250 g...).
- kcal/protein/carbs/fat : macros pour cette quantité, base alimentaire française réaliste.
- Le texte doit être en français.`;

async function callGemini(contents, systemInstruction = SCHEMA_INSTRUCTIONS) {
  const apiKey = getApiKey();
  if (!apiKey) {
    const err = new Error("Aucune clé API Gemini enregistrée.");
    err.code = "NO_API_KEY";
    throw err;
  }

  const url = `${API_URL}/${MODEL}:generateContent?key=${apiKey}`;

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        generationConfig: { responseMimeType: "application/json" },
        systemInstruction: { parts: [{ text: systemInstruction }] },
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
      res.status === 400 || res.status === 403
        ? "Clé API invalide ou refusée."
        : `Erreur API Gemini (${res.status}) ${detail}`
    );
    err.code = (res.status === 400 || res.status === 403) ? "BAD_KEY" : "API_ERROR";
    throw err;
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const clean = text.replace(/```json|```/g, "").trim();

  try {
    return JSON.parse(clean);
  } catch {
    const err = new Error("La réponse de l'IA n'était pas un JSON valide.");
    err.code = "BAD_JSON";
    throw err;
  }
}

export async function extractRecipeFromText(text) {
  return callGemini([{ parts: [{ text: `Voici le texte brut d'une recette à structurer :\n\n${text}` }] }]);
}

export async function generateRecipe(idea) {
  return callGemini([{ parts: [{ text: `Invente une recette originale et réaliste correspondant à cette demande : "${idea}"` }] }]);
}

export async function extractRecipeFromImage(base64, mediaType) {
  return callGemini([
    {
      parts: [
        { inlineData: { mimeType: mediaType, data: base64 } },
        { text: "Cette image est une capture d'écran (Instagram, un site, une photo de livre de cuisine...) contenant une recette. Lis attentivement les ingrédients, les quantités et les étapes visibles, puis structure-les." },
      ],
    },
  ]);
}

export async function enrichRecipeNutrition(recipe) {
  const payload = {
    name: recipe.name,
    portions: recipe.portions || 4,
    ingredients: (recipe.ingredients || []).map(i => ({ name: i.name, qty: i.qty })),
  };
  return callGemini(
    [{ parts: [{ text: `Fiche recette à analyser nutritionnellement :\n${JSON.stringify(payload, null, 2)}` }] }],
    NUTRITION_SCHEMA
  );
}

export async function guessNutritionFromText(text) {
  return callGemini([{ parts: [{ text: `Estime les macros de cet aliment : "${text}"` }] }], FOOD_GUESS_SCHEMA);
}

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