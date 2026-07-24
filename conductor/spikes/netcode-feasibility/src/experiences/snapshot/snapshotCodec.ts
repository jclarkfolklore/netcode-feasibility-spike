/**
 * 008.4 — snapshot capture + the serialization ladder (contracts.md §3):
 * JSON first (prove the loop) -> hand-packed DataView -> delta vs the last
 * snapshot. Pure functions, no Phaser dependency, so this module is fully
 * unit-testable under jsdom/vitest (booting a real Phaser.Game is not —
 * see hostScene.ts/guestScene.ts, exercised only in the live browser page).
 */
import type {
  FightScene,
} from "../../../../../../src/game/scenes/FightScene";
import type { Fighter } from "../../../../../../src/game/entities/Fighter";
import type {
  FighterSnap,
  FighterStateKind,
  Snapshot,
} from "../../lib/contracts";

// ---------------------------------------------------------------------------
// Capture — read the live sim's LOGICAL fields into the frozen Snapshot shape.
// ---------------------------------------------------------------------------

/**
 * `FightScene.p1`/`p2`/`countdown`/`winner`/`round`/`chargeP1`/`chargeP2` are
 * declared `private` — a TypeScript-only, compile-time restriction (not a
 * runtime `#private` field), so a type-only cast reaches them without
 * modifying `src/`. The same technique is already used by this harness's own
 * `determinismHarness.ts` (casting a stub to `Fighter`) and by
 * `src/game/scenes/PreviewScene.ts` itself (driving `Fighter`'s public
 * mutators externally) — an established pattern in this codebase, not a new
 * risk introduced here.
 */
interface FightSceneInternals {
  p1: Fighter;
  p2: Fighter;
  countdown: number;
  winner: 1 | 2 | null;
  round: number;
  /**
   * FINDING: `Fighter.chargeMs` (Fighter.ts:45) is a dead field — it is
   * declared and read (Fighter.ts:171, the `growing_power` reach bonus) but
   * NEVER written. The actual accumulating charge duration lives as two
   * plain numbers scoped to `FightScene` itself (`chargeP1`/`chargeP2`,
   * FightScene.ts:31-32, threaded through `processCombat`'s `setCharge`
   * callback). The frozen Snapshot schema's `FighterSnap.chargeMs` implies
   * "this lives on the fighter" — it doesn't; it lives on the scene. A
   * production snapshot API would need to either promote this to a real
   * `Fighter` field or have the producer reach past the fighter into scene
   * state, exactly as this harness does below.
   */
  chargeP1: number;
  chargeP2: number;
}

function internals(scene: FightScene): FightSceneInternals {
  return scene as unknown as FightSceneInternals;
}

function captureFighter(f: Fighter, chargeMs: number): FighterSnap {
  return {
    x: f.sprite.x,
    vx: f.body.velocity.x,
    health: f.health,
    confidence: f.confidence,
    special: f.specialMeter,
    state: f.state,
    facingRight: f.facingRight,
    attackTimer: f.attackTimer,
    hitstunTimer: f.hitstunTimer,
    chargeMs,
  };
}

/** Produce one `Snapshot` (contracts.md §3) from the real running `FightScene`. */
export function captureSnapshot(
  scene: FightScene,
  tick: number,
  hostTime: number,
  p1LastInputSeq: number,
  p2LastInputSeq: number,
): Snapshot {
  const s = internals(scene);
  return {
    t: "snapshot",
    tick,
    hostTime,
    p1LastInputSeq,
    p2LastInputSeq,
    round: s.round,
    countdown: s.countdown,
    winner: s.winner === null ? 0 : s.winner,
    fighters: [captureFighter(s.p1, s.chargeP1), captureFighter(s.p2, s.chargeP2)],
  };
}

// ---------------------------------------------------------------------------
// Rung 1 — JSON
// ---------------------------------------------------------------------------

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function encodeJSON(snap: Snapshot): { bytes: Uint8Array; size: number } {
  const bytes = textEncoder.encode(JSON.stringify(snap));
  return { bytes, size: bytes.byteLength };
}

export function decodeJSON(bytes: Uint8Array): Snapshot {
  return JSON.parse(textDecoder.decode(bytes)) as Snapshot;
}

// ---------------------------------------------------------------------------
// Rung 2 — hand-packed DataView (fixed layout, little-endian)
// ---------------------------------------------------------------------------

const STATE_KINDS: FighterStateKind[] = [
  "idle",
  "walk",
  "attack",
  "block",
  "hitstun",
  "ko",
];

function stateToByte(state: FighterStateKind): number {
  const idx = STATE_KINDS.indexOf(state);
  return idx < 0 ? 0 : idx;
}

function byteToState(byte: number): FighterStateKind {
  return STATE_KINDS[byte] ?? "idle";
}

/** header: tick(u32) hostTime(f64) p1Seq(u32) p2Seq(u32) round(u8) countdown(u8) winner(u8) = 23B */
export const HEADER_SIZE = 4 + 8 + 4 + 4 + 1 + 1 + 1;
/** per fighter: x(f32) vx(f32) health(u16) confidence(u8) special(u8) state(u8) facing(u8) attackTimer(u16) hitstunTimer(u16) chargeMs(u16) = 20B */
export const FIGHTER_SIZE = 4 + 4 + 2 + 1 + 1 + 1 + 1 + 2 + 2 + 2;
export const BINARY_FULL_SIZE = HEADER_SIZE + FIGHTER_SIZE * 2;

function writeFighter(view: DataView, offset: number, f: FighterSnap): number {
  view.setFloat32(offset, f.x, true);
  offset += 4;
  view.setFloat32(offset, f.vx, true);
  offset += 4;
  view.setUint16(offset, Math.max(0, Math.round(f.health)), true);
  offset += 2;
  view.setUint8(offset, Math.max(0, Math.min(255, Math.round(f.confidence))));
  offset += 1;
  view.setUint8(offset, Math.max(0, Math.min(255, Math.round(f.special))));
  offset += 1;
  view.setUint8(offset, stateToByte(f.state));
  offset += 1;
  view.setUint8(offset, f.facingRight ? 1 : 0);
  offset += 1;
  view.setUint16(offset, Math.max(0, Math.min(65535, Math.round(f.attackTimer))), true);
  offset += 2;
  view.setUint16(offset, Math.max(0, Math.min(65535, Math.round(f.hitstunTimer))), true);
  offset += 2;
  view.setUint16(offset, Math.max(0, Math.min(65535, Math.round(f.chargeMs))), true);
  offset += 2;
  return offset;
}

function readFighter(view: DataView, offset: number): { snap: FighterSnap; offset: number } {
  const x = view.getFloat32(offset, true);
  offset += 4;
  const vx = view.getFloat32(offset, true);
  offset += 4;
  const health = view.getUint16(offset, true);
  offset += 2;
  const confidence = view.getUint8(offset);
  offset += 1;
  const special = view.getUint8(offset);
  offset += 1;
  const state = byteToState(view.getUint8(offset));
  offset += 1;
  const facingRight = view.getUint8(offset) === 1;
  offset += 1;
  const attackTimer = view.getUint16(offset, true);
  offset += 2;
  const hitstunTimer = view.getUint16(offset, true);
  offset += 2;
  const chargeMs = view.getUint16(offset, true);
  offset += 2;
  return {
    snap: { x, vx, health, confidence, special, state, facingRight, attackTimer, hitstunTimer, chargeMs },
    offset,
  };
}

export function encodeBinary(snap: Snapshot): { bytes: Uint8Array; size: number } {
  const buf = new ArrayBuffer(BINARY_FULL_SIZE);
  const view = new DataView(buf);
  let offset = 0;
  view.setUint32(offset, snap.tick >>> 0, true);
  offset += 4;
  view.setFloat64(offset, snap.hostTime, true);
  offset += 8;
  view.setUint32(offset, snap.p1LastInputSeq >>> 0, true);
  offset += 4;
  view.setUint32(offset, snap.p2LastInputSeq >>> 0, true);
  offset += 4;
  view.setUint8(offset, snap.round);
  offset += 1;
  view.setUint8(offset, snap.countdown);
  offset += 1;
  view.setUint8(offset, snap.winner);
  offset += 1;
  offset = writeFighter(view, offset, snap.fighters[0]);
  offset = writeFighter(view, offset, snap.fighters[1]);
  return { bytes: new Uint8Array(buf), size: buf.byteLength };
}

export function decodeBinary(bytes: Uint8Array): Snapshot {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const tick = view.getUint32(offset, true);
  offset += 4;
  const hostTime = view.getFloat64(offset, true);
  offset += 8;
  const p1LastInputSeq = view.getUint32(offset, true);
  offset += 4;
  const p2LastInputSeq = view.getUint32(offset, true);
  offset += 4;
  const round = view.getUint8(offset);
  offset += 1;
  const countdown = view.getUint8(offset);
  offset += 1;
  const winner = view.getUint8(offset) as 0 | 1 | 2;
  offset += 1;
  const f1 = readFighter(view, offset);
  offset = f1.offset;
  const f2 = readFighter(view, offset);
  offset = f2.offset;
  return {
    t: "snapshot",
    tick,
    hostTime,
    p1LastInputSeq,
    p2LastInputSeq,
    round,
    countdown,
    winner,
    fighters: [f1.snap, f2.snap],
  };
}

// ---------------------------------------------------------------------------
// Rung 3 — delta vs the last snapshot
// ---------------------------------------------------------------------------

/**
 * One bit per changed field, in a fixed order. `tick`+`hostTime` are always
 * sent in full (16B) since they change every tick and the guest's
 * interpolation buffer needs `hostTime` regardless; everything else is
 * change-gated. 25 fields fits comfortably in a u32 bitmask.
 */
interface FieldSpec {
  size: number;
  changed(prev: Snapshot, curr: Snapshot): boolean;
  write(view: DataView, offset: number, snap: Snapshot): void;
  read(view: DataView, offset: number, out: MutableDelta): void;
}

interface MutableDelta {
  p1LastInputSeq?: number;
  p2LastInputSeq?: number;
  round?: number;
  countdown?: number;
  winner?: 0 | 1 | 2;
  f1: Partial<FighterSnap>;
  f2: Partial<FighterSnap>;
}

function fighterFieldSpec<K extends keyof FighterSnap>(
  which: 0 | 1,
  key: K,
  size: number,
  write: (view: DataView, offset: number, value: FighterSnap[K]) => void,
  read: (view: DataView, offset: number) => FighterSnap[K],
): FieldSpec {
  return {
    size,
    changed: (prev, curr) => prev.fighters[which][key] !== curr.fighters[which][key],
    write: (view, offset, snap) => write(view, offset, snap.fighters[which][key]),
    read: (view, offset, out) => {
      const target = which === 0 ? out.f1 : out.f2;
      (target as Record<string, unknown>)[key] = read(view, offset);
    },
  };
}

const FIELD_SPECS: FieldSpec[] = [
  {
    size: 4,
    changed: (p, c) => p.p1LastInputSeq !== c.p1LastInputSeq,
    write: (v, o, s) => v.setUint32(o, s.p1LastInputSeq >>> 0, true),
    read: (v, o, out) => (out.p1LastInputSeq = v.getUint32(o, true)),
  },
  {
    size: 4,
    changed: (p, c) => p.p2LastInputSeq !== c.p2LastInputSeq,
    write: (v, o, s) => v.setUint32(o, s.p2LastInputSeq >>> 0, true),
    read: (v, o, out) => (out.p2LastInputSeq = v.getUint32(o, true)),
  },
  {
    size: 1,
    changed: (p, c) => p.round !== c.round,
    write: (v, o, s) => v.setUint8(o, s.round),
    read: (v, o, out) => (out.round = v.getUint8(o)),
  },
  {
    size: 1,
    changed: (p, c) => p.countdown !== c.countdown,
    write: (v, o, s) => v.setUint8(o, s.countdown),
    read: (v, o, out) => (out.countdown = v.getUint8(o)),
  },
  {
    size: 1,
    changed: (p, c) => p.winner !== c.winner,
    write: (v, o, s) => v.setUint8(o, s.winner),
    read: (v, o, out) => (out.winner = v.getUint8(o) as 0 | 1 | 2),
  },
  ...([0, 1] as const).flatMap((which) => [
    fighterFieldSpec(which, "x", 4, (v, o, val) => v.setFloat32(o, val, true), (v, o) => v.getFloat32(o, true)),
    fighterFieldSpec(which, "vx", 4, (v, o, val) => v.setFloat32(o, val, true), (v, o) => v.getFloat32(o, true)),
    fighterFieldSpec(
      which,
      "health",
      2,
      (v, o, val) => v.setUint16(o, Math.max(0, Math.round(val)), true),
      (v, o) => v.getUint16(o, true),
    ),
    fighterFieldSpec(
      which,
      "confidence",
      1,
      (v, o, val) => v.setUint8(o, Math.max(0, Math.min(255, Math.round(val)))),
      (v, o) => v.getUint8(o),
    ),
    fighterFieldSpec(
      which,
      "special",
      1,
      (v, o, val) => v.setUint8(o, Math.max(0, Math.min(255, Math.round(val)))),
      (v, o) => v.getUint8(o),
    ),
    fighterFieldSpec(which, "state", 1, (v, o, val) => v.setUint8(o, stateToByte(val)), (v, o) => byteToState(v.getUint8(o))),
    fighterFieldSpec(
      which,
      "facingRight",
      1,
      (v, o, val) => v.setUint8(o, val ? 1 : 0),
      (v, o) => v.getUint8(o) === 1,
    ),
    fighterFieldSpec(
      which,
      "attackTimer",
      2,
      (v, o, val) => v.setUint16(o, Math.max(0, Math.min(65535, Math.round(val))), true),
      (v, o) => v.getUint16(o, true),
    ),
    fighterFieldSpec(
      which,
      "hitstunTimer",
      2,
      (v, o, val) => v.setUint16(o, Math.max(0, Math.min(65535, Math.round(val))), true),
      (v, o) => v.getUint16(o, true),
    ),
    fighterFieldSpec(
      which,
      "chargeMs",
      2,
      (v, o, val) => v.setUint16(o, Math.max(0, Math.min(65535, Math.round(val))), true),
      (v, o) => v.getUint16(o, true),
    ),
  ]),
];

if (FIELD_SPECS.length > 32) {
  throw new Error("delta bitmask assumes <=32 fields");
}

/** Max possible delta size: tick+hostTime+bitmask header + every field changed. */
export const DELTA_MAX_SIZE =
  4 + 8 + 4 + FIELD_SPECS.reduce((sum, f) => sum + f.size, 0);

export interface DeltaResult {
  bytes: Uint8Array;
  size: number;
  changedFieldCount: number;
}

/** `prev === null` means "first frame" — everything is sent (a full keyframe). */
export function encodeDelta(prev: Snapshot | null, curr: Snapshot): DeltaResult {
  const buf = new ArrayBuffer(DELTA_MAX_SIZE);
  const view = new DataView(buf);
  let offset = 0;
  view.setUint32(offset, curr.tick >>> 0, true);
  offset += 4;
  view.setFloat64(offset, curr.hostTime, true);
  offset += 8;

  let bitmask = 0;
  let changedFieldCount = 0;
  const changedFlags = FIELD_SPECS.map((field, i) => {
    const changed = !prev || field.changed(prev, curr);
    if (changed) {
      bitmask |= 1 << i;
      changedFieldCount += 1;
    }
    return changed;
  });

  const bitmaskOffset = offset;
  offset += 4; // written after we know it, but position is fixed
  view.setUint32(bitmaskOffset, bitmask >>> 0, true);

  for (let i = 0; i < FIELD_SPECS.length; i++) {
    if (!changedFlags[i]) continue;
    FIELD_SPECS[i].write(view, offset, curr);
    offset += FIELD_SPECS[i].size;
  }

  return { bytes: new Uint8Array(buf, 0, offset), size: offset, changedFieldCount };
}

/** Applies a delta on top of the last known FULL snapshot to reconstruct the current one. */
export function decodeDelta(prevFull: Snapshot, bytes: Uint8Array): Snapshot {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const tick = view.getUint32(offset, true);
  offset += 4;
  const hostTime = view.getFloat64(offset, true);
  offset += 8;
  const bitmask = view.getUint32(offset, true);
  offset += 4;

  const out: MutableDelta = { f1: {}, f2: {} };
  for (let i = 0; i < FIELD_SPECS.length; i++) {
    if (!(bitmask & (1 << i))) continue;
    FIELD_SPECS[i].read(view, offset, out);
    offset += FIELD_SPECS[i].size;
  }

  return {
    t: "snapshot",
    tick,
    hostTime,
    p1LastInputSeq: out.p1LastInputSeq ?? prevFull.p1LastInputSeq,
    p2LastInputSeq: out.p2LastInputSeq ?? prevFull.p2LastInputSeq,
    round: out.round ?? prevFull.round,
    countdown: out.countdown ?? prevFull.countdown,
    winner: out.winner ?? prevFull.winner,
    fighters: [
      { ...prevFull.fighters[0], ...out.f1 },
      { ...prevFull.fighters[1], ...out.f2 },
    ],
  };
}

// ---------------------------------------------------------------------------
// Per-frame production cost
// ---------------------------------------------------------------------------

export interface EncodeCostSample {
  jsonMs: number;
  jsonBytes: number;
  binaryMs: number;
  binaryBytes: number;
  deltaMs: number;
  deltaBytes: number;
}

/** Times ONE real call to each rung, exactly as a live per-tick producer would pay for it. */
export function measureEncodeCost(prev: Snapshot | null, curr: Snapshot): EncodeCostSample {
  const t0 = performance.now();
  const json = encodeJSON(curr);
  const t1 = performance.now();
  const binary = encodeBinary(curr);
  const t2 = performance.now();
  const delta = encodeDelta(prev, curr);
  const t3 = performance.now();
  return {
    jsonMs: t1 - t0,
    jsonBytes: json.size,
    binaryMs: t2 - t1,
    binaryBytes: binary.size,
    deltaMs: t3 - t2,
    deltaBytes: delta.size,
  };
}
