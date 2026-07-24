/**
 * Server-side wire types.
 *
 * `WireMessage` (input/snapshot/ping/pong/run/result) is the client<->client
 * payload the `/ws` relay forwards **opaquely** — the server never parses it
 * beyond `JSON.parse`/`JSON.stringify` for logging; it does not implement
 * any part of the `Transport` port itself. See `server/PROTOCOL.md`.
 *
 * `SignalingMessage` is this sub-spec's own envelope for bootstrapping a
 * WebRTC `RTCPeerConnection` (SDP + ICE) between exactly two peers. It is
 * NOT defined in `contracts.md` (only the `ping`/`pong` peer-echo relay
 * rule is normative there) — this is 008.2's own design, documented in
 * `server/PROTOCOL.md` for the 008.3 worker who will build the client side.
 */

export type Role = "host" | "guest";

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

/** Loss-injection proxy state, exposed over `/api/loss`. */
export interface LossState {
  enabled: boolean;
  /** 0-1 fraction of forwarded chunks withheld while enabled. */
  dropRate: number;
}
