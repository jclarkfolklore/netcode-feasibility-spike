import { describe, it, expect } from "vitest";
import { RoomRegistry } from "./rooms.js";

/**
 * Contract of the last-writer-wins seat (the reliability fix): a reloading /
 * reopening peer must ALWAYS win the seat, and a bumped predecessor's late
 * close must never evict the newcomer or fire a spurious peer-notification.
 */
describe("RoomRegistry — last-writer-wins seating", () => {
  it("assigns host to the first peer and guest to the second", () => {
    const r = new RoomRegistry<string>();
    expect(r.join("room", undefined, "a")).toEqual({ role: "host" });
    expect(r.join("room", undefined, "b")).toEqual({ role: "guest" });
    expect(r.bothPresent("room")).toBe(true);
  });

  it("BUMPS a stale socket instead of rejecting the newcomer", () => {
    const r = new RoomRegistry<string>();
    r.join("room", "guest", "old-guest");
    const res = r.join("room", "guest", "new-guest");
    // newcomer is seated; the old socket is handed back for the caller to close.
    expect(res.role).toBe("guest");
    expect(res.evicted).toBe("old-guest");
    expect(r.peerOf("room", "host")).toBe("new-guest"); // seat now holds the newcomer
  });

  it("does NOT report an eviction when the same peer rejoins its own seat", () => {
    const r = new RoomRegistry<string>();
    r.join("room", "host", "a");
    expect(r.join("room", "host", "a")).toEqual({ role: "host" }); // no `evicted`
  });

  it("identity-guarded leave: a bumped socket's late close cannot evict the newcomer", () => {
    const r = new RoomRegistry<string>();
    r.join("room", "guest", "old-guest");
    r.join("room", "guest", "new-guest"); // bumps old-guest

    // old-guest's socket finally closes and calls leave — must be a no-op.
    expect(r.leave("room", "guest", "old-guest")).toBe(false);
    expect(r.peerOf("room", "host")).toBe("new-guest"); // newcomer still seated

    // the genuine current holder leaving DOES vacate.
    expect(r.leave("room", "guest", "new-guest")).toBe(true);
    expect(r.peerOf("room", "host")).toBeUndefined();
  });

  it("leave without a peer arg (legacy) still vacates unconditionally", () => {
    const r = new RoomRegistry<string>();
    r.join("room", "host", "a");
    expect(r.leave("room", "host")).toBe(true);
    expect(r.bothPresent("room")).toBe(false);
  });
});
