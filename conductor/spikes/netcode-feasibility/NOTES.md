# Harness build/import notes (008.1)

## Single Phaser instance (Fable F5)

`src/game/*` in the root app imports `phaser` (`^4.1.0`, root `dependencies`).
This harness must reuse that exact install, never bundle a second copy.

**Approach chosen: alias, not a duplicate install.**

- This package's `package.json` does **not** list `phaser` as a dependency at
  all — there is no `conductor/spikes/netcode-feasibility/node_modules/phaser`.
- `vite.config.ts` sets:
  - `resolve.dedupe: ['phaser']` — collapses any nested-dependency copies
    Rollup/Vite might otherwise resolve independently.
  - `resolve.alias: { phaser: <absolute path to repo-root node_modules/phaser/dist/phaser.esm.js> }`
    — forces every `import ... from 'phaser'` (both inside this harness's own
    code and inside the read-only-imported `src/game/*` files) to resolve to
    the literal same file on disk, in both `vite` (dev) and `vite build`
    (Rollup) — not just "the nearest node_modules that happens to have it."

Why alias instead of relying on plain Node module-resolution walking up the
directory tree (which would also find the root's `node_modules/phaser` since
none is installed locally): the alias is explicit and inspectable in one
place, and it removes any dependency on npm's hoisting/workspace behavior
(this package intentionally is **not** an npm workspace member — see
`package.json`'s standalone `dev`/`build`/`lint`/`test` scripts) or on Vite's
own resolution edge cases. One entry in `vite.config.ts` is the single
source of truth for "there is exactly one Phaser."

**Verification:** `npm run build` output was inspected — no `phaser` install
exists at `conductor/spikes/netcode-feasibility/node_modules`, and no code in
this sub-spec imports Phaser at all yet (008.1 has no Phaser-touching
experience). The alias/dedupe config is proactive groundwork for 008.5
(`NetFightScene`), not exercised by 008.1's own code — the DoD asks that the
*mechanism* is in place and correct, verified here by re-deriving the
resolution path (`repoRoot/node_modules/phaser/dist/phaser.esm.js`, matching
that package's own `"module"` field) and confirming it exists on disk.

## `../../../src/game` boundary (Fable F5)

`tsconfig.json`'s `include` deliberately does **not** glob `src/game` — this
sub-spec does not import anything from it yet (per the sub-spec instructions).
Instead:

- Files under this harness's own `src/**` can add a plain relative import
  such as `import { FightScene } from "../../../src/game/scenes/FightScene"`
  (three `../` from this package's root — `spikes` → `conductor` →
  `rock-em-sock-em` — matches the repo layout) once a later sub-spec needs it.
- `moduleResolution: "bundler"` + `skipLibCheck: true` mean TypeScript
  resolves bare specifiers (like `phaser`, imported *inside*
  `src/game/scenes/FightScene.ts` itself) via the same upward node_modules
  walk Node uses — from `src/game/scenes/`, that walk reaches
  `rock-em-sock-em/node_modules/phaser` with no extra path mapping required.
- **Do not import** `src/game/scenes/PreviewScene.ts` or
  `src/game/previewMain.ts` — both use the root's `@/*` alias
  (`tsconfig.json`'s Next.js-only path mapping), which this harness
  intentionally does not replicate. Every other file actually needed for the
  fight loop (`BootScene`, `PreloadScene`, `FightScene`, `systems/*`,
  `entities/Fighter`, `types.ts`, `config.ts`) uses only relative imports and
  `phaser`, and typechecks cleanly under this config (spot-checked with a
  throwaway import + `tsc --noEmit`, then removed — see below).
- `vite.config.ts`'s `server.fs.allow` includes the repo root so Vite's dev
  server will actually serve those files once imported.

## Root tooling exclusion (Fable F12)

Already done at the root, verified, not modified:
- `eslint.config.mjs` → `globalIgnores(['conductor/**', '.claude/**'])`.
- root `tsconfig.json` → `"exclude": ["node_modules", "conductor"]`.
- `npm run architecture:validate` passes as-is; it does not need a
  `conductor/spikes/**` scan-exclusion entry added to
  `architecture.config.json` (no such field was needed — validation does not
  traverse into `conductor/`).

No root file was modified for this sub-spec.

## SPA framework choice

Vite + React + TypeScript, per the sub-spec's own preference. Navigation is a
minimal hand-rolled hash router (`App.tsx`) — no router dependency — so that
`?room=&role=` (contracts.md §6 pairing) survives page navigation untouched
(hash changes don't touch the URL's search string), and so the harness's
dependency surface stays small enough to audit for the single-Phaser-instance
requirement.

## Server + deploy (008.2)

See `server/PROTOCOL.md` for the full wire protocol (`/ws` relay, `/signal`
signaling envelope + glare handling) and `DEPLOY.md` for the Render
Blueprint mechanism + free-tier cold-start caveat.

Key structural decisions, briefly:

- **Two ports, one public.** `server/index.ts` binds a loopback-only app
  server (`INTERNAL_PORT`) and fronts it with `server/lossProxy.ts` on the
  single public port (`PORT`, default 8080) — Render and Vite's dev proxy
  both only ever see the public port, so the exact same loss-injection
  code path applies in dev and deployed (008.2 DoD: "same code paths").
- **`/ws` relay is opaque to `WireMessage`.** It forwards frames verbatim;
  it never parses or special-cases `ping`/`pong`. That's *why* the
  contracts.md §1 peer-echo rule ("server forwards; the peer echoes") is
  automatically satisfied rather than needing server-side logic — the
  peer's own (008.3) `WebSocketTransport` is what replies to a `ping` with
  a `pong`.
- **`/signal` glare handling is structural, not perfect-negotiation.**
  Because roles are exactly `host`/`guest` and role assignment is
  deterministic (first join = host), the relay just refuses an `offer`
  from `guest` or an `answer` from `host` — glare can't arise in a
  pinned two-role room, so a full polite/impolite state machine isn't
  needed. This is 008.2's own envelope design (not in `contracts.md`,
  which only makes the `ping`/`pong` relay normative) — flag this for
  008.3 review since it's the shape their client-side signaling code must
  match.
- **Loss injection is a delay-based FIFO proxy, not literal packet drop.**
  `server/lossProxy.ts` holds a random subset of forwarded TCP chunks for a
  fixed delay; because forwarding is strictly FIFO per connection, chunks
  queued behind a held one are held too — genuine head-of-line blocking at
  the byte level (below WS frame parsing), verified empirically: 0.2ms
  average RTT with loss disabled vs. 321.6ms average (up to ~800ms on
  stacked delays) with `dropRate: 0.4` enabled. This is *not* real IP-layer
  packet loss (nothing is dropped at the kernel/network layer) — it
  reproduces TCP's externally observable HOL-blocking behavior without a
  toxiproxy binary dependency. Documented as the deliberate tradeoff in
  `lossProxy.ts`'s header comment.
- **WebRTC P2P `link-loss` is out of this proxy's reach entirely** — once
  signaling completes, DataChannels are peer-to-peer and never touch this
  server. The only way to inject real loss on that path is an OS network
  conditioner (macOS Network Link Conditioner / Linux `tc netem`), run
  manually on one machine — documented, not automated, per F1.
- **`server/tsconfig.json` is separate from the root `tsconfig.json`.**
  Server code needs Node's `lib`/`types` (no DOM), the app's `tsconfig.json`
  needs DOM/browser libs for React — one `tsc -b` config can't cleanly
  cover both, so `npm run build` runs both typechecks
  (`tsc -b --noEmit && tsc -p server/tsconfig.json && vite build`).
- **Production runs the server via `tsx`, not a separate compile step**
  (`npm run start` = `tsx server/index.ts`) — acceptable for a spike; avoids
  a second build artifact directory for ~150 lines of server code. If this
  server ever outgrows spike status, compiling to plain JS via
  `tsc -p server/tsconfig.json --outDir dist-server` (no `noEmit`) and
  running `node dist-server/index.js` is the straightforward next step.
