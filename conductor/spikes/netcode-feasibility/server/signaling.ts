import type { IncomingMessage } from "node:http";
import type { WebSocket, WebSocketServer } from "ws";
import { RoomRegistry } from "./rooms.js";
import { log } from "./logger.js";
import type { Role, SignalingMessage } from "./types.js";

/**
 * `/signal?room=<id>&role=<host|guest>` — WebRTC signaling relay (SDP
 * offer/answer + ICE candidates), pairing exactly two peers per room.
 * Separate connection/endpoint from `/ws`: once signaling completes, media
 * (the DataChannels carrying `input`/`snapshot`/`ping`/`pong`, and the
 * separate reliable-ordered channel for `run`/`result`) flows peer-to-peer
 * and never touches this server again. See `server/PROTOCOL.md` for the
 * full envelope and the glare-avoidance rule.
 */
export function attachSignaling(wss: WebSocketServer): void {
  const rooms = new RoomRegistry<WebSocket>();
  const roleOf = new WeakMap<WebSocket, { room: string; role: Role }>();

  function send(socket: WebSocket, msg: SignalingMessage): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  }

  wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const room = url.searchParams.get("room");
    const requestedRole = (url.searchParams.get("role") as Role | null) ?? undefined;

    if (!room) {
      send(socket, { t: "error", code: "missing-room", message: "missing ?room=" });
      socket.close(4001, "missing ?room=");
      return;
    }

    const { role, evicted } = rooms.join(room, requestedRole, socket);
    if (evicted) {
      // Last-writer-wins (see rooms.ts): a reconnecting signaling socket bumps
      // its stale predecessor rather than being rejected.
      log("signal.replaced", { room, role });
      send(evicted, { t: "error", code: "replaced", message: "replaced by a newer connection" });
      evicted.close(4003, "replaced by a newer connection");
    }
    roleOf.set(socket, { room, role });

    const peer = () => rooms.peerOf(room, role);

    log("signal.join", { room, role, paired: rooms.bothPresent(room) });
    send(socket, { t: "joined", role, peerPresent: rooms.bothPresent(room) });
    const existingPeer = peer();
    if (existingPeer) send(existingPeer, { t: "peer-joined" });

    socket.on("message", (data) => {
      let msg: SignalingMessage;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        send(socket, { t: "error", code: "bad-json", message: "invalid JSON" });
        return;
      }

      // Glare avoidance (F9): role assignment is deterministic
      // (first-join = host by default) and this relay enforces a fixed
      // offerer/answerer split — only `host` may send `offer`, only
      // `guest` may send `answer` — so two peers can never race to send
      // simultaneous offers ("glare") in this exactly-two-peer model.
      // This sidesteps needing a full perfect-negotiation polite/impolite
      // state machine; it is a structural simplification available
      // *because* rooms are pinned to exactly two named roles, not a
      // general n-peer mesh.
      if (msg.t === "offer" && role !== "host") {
        send(socket, {
          t: "error",
          code: "offer-from-guest",
          message: "only host may send an offer",
        });
        return;
      }
      if (msg.t === "answer" && role !== "guest") {
        send(socket, {
          t: "error",
          code: "answer-from-host",
          message: "only guest may send an answer",
        });
        return;
      }

      // join is handled purely by upgrade-time query params, not relayed.
      if (msg.t === "join") return;

      const other = peer();
      // Log negotiation milestones (not ICE candidate spam beyond a marker).
      if (msg.t === "offer" || msg.t === "answer" || msg.t === "ice-failed") {
        log("signal.relay", { room, from: role, type: msg.t, delivered: !!other });
      }
      if (other) send(other, msg);
      // else: peer not yet connected — offers/candidates sent before the
      // peer joins are silently dropped (renegotiation-from-scratch on
      // the client is out of scope for this spike); ICE-failure is still
      // surfaced because it's generated only after both sides connected.
    });

    socket.on("close", () => {
      // Identity-guarded (see rooms.ts): a bumped predecessor's late close must
      // not evict the newcomer's seat nor fire a spurious peer-left.
      if (!rooms.leave(room, role, socket)) return;
      log("signal.leave", { room, role });
      const other = peer();
      if (other) send(other, { t: "peer-left" });
    });
  });
}
