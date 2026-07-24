/**
 * 008.5 — the guest->host consumer half of the input seam (contracts.md §2,
 * F3). `RemoteInput implements InputProvider` so `NetFightScene` can swap it
 * straight into `FightScene`'s inherited `keyboard` field (contracts.md §7)
 * with zero `CombatSystem`/`FightScene` changes.
 *
 * Exactly-once edge contract: `light`/`heavy`/`special` are `JustDown` edges
 * upstream (`InputManager.ts:42-45,53-56`) — a real key press is delivered
 * over the wire as exactly ONE `input` message with that edge `true`. This
 * class must reproduce "true on first read, false thereafter" without ever
 * dropping or doubling a press, even across dropped/late/out-of-order
 * network frames. The technique: an ingest-side delay-staging area (the
 * "input-delay ring buffer" the sub-spec calls for) feeding a strict FIFO —
 * `getInput()` dequeues at most ONE frame per call, so one wire message maps
 * to exactly one edge-delivery event. Never level-mirror a queued edge.
 */
import type { InputProvider } from "../../../../../../src/game/systems/InputManager";
import { EMPTY_INPUT, type PlayerInput } from "../../../../../../src/game/types";
import type { ButtonState, EdgeState, WireMessage } from "../../lib/contracts";

export type InputWireMessage = Extract<WireMessage, { t: "input" }>;

interface QueuedFrame {
  seq: number;
  tick: number;
  buttons: ButtonState;
  edges: EdgeState;
  tSent: number;
}

const NEUTRAL_BUTTONS: ButtonState = { left: false, right: false, block: false, charge: false };

/**
 * Consumes `input` wire messages for ONE player slot and honors the
 * exactly-once edge contract. `delayMs` is the input-delay knob (spec item
 * 2/3): messages are staged for `delayMs` before becoming consumable,
 * smoothing/normalizing arrival jitter into a fixed, predictable delay —
 * the same "delay-based" trick research.md §C describes for the symmetric
 * host-side knob, applied here to the remote (network) side.
 */
export class RemoteInput implements InputProvider {
  private staged: { releaseAt: number; frame: QueuedFrame }[] = [];
  private queue: QueuedFrame[] = [];
  private lastButtons: ButtonState = { ...NEUTRAL_BUTTONS };
  private lastSeqConsumed = -1;
  private lastFrameConsumed: QueuedFrame | null = null;

  constructor(
    private readonly player: 1 | 2,
    private delayMs = 0,
  ) {}

  setDelayMs(ms: number): void {
    this.delayMs = Math.max(0, ms);
  }

  get configuredDelayMs(): number {
    return this.delayMs;
  }

  /** Called once per received `input` message (from the transport's `onMessage`). */
  ingest(msg: InputWireMessage, now: number = performance.now()): void {
    this.staged.push({
      releaseAt: now + this.delayMs,
      frame: { seq: msg.seq, tick: msg.tick, buttons: msg.buttons, edges: msg.edges, tSent: msg.tSent },
    });
  }

  /**
   * Promotes delay-elapsed staged frames into the consumable FIFO, in
   * arrival order. Call once per host tick, BEFORE `getInput` runs for this
   * tick (contracts.md §7 — `NetFightScene.update()` calls this ahead of
   * `super.update()`).
   */
  releaseDue(now: number = performance.now()): void {
    while (this.staged.length && this.staged[0].releaseAt <= now) {
      this.queue.push(this.staged.shift()!.frame);
    }
  }

  /**
   * Missing/late frame -> last level state, all edges false (contracts.md
   * §2). A present frame is dequeued exactly once — its edges are reported
   * true on THIS call only; the frame is gone from the queue afterward, so
   * it can never be re-read/doubled, and skipping it (network gap) can
   * never resurrect a stale attack.
   */
  getInput(player: 1 | 2): PlayerInput {
    if (player !== this.player) return { ...EMPTY_INPUT };

    const next = this.queue.shift();
    if (!next) {
      return {
        ...this.lastButtons,
        light: false,
        heavy: false,
        special: false,
      };
    }

    this.lastButtons = { ...next.buttons };
    this.lastSeqConsumed = next.seq;
    this.lastFrameConsumed = next;
    return {
      left: next.buttons.left,
      right: next.buttons.right,
      block: next.buttons.block,
      charge: next.buttons.charge,
      light: next.edges.light,
      heavy: next.edges.heavy,
      special: next.edges.special,
    };
  }

  /** Last wire `seq` actually incorporated into a sim tick — feeds Snapshot's `p{1,2}LastInputSeq` (contracts.md §3). */
  get lastConsumedSeq(): number {
    return this.lastSeqConsumed;
  }

  /** `tSent` of the last consumed frame — the guest-side timestamp felt-lag attribution needs. */
  get lastConsumedTSent(): number | null {
    return this.lastFrameConsumed?.tSent ?? null;
  }

  get pendingCount(): number {
    return this.staged.length + this.queue.length;
  }
}
