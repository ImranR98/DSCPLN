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

echo "==> Checking Task Runner run_as permissions in $APP_IMAGE"
# Regression for the fresh-root staging bug: root creates the state/runtime
# dirs, then the actual task user (1000) must traverse and read them.
# shellcheck disable=SC2016 # the -c script must not expand on the host
"$ENGINE" run --rm --user 0 --entrypoint sh "$APP_IMAGE" -c '
    set -eu
    export BACKUPCTL_STATE_DIR=/tmp/task-runner-smoke
    export BACKUPCTL_STATE_UID=1000
    export BACKUPCTL_STATE_GID=1000
    export HOME=/tmp/task-runner-home
    rm -rf "$BACKUPCTL_STATE_DIR" "$HOME"
    mkdir -p "$HOME"

    node --input-type=module -e "
        import { ensureRuntimeDirs, stagingDir } from \"/app/apps/task-runner/state.mjs\";
        import fs from \"node:fs\";
        ensureRuntimeDirs();
        const dir = stagingDir(\"permission probe\");
        fs.writeFileSync(dir + \"/probe.txt\", \"probe\");
        fs.chownSync(dir + \"/probe.txt\", 1000, 1000);
    "

    setpriv --reuid=1000 --regid=1000 --clear-groups cat /tmp/task-runner-smoke/staging/permission_probe/probe.txt
    setpriv --reuid=1000 --regid=1000 --clear-groups test -w /tmp/task-runner-smoke/staging
    setpriv --reuid=1000 --regid=1000 --clear-groups test -w /tmp/task-runner-home/.venvs
    rm -rf "$BACKUPCTL_STATE_DIR" "$HOME"
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
