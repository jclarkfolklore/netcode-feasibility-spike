/**
 * Why the guest sees the opponent "in the past": the host clock is now, but
 * the guest renders an interpolated snapshot from ~RTT + interp-buffer ago, so
 * a punch that connects on the host can whiff on the guest's screen. Near-square
 * viewBox so it fills the explainer column legibly.
 */
export function StaleOpponentDiagram() {
  return (
    <figure className="diagram-frame">
      <svg
        className="diagram"
        viewBox="0 0 320 208"
        role="img"
        aria-label="The guest renders the opponent from the past due to interpolation delay"
      >
        <defs>
          <marker id="stale-arrow" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
            <path d="M0,0 L7,3.5 L0,7 Z" fill="var(--acceptable)" />
          </marker>
        </defs>

        {/* Host lane */}
        <text x="14" y="26" fontSize="12.5" fill="var(--text-faint)">host clock — now</text>
        <line x1="14" y1="42" x2="306" y2="42" stroke="var(--border-strong)" strokeWidth={1.5} />
        <circle cx="262" cy="42" r="9" fill="var(--accent)" />
        <text x="262" y="66" fontSize="12.5" textAnchor="middle" fill="var(--accent)">opponent (now)</text>

        {/* Stale gap */}
        <line x1="150" y1="78" x2="150" y2="128" stroke="var(--text-faint)" strokeDasharray="3 3" />
        <line x1="262" y1="52" x2="262" y2="128" stroke="var(--text-faint)" strokeDasharray="3 3" />
        <path d="M 150 104 L 262 104" stroke="var(--acceptable)" strokeWidth={1.5} markerEnd="url(#stale-arrow)" />
        <text x="206" y="98" fontSize="12" textAnchor="middle" fill="var(--acceptable)">
          stale gap ≈ RTT + interp
        </text>

        {/* Guest lane */}
        <text x="14" y="150" fontSize="12.5" fill="var(--text-faint)">guest render — RTT + interp behind</text>
        <line x1="14" y1="166" x2="306" y2="166" stroke="var(--border-strong)" strokeWidth={1.5} />
        <circle cx="150" cy="166" r="9" fill="var(--bad)" />
        <text x="150" y="190" fontSize="12.5" textAnchor="middle" fill="var(--bad)">opponent (as rendered)</text>
      </svg>
      <figcaption className="diagram-caption">
        Frame-1 hitboxes can't tolerate this the way shooters' server-rewind can — the central risk the
        end-to-end experience measures.
      </figcaption>
    </figure>
  );
}
