import type { Role, Topology } from "../contracts";

/**
 * Pairing (contracts.md §6): room/role via `?room=&role=`. Explicit role
 * selection; default is first-join = host, which here just means "no role
 * param => host" since the harness has no server-side join order yet
 * (008.2 introduces the relay).
 */
export interface SessionInfo {
  room: string | null;
  role: Role;
  topology: Topology;
}

function inferTopology(room: string | null): Topology {
  if (!room) return "loopback";
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    // Two tabs on localhost both pointing at the same room — can't
    // distinguish from a single-tab loopback purely from the URL, so this
    // is the harness's best-effort default; individual experiences that
    // actually pair over a Transport can refine/override this tag once a
    // peer is confirmed `open`.
    return "same-machine-two-tabs";
  }
  // Deployed (Render) URL: assume WAN until an experience measures
  // otherwise. LAN is only reachable by explicit user configuration
  // (contracts.md §6 solo-dev fallback), not inferred here.
  return "WAN";
}

export function parseSession(
  search: string = typeof window !== "undefined" ? window.location.search : "",
): SessionInfo {
  const params = new URLSearchParams(search);
  const room = params.get("room");
  const roleParam = params.get("role");
  const role: Role = roleParam === "guest" ? "guest" : "host";
  return { room, role, topology: inferTopology(room) };
}

/** Builds a same-origin URL preserving room/role, for "copy invite link" UX. */
export function buildRoomUrl(room: string, role: Role): string {
  const url = new URL(window.location.href);
  url.searchParams.set("room", room);
  url.searchParams.set("role", role);
  return url.toString();
}
