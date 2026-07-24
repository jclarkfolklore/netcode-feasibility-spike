import { describe, expect, it } from "vitest";
import {
  computeDistribution,
  computeJitter,
  computeLossPercent,
  computeReorderCount,
  computeThroughputBps,
  percentile,
} from "./metrics";

describe("percentile", () => {
  it("returns 0 for an empty array", () => {
    expect(percentile([], 50)).toBe(0);
  });

  it("computes p50 (median) for an odd-length array regardless of input order", () => {
    expect(percentile([5, 1, 3], 50)).toBe(3);
  });

  it("nearest-rank p99 on a 100-element uniform array picks the 99th value", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(percentile(values, 99)).toBe(99);
    expect(percentile(values, 50)).toBe(50);
  });
});

describe("computeDistribution", () => {
  it("returns all-zero distribution for an empty array", () => {
    expect(computeDistribution([])).toEqual({ count: 0, p50: 0, p95: 0, p99: 0, max: 0, mean: 0 });
  });

  it("computes count/p50/p95/p99/max/mean together", () => {
    const values = [10, 20, 30, 40, 50];
    const d = computeDistribution(values);
    expect(d.count).toBe(5);
    expect(d.max).toBe(50);
    expect(d.mean).toBe(30);
    expect(d.p50).toBe(30);
  });

  it("a single huge outlier moves p99/max but not p50 much", () => {
    const values = [10, 11, 12, 13, 500];
    const d = computeDistribution(values);
    expect(d.max).toBe(500);
    expect(d.p50).toBeLessThan(20);
  });
});

describe("computeJitter", () => {
  it("is 0 for fewer than 2 samples", () => {
    expect(computeJitter([])).toBe(0);
    expect(computeJitter([42])).toBe(0);
  });

  it("is 0 for perfectly constant samples", () => {
    expect(computeJitter([10, 10, 10, 10])).toBe(0);
  });

  it("is the mean absolute consecutive delta", () => {
    // deltas: |20-10|=10, |15-20|=5, |25-15|=10 -> mean 25/3
    expect(computeJitter([10, 20, 15, 25])).toBeCloseTo(25 / 3, 8);
  });
});

describe("computeLossPercent", () => {
  it("is 0 when nothing was attempted", () => {
    expect(computeLossPercent(0, 0)).toBe(0);
  });

  it("is 0 when everything attempted was received", () => {
    expect(computeLossPercent(10, 10)).toBe(0);
  });

  it("computes the correct percentage for partial loss", () => {
    expect(computeLossPercent(100, 95)).toBeCloseTo(5, 8);
  });

  it("is 100 when nothing was received", () => {
    expect(computeLossPercent(10, 0)).toBe(100);
  });
});

describe("computeReorderCount", () => {
  it("is 0 for strictly increasing arrival order", () => {
    expect(computeReorderCount([1, 2, 3, 4])).toBe(0);
  });

  it("counts each seq that arrives lower than the highest seen so far", () => {
    // 1,3 raise the high-water mark to 3; 2 arrives after and is a reorder;
    // 5 raises it again; 4 arrives after and is a second reorder.
    expect(computeReorderCount([1, 3, 2, 5, 4])).toBe(2);
  });

  it("is 0 for an empty array", () => {
    expect(computeReorderCount([])).toBe(0);
  });
});

describe("computeThroughputBps", () => {
  it("is 0 for zero or negative duration", () => {
    expect(computeThroughputBps(1000, 0)).toBe(0);
    expect(computeThroughputBps(1000, -5)).toBe(0);
  });

  it("computes bytes/sec from bytes and milliseconds", () => {
    expect(computeThroughputBps(1000, 1000)).toBe(1000); // 1000 bytes / 1s
    expect(computeThroughputBps(500, 500)).toBe(1000); // 500 bytes / 0.5s
  });
});
