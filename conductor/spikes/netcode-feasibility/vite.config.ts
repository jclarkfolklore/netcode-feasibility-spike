import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const here = path.dirname(fileURLToPath(import.meta.url));

// Repo root, three levels up from conductor/spikes/netcode-feasibility.
const repoRoot = path.resolve(here, "../../..");

// Single-Phaser-instance mechanics (Fable F5): src/game imports the bare
// `phaser` specifier; this harness must never bundle a second copy — two
// Phaser instances break `instanceof` checks and Phaser's own globals/registry.
// The spike now carries its OWN pinned `phaser` (4.1.0, matching the root) so
// it is self-contained and deployable standalone (Render / a future spike-only
// remote) without reaching into the monorepo root. We alias the bare specifier
// straight at THIS package's install + `dedupe` so both Vite's dev server and
// its production (Rollup) build — and the read-only `../../../src/game` imports
// — all resolve to the exact same file on disk.
const phaserEntry = path.resolve(here, "node_modules/phaser/dist/phaser.esm.js");

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ["phaser"],
    alias: {
      phaser: phaserEntry,
    },
  },
  server: {
    fs: {
      // Vite's dev server otherwise refuses to serve files outside this
      // package's root. Later sub-specs import ../../../src/game read-only,
      // so the allow-list must reach the repo root.
      allow: [repoRoot],
    },
    // F16: cross-origin isolation in dev too, so `crossOriginIsolated` and
    // high-res-timer behavior match what the deployed server serves
    // (server/staticServer.ts sets the same two headers in production).
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
    // Local-dev parity (008.2 DoD): `npm run dev` runs Vite (this process)
    // alongside the Node server (`server/index.ts`, started by the sibling
    // `dev:server` script — see package.json's `dev` script). Vite proxies
    // the server's endpoints through to the Node server's public,
    // loss-proxy-fronted port so the exact same server code path (and the
    // same `link-loss` toggle) is exercised in dev as in the Render
    // deployment, where one process serves everything on one port.
    proxy: {
      "/ws": { target: "ws://localhost:8080", ws: true },
      "/signal": { target: "ws://localhost:8080", ws: true },
      "/api": { target: "http://localhost:8080" },
    },
  },
  build: {
    outDir: "dist",
  },
});
