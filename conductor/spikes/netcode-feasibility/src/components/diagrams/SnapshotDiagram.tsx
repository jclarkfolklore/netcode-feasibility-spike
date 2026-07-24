/**
 * What a per-tick state snapshot carries (cheap, mirrors cleanly) vs. what it
 * loses (tween-driven pose/animation). Compact, column-sized like the TCP
 * diagram so it stays legible in the explainer column.
 */
export function SnapshotDiagram() {
  const mirrors = ["position · velocity", "health · confidence", "facing · state", "round · timers"];
  const lost = ["attack pose / lunge", "hit-flash color", "block-shield fade", "charge-ring pulse"];
  return (
    <figure className="diagram-frame">
      <svg
        className="diagram"
        viewBox="0 0 300 214"
        role="img"
        aria-label="What a state snapshot carries versus what it loses"
      >
        <text x="150" y="18" fontSize="12" textAnchor="middle" fill="var(--text-faint)">
          what a per-tick snapshot carries
        </text>

        {/* Mirrors */}
        <rect x="8" y="30" width="138" height="176" rx="10" fill="var(--good-bg)" stroke="var(--good-border)" strokeWidth="1" />
        <text x="24" y="54" fontSize="14" fontWeight={700} fill="var(--good)">✓ mirrors</text>
        {mirrors.map((m, i) => (
          <text key={m} x="24" y={82 + i * 28} fontSize="12.5" fill="var(--text)">
            {m}
          </text>
        ))}

        {/* Lost */}
        <rect x="154" y="30" width="138" height="176" rx="10" fill="var(--bad-bg)" stroke="var(--bad-border)" strokeWidth="1" />
        <text x="170" y="54" fontSize="14" fontWeight={700} fill="var(--bad)">✗ lost</text>
        {lost.map((m, i) => (
          <text key={m} x="170" y={82 + i * 28} fontSize="12.5" fill="var(--text)">
            {m}
          </text>
        ))}
      </svg>
      <figcaption className="diagram-caption">
        HUD-visible state mirrors cheaply; tween-driven pose isn't in the snapshot — pose-accurate guest
        rendering would need a production state→render API.
      </figcaption>
    </figure>
  );
}
