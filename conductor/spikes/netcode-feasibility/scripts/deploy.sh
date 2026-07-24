#!/usr/bin/env bash
# Deploy the netcode-feasibility spike to Render — spike-only, driven from this
# machine, no Docker. It maintains a small STANDALONE snapshot repo (this spike
# + src/game + render.yaml), commits the latest, and pushes. Render (autoDeploy)
# builds from that repo. Re-run any time you change the spike or src/game.
#
#   npm run deploy
#
# Config (env overrides):
#   DEPLOY_DIR     where the snapshot repo lives (default ~/Code/netcode-feasibility-deploy)
#   DEPLOY_REMOTE  git remote to push to (default the jclarkfolklore spike repo)
set -euo pipefail
SPIKE="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$SPIKE/../../.." && pwd)"
DEPLOY_DIR="${DEPLOY_DIR:-$HOME/Code/netcode-feasibility-deploy}"
DEPLOY_REMOTE="${DEPLOY_REMOTE:-git@github.com:jclarkfolklore/netcode-feasibility-spike.git}"

echo "→ Sanity build (fail fast before pushing a broken tree) ..."
( cd "$SPIKE" && npm run build >/dev/null )

echo "→ Syncing snapshot to $DEPLOY_DIR ..."
mkdir -p "$DEPLOY_DIR/conductor/spikes/netcode-feasibility" "$DEPLOY_DIR/src"
rsync -a --delete \
  --exclude node_modules --exclude dist --exclude .git \
  --exclude .ux-shots --exclude .render-service \
  "$SPIKE/" "$DEPLOY_DIR/conductor/spikes/netcode-feasibility/"
rsync -a --delete "$REPO_ROOT/src/game/" "$DEPLOY_DIR/src/game/"
cp "$SPIKE/render.yaml" "$DEPLOY_DIR/render.yaml"
cp "$SPIKE/scripts/deploy-README.md" "$DEPLOY_DIR/README.md"   # root README (project + context)
printf 'node_modules/\ndist/\n.render-service\n.DS_Store\n' > "$DEPLOY_DIR/.gitignore"

cd "$DEPLOY_DIR"
[ -d .git ] || git init -q -b main
git remote get-url origin >/dev/null 2>&1 || git remote add origin "$DEPLOY_REMOTE"
git add -A
if git diff --cached --quiet; then
  echo "  (no changes since last deploy)"
else
  git commit -q -m "spike deploy snapshot ($(date -u +%Y-%m-%dT%H:%MZ))"
fi

echo "→ Pushing to $DEPLOY_REMOTE ..."
git push -u origin main

# Auto-deploy-on-push is intentionally OFF. Trigger the build EXPLICITLY here so
# `npm run deploy` is a deliberate deploy, while a plain push never builds.
SERVICE="${RENDER_SERVICE_ID:-}"
[ -z "$SERVICE" ] && [ -f "$SPIKE/.render-service" ] && SERVICE="$(tr -d '[:space:]' < "$SPIKE/.render-service")"

if [ -z "$SERVICE" ]; then
  echo ""
  echo "✓ Pushed. No Render service id configured, so NO build was triggered."
  echo "  Save it once:  echo srv-XXXXXXXX > .render-service   (or export RENDER_SERVICE_ID)"
  echo "  Then re-run, or trigger manually:  render deploys create <srv> --wait"
  exit 0
fi

echo "→ Triggering Render deploy for ${SERVICE} (auto-deploy is off) ..."
if ! render deploys create "${SERVICE}" --confirm --wait --output text 2>&1; then
  cat <<EOF

⚠ Could not trigger the deploy via CLI (workspace not set, or auth). Fixes:
    render workspace set tea-d9h42fcvikkc73b3pb8g --confirm
    render deploys create ${SERVICE} --wait
  (The push succeeded — the repo is updated; only the build wasn't triggered.)
EOF
  exit 1
fi
echo "✓ Deploy triggered + completed."
