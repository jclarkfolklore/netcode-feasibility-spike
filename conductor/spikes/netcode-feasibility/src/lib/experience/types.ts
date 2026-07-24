import type { ExperienceResult } from "../contracts";

/**
 * Uniform run-model (008.1 scope). Every experience page — manual button or
 * "run all" — invokes `run()` through the identical path in `runner.ts`.
 */
export interface Experience<TConfig extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  title: string;
  /** "What this tests" — the ≤3-sentence L1 summary (no internal citations). */
  whatItTests: string;
  /** Optional remaining methodology detail, revealed behind a "Show more". */
  whatItTestsMore?: string;
  /** "Why multiplayer needs it" — explanatory scaffold. */
  whyItMatters: string;
  /** "How to read the result" — explanatory scaffold. */
  howToRead: string;
  /** Canonical config. Run-all uses exactly this so manual == run-all is checkable. */
  defaultConfig: TConfig;
  /**
   * True if this experience can run with only one peer (no pairing needed).
   * Loopback/solo runs are always runnable regardless of this flag; this
   * flag governs whether a cross-network run needs a second peer at all
   * (contracts.md §6 — determinism analysis, and 008.3/008.5 in loopback).
   */
  soloCapable?: boolean;
  run(config: TConfig, signal: AbortSignal): Promise<ExperienceResult>;
}
