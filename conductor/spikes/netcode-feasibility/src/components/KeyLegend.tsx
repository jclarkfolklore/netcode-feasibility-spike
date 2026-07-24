/**
 * Two-row key legend (P1 / P2) rendered as `<kbd>` caps — replaces the
 * unparseable "P1: A/D/S/F/G/Shift/Q" prose. Bindings verified against the
 * read-only `src/game/systems/InputManager.ts` (there is no jump/duck; "down"
 * is Block, "up"/W and "/" are the alternate Charge keys). DP §2.10.
 */
interface Binding {
  action: string;
  keys: string[];
}

const P1: Binding[] = [
  { action: "Move", keys: ["A", "D"] },
  { action: "Block", keys: ["S"] },
  { action: "Light", keys: ["F"] },
  { action: "Heavy", keys: ["G"] },
  { action: "Charge", keys: ["Shift", "W"] },
  { action: "Special", keys: ["Q"] },
];

const P2: Binding[] = [
  { action: "Move", keys: ["←", "→"] },
  { action: "Block", keys: ["↓"] },
  { action: "Light", keys: ["."] },
  { action: "Heavy", keys: [","] },
  { action: "Charge", keys: ["↑", "/"] },
  { action: "Special", keys: ["Enter"] },
];

function Row({ label, bindings, testId }: { label: string; bindings: Binding[]; testId: string }) {
  return (
    <div className="key-legend-row" data-testid={testId}>
      <span className="key-legend-player">{label}</span>
      {bindings.map((b) => (
        <span className="key-legend-binding" key={b.action}>
          {b.keys.map((k) => (
            <kbd key={k}>{k}</kbd>
          ))}
          <span className="key-legend-action">{b.action}</span>
        </span>
      ))}
    </div>
  );
}

export function KeyLegend({ testId = "key-legend" }: { testId?: string }) {
  return (
    <div className="key-legend" data-testid={testId}>
      <Row label="P1" bindings={P1} testId={`${testId}-p1`} />
      <Row label="P2" bindings={P2} testId={`${testId}-p2`} />
    </div>
  );
}
