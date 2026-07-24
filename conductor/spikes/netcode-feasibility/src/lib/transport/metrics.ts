/**
 * Pure statistics helpers for the transport sweep (contracts.md §1/§5 —
 * "Metrics as distributions p50/p95/p99 + max", jitter, loss %, reorder,
 * throughput). No transport/network code lives here — this module only
 * turns arrays of samples into numbers, so it's trivially unit-testable.
 */

export interface Distribution {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

const EMPTY_DISTRIBUTION: Distribution = { count: 0, p50: 0, p95: 0, p99: 0, max: 0, mean: 0 };

/** Nearest-rank percentile over a (not necessarily sorted) sample array. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)];
}

/** p50/p95/p99/max/mean in one pass (well, four `percentile` passes — fine at this scale). */
export function computeDistribution(values: number[]): Distribution {
  if (values.length === 0) return { ...EMPTY_DISTRIBUTION };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return {
    count: values.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1],
    mean,
  };
}

/**
 * Jitter = mean absolute difference between consecutive samples (RFC 3550's
 * simple interpacket-variation notion, not the full smoothed estimator —
 * adequate for a comparative harness, not a production RTP stack).
 */
export function computeJitter(values: number[]): number {
  if (values.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < values.length; i++) sum += Math.abs(values[i] - values[i - 1]);
  return sum / (values.length - 1);
}

/** Loss % = (attempted - received) / attempted * 100. */
export function computeLossPercent(attempted: number, received: number): number {
  if (attempted === 0) return 0;
  return ((attempted - received) / attempted) * 100;
}

/**
 * Reorder count: number of received sequence numbers that arrived lower
 * than the highest sequence number already seen (i.e., out of send order).
 */
export function computeReorderCount(receivedSeqInArrivalOrder: number[]): number {
  let reorders = 0;
  let highest = -Infinity;
  for (const seq of receivedSeqInArrivalOrder) {
    if (seq < highest) reorders++;
    else highest = seq;
  }
  return reorders;
}

export function computeThroughputBps(totalBytes: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return (totalBytes * 1000) / durationMs;
}
