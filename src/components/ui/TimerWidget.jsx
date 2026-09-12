import { useApp } from "../../context/AppContext";

export default function TimerWidget() {
  const { timerCtx } = useApp();
  const { timer, fmt, toggle, cancel } = timerCtx;
  if (!timer) return null;
  return (
    <div className="timer-widget">
      <div className="timer-widget__label">{timer.label}</div>
      <div className="timer-widget__time">{timer.done ? '✓ Prêt !' : fmt(timer.remaining)}</div>
      <div className="timer-widget__actions">
        <button className="timer-widget__btn" onClick={toggle}>{timer.paused ? 'Reprendre' : 'Suspendre'}</button>
        <button className="timer-widget__btn timer-widget__btn--stop" onClick={cancel}>Arrêter</button>
      </div>
    </div>
  );
}