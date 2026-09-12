export default function EmptyState({ emoji = "📖", title = "Rien pour le moment", text = "", children }) {
  return (
    <div className="empty">
      <div className="empty__emoji">{emoji}</div>
      <div className="empty__title">{title}</div>
      {text && <p className="empty__text">{text}</p>}
      {children && <div style={{ marginTop: "var(--space-m)" }}>{children}</div>}
    </div>
  );
}