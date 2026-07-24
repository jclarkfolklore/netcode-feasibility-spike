#!/usr/bin/env bash
# Reusable Render deploy for the netcode-feasibility spike.
#   npm run deploy            # build + trigger a Render deploy (streams logs, waits)
#
# One-time setup (needs your Render account — interactive):
#   1) render workspace set
#   2) Create the web service from render.yaml:
#        Render dashboard → New → Blueprint → point at this repo's render.yaml
#        (or `render services create`). rootDir is conductor/spikes/netcode-feasibility.
#   3) Record the service id so this script is reusable:
#        echo srv-XXXXXXXX > .render-service      # (gitignored)
#        # or:  export RENDER_SERVICE_ID=srv-XXXXXXXX
#
# NOTE on the deploy source: this spike imports ../../../src/game read-only, so
# whatever git source Render builds from MUST contain both this folder AND the
# repo's src/game. See DEPLOY.md.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "→ Building (tsc + vite) ..."
npm run build

SERVICE="${RENDER_SERVICE_ID:-}"
if [ -z "$SERVICE" ] && [ -f .render-service ]; then
  SERVICE="$(tr -d '[:space:]' < .render-service)"
fi

if [ -z "$SERVICE" ]; then
  cat <<'EOF'

✓ Build OK — but no Render service is configured yet, so nothing was deployed.
  One-time setup (see the header of scripts/deploy.sh):
    1) render workspace set
    2) create the service from render.yaml (dashboard Blueprint or `render services create`)
    3) echo srv-XXXXXXXX > .render-service   (or export RENDER_SERVICE_ID=srv-XXXXXXXX)
  Then re-run:  npm run deploy
EOF
  exit 1
fi

echo "→ Deploying to Render service ${SERVICE} ..."
render deploys create "${SERVICE}" --confirm --wait --output text
