/**
 * Contrasts state-relay (host-authoritative, no determinism required) with
 * rollback/lockstep (bitwise-deterministic sim required, or the two sims
 * diverge). Near-square viewBox so it fills the explainer column legibly.
 */
export function DeterminismDiagram() {
  return (
    <figure className="diagram-frame">
      <svg
        className="diagram"
        viewBox="0 0 320 228"
        role="img"
        aria-label="State-relay needs no determinism; rollback would require a bitwise-deterministic sim"
      >
        <defs>
          <marker id="det-a1" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
            <path d="M0,0 L7,3.5 L0,7 Z" fill="var(--accent)" />
          </marker>
          <marker id="det-a2" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
            <path d="M0,0 L7,3.5 L0,7 Z" fill="var(--bad)" />
          </marker>
        </defs>

        {/* State-relay */}
        <text x="12" y="18" fontSize="12.5" fontWeight={700} fill="var(--text)">
          State-relay (this model)
        </text>
        <rect x="12" y="28" width="116" height="36" rx="8" fill="var(--accent-dim)" stroke="var(--accent)" />
        <text x="70" y="51" fontSize="12.5" textAnchor="middle" fill="var(--text)">host sim runs</text>
        <line x1="128" y1="46" x2="156" y2="46" stroke="var(--accent)" strokeWidth={1.5} markerEnd="url(#det-a1)" />
        <rect x="158" y="28" width="150" height="36" rx="8" fill="var(--good-bg)" stroke="var(--good)" />
        <text x="233" y="51" fontSize="12.5" textAnchor="middle" fill="var(--text)">guest just renders</text>
        <text x="12" y="88" fontSize="13" fontWeight={600} fill="var(--good)">✓ no determinism needed</text>

        {/* Rollback */}
        <text x="12" y="130" fontSize="12.5" fontWeight={700} fill="var(--text)">
          Rollback / lockstep (would need)
        </text>
        <rect x="12" y="140" width="116" height="36" rx="8" fill="var(--accent-dim)" stroke="var(--accent)" />
        <text x="70" y="163" fontSize="12.5" textAnchor="middle" fill="var(--text)">host sim runs</text>
        <line x1="128" y1="158" x2="156" y2="158" stroke="var(--bad)" strokeWidth={1.5} markerEnd="url(#det-a2)" />
        <rect x="158" y="140" width="150" height="36" rx="8" fill="var(--bad-bg)" stroke="var(--bad)" />
        <text x="233" y="163" fontSize="12.5" textAnchor="middle" fill="var(--text)">guest re-simulates</text>
        <text x="12" y="200" fontSize="13" fontWeight={600} fill="var(--bad)">✗ seeded RNG + fixed step +</text>
        <text x="26" y="219" fontSize="13" fontWeight={600} fill="var(--bad)">restorable physics</text>
      </svg>
      <figcaption className="diagram-caption">
        A separate axis from feasibility: it answers "should we switch to rollback?", not "is
        host-authoritative good enough?"
      </figcaption>
    </figure>
  );
}
