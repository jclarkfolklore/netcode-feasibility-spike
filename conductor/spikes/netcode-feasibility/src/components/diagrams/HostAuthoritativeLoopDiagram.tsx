/**
 * The host-authoritative round-trip as a two-client loop: the HOST runs the
 * real sim and streams state snapshots to the GUEST, who renders them with no
 * local sim and streams input back. Labels sit clear of the arcs.
 */
export function HostAuthoritativeLoopDiagram() {
  return (
    <figure className="diagram-frame">
      <svg
        className="diagram loop-diagram"
        viewBox="0 0 540 250"
        role="img"
        aria-label="The host streams state snapshots to the guest; the guest streams input back."
      >
        <defs>
          <marker id="ha-state" markerWidth="6" markerHeight="6" refX="4.5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="var(--accent)" />
          </marker>
          <marker id="ha-input" markerWidth="6" markerHeight="6" refX="4.5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="var(--good)" />
          </marker>
        </defs>

        {/* Host */}
        <rect x="20" y="78" width="176" height="94" rx="16" fill="var(--card)" stroke="var(--border-strong)" strokeWidth="1.25" />
        <circle cx="46" cy="104" r="5" fill="var(--accent)" />
        <text x="62" y="110" fontSize="17" fontWeight={700} fill="var(--text)">HOST</text>
        <text x="38" y="136" fontSize="13" fill="var(--text-dim)">runs the real fight sim</text>
        <text x="38" y="156" fontSize="11" fontFamily="var(--font-mono)" fill="var(--text-faint)">authoritative</text>

        {/* Guest */}
        <rect x="344" y="78" width="176" height="94" rx="16" fill="var(--card)" stroke="var(--border-strong)" strokeWidth="1.25" />
        <circle cx="370" cy="104" r="5" fill="var(--good)" />
        <text x="386" y="110" fontSize="17" fontWeight={700} fill="var(--text)">GUEST</text>
        <text x="362" y="136" fontSize="13" fill="var(--text-dim)">renders snapshots, no sim</text>
        <text x="362" y="156" fontSize="11" fontFamily="var(--font-mono)" fill="var(--text-faint)">interpolated</text>

        {/* State: host -> guest (top), label clear above the flat arc */}
        <text x="270" y="52" fontSize="14" fontWeight={600} textAnchor="middle" fill="var(--accent)">
          state snapshot  ·  ~60 Hz  →
        </text>
        <path d="M 196 104 C 250 88, 290 88, 344 104" fill="none" stroke="var(--accent)" strokeWidth="1.75" markerEnd="url(#ha-state)" />

        {/* Transport pill */}
        <rect x="228" y="112" width="84" height="26" rx="13" fill="var(--bg-raised)" stroke="var(--border)" strokeWidth="1" />
        <text x="270" y="129" fontSize="12" fontFamily="var(--font-mono)" textAnchor="middle" fill="var(--text-dim)">WS / WebRTC</text>

        {/* Input: guest -> host (bottom), label clear below the arc */}
        <path d="M 344 146 C 290 162, 250 162, 196 146" fill="none" stroke="var(--good)" strokeWidth="1.75" markerEnd="url(#ha-input)" />
        <text x="270" y="196" fontSize="14" fontWeight={600} textAnchor="middle" fill="var(--good)">
          ←  input (button edges)
        </text>

        <text x="270" y="228" fontSize="12.5" textAnchor="middle" fill="var(--text-faint)">
          the guest waits a full round trip + interpolation buffer before its input shows
        </text>
      </svg>
      <figcaption className="diagram-caption">
        One round trip of the host-authoritative loop. Every experiment measures one leg — the wire, the
        snapshot, the felt lag, or the sim underneath.
      </figcaption>
    </figure>
  );
}
