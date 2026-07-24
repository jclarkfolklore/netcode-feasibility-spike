import type { Transport, TransportState, WireMessage } from "../contracts";

type MessageHandler = (msg: WireMessage) => void;
type StateHandler = (s: TransportState, detail?: string) => void;

/**
 * In-process `Transport` for the `loopback` topology.
 *
 * Two modes, both honoring the port's "no ordering/reliability assumed"
 * contract by delivering asynchronously (a queued microtask), never
 * synchronously in-line with `send`:
 *
 * - Solo: `new LoopbackTransport()` echoes every sent message back to its
 *   own `onMessage` listeners. Used by the conformance test and by any
 *   experience that only needs "a" transport with no real peer.
 * - Paired: `LoopbackTransport.createPair()` returns two transports wired
 *   to each other, modeling one browser tab standing in for both host and
 *   guest roles (contracts.md §6 `loopback` topology).
 */
export class LoopbackTransport implements Transport {
  readonly kind = "loopback" as const;

  private messageHandlers: MessageHandler[] = [];
  private stateHandlers: StateHandler[] = [];
  private peer: LoopbackTransport | null = null;
  private state: TransportState = "connecting";
  private closed = false;

  static createPair(): [LoopbackTransport, LoopbackTransport] {
    const a = new LoopbackTransport();
    const b = new LoopbackTransport();
    a.peer = b;
    b.peer = a;
    queueMicrotask(() => {
      a.setState("open");
      b.setState("open");
    });
    return [a, b];
  }

  constructor() {
    // Solo mode auto-opens; paired mode's constructor-time "open" is
    // overwritten by createPair's own queued open above.
    queueMicrotask(() => {
      if (this.state === "connecting") this.setState("open");
    });
  }

  send(msg: WireMessage): void {
    if (this.closed) return;
    const target = this.peer ?? this;
    queueMicrotask(() => {
      for (const cb of target.messageHandlers) cb(msg);
    });
  }

  onMessage(cb: MessageHandler): void {
    this.messageHandlers.push(cb);
  }

  onStateChange(cb: StateHandler): void {
    this.stateHandlers.push(cb);
    // Conformance: a late subscriber still learns the current state.
    cb(this.state);
  }

  close(code?: number): void {
    if (this.closed) return;
    this.closed = true;
    this.setState("closed", code !== undefined ? `code ${code}` : undefined);
  }

  private setState(s: TransportState, detail?: string): void {
    this.state = s;
    for (const cb of this.stateHandlers) cb(s, detail);
  }
}
