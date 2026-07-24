/**
 * A fixed-capacity, tick-indexed ring buffer. Shared plumbing for the
 * symmetric host-side input-delay knob (`delayedLocalInput.ts`) — bounded
 * memory regardless of session length, and a tick-match guard so a stale
 * wraparound slot is never mistaken for the requested tick.
 */
export class TickRing<T> {
  private readonly buf: ({ tick: number; value: T } | undefined)[];

  constructor(private readonly capacity = 600) {
    this.buf = new Array(capacity);
  }

  write(tick: number, value: T): void {
    const idx = ((tick % this.capacity) + this.capacity) % this.capacity;
    this.buf[idx] = { tick, value };
  }

  read(tick: number): T | undefined {
    if (tick < 0) return undefined;
    const idx = ((tick % this.capacity) + this.capacity) % this.capacity;
    const entry = this.buf[idx];
    return entry && entry.tick === tick ? entry.value : undefined;
  }
}
