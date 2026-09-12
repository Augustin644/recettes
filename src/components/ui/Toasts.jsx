import { useApp } from "../../context/AppContext";

export default function Toasts() {
  const { toasts } = useApp();
  if (!toasts.length) return null;
  return (
    <div className="toast-stack" role="status">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast--${t.type}`}>
          <span className="toast__dot" />
          {t.msg}
        </div>
      ))}
    </div>
  );
}