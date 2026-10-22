#!/usr/bin/env bash
# Build and push the generic D$CPLN agent image. The same image runs on every
# remote host; host-specific jobs come from the mounted agent config.
#
#   scripts/build-agent.sh
#   REGISTRY=ghcr.io IMAGE_ORG=example scripts/build-agent.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
DOCKERFILE="$ROOT/docker/agent.Dockerfile"

source "$ROOT/scripts/images.sh"

REGISTRY="${REGISTRY:-$DEFAULT_REGISTRY}"
IMAGE_ORG="${IMAGE_ORG:-$DEFAULT_IMAGE_ORG}"
REGISTRY="${REGISTRY,,}"
IMAGE_ORG="${IMAGE_ORG,,}"
IMAGE="${REGISTRY}/${IMAGE_ORG}/${AGENT_IMAGE}:latest"

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

echo
echo "Pushed $IMAGE@$DIGEST"
echo "Pin it in the remote host's Compose file:"
echo "  image: $IMAGE@$DIGEST"
