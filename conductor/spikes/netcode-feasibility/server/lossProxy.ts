import net from "node:net";
import type { LossState } from "./types.js";

/**
 * In-process TCP proxy standing in for a toxiproxy sidecar (contracts.md §4,
 * spec F1). Real `toxiproxy` needs a separately-installed/managed binary;
 * this spike ships an equivalent proxy `server/index.ts` owns and starts
 * in-process, so `link-loss` is available with zero extra infra.
 *
 * **Mechanism (the honest part):** on toggle, each proxied TCP connection
 * gets a per-direction FIFO queue. Every inbound chunk is rolled against
 * `dropRate`; a "hit" chunk is held for `delayMs` before being written
 * onward, and — because the queue is strictly FIFO per connection — every
 * chunk queued behind it is held too, even if it didn't itself roll a hit.
 * That is real head-of-line blocking: it happens to the raw byte stream
 * *before* the WebSocket frame parser (or the app's `JSON.parse`) ever sees
 * it, exactly like real packet loss + TCP retransmission stalls delivery of
 * already-buffered-but-later bytes until the gap is filled. This is
 * different from `payload-drop` (contracts.md §4), which discards whole,
 * already-framed `WireMessage`s in the send path *after* the transport has
 * delivered them — no stream-level stall, no HOL blocking.
 *
 * This does **not** touch real IP packets — nothing is dropped at the
 * kernel/network layer, so it is not literally "below TCP." It reproduces
 * TCP's *externally observable* HOL-blocking behavior (in-order delivery,
 * arbitrary stall on loss) at the byte-forwarding layer instead. For a
 * result that also varies with real packet loss/reordering/jitter at the
 * IP layer, run toxiproxy for real, or (for the P2P WebRTC path, which
 * this proxy cannot reach at all — see PROTOCOL.md) use an OS network
 * conditioner (macOS Network Link Conditioner / Linux `tc netem`).
 *
 * All traffic on the public port passes through this proxy (static assets,
 * `/api/*`, `/ws`, `/signal`) — not just the WS leg — because during an
 * actual netcode experience run the WS/signaling connections are the only
 * long-lived streams in flight, so toggling loss only meaningfully affects
 * them in practice. Static page loads happen before/after a run, not
 * during, so this simplification does not leak into the measurements.
 */
export class LossProxy {
  private state: LossState = { enabled: false, dropRate: 0.15 };
  private readonly delayMs = 400;
  private server: net.Server | null = null;

  getState(): LossState {
    return { ...this.state };
  }

  setState(next: Partial<LossState>): LossState {
    if (typeof next.enabled === "boolean") this.state.enabled = next.enabled;
    if (typeof next.dropRate === "number") {
      this.state.dropRate = Math.min(1, Math.max(0, next.dropRate));
    }
    return this.getState();
  }

  /** Start listening on `publicPort`, forwarding to `targetPort` on localhost. */
  listen(publicPort: number, targetPort: number, host = "0.0.0.0"): void {
    this.server = net.createServer((client) => {
      const upstream = net.connect({ port: targetPort, host: "127.0.0.1" });

      this.pipeWithLoss(client, upstream);
      this.pipeWithLoss(upstream, client);

      const cleanup = () => {
        client.destroy();
        upstream.destroy();
      };
      client.on("error", cleanup);
      upstream.on("error", cleanup);
      client.on("close", () => upstream.destroy());
      upstream.on("close", () => client.destroy());
    });

    this.server.listen(publicPort, host);
  }

  close(): void {
    this.server?.close();
  }

  /** Forward `src` chunks onto `dest`, applying the FIFO delay-on-hit rule. */
  private pipeWithLoss(src: net.Socket, dest: net.Socket): void {
    let queue = Promise.resolve();

    src.on("data", (chunk: Buffer) => {
      const hit = this.state.enabled && Math.random() < this.state.dropRate;
      // Chain onto `queue` unconditionally — a non-hit chunk still waits
      // for any hit chunk queued ahead of it (FIFO = real HOL blocking).
      queue = queue.then(
        () =>
          new Promise<void>((resolve) => {
            const write = () => {
              if (!dest.destroyed) dest.write(chunk);
              resolve();
            };
            if (hit) setTimeout(write, this.delayMs);
            else write();
          }),
      );
    });
  }
}
