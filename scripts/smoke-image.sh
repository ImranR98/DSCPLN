#!/usr/bin/env bash
# Smoke-test the production images before they are published.
#
#   scripts/smoke-image.sh [APP_IMAGE] [AGENT_IMAGE]
#
# Verifies that the base image provides every runtime tool the apps expect,
# that production dependencies survived `npm prune`, and that the unified
# image can actually serve the portal health endpoint. Runs on CI and locally;
# uses docker or podman like scripts/build.sh.
set -euo pipefail

APP_IMAGE="${1:-dscpln-app:ci}"
AGENT_IMAGE="${2:-dscpln-agent:ci}"
SMOKE_PORT="${SMOKE_PORT:-18080}"

ENGINE="${ENGINE:-}"
if [ -z "$ENGINE" ]; then
    if command -v podman >/dev/null 2>&1; then ENGINE=podman
    elif command -v docker >/dev/null 2>&1; then ENGINE=docker
    else echo "Error: neither podman nor docker found" >&2; exit 1
    fi
fi

echo "==> Checking runtime tools in $APP_IMAGE"
# shellcheck disable=SC2016 # the -c script must not expand on the host
"$ENGINE" run --rm --entrypoint sh "$APP_IMAGE" -c '
    set -eu

    node --version
    node -e "if (!process.release.lts) process.exit(1)"

    # Runtime tools used by one or more apps. A missing tool here means a
    # base-image or apt change broke the unified image.
    ffmpeg -version | head -1
    restic version
    kubectl version --client
    python3 -m venv /tmp/smoke-venv
    /tmp/smoke-venv/bin/pip --version
    nft --version
    adb version | head -1
    age --version
    jq --version
    git --version
    rsync --version | head -1
    tar --version | head -1
    unzip -v | head -1

    # Production dependencies must still resolve after `npm prune`.
    npm ls --omit=dev --depth=0 >/dev/null
'

echo "==> Checking portal health in $APP_IMAGE"
container="dscpln-smoke-$$"
cleanup() { "$ENGINE" rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT

"$ENGINE" run -d --rm --name "$container" \
    -e APP=portal \
    -e DSCPLN_DATA_DIR=/tmp/dscpln-smoke \
    -e DSCPLN_CONFIG_FILE=/tmp/dscpln-smoke/config.json \
    -p "127.0.0.1:${SMOKE_PORT}:8080" \
    "$APP_IMAGE" >/dev/null

healthy=0
for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${SMOKE_PORT}/api/health" >/dev/null 2>&1; then
        healthy=1
        break
    fi
    if ! "$ENGINE" inspect -f '{{.State.Running}}' "$container" 2>/dev/null | grep -q true; then
        break
    fi
    sleep 1
done

if [ "$healthy" -ne 1 ]; then
    echo "Error: portal did not become healthy on port $SMOKE_PORT" >&2
    "$ENGINE" logs "$container" >&2 || true
    exit 1
fi
echo "portal /api/health OK"

echo "==> Checking $AGENT_IMAGE"
# shellcheck disable=SC2016 # the -c script must not expand on the host
"$ENGINE" run --rm --entrypoint sh "$AGENT_IMAGE" -c '
    set -eu
    node --version
    tar --version | head -1
    node --check /app/server.mjs
'

echo "==> Image smoke tests passed"
