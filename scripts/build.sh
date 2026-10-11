#!/usr/bin/env bash
# Build and push one D$CPLN app image, then print the registry digest to pin
# in the Infra template. The build context is the monorepo root.
#
#   scripts/build.sh media-sync
#   ENGINE=docker scripts/build.sh balance-xlsx
#
# Registry digests must come from the push itself: `podman image inspect
# .RepoDigests` can return a digest the registry does not have.
set -euo pipefail

APP="${1:?usage: scripts/build.sh <app> [image:tag]}"
ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
DOCKERFILE="$ROOT/apps/$APP/Dockerfile"
[ -f "$DOCKERFILE" ] || { echo "Error: $DOCKERFILE not found" >&2; exit 1; }

declare -A IMAGE_NAMES=(
    [balance-xlsx]=dscpln-balance
    [media-sync]=dscpln-media-sync
    [whatsapp-txt]=dscpln-watxt
    [task-runner]=dscpln-task-runner
    [contacts-calendar]=dscpln-contacts
    [compose-state]=dscpln-compose
    [ytmusic]=dscpln-ytmusic
    [portal]=dscpln-portal
)
IMAGE="${2:-docker.io/imranrdev/${IMAGE_NAMES[$APP]:-dscpln-$APP}:latest}"

ENGINE="${ENGINE:-}"
if [ -z "$ENGINE" ]; then
    if command -v podman >/dev/null 2>&1; then ENGINE=podman
    elif command -v docker >/dev/null 2>&1; then ENGINE=docker
    else echo "Error: neither podman nor docker found" >&2; exit 1
    fi
fi

echo "==> Building $IMAGE (linux/amd64, $ENGINE)"
"$ENGINE" build --platform linux/amd64 -f "$DOCKERFILE" -t "$IMAGE" "$ROOT"

DIGEST_FILE="$(mktemp)"
trap 'rm -f "$DIGEST_FILE"' EXIT
echo "==> Pushing $IMAGE"
"$ENGINE" push --digestfile "$DIGEST_FILE" "$IMAGE"
DIGEST="$(cat "$DIGEST_FILE")"
[ -n "$DIGEST" ] || { echo "Error: push produced no digest" >&2; exit 1; }

if command -v skopeo >/dev/null 2>&1; then
    # Tag + digest references are invalid; verify against the digest alone.
    skopeo inspect "docker://${IMAGE%:*}@${DIGEST}" >/dev/null && echo "==> Registry digest verified"
fi

echo
echo "Pushed $IMAGE@$DIGEST"
echo "Pin it in the Infra template:"
echo "  image: $IMAGE@$DIGEST"
