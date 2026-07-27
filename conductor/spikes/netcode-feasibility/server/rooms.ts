import type { Role } from "./types.js";

/**
 * Generic exactly-two-peer room registry (contracts.md §6 pairing).
 *
 * Used independently by both the `/ws` relay and the `/signal` relay —
 * each endpoint has its own `RoomRegistry` instance (a peer's WS-relay
 * socket and its signaling socket are two separate connections), but both
 * key rooms by the same `?room=` id from the URL, so "room aa42 on /ws"
 * and "room aa42 on /signal" refer to the same logical two-player match.
 *
 * Role assignment: first peer to join a room becomes `host` unless it
 * explicitly requests `guest`; the room rejects a third peer and rejects a
 * duplicate role.
 */
export class RoomRegistry<Peer> {
  private rooms = new Map<string, Partial<Record<Role, Peer>>>();

  /**
   * Seat `peer` into `roomId` under `requestedRole` with LAST-WRITER-WINS:
   * the newest connection always takes the seat, and any peer previously
   * seated in that role is returned as `evicted` so the caller can close it.
   *
   * Rationale (spike reliability): the old "first-come, reject the newcomer"
   * rule made reload/reopen fragile — a reloading tab's fresh socket was
   * rejected (`role-taken`) until the stale socket's close finally propagated,
   * so a STALE/cached tab kept the seat while the fresh one spun in a
   * reject→reconnect loop. Bumping instead means "the tab you just opened is
   * the one that's connected", every time. The identity-guarded `leave` below
   * ensures the evicted socket's later close event can't tear down the seat the
   * newcomer now holds.
   */
  join(roomId: string, requestedRole: Role | undefined, peer: Peer): { role: Role; evicted?: Peer } {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = {};
      this.rooms.set(roomId, room);
    }
    const role: Role = requestedRole ?? (room.host ? "guest" : "host");
    const evicted = room[role];
    room[role] = peer;
    return evicted && evicted !== peer ? { role, evicted } : { role };
  }

  /** The other peer in the room, if present and seated. */
  peerOf(roomId: string, role: Role): Peer | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;
    const otherRole: Role = role === "host" ? "guest" : "host";
    return room[otherRole];
  }

  bothPresent(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    return !!room && !!room.host && !!room.guest;
  }

  /**
   * Vacate `role` in `roomId` — but ONLY if `peer` is still the seated socket.
   * A bumped (last-writer-wins) socket fires its `close` event AFTER the
   * newcomer has taken the seat; without this identity guard that late close
   * would evict the newcomer. Returns whether a seat was actually vacated, so
   * the caller can skip peer-notification for a stale bumped socket.
   */
  leave(roomId: string, role: Role, peer?: Peer): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    if (peer !== undefined && room[role] !== peer) return false; // already replaced — not ours to vacate
    delete room[role];
    if (!room.host && !room.guest) this.rooms.delete(roomId);
    return true;
  }

  size(): number {
    return this.rooms.size;
  }
}
