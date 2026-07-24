/**
 * 008.5 build item 4 — "support injected loss/latency" over the selected
 * transport. `LoopbackTransport` (and, in a live two-peer run, real network
 * latency on WS/WebRTC) don't by themselves give a controllable, repeatable
 * number for the loopback/solo-capable demo this sub-spec must also work
 * in — so this wraps ANY `Transport` with an artificial one-way delay +
 * jitter + app-layer payload-drop, applied on the SEND side (never
 * synchronous with `send`, matching every real `Transport`'s "no ordering/
 * reliability assumed" contract).
 *
 * This is `payload-drop` semantics (contracts.md §4) — it happens in the
 * app's own send path, not below a real transport layer, so it is NOT a
 * head-of-line-blocking measurement; that distinction is preserved in the
 * `ExperienceResult.lossMode` tag the experience sets.
 */
import type { Transport, TransportState, WireMessage } from "../../lib/contracts";

export interface SimulatedNetworkConfig {
  /** One-way base delay added before the wrapped transport's real `send` fires. */
  latencyMs: number;
  /** +/- jitter around `latencyMs`, uniformly distributed. */
  jitterMs: number;
  /** 0-100. Message is silently never sent (payload-drop, contracts.md §4). */
  dropPercent: number;
}

export const NO_SIMULATED_IMPAIRMENT: SimulatedNetworkConfig = {
  latencyMs: 0,
  jitterMs: 0,
  dropPercent: 0,
};

/** Wraps `inner` so every `send` is delayed/dropped per `config`; `onMessage`/`onStateChange`/`close` pass through untouched. */
export function wrapWithSimulatedNetwork(inner: Transport, config: SimulatedNetworkConfig): Transport {
  return {
    kind: inner.kind,
    send(msg: WireMessage): void {
      if (config.dropPercent > 0 && Math.random() * 100 < config.dropPercent) return;
      const jitter = config.jitterMs > 0 ? (Math.random() * 2 - 1) * config.jitterMs : 0;
      const delay = Math.max(0, config.latencyMs + jitter);
      if (delay === 0) {
        inner.send(msg);
        return;
      }
      setTimeout(() => inner.send(msg), delay);
    },
    onMessage(cb: (msg: WireMessage) => void): void {
      inner.onMessage(cb);
    },
    onStateChange(cb: (s: TransportState, detail?: string) => void): void {
      inner.onStateChange(cb);
    },
    close(code?: number): void {
      inner.close(code);
    },
  };
}
