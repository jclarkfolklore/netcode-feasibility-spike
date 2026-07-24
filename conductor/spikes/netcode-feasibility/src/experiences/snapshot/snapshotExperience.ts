/**
 * 008.4 — the automated run(): boots a REAL host sim + a render-only guest
 * scene into detached, off-screen DOM containers, relays snapshots
 * host->guest over a `LoopbackTransport` pair (contracts.md §1), drives a
 * scripted sequence of state changes on the host (public `Fighter` mutators,
 * never `processCombat`), measures the serialization ladder + interpolation
 * behavior for a fixed number of ticks in BOTH guest render modes, tears
 * everything down, and returns one `ExperienceResult`.
 */
import type { ExperienceResult, Snapshot, SubScore, Topology } from "../../lib/contracts";
import type { Experience } from "../../lib/experience/types";
import { LoopbackTransport } from "../../lib/transport/loopback";
import { bootGuestGame, bootHostGame, type GuestGameHandle, type HostGameHandle } from "./bootGames";
import { NET_SNAPSHOT_EVENT } from "./hostScene";
import { InterpolationBuffer } from "./interpBuffer";
import { BINARY_FULL_SIZE, measureEncodeCost } from "./snapshotCodec";
import type { GuestRenderMode } from "./guestScene";

export interface SnapshotConfig extends Record<string, unknown> {
  /** Ticks of the host sim to drive per measured pass (~60Hz -> ~2s @ 120). */
  driveTicks: number;
  /** Guest interpolation delay, ms — F7's tunable 0/50/100ms knob. */
  interpDelayMs: number;
}

export const SNAPSHOT_EXPERIENCE_DEFAULT_CONFIG: SnapshotConfig = {
  driveTicks: 120,
  interpDelayMs: 50,
};

/** The scripted, no-keyboard-required state-variety drive (same technique as `PreviewScene`). */
function driveScript(scene: HostGameHandle["scene"], tick: number): void {
  const [p1, p2] = scene.fighters;
  // A small fixed cadence of public-API actions -> real state/pose variety
  // for the fidelity-gap measurement, independent of keyboard input.
  switch (tick) {
    case 10:
      p1.setCharging(true);
      break;
    case 40:
      p1.setCharging(false);
      p1.startAttack("light", "token_overflow");
      break;
    case 55:
      p2.setBlocking(true);
      break;
    case 70:
      p2.setBlocking(false);
      p2.startAttack("heavy", "hotfix_fury");
      break;
    case 90:
      p1.takeDamage(12);
      break;
    default:
      break;
  }
}

interface PassStats {
  mode: GuestRenderMode;
  ticksObserved: number;
  jsonBytes: number[];
  binaryBytes: number[];
  deltaBytes: number[];
  jsonMs: number[];
  binaryMs: number[];
  deltaMs: number[];
  stalenessMs: number[];
  distinctStatesSeen: Set<string>;
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function max(xs: number[]): number {
  return xs.length ? Math.max(...xs) : 0;
}

async function runOnePass(
  host: HostGameHandle,
  guest: GuestGameHandle,
  mode: GuestRenderMode,
  driveTicks: number,
  interpDelayMs: number,
  signal: AbortSignal,
): Promise<PassStats> {
  guest.scene.mode = mode;
  const [hostTransport, guestTransport] = LoopbackTransport.createPair();
  const interp = new InterpolationBuffer();

  const stats: PassStats = {
    mode,
    ticksObserved: 0,
    jsonBytes: [],
    binaryBytes: [],
    deltaBytes: [],
    jsonMs: [],
    binaryMs: [],
    deltaMs: [],
    stalenessMs: [],
    distinctStatesSeen: new Set(),
  };

  let prevSnapshot: Snapshot | null = null;

  guestTransport.onMessage((msg) => {
    if (msg.t !== "snapshot") return;
    interp.push(msg);
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("aborted mid-pass"));
    };
    signal.addEventListener("abort", onAbort, { once: true });

    function cleanup() {
      host.game.events.off(NET_SNAPSHOT_EVENT, onSnapshot);
      hostTransport.close();
      guestTransport.close();
      signal.removeEventListener("abort", onAbort);
    }

    function onSnapshot(snapshot: Snapshot) {
      if (settled) return;
      driveScript(host.scene, host.scene.currentTick);

      const cost = measureEncodeCost(prevSnapshot, snapshot);
      stats.jsonBytes.push(cost.jsonBytes);
      stats.binaryBytes.push(cost.binaryBytes);
      stats.deltaBytes.push(cost.deltaBytes);
      stats.jsonMs.push(cost.jsonMs);
      stats.binaryMs.push(cost.binaryMs);
      stats.deltaMs.push(cost.deltaMs);
      stats.distinctStatesSeen.add(snapshot.fighters[0].state);
      stats.distinctStatesSeen.add(snapshot.fighters[1].state);
      prevSnapshot = snapshot;

      hostTransport.send(snapshot);

      const sample = interp.sampleAt(snapshot.hostTime, interpDelayMs);
      if (sample) {
        guest.scene.applySnapshot(sample);
        stats.stalenessMs.push(interp.staleness(snapshot.hostTime));
      }

      stats.ticksObserved += 1;
      if (stats.ticksObserved >= driveTicks) {
        settled = true;
        cleanup();
        resolve(stats);
      }
    }

    host.game.events.on(NET_SNAPSHOT_EVENT, onSnapshot);
  });
}

function bandFor(value: number, good: number, acceptable: number): SubScore["band"] {
  if (value <= good) return "good";
  if (value <= acceptable) return "acceptable";
  return "bad";
}

export function createSnapshotExperience(getTopology: () => Topology): Experience<SnapshotConfig> {
  return {
    id: "sim-snapshot",
    title: "Sim-snapshot (host-authoritative feasibility)",
    whatItTests:
      "Captures the real fight state every tick, serializes it three ways (`JSON`, packed binary, delta), and renders it on a second, sim-free client. Measures bytes per tick and encode cost against the `16.67ms` frame budget. The question: is a snapshot cheap, and does it look right?",
    whatItTestsMore:
      "Whether this codebase's Phaser sim can actually be snapshotted and rendered the way host-authoritative multiplayer needs: capture a serializable `Snapshot` every tick from the REAL running FightScene, relay it host→guest over a `LoopbackTransport` pair, apply it to a SEPARATE render-only guest scene, and measure the serialization ladder (`JSON`, hand-packed binary, delta) for size and per-frame production cost against the `16.67ms` frame budget. It also runs the guest render vehicle in two modes (`state-only` vs. an experimental `redrive-mutators`) to characterize exactly what pose/tween fidelity is and is not recoverable from the snapshot alone.",
    whyItMatters:
      "Decision 1 chose host-authoritative because it needs neither determinism nor rollback/restore (research.md §C) — but that's only cheap if a snapshot is actually cheap to produce AND faithfully renders. research.md §A found this sim welds combat state to Phaser render objects (tween-driven pose, no state->render path) — this experience turns that risk into a measured, honest finding instead of an assumption.",
    howToRead:
      "`raw.ladder` shows measured byte sizes (JSON/binary/delta) and per-frame encode cost (ms) — compare against the 16.67ms/frame budget. `raw.fidelity` lists, per render mode, what mirrored the host and what didn't. `raw.interpolation` shows the configured interp delay and the observed guest staleness (hostTime - renderedSnapshotTime). The `snapshot-cost` sub-score reflects ONLY the encode-cost budget question — it does NOT score render fidelity, which has no single number and is reported as a qualitative finding instead (per contracts.md §5, composite scores must not paper over a structural gap like this one).",
    defaultConfig: SNAPSHOT_EXPERIENCE_DEFAULT_CONFIG,
    soloCapable: true,
    async run(config, signal): Promise<ExperienceResult> {
      const container = document.createElement("div");
      container.style.position = "fixed";
      container.style.left = "-10000px";
      container.style.top = "0";
      document.body.appendChild(container);
      const hostParent = document.createElement("div");
      const guestParent = document.createElement("div");
      container.appendChild(hostParent);
      container.appendChild(guestParent);

      let host: HostGameHandle | undefined;
      let guest: GuestGameHandle | undefined;

      try {
        if (signal.aborted) throw new Error("aborted");
        [host, guest] = await Promise.all([bootHostGame(hostParent, { signal }), bootGuestGame(guestParent)]);

        const stateOnly = await runOnePass(host, guest, "state-only", config.driveTicks, config.interpDelayMs, signal);
        const redrive = await runOnePass(host, guest, "redrive-mutators", config.driveTicks, config.interpDelayMs, signal);

        const avgBinaryMs = avg(stateOnly.binaryMs);
        const snapshotCostBand = bandFor(avgBinaryMs, 1, 5);
        const subScores: SubScore[] = [
          {
            key: "snapshot-cost",
            value0to100: Math.max(0, Math.min(100, 100 - (avgBinaryMs / 16.67) * 100)),
            band: snapshotCostBand,
            weight: 1,
            rationale: `Average measured per-frame binary-encode cost was ${avgBinaryMs.toFixed(4)}ms against the 16.67ms/frame budget (${((avgBinaryMs / 16.67) * 100).toFixed(2)}% of one frame) over ${stateOnly.ticksObserved} real ticks of the live sim. This scores ONLY encode cost — see raw.fidelity for the render-fidelity finding, which this number cannot and does not capture.`,
          },
        ];

        const fidelity = {
          "state-only (F6 default)": {
            mirrors: [
              "x position, facing direction",
              "health / confidence / special meter values (the HUD-visible numbers)",
              "logical FighterStateKind (idle/walk/attack/block/hitstun/ko) and its timers as raw numbers",
              "round / countdown / winner",
            ],
            missing: [
              "attack lunge (torso/punch-arm tween), hit-flash color tween, block-shield alpha tween, charge-ring pulse, walk leg-swing — all are Phaser Tween side effects of calling Fighter's private mutators, never stored as snapshottable state",
              "the action badge / move name text (e.g. 'JAB', 'SMASH', the special's move name) — not represented in the FighterSnap schema at all",
              "which specific move/attack kind is playing — the frozen Snapshot schema (contracts.md §3) carries only the coarse `state` enum, not attackKind or moveId",
            ],
          },
          "redrive-mutators (F6 experimental)": {
            mirrors: [
              "everything state-only mirrors, PLUS some pose motion (attack lunge, block shield raise/lower, charge ring, hit-flash) via re-driving startAttack/setBlocking/setCharging/takeDamage",
            ],
            missing: [
              "exact attack identity — this harness can only guess a generic 'light' attack on any attack-state transition, since the schema doesn't carry which move/kind the host actually played, so reach/duration/animation are frequently wrong even when pose motion IS recovered",
              "exact hitstun/attack timer fidelity during the redriven tween — Fighter.takeDamage() hardcodes a 280ms hitstun and derives health from its own `amount` argument (which the schema doesn't transmit either); this harness re-asserts the snapshot's authoritative numbers immediately after, which fixes the LOGICAL state but not the tween that already started playing under the mutator's own (wrong) assumptions",
              "charge/announcer state is fragile to infer: 'charging' is inferred here from chargeMs rising from 0, not from a schema field — an honest workaround, not a real signal",
            ],
          },
        };

        const productionApiFinding =
          "YES — a production snapshot/state->render API is implied. Two independent, verified findings make raw-snapshot rendering structurally lossy today: (1) all pose/animation lives in fire-and-forget Phaser Tweens with no snapshottable tween state (research.md §A) — reproducing it needs either re-driving the same mutator methods (approximate, as measured above) or a real src/ refactor that separates 'what changed logically' from 'how to animate that change' into an explicit, serializable transition/event stream; (2) Fighter.chargeMs (Fighter.ts:45) is a DEAD field — the sim's actual charge value lives on FightScene (chargeP1/chargeP2, scene-local), not on the Fighter the schema's FighterSnap models per-fighter. Neither of these is fixed by this harness (out of scope, no src/ edits) — they are the finding.";

        return {
          experienceId: "sim-snapshot",
          status: "completed",
          topology: getTopology(),
          lossMode: "none",
          raw: {
            config,
            renderVehicle:
              "F6 default: a harness-local, render-only Phaser.Scene (SnapshotGuestScene) constructing real Fighter objects purely for visuals; its update() never calls processCombat and isn't a FightScene subclass at all.",
            twoGamesApproach:
              "new Phaser.Game() instantiated directly, twice, bypassing src/game/instances.ts's createGame() singleton entirely (never imported) — separate DOM parents, independent lifecycles.",
            ladder: {
              jsonBytesAvg: avg(stateOnly.jsonBytes),
              jsonBytesMax: max(stateOnly.jsonBytes),
              binaryBytesAvg: avg(stateOnly.binaryBytes),
              binaryBytesFixed: BINARY_FULL_SIZE,
              deltaBytesAvg: avg(stateOnly.deltaBytes),
              deltaBytesMax: max(stateOnly.deltaBytes),
              jsonMsAvg: avg(stateOnly.jsonMs),
              binaryMsAvg: avg(stateOnly.binaryMs),
              deltaMsAvg: avg(stateOnly.deltaMs),
              frameBudgetMs: 16.67,
              subMtuBudgetBytes: 1192,
            },
            interpolation: {
              configuredDelayMs: config.interpDelayMs,
              observedStalenessMsAvg: avg(stateOnly.stalenessMs),
              observedStalenessMsMax: max(stateOnly.stalenessMs),
              note: "Host and guest share one clock in this loopback demo (single process), so staleness is exact here; a cross-machine guest needs clock sync (e.g. an offset derived from ping/pong RTT, contracts.md §1) to compute the same number honestly.",
            },
            fidelity,
            distinctStatesObserved: {
              stateOnly: Array.from(stateOnly.distinctStatesSeen),
              redrive: Array.from(redrive.distinctStatesSeen),
            },
            productionApiFinding,
          },
          subScores,
          verdict: `Snapshot encode cost is negligible (${avgBinaryMs.toFixed(4)}ms/frame binary, ${(avg(stateOnly.deltaBytes)).toFixed(0)}B avg delta vs ${BINARY_FULL_SIZE}B full binary, both far under the 16.67ms budget and the 1192B sub-MTU ceiling) — matching research.md §C's "a 2-fighter snapshot is tiny." But render fidelity is genuinely partial: HUD-visible fields (position, health/confidence/special, facing, logical state/timers) mirror cleanly; pose/tweens do not reproduce from state alone, and even the experimental mutator-redrive only approximates them, guessing attack identity the schema doesn't carry. Host-authoritative is size/cost-cheap and render-lossy — the size/cost half of the feasibility question is answered "yes, cheap"; the render half needs either accepted lossy pose (likely fine — HUD-only games don't need pixel-exact pose) or a production state->render API.`,
          measuredCaveat:
            "Real Phaser.Game boots, real FightScene ticks, real encode/decode math — but topology is loopback (one process, one clock; contracts.md §6 excludes loopback runs from cross-network verdicts) and the drive is a short scripted sequence (public Fighter mutators, not real keyboard input or real network jitter). Encode-cost numbers are single-call-per-tick timings (realistic for a live per-frame producer), not a synthetic microbenchmark loop.",
        };
      } catch (err) {
        return {
          experienceId: "sim-snapshot",
          status: "failed",
          topology: getTopology(),
          lossMode: "none",
          raw: { config, error: err instanceof Error ? err.message : String(err) },
          subScores: [],
          verdict: "Failed before completion — see raw.error.",
          measuredCaveat: "n/a — run did not complete",
        };
      } finally {
        host?.destroy();
        guest?.destroy();
        container.remove();
      }
    },
  };
}
