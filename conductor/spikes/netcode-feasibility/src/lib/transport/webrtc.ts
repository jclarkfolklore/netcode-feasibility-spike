import type { Role } from "../contracts";
import type { Transport, TransportState, WireMessage } from "../contracts";
import type { WebSocketLike } from "./ws";

/**
 * The subset of `RTCDataChannel` this transport depends on. A real
 * `RTCDataChannel` satisfies this directly; tests inject a fake with the
 * same shape (dependency-injection seam — no mocking library, no new
 * dependency, and no real network in unit tests).
 */
export interface RTCDataChannelLike {
  readyState: "connecting" | "open" | "closing" | "closed";
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

/**
 * `/signal` envelope (server/PROTOCOL.md — "this sub-spec's own design, not
 * in contracts.md"). Transcribed verbatim from the protocol doc.
 */
export type SignalingMessage =
  | { t: "join"; room: string; role: Role }
  | { t: "joined"; role: Role; peerPresent: boolean }
  | { t: "peer-joined" }
  | { t: "peer-left" }
  | { t: "offer"; sdp: string }
  | { t: "answer"; sdp: string }
  | { t: "ice-candidate"; candidate: unknown }
  | { t: "ice-failed"; detail?: string }
  | { t: "error"; code: string; message: string };

export type WebRTCMode = "unreliable" | "reliable";

export interface WebRTCTransportOptions {
  room: string;
  role: Role;
  /** unordered+maxRetransmits:0 ("UDP-like") vs default ordered-reliable. */
  mode: WebRTCMode;
  /** Defaults to `ws?://<host>/signal?room=&role=` — the PROTOCOL.md endpoint. */
  signalUrl?: string;
  iceServers?: RTCIceServer[];
  /** Same peer-echo-pong toggle as `WebSocketTransport`; see there. */
  autoReplyToPing?: boolean;
  /**
   * DI/test seam: supply both channels directly and skip real
   * signaling/`RTCPeerConnection` entirely. Used by the conformance suite's
   * solo/self-echo fixture and by unit tests.
   */
  channels?: { data: RTCDataChannelLike; control: RTCDataChannelLike };
  /** DI seam for the `/signal` socket (tests only; ignored if `channels` given). */
  signalFactory?: (url: string) => WebSocketLike;
  /** DI seam for `RTCPeerConnection` construction (tests only; ignored if `channels` given). */
  peerConnectionFactory?: (config: RTCConfiguration) => RTCPeerConnection;
}

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

function defaultSignalUrl(room: string, role: Role): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/signal?room=${encodeURIComponent(room)}&role=${role}`;
}

/**
 * `Transport` backed by a native `RTCPeerConnection` DataChannel, P2P after
 * `/signal` signaling completes (server/PROTOCOL.md). Two isolated modes so
 * the cause of any gap is isolable (spec item 2):
 *
 * - `mode: "unreliable"` — `{ordered:false, maxRetransmits:0}`, UDP-like.
 * - `mode: "reliable"` — default ordered-reliable DataChannel options.
 *
 * Per contracts.md §1, a SEPARATE reliable-ordered channel always carries
 * `run`/`result` (control-plane), regardless of `mode` — `input`/`snapshot`/
 * `ping` always go on the mode-selected channel. `kind` reflects `mode`
 * (`webrtc-unreliable` | `webrtc-reliable`) so results tag which was used.
 */
export class WebRTCTransport implements Transport {
  readonly kind: "webrtc-unreliable" | "webrtc-reliable";

  private readonly autoReplyToPing: boolean;
  private readonly mode: WebRTCMode;
  private dataChannel: RTCDataChannelLike | null = null;
  private controlChannel: RTCDataChannelLike | null = null;
  private pc: RTCPeerConnection | null = null;
  private signalSocket: WebSocketLike | null = null;
  private messageHandlers: ((msg: WireMessage) => void)[] = [];
  private stateHandlers: ((s: TransportState, detail?: string) => void)[] = [];
  private state: TransportState = "connecting";
  private closed = false;
  private openChannels = 0;

  constructor(opts: WebRTCTransportOptions) {
    this.mode = opts.mode;
    this.kind = opts.mode === "unreliable" ? "webrtc-unreliable" : "webrtc-reliable";
    this.autoReplyToPing = opts.autoReplyToPing ?? true;

    if (opts.channels) {
      this.dataChannel = opts.channels.data;
      this.controlChannel = opts.channels.control;
      this.wireChannel(this.dataChannel);
      this.wireChannel(this.controlChannel);
      return;
    }

    this.setupReal(opts);
  }

  // -- real signaling + RTCPeerConnection path -------------------------------

  private setupReal(opts: WebRTCTransportOptions): void {
    const iceServers = opts.iceServers ?? DEFAULT_ICE_SERVERS;
    const pcFactory = opts.peerConnectionFactory ?? ((config) => new RTCPeerConnection(config));
    const pc = pcFactory({ iceServers });
    this.pc = pc;

    const signalUrl = opts.signalUrl ?? defaultSignalUrl(opts.room, opts.role);
    const signalFactory =
      opts.signalFactory ?? ((url: string) => new WebSocket(url) as unknown as WebSocketLike);
    const socket = signalFactory(signalUrl);
    this.signalSocket = socket;

    const sendSignal = (msg: SignalingMessage) => {
      if (socket.readyState === 1) socket.send(JSON.stringify(msg));
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate) sendSignal({ t: "ice-candidate", candidate: ev.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") {
        sendSignal({ t: "ice-failed", detail: "connectionState=failed" });
        this.setState("closed", "ice-failed");
      }
    };

    const doOffer = async () => {
      const dcOptions: RTCDataChannelInit =
        this.mode === "unreliable" ? { ordered: false, maxRetransmits: 0 } : {};
      const data = pc.createDataChannel("data", dcOptions) as unknown as RTCDataChannelLike;
      const control = pc.createDataChannel("control", {}) as unknown as RTCDataChannelLike;
      this.dataChannel = data;
      this.controlChannel = control;
      this.wireChannel(data);
      this.wireChannel(control);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignal({ t: "offer", sdp: offer.sdp ?? "" });
    };

    pc.ondatachannel = (ev) => {
      const channel = ev.channel as unknown as RTCDataChannelLike;
      if (ev.channel.label === "data") {
        this.dataChannel = channel;
        this.wireChannel(channel);
      } else if (ev.channel.label === "control") {
        this.controlChannel = channel;
        this.wireChannel(channel);
      }
    };

    socket.onopen = () => {
      // no-op: role/room already conveyed via the connect-time query string
      // (server/PROTOCOL.md — `join` is accepted-but-ignored by the relay).
    };
    socket.onmessage = (ev) => {
      let msg: SignalingMessage;
      try {
        msg = JSON.parse(String(ev.data)) as SignalingMessage;
      } catch {
        return;
      }
      void this.handleSignal(msg, pc, opts.role, doOffer, sendSignal);
    };
    socket.onclose = () => {
      if (!this.closed) this.setState("closed", "signal socket closed");
    };
    socket.onerror = () => {};
  }

  private async handleSignal(
    msg: SignalingMessage,
    pc: RTCPeerConnection,
    role: Role,
    doOffer: () => Promise<void>,
    sendSignal: (m: SignalingMessage) => void,
  ): Promise<void> {
    switch (msg.t) {
      case "joined":
        // Host: guest may already be seated (race) — only host offers
        // (PROTOCOL.md glare-avoidance: fixed offerer/answerer split).
        if (role === "host" && msg.peerPresent) await doOffer();
        return;
      case "peer-joined":
        if (role === "host") await doOffer();
        return;
      case "offer": {
        if (role !== "guest") return;
        await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal({ t: "answer", sdp: answer.sdp ?? "" });
        return;
      }
      case "answer":
        if (role !== "host") return;
        await pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
        return;
      case "ice-candidate":
        try {
          await pc.addIceCandidate(msg.candidate as RTCIceCandidateInit);
        } catch {
          // candidates that arrive before the remote description is set
          // are best-effort here — a full ICE-candidate queue is out of
          // scope for this spike (PROTOCOL.md documents the simplification).
        }
        return;
      case "peer-left":
        this.setState("closed", "peer left");
        return;
      case "ice-failed":
        this.setState("closed", `peer ice-failed: ${msg.detail ?? ""}`);
        return;
      case "error":
        this.setState("closed", `signal error: ${msg.code}`);
        return;
    }
  }

  // -- shared channel wiring --------------------------------------------------

  private wireChannel(ch: RTCDataChannelLike): void {
    ch.onopen = () => {
      this.openChannels += 1;
      if (this.openChannels >= 2) this.setState("open");
    };
    ch.onmessage = (ev) => this.handleFrame(ev.data);
    ch.onclose = () => {
      this.closed = true;
      this.setState("closed", "channel closed");
    };
    ch.onerror = () => {};
  }

  private handleFrame(data: unknown): void {
    if (this.closed) return;
    let msg: WireMessage;
    try {
      msg = JSON.parse(String(data)) as WireMessage;
    } catch {
      return;
    }

    if (this.autoReplyToPing && msg.t === "ping") {
      this.send({ t: "pong", seq: msg.seq, t0: msg.t0 });
    }
    for (const cb of this.messageHandlers) cb(msg);
  }

  send(msg: WireMessage): void {
    if (this.closed) return;
    // run/result are control-plane (contracts.md §1); everything else rides
    // the mode-selected channel.
    const channel = msg.t === "run" || msg.t === "result" ? this.controlChannel : this.dataChannel;
    if (!channel || channel.readyState !== "open") return;
    channel.send(JSON.stringify(msg));
  }

  onMessage(cb: (msg: WireMessage) => void): void {
    this.messageHandlers.push(cb);
  }

  onStateChange(cb: (s: TransportState, detail?: string) => void): void {
    this.stateHandlers.push(cb);
    cb(this.state);
  }

  close(code?: number): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.dataChannel?.close();
    } catch {
      /* best-effort */
    }
    try {
      this.controlChannel?.close();
    } catch {
      /* best-effort */
    }
    try {
      this.pc?.close();
    } catch {
      /* best-effort */
    }
    try {
      this.signalSocket?.close(code);
    } catch {
      /* best-effort */
    }
    this.setState("closed", code !== undefined ? `code ${code}` : undefined);
  }

  private setState(s: TransportState, detail?: string): void {
    if (this.state === s) return;
    this.state = s;
    for (const cb of this.stateHandlers) cb(s, detail);
  }
}

/**
 * A `RTCDataChannelLike` fake that echoes whatever it "sends" back to its
 * own `onmessage`, asynchronously — mirrors `LoopbackTransport`/
 * `SelfEchoSocket`'s solo-mode contract. No real peer connection, no
 * signaling, no STUN.
 */
class SelfEchoDataChannel implements RTCDataChannelLike {
  // Open immediately — see `SelfEchoSocket`'s comment in `ws.ts` for why:
  // `send()` should not be gated on connection state for a solo/self-echo
  // fixture, only the `onopen` event/state notification is deferred.
  readyState: "connecting" | "open" | "closing" | "closed" = "open";
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  private closedFlag = false;

  constructor() {
    queueMicrotask(() => {
      if (this.closedFlag) return;
      this.onopen?.();
    });
  }

  send(data: string): void {
    if (this.closedFlag) return;
    queueMicrotask(() => {
      if (this.closedFlag) return;
      this.onmessage?.({ data });
    });
  }

  close(): void {
    if (this.closedFlag) return;
    this.closedFlag = true;
    this.readyState = "closed";
    this.onclose?.();
  }
}

/**
 * Solo/self-echo `WebRTCTransport` — no real signaling, no STUN, no peer.
 * Used by the conformance suite (`transport.conformance.test.ts`).
 */
export function createLoopbackWebRTCTransport(mode: WebRTCMode = "unreliable"): WebRTCTransport {
  return new WebRTCTransport({
    room: "solo",
    role: "host",
    mode,
    channels: { data: new SelfEchoDataChannel(), control: new SelfEchoDataChannel() },
    autoReplyToPing: false,
  });
}
