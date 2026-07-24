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
   * Attempt to seat `peer` into `roomId` under `requestedRole`.
   * Returns the assigned role, or `null` if the room already has that role
   * seated (rejected — caller should close the connection with an error).
   */
  join(roomId: string, requestedRole: Role | undefined, peer: Peer): Role | null {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = {};
      this.rooms.set(roomId, room);
    }
    const role: Role = requestedRole ?? (room.host ? "guest" : "host");
    if (room[role]) return null; // seat taken — reject, don't silently bump
    room[role] = peer;
    return role;
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

  leave(roomId: string, role: Role): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    delete room[role];
    if (!room.host && !room.guest) this.rooms.delete(roomId);
  }

  size(): number {
    return this.rooms.size;
  }
}
