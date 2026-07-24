import type { ReactNode } from "react";
import type { BandValue } from "./Band";

interface Props {
  label: string;
  value: string;
  band?: BandValue;
  /** e.g. the experience id this metric came from. */
  source?: string;
  testId?: string;
}

/** A single scannable metric tile — monospace value, traffic-light band color. */
export function MetricTile({ label, value, band, source, testId }: Props) {
  return (
    <div className="metric-tile" data-band={band ?? "none"} data-testid={testId}>
      <div className="metric-tile-key">{label}</div>
      <div className="metric-tile-value">{value}</div>
      {source && <div className="metric-tile-source">{source}</div>}
    </div>
  );
}

/** Grid wrapper for a row of `MetricTile`s. */
export function MetricTileGrid({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="metric-tile-grid" data-testid={testId}>
      {children}
    </div>
  );
}
