/**
 * 008.5 build item 5 — "measure guest felt input lag the honest way":
 * timestamp the guest input event (`recordSent`, called at the moment the
 * guest's `input` wire message is sent — the input `event`/queue timestamp,
 * BEFORE any simulated network delay is added), attribute the rendered
 * response via the snapshot's `lastInputSeq` (contracts.md §3), and record
 * the delta at the committed `requestAnimationFrame` (`attribute`, called
 * once per rAF with whatever `lastInputSeq` the just-applied, interpolated
 * snapshot carries for THIS guest's own controlled player).
 *
 * Each guest button press contributes exactly one sample. When the rendered
 * `lastInputSeq` JUMPS (the host consumed several presses in a burst between
 * two committed guest frames — common when the host outruns the guest's 60Hz
 * rAF), EVERY skipped seq in the gap that has a recorded send is attributed at
 * this frame's timestamp (they all first became visible to the guest on THIS
 * render). The earlier "latest-seq-only" behavior discarded the skipped ones,
 * turning ~20 presses into ~4 samples and starving the distribution (§ P1).
 */
const MAX_TRACKED_SENDS = 4000;

export class FeltLagTracker {
  private readonly tSentBySeq = new Map<number, number>();
  private lastAttributedSeq = -1;
  readonly samplesMs: number[] = [];

  recordSent(seq: number, tSent: number): void {
    this.tSentBySeq.set(seq, tSent);
    if (this.tSentBySeq.size > MAX_TRACKED_SENDS) {
      const oldestKey = this.tSentBySeq.keys().next().value;
      if (oldestKey !== undefined) this.tSentBySeq.delete(oldestKey);
    }
  }

  /** Call once per committed rAF, with the just-rendered snapshot's `lastInputSeq` for THIS guest's own player. */
  attribute(lastInputSeq: number, nowMs: number): number | null {
    if (lastInputSeq <= this.lastAttributedSeq) return null;
    // Attribute EVERY recorded send in the newly-visible gap (not just the
    // latest) — on a seq jump the skipped presses all became visible now.
    let lastLag: number | null = null;
    for (let seq = this.lastAttributedSeq + 1; seq <= lastInputSeq; seq++) {
      const tSent = this.tSentBySeq.get(seq);
      if (tSent === undefined) continue; // never sent by this player (or evicted)
      const lagMs = nowMs - tSent;
      this.samplesMs.push(lagMs);
      this.tSentBySeq.delete(seq);
      lastLag = lagMs;
    }
    this.lastAttributedSeq = lastInputSeq;
    return lastLag;
  }

  get sampleCount(): number {
    return this.samplesMs.length;
  }
}
