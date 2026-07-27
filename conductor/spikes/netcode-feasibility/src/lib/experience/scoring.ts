import type { ExperienceResult, SubScoreKey, SubScore, Topology } from "../contracts";

/**
 * Scoring (contracts.md §5, research.md §D): "Aggregate with geometric mean
 * over `completed` sub-scores + a min-gate (one `bad` caps the composite) —
 * never additive." 008.1 built the shape; 008.7 adds the real weight
 * story: per-key weight overrides (the "let the user perturb weights"
 * transparency knob) and the feasibility/determinism axis split (research
 * §D + the 008.7 spec's "don't naively average across different
 * questions" nuance).
 *
 * `failed`/`skipped` results are excluded entirely, never zero the score.
 */

const EPSILON = 0.01; // avoid ln(0) for a genuine 0 sub-score

/** Weighted geometric mean + min-gate over one result's completed sub-scores. */
export function scoreSubScores(subScores: SubScore[]): number | null {
  if (subScores.length === 0) return null;

  // `?? 1` (not `|| 1`): an authored `weight: 0` means "show but DON'T score"
  // (e.g. an unscored/neutral placeholder) — `|| 1` silently gave it full weight.
  const totalWeight = subScores.reduce((sum, s) => sum + (s.weight ?? 1), 0);
  if (totalWeight === 0) return null; // every sub-score was weight-0 (informational only)
  const weightedLogSum = subScores.reduce(
    (sum, s) => sum + (s.weight ?? 1) * Math.log(Math.max(s.value0to100, EPSILON)),
    0,
  );
  const weightedGeoMean = Math.exp(weightedLogSum / totalWeight);

  // Min-gate: a single 'bad' sub-score caps the whole composite at that
  // sub-score's own value, so a great score elsewhere can never mask it.
  const badValues = subScores
    .filter((s) => s.band === "bad")
    .map((s) => s.value0to100);
  if (badValues.length > 0) {
    return Math.min(weightedGeoMean, Math.min(...badValues));
  }
  return weightedGeoMean;
}

/**
 * User-adjustable weight multipliers, keyed by SubScoreKey — "let the user
 * perturb weights and watch the verdict" (research.md §D). A multiplier of
 * 1 (or an absent key) reproduces the experience's own authored weight
 * unchanged; this never invents a weight, only scales the authored one, so
 * the rationale text (which cites the authored weight) stays honest.
 */
export type WeightOverrides = Partial<Record<SubScoreKey, number>>;

/** Applies weight multipliers to a sub-score vector without mutating the input. */
export function applyWeightOverrides(subScores: SubScore[], overrides?: WeightOverrides): SubScore[] {
  if (!overrides) return subScores;
  return subScores.map((s) => {
    const multiplier = overrides[s.key];
    if (multiplier === undefined || multiplier === 1) return s;
    return { ...s, weight: s.weight * multiplier };
  });
}

/** Composite score for one experience's result, or null if not scoreable. */
export function scoreExperienceResult(
  result: ExperienceResult,
  overrides?: WeightOverrides,
): number | null {
  if (result.status !== "completed") return null;
  return scoreSubScores(applyWeightOverrides(result.subScores, overrides));
}

export interface AggregateScore {
  /** Unweighted geometric mean across completed experiences' composites, or null if none completed. */
  compositeScore: number | null;
  perExperience: Record<string, number | null>;
  completedCount: number;
  failedCount: number;
  skippedCount: number;
}

/** Rolls a set of ExperienceResults into the summary-page composite. */
export function aggregateResults(
  results: ExperienceResult[],
  overrides?: WeightOverrides,
): AggregateScore {
  const perExperience: Record<string, number | null> = {};
  const completedScores: number[] = [];
  let failedCount = 0;
  let skippedCount = 0;

  for (const r of results) {
    const score = scoreExperienceResult(r, overrides);
    perExperience[r.experienceId] = score;
    if (r.status === "failed") failedCount++;
    if (r.status === "skipped") skippedCount++;
    if (score !== null) completedScores.push(score);
  }

  const compositeScore =
    completedScores.length === 0
      ? null
      : Math.exp(
          completedScores.reduce((sum, s) => sum + Math.log(Math.max(s, EPSILON)), 0) /
            completedScores.length,
        );

  return {
    compositeScore,
    perExperience,
    completedCount: completedScores.length,
    failedCount,
    skippedCount,
  };
}

// ---------------------------------------------------------------------------
// Feasibility vs. determinism — two different questions (008.7 spec nuance)
// ---------------------------------------------------------------------------

/**
 * `determinism-readiness` answers "should we switch to rollback?" — a
 * DIFFERENT question from host-authoritative feasibility (transport +
 * snapshot-cost + input-lag, the gating axis). Blending the two into one
 * mean would let a great transport score paper over "rollback is
 * structurally expensive," or vice versa. This is the only experience that
 * emits a `determinism-readiness` sub-score, so splitting by experienceId
 * is sufficient and exact (no sub-score-level surgery needed).
 */
export const DETERMINISM_EXPERIENCE_ID = "determinism-cost";

export interface AxisSplit {
  /** Every completed/failed/skipped result EXCEPT determinism-cost. */
  feasibilityResults: ExperienceResult[];
  /** The determinism-cost experience's result, if it has run. */
  determinismResult: ExperienceResult | undefined;
}

export function splitAxes(results: ExperienceResult[]): AxisSplit {
  return {
    feasibilityResults: results.filter((r) => r.experienceId !== DETERMINISM_EXPERIENCE_ID),
    determinismResult: results.find((r) => r.experienceId === DETERMINISM_EXPERIENCE_ID),
  };
}

// ---------------------------------------------------------------------------
// Cross-network exclusion — loopback/solo runs are badged, not verdict-bearing
// ---------------------------------------------------------------------------

/** True for the in-process, no-real-network topology (contracts.md §6). */
export function isSoloTopology(topology: Topology): boolean {
  return topology === "loopback";
}

/** Results with a real peer on the other end of a real wire. */
export function crossNetworkResults(results: ExperienceResult[]): ExperienceResult[] {
  return results.filter((r) => !isSoloTopology(r.topology));
}

/** Maps a raw metric value to a 0-100 score + band via Good/Acceptable/Bad thresholds. */
export interface Bands {
  /** value <= goodMax -> 'good' (or >= if `higherIsBetter`) */
  goodMax: number;
  acceptableMax: number;
  higherIsBetter?: boolean;
}

export function bandFor(value: number, bands: Bands): "good" | "acceptable" | "bad" {
  const { goodMax, acceptableMax, higherIsBetter } = bands;
  if (higherIsBetter) {
    if (value >= goodMax) return "good";
    if (value >= acceptableMax) return "acceptable";
    return "bad";
  }
  if (value <= goodMax) return "good";
  if (value <= acceptableMax) return "acceptable";
  return "bad";
}
