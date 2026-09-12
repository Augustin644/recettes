import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Erreur d'affichage :", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app-main" style={{ maxWidth: 560 }}>
          <div className="nutrition-card" style={{ marginTop: 'var(--space-m)' }}>
            <div className="section-title" style={{ margin: 0 }}>Oups, un souci d'affichage</div>
            <p style={{ fontSize: 'var(--step--1)', color: 'var(--ink-2)', marginTop: 'var(--space-xs)' }}>
              {String(this.state.error?.message || this.state.error)}
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-xs)', marginTop: 'var(--space-s)', flexWrap: 'wrap' }}>
              <button className="btn btn--primary" onClick={() => this.setState({ error: null })}>Réessayer</button>
              <button className="btn btn--secondary" onClick={() => { this.setState({ error: null }); }}>Retour</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}