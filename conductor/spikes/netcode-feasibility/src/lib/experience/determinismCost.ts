import type { ExperienceResult, SubScore, Topology } from "../contracts";
import type { Experience } from "./types";
import {
  DEMO_TAPE,
  SYNTHETIC_CHAR_DEFS,
  runAnnouncerPick,
  runScriptedTape,
} from "./determinismHarness";

/** Enumerated non-determinism sources — `file:line`, verified 2026-07-23. */
export interface NonDeterminismSource {
  location: string;
  kind: "rng" | "timestep" | "physics";
  cost: "cheap" | "structural";
  description: string;
}

export const NON_DETERMINISM_SOURCES: NonDeterminismSource[] = [
  {
    location: "src/game/systems/CombatSystem.ts:52",
    kind: "rng",
    cost: "cheap",
    description:
      "`Math.random() < 0.25` crit roll, gated on the `hallucination_crit` trait. Seedable by patching `Math.random` around the call (demonstrated below).",
  },
  {
    location: "src/game/systems/CombatSystem.ts:58",
    kind: "rng",
    cost: "cheap",
    description:
      "`Math.random() < 0.1` bug-prone damage-reduction roll, gated on the `bug_prone` trait. Same fix as the crit roll.",
  },
  {
    location: "src/game/systems/Announcer.ts:10",
    kind: "rng",
    cost: "cheap",
    description:
      "`Math.floor(Math.random() * lines.length)` announcer line-pick. Cosmetic (does not affect combat outcome) but still a non-determinism source if included in a rollback snapshot's inputs.",
  },
  {
    location: "src/game/entities/Fighter.ts:253-270, :197-201, :279-311; src/game/systems/Announcer.ts:17-19",
    kind: "timestep",
    cost: "structural",
    description:
      "Every timer (attackTimer, hitstunTimer, confidence regen, announcer cooldown, walk-cycle phase) is keyed on the real, variable `delta` passed into Phaser's `update(time, delta)`. There is no tick counter anywhere in `src/game`. Two runs of the identical input sequence at different frame rates (or the same frame rate with different scheduler jitter) accumulate different intermediate timer values and can diverge in outcome even with seeded RNG. Fixing this means introducing a fixed timestep + tick counter and re-deriving every timer from ticks, not milliseconds.",
  },
  {
    location: "src/game/entities/Fighter.ts:142-150 (Arcade.Body), CombatSystem.ts:70-72 (float position/range checks)",
    kind: "physics",
    cost: "structural",
    description:
      "Canonical position/velocity live in a Phaser Arcade `Body`, integrated by Phaser's Arcade physics on a step that is not locked to a fixed rate, and combat range checks (`Math.abs(attacker.sprite.x - defender.sprite.x)`) run on floating-point positions. Neither is bitwise-reproducible across runs/machines without converting to fixed-point math or a fixed-step-locked physics integrator — this is the same class of problem NetherRealm hit retrofitting MKX.",
  },
];

/** Evidence-anchored cost table (research.md §C) — cheap vs structural. */
export interface CostRow {
  part: string;
  cost: "cheap" | "structural";
  estimate: string;
  anchor: string;
}

export const COST_TABLE: CostRow[] = [
  {
    part: "Seed the 3 RNG sites (crit, bug-prone, announcer line-pick)",
    cost: "cheap",
    estimate: "Hours, not weeks — thread a seeded PRNG in place of 3 direct `Math.random()` calls.",
    anchor: "Demonstrated live below: same seed + same tape => identical outcome, headless.",
  },
  {
    part: "Convert every timer to a fixed timestep + tick counter",
    cost: "structural",
    estimate: "Weeks — every `delta`-keyed timer in Fighter/Announcer/FightScene must be re-derived from ticks.",
    anchor: "research.md §C: rollback needs bitwise determinism; MKX retrofit ≈ 8 man-years total, only ~2 of them on serialization.",
  },
  {
    part: "Deterministic physics (fixed-point, or locked-step Arcade integration) + snapshot/restore every frame",
    cost: "structural",
    estimate: "Months — this is the bulk of the retrofit; tween-driven animation state is not currently snapshottable at all (research.md §A).",
    anchor: "research.md §C: naive rollback tripled frame cost 10ms -> 32ms; state-relay needs NO determinism/restore at all, which is why host-authoritative is the cheap path today.",
  },
];

const REPRODUCIBILITY_SEED_A = 42;
const REPRODUCIBILITY_SEED_B = 42;
const REPRODUCIBILITY_DIVERGENT_SEED = 7;

export interface DeterminismConfig extends Record<string, unknown> {
  seedA: number;
  seedB: number;
  divergentSeed: number;
}

const DEFAULT_CONFIG: DeterminismConfig = {
  seedA: REPRODUCIBILITY_SEED_A,
  seedB: REPRODUCIBILITY_SEED_B,
  divergentSeed: REPRODUCIBILITY_DIVERGENT_SEED,
};

const ANNOUNCER_DATA = {
  roundStart: ["Round one — FIGHT", "Here we go", "Standup meeting begins"],
  bigHit: ["Ouch!", "That's a P0"],
  miss: ["Whiffed it", "Missed the sprint"],
  lowConfidence: ["Losing confidence"],
  ko: ["Knocked out"],
  block: ["Blocked"],
};

/**
 * The 008.6 Determinism-cost experience. Analysis-mode: no network, no
 * peer — `soloCapable`. The "measurement" is a headless scripted-drive
 * reproducibility demo (F8) plus an evidence-anchored cost estimate, not a
 * live network metric.
 */
export function createDeterminismCostExperience(
  getTopology: () => Topology,
): Experience<DeterminismConfig> {
  return {
    id: "determinism-cost",
    title: "Determinism-cost (does rollback reopen?)",
    whatItTests:
      "Counts every source of non-determinism in the sim (verified `file:line`) and demonstrates the cheap part headlessly: same seed + same inputs = identical outcome. The question: would rollback netcode be cheap to retrofit? (Separate axis — not part of the feasibility score.)",
    whatItTestsMore:
      "Whether this codebase's combat sim is cheap or expensive to make deterministic — the prerequisite for rollback netcode. It enumerates every non-determinism source with `file:line`, headlessly demonstrates that the 3 `Math.random()` sites are trivially seedable (same seed + scripted input tape → identical damage/KO outcome, reproduced twice), and estimates the cost of the remaining structural work (fixed timestep, deterministic physics) that a live run cannot demonstrate.",
    whyItMatters:
      "Decision 1 chose host-authoritative because a deterministic rewrite \"isn't worth it\" — but said explicitly to revisit if the cost calculus changes. Rollback is the FGC gold standard and avoids the guest input-lag / stale-opponent costs 008.5 measures for host-authoritative — but only if bitwise determinism is affordable. This page turns that into a number instead of a guess.",
    howToRead:
      "The non-determinism enumeration below is read-only research (file:line, verified against current source). The reproducibility demo runs the SAME scripted attack tape twice with the SAME seed (must match exactly) and once more with a DIFFERENT seed (may or may not match — a coincidental repeat is possible, not a bug). The cost table and recommendation are an evidence-anchored ESTIMATE, badged as analysis — not a live network measurement, and the `determinism-readiness` sub-score reflects how much of the full retrofit is already provably cheap vs. still fully unaddressed and structural.",
    defaultConfig: DEFAULT_CONFIG,
    soloCapable: true,
    async run(config, signal): Promise<ExperienceResult> {
      if (signal.aborted) {
        return abortedResult(getTopology(), config);
      }

      const runA = runScriptedTape(config.seedA, DEMO_TAPE, SYNTHETIC_CHAR_DEFS);
      const runB = runScriptedTape(config.seedB, DEMO_TAPE, SYNTHETIC_CHAR_DEFS);
      const runDivergent = runScriptedTape(config.divergentSeed, DEMO_TAPE, SYNTHETIC_CHAR_DEFS);

      const reproducible = JSON.stringify(runA) === JSON.stringify(runB);
      const divergedFromBaseline = JSON.stringify(runA) !== JSON.stringify(runDivergent);

      const announcerA = runAnnouncerPick(config.seedA, ANNOUNCER_DATA, "roundStart");
      const announcerB = runAnnouncerPick(config.seedB, ANNOUNCER_DATA, "roundStart");
      const announcerReproducible = announcerA === announcerB;

      if (signal.aborted) {
        return abortedResult(getTopology(), config);
      }

      const subScores: SubScore[] = [
        {
          key: "determinism-readiness",
          value0to100: 25,
          band: "bad",
          weight: 1,
          rationale:
            "Estimate, not a measurement: the 3 RNG sites (cheap, proven seedable below) are a small slice of the full rollback retrofit. research.md §C anchors the MKX retrofit at ~8 man-years total with only ~2 of those years on serialization — implying the structural remainder (fixed timestep + deterministic/snapshot-restorable physics, entirely unaddressed here) dominates the cost. 25/100 reflects 'the cheap ~2/8 share is provably done-able; the ~6/8 structural share is not.'",
        },
      ];

      return {
        experienceId: "determinism-cost",
        status: "completed",
        topology: getTopology(),
        lossMode: "none",
        raw: {
          config,
          nonDeterminismSources: NON_DETERMINISM_SOURCES,
          costTable: COST_TABLE,
          reproducibility: {
            runA,
            runB,
            runDivergent,
            reproducible,
            divergedFromBaseline,
            announcerA,
            announcerB,
            announcerReproducible,
          },
          recommendation:
            "Rollback does NOT reopen. The 3 RNG sites are cheap to seed (demonstrated here, headless), but rollback needs the WHOLE sim bitwise-deterministic and per-tick snapshot/restore-able, and the dominant cost — fixed timestep conversion + deterministic physics + making tween-driven animation state snapshottable (currently impossible per research.md §A) — is untouched and, per the MKX anchor, the majority of an ~8 man-year retrofit. Host-authoritative (Decision 1) stands; revisit only if a fixed-timestep/physics rewrite is independently justified for other reasons.",
        },
        subScores,
        verdict: reproducible
          ? `Reproducibility demonstrated: identical scripted tape + same seed produced an identical outcome across two headless runs (winner=${runA.winner}, p1Health=${runA.p1Health}, p2Health=${runA.p2Health}). A different seed ${divergedFromBaseline ? "did" : "did not"} change the outcome on this tape. Full determinism (rollback-ready) is still far off — see the cost table.`
          : "Reproducibility FAILED — same seed produced different outcomes. This would indicate a bug in the harness's monkey-patch/stub, not the sim; investigate before trusting the cost estimate.",
        measuredCaveat:
          "This is a headless, harness-side analysis of resolveAttack()/Announcer.pick() under a scripted input tape and monkey-patched Math.random — not a live sim run (a live run diverges under variable delta even with seeded RNG, per F8) and not a live network metric. The determinism-readiness sub-score is an estimate anchored to research.md §C, not a measured quantity.",
      };
    },
  };
}

function abortedResult(topology: Topology, config: Record<string, unknown>): ExperienceResult {
  return {
    experienceId: "determinism-cost",
    status: "failed",
    topology,
    lossMode: "none",
    raw: { config, reason: "aborted" },
    subScores: [],
    verdict: "Aborted before completion.",
    measuredCaveat: "n/a — aborted",
  };
}
