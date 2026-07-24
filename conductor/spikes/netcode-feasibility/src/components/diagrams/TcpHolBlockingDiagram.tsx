/**
 * TCP head-of-line blocking vs WebRTC unreliable delivery. Packet #3 is lost:
 * TCP freezes #4/#5 behind it for ~1 RTT; WebRTC drops #3 and delivers on.
 * Designed to stay legible at ~360px column width — big cells, labels on
 * their own lines, nothing cut off.
 */
function Row({
  y,
  label,
  cells,
  outcome,
  outcomeColor,
}: {
  y: number;
  label: string;
  cells: { n: number; kind: "ok" | "lost" | "blocked" | "gap" }[];
  outcome: string;
  outcomeColor: string;
}) {
  const cellW = 44;
  const startX = 14;
  const colors: Record<string, { fill: string; stroke: string; text: string }> = {
    ok: { fill: "var(--accent-dim)", stroke: "var(--accent)", text: "var(--text)" },
    lost: { fill: "var(--bad-bg)", stroke: "var(--bad)", text: "var(--bad)" },
    blocked: { fill: "var(--acceptable-bg)", stroke: "var(--acceptable)", text: "var(--text)" },
    gap: { fill: "transparent", stroke: "var(--border-strong)", text: "var(--text-faint)" },
  };
  return (
    <g>
      <text x={startX} y={y - 14} fontSize="14" fontWeight={700} fill="var(--text)">
        {label}
      </text>
      {cells.map((c, i) => {
        const x = startX + i * cellW;
        const col = colors[c.kind];
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={36}
              height={32}
              rx={7}
              fill={col.fill}
              stroke={col.stroke}
              strokeWidth={1.5}
              strokeDasharray={c.kind === "lost" || c.kind === "gap" ? "4 3" : undefined}
            />
            {c.kind !== "gap" && (
              <text x={x + 18} y={y + 21} fontSize="15" fontWeight={600} textAnchor="middle" fill={col.text}>
                {c.kind === "lost" ? "✕" : c.n}
              </text>
            )}
          </g>
        );
      })}
      <text x={startX} y={y + 52} fontSize="12.5" fill={outcomeColor}>
        {outcome}
      </text>
    </g>
  );
}

export function TcpHolBlockingDiagram() {
  return (
    <figure className="diagram-frame">
      <svg
        className="diagram"
        viewBox="0 0 320 210"
        role="img"
        aria-label="TCP head-of-line blocking vs WebRTC unreliable delivery when packet 3 is lost"
      >
        <Row
          y={30}
          label="TCP (WebSocket)"
          cells={[
            { n: 1, kind: "ok" },
            { n: 2, kind: "ok" },
            { n: 3, kind: "lost" },
            { n: 4, kind: "blocked" },
            { n: 5, kind: "blocked" },
          ]}
          outcome="✕ #4 & #5 wait for the resend — ~1 RTT frozen"
          outcomeColor="var(--bad)"
        />
        <Row
          y={130}
          label="WebRTC (unreliable)"
          cells={[
            { n: 1, kind: "ok" },
            { n: 2, kind: "ok" },
            { n: 3, kind: "gap" },
            { n: 4, kind: "ok" },
            { n: 5, kind: "ok" },
          ]}
          outcome="✓ #3 dropped, #4 & #5 delivered right away"
          outcomeColor="var(--good)"
        />
      </svg>
      <figcaption className="diagram-caption">
        A single lost packet is the whole story: TCP stalls everything behind it; WebRTC's unreliable
        channel keeps moving.
      </figcaption>
    </figure>
  );
}
