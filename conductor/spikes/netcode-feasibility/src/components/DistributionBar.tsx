interface Distribution {
  p50: number;
  p95: number;
  p99: number;
}

interface Props {
  title: string;
  dist: Distribution;
  /** Appended after each value, e.g. "ms". */
  unit?: string;
  testId?: string;
}

/** Inline-SVG-free (pure CSS bar) p50/p95/p99 distribution — deliberately not a mean. */
export function DistributionBar({ title, dist, unit = "", testId }: Props) {
  const scale = Math.max(dist.p50, dist.p95, dist.p99, 1);
  const row = (percentile: "p50" | "p95" | "p99", value: number) => (
    <div className="distribution-bar-row" key={percentile}>
      <span className="distribution-bar-label">{percentile}</span>
      <div className="distribution-bar-track">
        <div
          className="distribution-bar-fill"
          data-percentile={percentile}
          style={{ width: `${Math.min(100, (value / scale) * 100)}%` }}
        />
      </div>
      <span className="distribution-bar-value">
        {value.toFixed(1)}
        {unit}
      </span>
    </div>
  );
  return (
    <div className="distribution-bar" data-testid={testId}>
      <div className="distribution-bar-title">{title}</div>
      {row("p50", dist.p50)}
      {row("p95", dist.p95)}
      {row("p99", dist.p99)}
    </div>
  );
}

/** Alias kept for callers reaching for the more generic "sparkline" name. */
export const Sparkline = DistributionBar;
