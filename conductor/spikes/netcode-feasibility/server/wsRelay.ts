import type { IncomingMessage } from "node:http";
import type { WebSocket, WebSocketServer } from "ws";
import { RoomRegistry } from "./rooms.js";
import { log } from "./logger.js";
import type { Role } from "./types.js";

/** Per-room, per-direction traffic counters, flushed periodically to the log. */
interface RoomTraffic {
  hostMsgs: number;
  hostBytes: number;
  guestMsgs: number;
  guestBytes: number;
}

/**
 * `/ws?room=<id>&role=<host|guest>` — the relay backing `kind: 'ws'`
 * transports (contracts.md §1).
 *
 * The relay is deliberately **opaque to `WireMessage`**: every text frame
 * received from one peer is forwarded byte-for-byte to the other peer in
 * the room, unparsed. This is what makes the peer-echo `ping`/`pong` rule
 * (contracts.md §1: "the server's WS relay forwards `ping`/`pong` to the
 * peer; the *peer* echoes") fall out for free — the server never
 * special-cases `ping`, it just relays; the client-side `WebSocketTransport`
 * (008.3) is the one that, on receiving a `{t:'ping', ...}`, replies with a
 * `{t:'pong', t0: <same t0>}` which this same relay forwards back
 * unmodified. See `server/PROTOCOL.md`.
 *
 * Peer-disconnect handling: a 2-peer room is meaningless with one peer, so
 * when either socket closes, the relay closes the other with code 4000
 * ("peer left") — the client's own `onStateChange` reacts to its own
 * socket closing; the server never invents a `WireMessage` for this.
 */
export function attachWsRelay(wss: WebSocketServer): RoomRegistry<WebSocket> {
  const rooms = new RoomRegistry<WebSocket>();
  const traffic = new Map<string, RoomTraffic>();

  // Periodic throughput summary — one line per active room every 2s, so the
  // tail shows real bidirectional flow without a line per 60Hz frame.
  const flush = setInterval(() => {
    for (const [room, t] of traffic) {
      if (t.hostMsgs === 0 && t.guestMsgs === 0) continue;
      log("ws.throughput", {
        room,
        "host->guest": `${t.hostMsgs}msg/${t.hostBytes}B`,
        "guest->host": `${t.guestMsgs}msg/${t.guestBytes}B`,
        window: "2s",
      });
      traffic.set(room, { hostMsgs: 0, hostBytes: 0, guestMsgs: 0, guestBytes: 0 });
    }
  }, 2000);
  if (typeof flush.unref === "function") flush.unref();

  wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const room = url.searchParams.get("room");
    const requestedRole = (url.searchParams.get("role") as Role | null) ?? undefined;

    if (!room) {
      socket.close(4001, "missing ?room=");
      return;
    }

    const role = rooms.join(room, requestedRole, socket);
    if (!role) {
      log("ws.reject", { room, requestedRole, reason: "role-taken" });
      socket.close(4002, "role already seated in room");
      return;
    }
    log("ws.connect", { room, role, paired: rooms.bothPresent(room) });
    if (rooms.bothPresent(room)) log("ws.paired", { room });
    if (!traffic.has(room)) {
      traffic.set(room, { hostMsgs: 0, hostBytes: 0, guestMsgs: 0, guestBytes: 0 });
    }

    // TCP_NODELAY is set on the raw socket at `upgrade` time, in
    // `server/index.ts`, before `ws` ever wraps it — see the note there for
    // why (Nagle coalescing skews the WS baseline vs. WebRTC's unbuffered
    // unreliable channel).

    socket.on("message", (data, isBinary) => {
      const peer = rooms.peerOf(room, role);
      if (peer && peer.readyState === peer.OPEN) {
        peer.send(data, { binary: isBinary });
      }
      const t = traffic.get(room);
      if (t) {
        const bytes = typeof data === "string" ? Buffer.byteLength(data) : (data as Buffer).length;
        if (role === "host") {
          t.hostMsgs++;
          t.hostBytes += bytes;
        } else {
          t.guestMsgs++;
          t.guestBytes += bytes;
        }
      }
    });

    socket.on("close", () => {
      rooms.leave(room, role);
      log("ws.disconnect", { room, role });
      const peer = rooms.peerOf(room, role);
      peer?.close(4000, "peer left");
      if (!rooms.bothPresent(room) && !peer) traffic.delete(room);
    });
  });

  return rooms;
}
