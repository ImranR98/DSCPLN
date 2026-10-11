#!/bin/bash
# DESC: Build and push the Media Sync image and print the pushed digest so a
# deployment can pin it.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
IMAGE="${IMAGE:-imranrdev/media-sync:latest}"
ENGINE="${ENGINE:-podman}"

command -v "$ENGINE" >/dev/null 2>&1 || { echo "Error: $ENGINE not found" >&2; exit 1; }

echo "==> Building $IMAGE (linux/amd64)"
"$ENGINE" build --platform linux/amd64 -t "$IMAGE" "$SCRIPT_DIR"

echo "==> Pushing $IMAGE"
"$ENGINE" push "$IMAGE"

digest="$("$ENGINE" image inspect --format '{{index .RepoDigests 0}}' "$IMAGE" | sed 's/^[^@]*@//')"
[ -n "$digest" ] || { echo "Error: no pushed digest found for $IMAGE" >&2; exit 1; }

echo
echo "Pushed $IMAGE@$digest"
echo "Pin it wherever the app is deployed:"
echo "  image: $IMAGE@$digest"
