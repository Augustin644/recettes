export default function DiffDots({ diff }) {
  return (
    <span className="diff-dots" title={diff ? `Difficulté : ${diff}/3` : ""}>
      {[1, 2, 3].map(i => <span key={i} className={`diff-dot ${i <= (diff || 0) ? 'on' : ''}`} />)}
    </span>
  );
}