/**
 * 008.4 — F7: the guest interpolation buffer. Without this, "how far behind
 * is the rendered opponent" isn't a measurable term at all — this class is
 * what makes it one (research.md §C: guests interpolate into the past by
 * design; 008.5 needs the same rendered-timestamp tracking for felt input
 * lag attribution).
 */
import type { Snapshot } from "../../lib/contracts";

const MAX_BUFFERED = 300; // ~5s at 60Hz — plenty for 0/50/100ms interp delays.

export class InterpolationBuffer {
  private buf: Snapshot[] = [];
  private renderedHostTime = 0;
  private renderedTick = -1;

  push(snap: Snapshot): void {
    this.buf.push(snap);
    if (this.buf.length > MAX_BUFFERED) this.buf.shift();
  }

  get size(): number {
    return this.buf.length;
  }

  clear(): void {
    this.buf = [];
    this.renderedHostTime = 0;
    this.renderedTick = -1;
  }

  /**
   * Returns the newest buffered snapshot whose `hostTime` is at or before
   * `hostNow - delayMs` — the classic "render `delayMs` in the past" guest
   * interpolation window. `null` if the buffer has nothing that old yet
   * (still filling / delay set higher than what's been produced).
   */
  sampleAt(hostNow: number, delayMs: number): Snapshot | null {
    const targetTime = hostNow - delayMs;
    let chosen: Snapshot | null = null;
    for (const s of this.buf) {
      if (s.hostTime <= targetTime) chosen = s;
      else break;
    }
    if (chosen) {
      this.renderedHostTime = chosen.hostTime;
      this.renderedTick = chosen.tick;
    }
    return chosen;
  }

  get lastRenderedTick(): number {
    return this.renderedTick;
  }

  /** Oldest/newest `hostTime` currently buffered (0 if empty) — diagnostics only:
   * lets the guest see whether its interp target window falls inside the buffered
   * span at all (a starved sampler vs a mis-estimated clock). */
  get oldestHostTime(): number {
    return this.buf.length ? this.buf[0].hostTime : 0;
  }
  get newestHostTime(): number {
    return this.buf.length ? this.buf[this.buf.length - 1].hostTime : 0;
  }

  /**
   * The stale-opponent visualization (F7): how far behind the host's clock
   * the currently-rendered snapshot is. In this loopback demo host and guest
   * share one clock (single process), so this is exact; a real cross-machine
   * guest would need clock sync (e.g. an NTP-style offset from the `ping`/
   * `pong` RTT exchange, contracts.md §1) to compute the same number honestly.
   */
  staleness(hostNow: number): number {
    if (this.renderedTick < 0) return 0;
    return hostNow - this.renderedHostTime;
  }
}
