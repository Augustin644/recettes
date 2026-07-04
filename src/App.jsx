import { useState } from "react";
import {
  generateRecipe
} from "./services/gemini";

export default function App() {
  const [idea, setIdea] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const handleGenerate = async () => {
    if (!idea) return;

    setLoading(true);
    setResult(null);

    try {
      const res = await generateRecipe(idea);
      setResult(res);
    } catch (err) {
      console.error(err);
      alert("Erreur IA");
    }

    setLoading(false);
  };

  return (
    <div style={{ padding: 20, fontFamily: "Arial" }}>
      <h1>🍳 Recettes IA</h1>

      <input
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
        placeholder="Ex: pizza, burger, dessert..."
        style={{ padding: 10, width: "300px" }}
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
