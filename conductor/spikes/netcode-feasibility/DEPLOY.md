# Deploying the netcode-feasibility spike (008.2)

**Status: config prepared + blockers cleared; deploy is one-command once the
service exists.** Use `npm run deploy` (see below). The detailed rationale for
the Blueprint mechanism follows the quick-start.

## Quick start — `npm run deploy`

Deploys spike-only, from this machine, **no Docker, no monorepo**. Auto-deploy-on-push is
**intentionally OFF** (`render.yaml` `autoDeploy: false` + set on the service). So a plain push
never builds — `npm run deploy` maintains a standalone snapshot repo (this spike + `src/game` +
`render.yaml`), pushes it, and then **explicitly triggers** a Render build via the CLI.

```
npm run deploy          # sanity build → sync snapshot → commit → push → `render deploys create` (explicit)
```
Needs the service id (already saved in `.render-service` = `srv-d9hs8vd7vvec73f2e6s0`) and the CLI
workspace set (`render workspace set tea-d9h42fcvikkc73b3pb8g --confirm`, once).
- Snapshot repo: `~/Code/netcode-feasibility-deploy` (override with `DEPLOY_DIR`).
- Pushes to: `git@github.com:jclarkfolklore/netcode-feasibility-spike.git` (override with `DEPLOY_REMOTE`).
- The snapshot is a *mini-monorepo* (`conductor/spikes/netcode-feasibility/` + `src/game/`) because
  the spike imports `../../../src/game` read-only — `render.yaml`'s `rootDir` scopes the build to
  the spike folder. Verified to build standalone (`npm ci && npm run build`).

### One-time Render setup (interactive, your account)
1. **Render dashboard → New → Blueprint**, pick `jclarkfolklore/netcode-feasibility-spike`
   (authorize GitHub access to it if prompted). `render.yaml` is at the repo root.
2. Render reads the Blueprint (runtime node, `rootDir: conductor/spikes/netcode-feasibility`,
   `buildCommand: npm install && npm run build`, `startCommand: npm run start`,
   `healthCheckPath: /api/health`) and creates the web service. Deploy.
3. Auto-deploy is OFF, so pushes don't build. Deploy deliberately with `npm run deploy` (pushes +
   triggers a build), or `render deploys create srv-d9hs8vd7vvec73f2e6s0 --wait`. Watch:
   `render deploys list srv-d9hs8vd7vvec73f2e6s0`.

### Blockers cleared
- **`phaser` vendored into this package** (pinned `4.1.0`, aliased locally in `vite.config.ts`).
- **`tsx` in `dependencies`** so `npm run start` survives a production install.
- **Cold-start banner** (`ServerWakeBanner`) for the free-tier ~15min idle spin-down.

### Still TODO for a polished public deploy (not blocking)
- TURN for real-WAN WebRTC; single-instance in-memory room registry (fine for a friends/LAN test).

### Why not Docker-image-to-Render?
That path (build image locally → push to a registry → `render deploys create --image`) also works
and needs no GitHub, but requires a working Docker daemon + a container registry (Docker Hub). Given
Docker Desktop wasn't starting on this machine, the git-snapshot path above is simpler and Docker-free.

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
