/**
 * Frozen cross-sub-spec types, transcribed verbatim from
 * `conductor/tracks/008-netcode-feasibility_20260723/contracts.md`.
 *
 * This file is the single place these shapes are defined for the harness.
 * Do not redefine them elsewhere — import from here.
 */

// ---------------------------------------------------------------------------
// §2 — Input message + edge-trigger contract
// ---------------------------------------------------------------------------

/** Level-held booleans. */
export interface ButtonState {
  left: boolean;
  right: boolean;
  block: boolean;
  charge: boolean;
}

/** One-frame edges — JustDown semantics, must be delivered exactly once. */
export interface EdgeState {
  light: boolean;
  heavy: boolean;
  special: boolean;
}

// ---------------------------------------------------------------------------
// §3 — Snapshot schema
// ---------------------------------------------------------------------------

export type FighterStateKind =
  | "idle"
  | "walk"
  | "attack"
  | "block"
  | "hitstun"
  | "ko";

export interface FighterSnap {
  x: number;
  vx: number;
  health: number;
  confidence: number;
  special: number;
  state: FighterStateKind;
  facingRight: boolean;
  attackTimer: number;
  hitstunTimer: number;
  chargeMs: number;
}

export interface Snapshot {
  t: "snapshot";
  tick: number;
  hostTime: number; // producer performance.now()
  p1LastInputSeq: number;
  p2LastInputSeq: number;
  round: number;
  countdown: number;
  winner: 0 | 1 | 2;
  fighters: [FighterSnap, FighterSnap];
}

// ---------------------------------------------------------------------------
// §5 — ExperienceResult + status + scoring
// ---------------------------------------------------------------------------

export type ExperienceStatus = "completed" | "failed" | "skipped";

export type Topology =
  | "loopback"
  | "same-machine-two-tabs"
  | "LAN"
  | "WAN";

export type LossMode = "none" | "payload-drop" | "link-loss";

export type SubScoreKey =
  | "latency"
  | "jitter"
  | "loss-resilience"
  | "snapshot-cost"
  | "input-lag"
  | "determinism-readiness";

export type ScoreBand = "good" | "acceptable" | "bad";

export interface SubScore {
  key: SubScoreKey;
  /** 0-100. Scale is 0-100 everywhere — never 0-1. */
  value0to100: number;
  band: ScoreBand;
  weight: number;
  rationale: string;
}

export interface ExperienceResult {
  experienceId: string;
  /** Failures are shown, never averaged into the score. */
  status: ExperienceStatus;
  topology: Topology;
  lossMode: LossMode;
  /** Full distributions, per-cell data. */
  raw: Record<string, unknown>;
  subScores: SubScore[];
  verdict: string;
  measuredCaveat: string;
}

// ---------------------------------------------------------------------------
// §6 — Session, pairing & run orchestration
// ---------------------------------------------------------------------------

export type Role = "host" | "guest";

export interface RunControl {
  experienceId: string;
  config: Record<string, unknown>;
  action: "start" | "abort";
}

// ---------------------------------------------------------------------------
// §1 — Transport port
// ---------------------------------------------------------------------------

export type WireMessage =
  | {
      t: "input";
      seq: number;
      tick: number;
      buttons: ButtonState;
      edges: EdgeState;
      tSent: number;
    }
  | Snapshot
  | { t: "ping"; seq: number; t0: number; pad?: string }
  | { t: "pong"; seq: number; t0: number } // echoes t0 verbatim
  | ({ t: "run" } & RunControl)
  | { t: "result"; experienceId: string; result: ExperienceResult };

export type TransportState = "connecting" | "open" | "reconnecting" | "closed";

export interface Transport {
  /** Fire-and-forget; NO ordering/reliability assumed. */
  send(msg: WireMessage): void;
  onMessage(cb: (msg: WireMessage) => void): void;
  onStateChange(cb: (s: TransportState, detail?: string) => void): void;
  close(code?: number): void;
  readonly kind: "ws" | "webrtc-unreliable" | "webrtc-reliable" | "loopback";
}
