# Server protocol (008.2)

One Node process, two long-lived WebSocket endpoints, one HTTP control
route, fronted by an in-process TCP proxy that can inject real link-level
loss. This is the normative reference for the 008.3 worker building
`WebSocketTransport` / `WebRTCTransport` against this server.

## Ports & topology

```
browser ──TCP──> LossProxy (PUBLIC_PORT, default 8080)
                     │  raw byte forward, optionally delayed (see "Loss injection")
                     ▼
                 app server (INTERNAL_PORT, default 8080+1, 127.0.0.1-only)
                     ├─ static files (dist/, incl. dist/data/announcer.json)
                     ├─ GET/POST /api/loss
                     ├─ GET      /api/health
                     ├─ WS       /ws?room=<id>&role=<host|guest>
                     └─ WS       /signal?room=<id>&role=<host|guest>
```

Only `PUBLIC_PORT` is ever exposed (Render's routed port; Vite's dev proxy
target). `INTERNAL_PORT` binds `127.0.0.1` only — never reachable directly.

## `/ws` — WireMessage relay (backs `Transport.kind === 'ws'`)

Query params: `room` (required), `role` (`host`|`guest`, optional — first
join to a room defaults to `host`, second to `guest`; requesting an already
seated role gets the connection closed with code `4002`; missing `room`
closes with `4001`).

**The relay is opaque.** It forwards every WS text/binary frame from one
peer to the other **verbatim, unparsed** — it does not know or care that
the payload is JSON-encoded `WireMessage` (`contracts.md §1`). This is what
makes the peer-echo `ping`/`pong` rule fall out for free: the server never
special-cases `{t:'ping', ...}`; the *client's* `WebSocketTransport`, on
receiving one, is expected to reply `{t:'pong', seq, t0}` (echoing `t0`
verbatim) — that reply is itself just another frame the relay forwards
back. RTT is computed by the original sender as `now() − t0`, entirely
client-side.

When either peer's socket closes, the relay closes the other peer's socket
too, with code `4000` ("peer left") — a 2-peer room is meaningless with one
peer. The server never injects a synthetic `WireMessage` for this; the
client's `onStateChange` reacts to its own socket's `close` event.

TCP_NODELAY is set on the raw socket at `upgrade` time (`server/index.ts`),
before `ws` wraps it, for both `/ws` and `/signal` — Nagle's algorithm would
otherwise coalesce the small, frequent frames (60Hz input, ping/pong),
skewing the WS latency baseline against WebRTC's unbuffered unreliable
channel.

## `/signal` — WebRTC signaling relay

Query params: same as `/ws` (independent room/role state — a peer's
`/ws` connection and its `/signal` connection are two separate sockets;
they share a room id, not a room object).

### Envelope (this sub-spec's own design — not in `contracts.md`)

```ts
type SignalingMessage =
  | { t: 'join'; room: string; role: 'host' | 'guest' }   // not relayed — role/room come from the URL at connect time; this variant exists for completeness/typing symmetry, the server ignores an inbound `join` frame
  | { t: 'joined'; role: 'host' | 'guest'; peerPresent: boolean }  // server -> connecting client, immediately on connect
  | { t: 'peer-joined' }                                   // server -> existing peer, when the second peer connects
  | { t: 'peer-left' }                                      // server -> remaining peer, on the other's disconnect
  | { t: 'offer'; sdp: string }                             // host -> server -> guest only
  | { t: 'answer'; sdp: string }                             // guest -> server -> host only
  | { t: 'ice-candidate'; candidate: unknown }               // either direction, pass-through
  | { t: 'ice-failed'; detail?: string }                     // either direction, pass-through — client sends this when its RTCPeerConnection.connectionState becomes 'failed', so the *other* side's UI can also show "connection failed"
  | { t: 'error'; code: string; message: string };           // server -> sender only, never relayed
```

### Glare handling

Glare (both peers sending a simultaneous `offer`) is avoided **structurally**,
not via a perfect-negotiation polite/impolite state machine: role
assignment is deterministic (first join = `host` unless a role is
explicitly requested) and the relay enforces a fixed offerer/answerer
split — **only `host` may send `offer`**, **only `guest` may send `answer`**.
A guest attempting to send an `offer` (or a host an `answer`) gets a `t:
'error'` back and the frame is not relayed. This is a valid simplification
*because* rooms are pinned to exactly two named roles (not a general n-peer
mesh) — it is not a general-purpose WebRTC negotiation library.

### ICE-failure surfaced

The client is responsible for watching its own `RTCPeerConnection`'s
`connectionState`; on `'failed'` it sends `{t:'ice-failed', detail}` over
`/signal`, which the server relays to the other peer unmodified — so a
STUN/NAT-traversal failure (expected for an estimated 15-30% of real-world
network pairs per `research.md`) is visible on **both** ends, not silently
stuck.

### What never touches this server

Once signaling completes, the actual DataChannels — the unreliable channel
carrying `input`/`snapshot`/`ping` and the separate reliable-ordered channel
carrying `run`/`result` (contracts.md §1) — are peer-to-peer. This server
has no visibility into them at all.

## `/api/loss` — link-loss toggle (contracts.md §4, spec F1)

```
GET  /api/loss                 -> { enabled: boolean, dropRate: number }
POST /api/loss  { enabled?, dropRate? }  -> same shape, echoes the new state
```

Toggles the `LossProxy` (`server/lossProxy.ts`) sitting in front of the
whole app on `PUBLIC_PORT`. See that file's header comment for the exact
mechanism (FIFO delay-on-hit per TCP connection — real head-of-line
blocking at the byte level, below WS frame parsing) and how it differs from
`payload-drop` (app-layer, no HOL blocking, owned by the client/008.3).

**Verified** (008.2 self-check): 20 `ping` round-trips over `/ws` averaged
0.2ms with loss disabled; with `enabled:true, dropRate:0.4` the same test
averaged 321.6ms, including several trips >800ms where consecutive
in-flight chunks queued behind an earlier delayed one — i.e. real
head-of-line blocking, not independent per-message jitter.

## Environment variables

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Public port (loss-proxy front). Render sets this. |
| `INTERNAL_PORT` | `PORT + 1` | Loopback-only app server port. |

## `/api/health`

Plain `200 ok` — for Render's health check and manual smoke tests.
