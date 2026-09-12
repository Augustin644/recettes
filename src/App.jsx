import { HashRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AppProvider, useApp } from "./context/AppContext";
import Header from "./components/layout/Header";
import BottomNav from "./components/layout/BottomNav";
import Toasts from "./components/ui/Toasts";
import TimerWidget from "./components/ui/TimerWidget";
import EmptyState from "./components/ui/EmptyState";
import ErrorBoundary from "./components/ui/ErrorBoundary";
import AuthScreen from "./components/AuthScreen";
import DiscoverPage from "./pages/DiscoverPage";
import AtelierPage from "./pages/AtelierPage";
import FavoritesPage from "./pages/FavoritesPage";
import PlanningPage from "./pages/PlanningPage";
import SearchPage from "./pages/SearchPage";
import RecipePage from "./pages/RecipePage";
import ProfilePage from "./pages/ProfilePage";
import UserPage from "./pages/UserPage";
import MessagesPage from "./pages/MessagesPage";
import ChatPage from "./pages/ChatPage";
import SettingsPage from "./pages/SettingsPage";
import AdminPage from "./pages/AdminPage";
import AddRecipePage from "./pages/AddRecipePage";
import SportifPage from "./pages/SportifPage";

function AppShell() {
  const { user, isBanned, logoutUser } = useApp();
  const location = useLocation();

  if (user === undefined) {
    return <div className="boot">⟳ Initialisation du carnet…</div>;
  }

  if (!user) {
    return <AuthScreen />;
  }

  if (isBanned) {
    return (
      <div className="app-main" style={{ maxWidth: 460, minHeight: '80dvh', display: 'flex', alignItems: 'center' }}>
        <EmptyState emoji="🚫" title="Compte suspendu"
          text="Ce compte a été suspendu par un administrateur. Contactez l'équipe du carnet pour toute réclamation.">
          <button className="btn btn--secondary" onClick={() => logoutUser()}>Se déconnecter</button>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Header />
      <div>
        <ErrorBoundary key={location.pathname}>
          <Routes>
            <Route path="/" element={<Navigate to="/decouvrir" replace />} />
            <Route path="/decouvrir" element={<DiscoverPage />} />
            <Route path="/atelier" element={<AtelierPage />} />
            <Route path="/favoris" element={<FavoritesPage />} />
            <Route path="/planning" element={<PlanningPage />} />
            <Route path="/chercher" element={<SearchPage />} />
            <Route path="/recette/:id" element={<RecipePage />} />
            <Route path="/ajouter" element={<AddRecipePage />} />
            <Route path="/profil" element={<ProfilePage />} />
            <Route path="/membre/:uid" element={<UserPage />} />
            <Route path="/messages" element={<MessagesPage />} />
            <Route path="/messages/:uid" element={<ChatPage />} />
            <Route path="/reglages" element={<SettingsPage />} />
            <Route path="/sportif" element={<SportifPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="*" element={<Navigate to="/decouvrir" replace />} />
          </Routes>
        </ErrorBoundary>
      </div>
      <TimerWidget />
      <Toasts />
      <BottomNav />
    </div>
  );
}

function AppInner() {
  return (
    <AppProvider>
      <HashRouter>
        <AppShell />
      </HashRouter>
    </AppProvider>
  );
}

export default AppInner;