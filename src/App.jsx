import { useState } from "react";

const MODEL = "gemini-2.5-flash";
const STORAGE_KEY = "carnet_gemini_api_key";

function getApiKey() {
  return localStorage.getItem(STORAGE_KEY) || "";
}

async function callGemini(prompt) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("No API key");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    }
  );

  const data = await res.json();

  return data.candidates?.[0]?.content?.parts?.[0]?.text || "Erreur IA";
}

export default function App() {
  const [text, setText] = useState("");
  const [out, setOut] = useState("");

  const test = async () => {
    const res = await callGemini("Donne une recette de crêpes");
    setOut(res);
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>Recettes IA</h1>

      <button onClick={test}>
        Tester IA
      </button>

      <pre>{out}</pre>
    </div>
  );
}
