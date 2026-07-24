import type { ExperienceResult, SubScore, Topology } from "../contracts";
import type { Experience } from "./types";

export interface PlaceholderConfig extends Record<string, unknown> {
  fakeDelayMs: number;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

const FAKE_SUB_SCORES: SubScore[] = [
  {
    key: "latency",
    value0to100: 92,
    band: "good",
    weight: 1,
    rationale: "Fabricated fixed value — proves the run/result/score plumbing, not a measurement.",
  },
  {
    key: "jitter",
    value0to100: 78,
    band: "acceptable",
    weight: 1,
    rationale: "Fabricated fixed value — proves the run/result/score plumbing, not a measurement.",
  },
  {
    key: "determinism-readiness",
    value0to100: 60,
    band: "acceptable",
    weight: 1,
    rationale: "Fabricated fixed value — proves the run/result/score plumbing, not a measurement.",
  },
];

/**
 * The 008.1 placeholder experience: no real measurement, just enough shape
 * to demonstrate the identical manual/run-all path, abort/timeout, and a
 * scoreable ExperienceResult end-to-end in the `loopback` topology.
 */
export function createPlaceholderExperience(getTopology: () => Topology): Experience<PlaceholderConfig> {
  return {
    id: "placeholder",
    title: "Placeholder Experience (plumbing check)",
    whatItTests:
      "Nothing real yet. This page exists to prove the app shell's run-model — manual button and \"run all\" invoking the identical path, abort, and timeout — works end-to-end before any real experience (transport, snapshot, input-lag, determinism) is built on top of it.",
    whyItMatters:
      "Every later experience hangs its real measurement off this exact run -> ExperienceResult -> score path. If the plumbing here is wrong — if manual and run-all diverge, or abort doesn't clean up, or scores don't aggregate right — every later result inherits that bug silently.",
    howToRead:
      "A fabricated ExperienceResult with three sub-scores (0-100, banded) appears after a short simulated delay. Compare the result from a manual run against a run-all pass — they should be identical in shape. Try Abort mid-run: the result should show status \"failed\" with a clear reason, never hang.",
    defaultConfig: { fakeDelayMs: 400 },
    soloCapable: true,
    async run(config, signal): Promise<ExperienceResult> {
      await delay(config.fakeDelayMs, signal);

      if (signal.aborted) {
        return {
          experienceId: "placeholder",
          status: "failed",
          topology: getTopology(),
          lossMode: "none",
          raw: { config, reason: "aborted" },
          subScores: [],
          verdict: "Aborted before completion.",
          measuredCaveat: "n/a — placeholder, no real measurement",
        };
      }

      return {
        experienceId: "placeholder",
        status: "completed",
        topology: getTopology(),
        lossMode: "none",
        raw: { config },
        subScores: FAKE_SUB_SCORES,
        verdict: "Plumbing works: manual and run-all both produce this identical shape.",
        measuredCaveat: "Fabricated numbers — this experience does not measure anything real.",
      };
    },
  };
}
