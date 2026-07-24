import { describe, expect, it, vi } from "vitest";
import type { Transport, WireMessage } from "../contracts";
import { LoopbackTransport } from "./loopback";
import { createLoopbackWebSocketTransport } from "./ws";
import { createLoopbackWebRTCTransport } from "./webrtc";

/**
 * Contract-level conformance test for any `Transport` implementation.
 * The port assumes NO ordering/reliability guarantees (Decision 3's
 * Tier-1 invariant) — this suite only asserts round-trip delivery and
 * state-change notification, never message order across `send` calls.
 */
function conformanceSuite(name: string, makeSolo: () => Transport) {
  describe(`Transport conformance: ${name}`, () => {
    it("has the frozen `kind` discriminant", () => {
      const t = makeSolo();
      expect(["ws", "webrtc-unreliable", "webrtc-reliable", "loopback"]).toContain(
        t.kind,
      );
    });

    it("delivers a state to a listener registered before open", async () => {
      const t = makeSolo();
      const states: string[] = [];
      t.onStateChange((s) => states.push(s));
      await vi.waitFor(() => expect(states).toContain("open"));
    });

    it("delivers current state immediately to a late subscriber", async () => {
      const t = makeSolo();
      const early: string[] = [];
      t.onStateChange((s) => early.push(s));
      await vi.waitFor(() => expect(early).toContain("open"));

      const late: string[] = [];
      t.onStateChange((s) => late.push(s));
      expect(late).toEqual(["open"]);
    });

    it("round-trips a message sent through `send` to `onMessage`", async () => {
      const t = makeSolo();
      const received: WireMessage[] = [];
      t.onMessage((m) => received.push(m));

      const msg: WireMessage = { t: "ping", seq: 1, t0: 123 };
      t.send(msg);

      await vi.waitFor(() => expect(received).toHaveLength(1));
      expect(received[0]).toEqual(msg);
    });

    it("round-trips every WireMessage variant used by the port", async () => {
      const t = makeSolo();
      const received: WireMessage[] = [];
      t.onMessage((m) => received.push(m));

      const messages: WireMessage[] = [
        {
          t: "input",
          seq: 1,
          tick: 10,
          buttons: { left: true, right: false, block: false, charge: false },
          edges: { light: true, heavy: false, special: false },
          tSent: performance.now(),
        },
        {
          t: "snapshot",
          tick: 10,
          hostTime: performance.now(),
          p1LastInputSeq: 1,
          p2LastInputSeq: 1,
          round: 1,
          countdown: 0,
          winner: 0,
          fighters: [
            {
              x: 0,
              vx: 0,
              health: 100,
              confidence: 0,
              special: 0,
              state: "idle",
              facingRight: true,
              attackTimer: 0,
              hitstunTimer: 0,
              chargeMs: 0,
            },
            {
              x: 100,
              vx: 0,
              health: 100,
              confidence: 0,
              special: 0,
              state: "idle",
              facingRight: false,
              attackTimer: 0,
              hitstunTimer: 0,
              chargeMs: 0,
            },
          ],
        },
        { t: "pong", seq: 1, t0: 123 },
        {
          t: "run",
          experienceId: "placeholder",
          config: {},
          action: "start",
        },
      ];

      for (const m of messages) t.send(m);

      await vi.waitFor(() => expect(received).toHaveLength(messages.length));
      expect(received).toEqual(messages);
    });

    it("does not deliver anything after close()", async () => {
      const t = makeSolo();
      const received: WireMessage[] = [];
      t.onMessage((m) => received.push(m));
      t.close(1000);
      t.send({ t: "ping", seq: 1, t0: 0 });
      await new Promise((r) => setTimeout(r, 10));
      expect(received).toHaveLength(0);
    });

    it("notifies onStateChange of close()", async () => {
      const t = makeSolo();
      const states: string[] = [];
      t.onStateChange((s) => states.push(s));
      t.close();
      await vi.waitFor(() => expect(states).toContain("closed"));
    });
  });
}

conformanceSuite("LoopbackTransport (solo echo)", () => new LoopbackTransport());

// 008.3 adapters — solo/self-echo fixtures (no real server/signaling; see
// `createLoopbackWebSocketTransport`/`createLoopbackWebRTCTransport`'s own
// docs). Both must pass this shared suite unchanged, per the sub-spec DoD.
conformanceSuite("WebSocketTransport (solo self-echo)", () => createLoopbackWebSocketTransport());
conformanceSuite("WebRTCTransport unreliable (solo self-echo)", () =>
  createLoopbackWebRTCTransport("unreliable"),
);
conformanceSuite("WebRTCTransport reliable (solo self-echo)", () =>
  createLoopbackWebRTCTransport("reliable"),
);

describe("LoopbackTransport.createPair", () => {
  it("delivers messages sent on one end to the other end only", async () => {
    const [a, b] = LoopbackTransport.createPair();
    const aReceived: WireMessage[] = [];
    const bReceived: WireMessage[] = [];
    a.onMessage((m) => aReceived.push(m));
    b.onMessage((m) => bReceived.push(m));

    a.send({ t: "ping", seq: 1, t0: 1 });

    await vi.waitFor(() => expect(bReceived).toHaveLength(1));
    expect(aReceived).toHaveLength(0);
    expect(bReceived[0]).toEqual({ t: "ping", seq: 1, t0: 1 });
  });

  it("is symmetric — both ends can send and receive", async () => {
    const [a, b] = LoopbackTransport.createPair();
    const aReceived: WireMessage[] = [];
    const bReceived: WireMessage[] = [];
    a.onMessage((m) => aReceived.push(m));
    b.onMessage((m) => bReceived.push(m));

    a.send({ t: "pong", seq: 1, t0: 1 });
    b.send({ t: "pong", seq: 2, t0: 2 });

    await vi.waitFor(() => {
      expect(aReceived).toHaveLength(1);
      expect(bReceived).toHaveLength(1);
    });
  });
});
