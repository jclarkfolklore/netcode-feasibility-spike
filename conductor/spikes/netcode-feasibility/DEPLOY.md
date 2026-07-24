# Deploying the netcode-feasibility spike (008.2)

**Status: config prepared + blockers cleared; deploy is one-command once the
service exists.** Use `npm run deploy` (see below). The detailed rationale for
the Blueprint mechanism follows the quick-start.

## Quick start — `npm run deploy`

```
npm run deploy          # builds (tsc + vite), then triggers a Render deploy
```

One-time setup (needs the Render account — interactive; the CLI must be logged in):
1. `render workspace set`
2. Create the web service from `render.yaml` — Render dashboard → **New → Blueprint**
   (point it at the git source; see the deploy-source note below) — or `render services create`.
3. Record the service id so the script is reusable:
   `echo srv-XXXXXXXX > .render-service` (gitignored) or `export RENDER_SERVICE_ID=srv-XXXXXXXX`.
Then `npm run deploy` builds and deploys, streaming logs.

### Blockers cleared (were flagged in the reviews)
- **`phaser` is now vendored into this package** (pinned `4.1.0`, aliased locally in
  `vite.config.ts`) — the build no longer reaches into the monorepo root's `node_modules`.
- **`tsx` moved to `dependencies`** so `npm run start` (`tsx server/index.ts`) survives a
  production install.

### ⚠ Deploy-source note (important)
This spike imports `../../../src/game/*` read-only (the netcode scenes subclass the REAL
`FightScene`), so it is **not** fully standalone. Whatever git source Render builds from must
contain **both** this folder AND the repo's `src/game`. Because this folder has its own git repo
and is gitignored by the monorepo, confirm before the first deploy that the deploy source actually
includes both (e.g. deploy the monorepo with this folder un-ignored on the deploy branch, or vendor
the needed `src/game` files). `render.yaml`'s `rootDir` + full-repo clone assumes the former.

### Still TODO for a polished public deploy (not blocking a functional deploy)
- A cold-start "waking server…" UI for the free-tier ~15min idle spin-down (this doc's original ask).
- TURN for real-WAN WebRTC; single-instance in-memory room registry (fine for a friends test).

---

**Original notes (mechanism rationale):** This sub-spec's worker had no Render
credentials — the steps below are what whoever holds the Render account runs.

## Mechanism chosen: `render.yaml` Blueprint

Chosen over CLI-triggered ad-hoc deploys or Docker (the sub-spec's "open
decision") because:
- `rootDir` is declarative and version-controlled (`render.yaml` at the
  **repo root**... see caveat below) — no one has to remember a manual
  "set root directory" click in the dashboard.
- `autoDeploy: true` gives push-to-deploy without extra CLI steps, which
  matters for a spike other people (a second machine, on WAN, per the DoD)
  need to reach without a human re-triggering anything.
- Docker adds a build-context/Dockerfile-location problem for zero benefit
  here — this is a plain Node app with one runtime dependency shape
  (`npm install && npm run build` then `node`/`tsx`).

## One-time setup

**`render.yaml` must live at the repository root**, not inside this spike
folder — Render's Blueprint feature only auto-discovers `render.yaml` at
the repo root. This spec's file is at
`conductor/spikes/netcode-feasibility/render.yaml`; the supervisor must
either:

- (a) copy/symlink it to the repo root before running "New Blueprint
  Instance", or
- (b) paste its contents into the Render dashboard's "New Web Service"
  manual flow instead (Settings → Root Directory =
  `conductor/spikes/netcode-feasibility`, Build Command =
  `npm install && npm run build`, Start Command = `npm run start`, Health
  Check Path = `/api/health`, Plan = Free).

This wasn't inlined into the repo root by this worker because file
ownership for this wave is scoped to inside
`conductor/spikes/netcode-feasibility/` only — placing a file at the repo
root is out of bounds for 008.2. Record this as a follow-up for whoever
does the actual deploy.

### Steps (once `render.yaml` is at the repo root, or pasted manually)

1. Render dashboard → **New** → **Blueprint** → connect this GitHub repo.
2. Render detects `render.yaml`, shows the `netcode-feasibility-spike`
   service (rootDir pinned, free plan) → **Apply**.
3. First deploy runs `npm install && npm run build` from
   `conductor/spikes/netcode-feasibility/`, then `npm run start`.
4. Note the assigned URL (`https://netcode-feasibility-spike.onrender.com`
   or similar) — that's the one URL two people on different networks open.

### Re-deploy

- **Automatic:** any push to the tracked branch with a diff under
  `conductor/spikes/netcode-feasibility/**` triggers a new deploy
  (`autoDeploy: true` + `rootDir` scoping).
- **Manual/CLI:** `render deploys create <service-id>` (Render CLI,
  `npm install -g render-cli` or the Go binary) if a deploy must be forced
  without a new commit — e.g. re-running after only a dashboard env-var
  change.

## Free-tier cold start (F10 — must surface in the UI)

Render's free web services **spin down after ~15 minutes idle** and take
several seconds to tens of seconds to cold-start on the next request. This
directly conflicts with "teammate opens the shared link and it just
works" — the first hit after idle will hang on the initial page load (and
then again on the first `/ws`/`/signal` handshake if the socket connects
before the process has fully warmed).

**Required UI treatment (008.3/008.4 to implement, not built by 008.2):**
show a "waking server…" state for any initial connection that doesn't open
within ~2-3 seconds, rather than a blank page or a raw WS error. The
`Transport`'s `onStateChange('connecting', detail)` hook exists for exactly
this — `detail` can carry a human string the UI surfaces.

**Keep-warm option (not configured — costs money):** an external pinger
hitting `/api/health` every ~10 minutes keeps a free instance from spinning
down, or upgrading the Render plan removes the spin-down entirely. Left as
a documented option, not applied, since it either needs a paid plan or an
external cron the spike doesn't otherwise need.

## Smoke test (post-deploy, run by whoever has the URL)

1. Open `<render-url>/?room=smoke1&role=host` in one browser/machine.
2. Open `<render-url>/?room=smoke1&role=guest` in a second browser, ideally
   on a different network (confirms WAN reachability, not just same-LAN).
3. Confirm both pages report `crossOriginIsolated === true` (008.2 built
   this to be display, not just claimed — see the served page / dev
   console).
4. Confirm `curl -I <render-url>/` shows
   `Cross-Origin-Opener-Policy: same-origin` and
   `Cross-Origin-Embedder-Policy: require-corp`.
5. Confirm `curl <render-url>/data/announcer.json` returns the JSON (not
   404) — the sim crashes without it (`PreloadScene.ts:11`).
6. (008.3+, once the transport experience page exists) confirm a `ping`
   sent from one browser is echoed back via the other and RTT is measured.

## Local dev vs. deployed — same code path

`npm run dev` starts both Vite (client, hot-reload) and the Node server
(`server/index.ts`, unchanged from what Render runs) concurrently; Vite
proxies `/ws`, `/signal`, `/api/*` to the Node server's public
(loss-proxy-fronted) port. In production, the same Node server also serves
the built static files directly (no Vite in the loop). Only the "who
serves the HTML/JS" path differs between dev and prod — the WS relay,
signaling relay, and loss-injection proxy are the exact same code,
running the exact same way, in both. See `server/PROTOCOL.md`.

## What this sub-spec did NOT do

- Did not actually create a Render account/service or trigger a deploy —
  no credentials were available or used.
- Did not copy `render.yaml` to the repo root (file-ownership boundary for
  this wave) — see "One-time setup" above.
- Did not configure a keep-warm pinger.
