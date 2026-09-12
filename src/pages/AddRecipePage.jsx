import { useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import RecipeForm from "../components/recipe/RecipeForm";

export default function AddRecipePage() {
  const navigate = useNavigate();
  const { saveNewRecipe } = useApp();

  return (
    <RecipeForm
      title="Créer une fiche recette"
      onSave={saveNewRecipe}
      onClose={() => navigate(-1)}
    />
  );
}