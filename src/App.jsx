import { useState } from "react";
import { generateRecipe } from "./gemini"; // ou services/gemini si tu préfères

export default function App() {
  const [idea, setIdea] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    if (!idea) return;

    setLoading(true);
    setResult(null);

    try {
      const res = await generateRecipe(idea);
      setResult(res);
    } catch (e) {
      console.error(e);
      alert("Erreur IA");
    }

    setLoading(false);
  };

  return (
    <div style={{ padding: 20, fontFamily: "Arial" }}>
      <h1>🍳 Mes Recettes</h1>

      <input
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
        placeholder="Ex: pizza, gâteau, burger..."
        style={{ padding: 10, width: 300 }}
      />

      <button onClick={handleGenerate} disabled={loading}>
        {loading ? "Génération..." : "Créer recette"}
      </button>

      {result && (
        <pre style={{ marginTop: 20 }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
