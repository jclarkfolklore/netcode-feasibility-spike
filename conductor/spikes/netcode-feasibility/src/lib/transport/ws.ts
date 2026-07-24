import type { Role } from "../contracts";
import type { Transport, TransportState, WireMessage } from "../contracts";

/**
 * The subset of the native `WebSocket` interface this transport depends on.
 * A real `WebSocket` satisfies this directly; tests inject a fake that
 * implements the same shape (dependency-injection seam — no mocking
 * library, no new dependency).
 */
export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

const WS_OPEN = 1;

export interface WebSocketTransportOptions {
  room: string;
  role: Role;
  /** Defaults to `wss?://<host>/ws?room=&role=` — the PROTOCOL.md endpoint. */
  url?: string;
  /** DI seam for tests/solo use — defaults to `(url) => new WebSocket(url)`. */
  wsFactory?: (url: string) => WebSocketLike;
  /**
   * Auto-reply `pong` (echoing `t0` verbatim) on receipt of a `ping`
   * (contracts.md §1 peer-echo RTT, PROTOCOL.md's `/ws` note). Defaults to
   * true for real use; the conformance suite's solo/self-echo fixture turns
   * it off so a solo `ping` round-trip isn't doubled by its own echo.
   */
  autoReplyToPing?: boolean;
}

function defaultWsUrl(room: string, role: Role): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws?room=${encodeURIComponent(room)}&role=${role}`;
}

/**
 * `Transport` backed by a native `WebSocket` to the 008.2 `/ws` relay.
 *
 * The relay is opaque (forwards frames verbatim, unparsed) — this class is
 * where the peer-echo `ping`/`pong` rule (contracts.md §1, F9) actually
 * lives: on receiving a `ping` this transport replies `pong` echoing `t0`,
 * so RTT is computed by the *original sender* as `now() - t0`, entirely
 * client-side and skew-immune (PROTOCOL.md `/ws` section).
 */
export class WebSocketTransport implements Transport {
  readonly kind = "ws" as const;

  private socket: WebSocketLike;
  private readonly autoReplyToPing: boolean;
  private messageHandlers: ((msg: WireMessage) => void)[] = [];
  private stateHandlers: ((s: TransportState, detail?: string) => void)[] = [];
  private state: TransportState = "connecting";
  private closed = false;

  constructor(opts: WebSocketTransportOptions) {
    this.autoReplyToPing = opts.autoReplyToPing ?? true;
    const url = opts.url ?? defaultWsUrl(opts.room, opts.role);
    const factory = opts.wsFactory ?? ((u: string) => new WebSocket(u) as unknown as WebSocketLike);
    this.socket = factory(url);

    this.socket.onopen = () => this.setState("open");
    this.socket.onmessage = (ev) => this.handleFrame(ev.data);
    this.socket.onclose = (ev) => {
      this.closed = true;
      this.setState("closed", ev?.reason || (ev?.code !== undefined ? `code ${ev.code}` : undefined));
    };
    this.socket.onerror = () => {
      // Native WebSocket always follows an error with a close event; state
      // transition is handled there so we don't double-report.
    };
  }

  private handleFrame(data: unknown): void {
    if (this.closed) return;
    let msg: WireMessage;
    try {
      msg = JSON.parse(String(data)) as WireMessage;
    } catch {
      return; // malformed frame — the relay is opaque, so this can happen; drop it.
    }

    if (this.autoReplyToPing && msg.t === "ping") {
      this.send({ t: "pong", seq: msg.seq, t0: msg.t0 });
    }
    for (const cb of this.messageHandlers) cb(msg);
  }

  send(msg: WireMessage): void {
    if (this.closed) return;
    if (this.socket.readyState !== WS_OPEN) return;
    this.socket.send(JSON.stringify(msg));
  }

  onMessage(cb: (msg: WireMessage) => void): void {
    this.messageHandlers.push(cb);
  }

  onStateChange(cb: (s: TransportState, detail?: string) => void): void {
    this.stateHandlers.push(cb);
    cb(this.state); // late-subscriber conformance
  }

  close(code?: number): void {
    if (this.closed) return;
    this.closed = true;
    this.socket.close(code);
    this.setState("closed", code !== undefined ? `code ${code}` : undefined);
  }

  private setState(s: TransportState, detail?: string): void {
    this.state = s;
    for (const cb of this.stateHandlers) cb(s, detail);
  }
}

/**
 * A `WebSocketLike` fake that echoes whatever it "sends" back to its own
 * `onmessage`, asynchronously (never synchronously in-line with `send`,
 * matching `LoopbackTransport`'s solo-mode contract). No real socket, no
 * server dependency — used only by the conformance suite and as a
 * zero-server local-dev fallback.
 */
class SelfEchoSocket implements WebSocketLike {
  // Open immediately so a fresh solo instance can `send()` right away
  // (matching `LoopbackTransport`'s solo mode, which never gates `send` on
  // connection state — only real sockets need the readyState guard). The
  // `onopen` *event*/state notification still fires on its own microtask
  // below, for the separate state-change conformance checks.
  readyState = WS_OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  private closed = false;

  constructor() {
    queueMicrotask(() => {
      if (this.closed) return;
      this.onopen?.();
    });
  }

  send(data: string): void {
    if (this.closed) return;
    queueMicrotask(() => {
      if (this.closed) return;
      this.onmessage?.({ data });
    });
  }

  close(code?: number, reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.onclose?.({ code: code ?? 1000, reason: reason ?? "" });
  }
}

/**
 * Solo/self-echo `WebSocketTransport` — no real server. Used by the
 * transport conformance suite (`transport.conformance.test.ts`) and
 * available for a zero-server smoke check.
 */
export function createLoopbackWebSocketTransport(): WebSocketTransport {
  return new WebSocketTransport({
    room: "solo",
    role: "host",
    url: "solo:",
    wsFactory: () => new SelfEchoSocket(),
    autoReplyToPing: false,
  });
}
