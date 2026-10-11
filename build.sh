#!/bin/bash
# DESC: Build and push the D$CPLN image and print the pushed digest so a
# deployment can pin it.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
IMAGE="${IMAGE:-imranrdev/dscpln:latest}"

command -v docker >/dev/null 2>&1 || { echo "Error: docker not found" >&2; exit 1; }

echo "==> Building $IMAGE (linux/amd64)"
docker build --platform linux/amd64 -t "$IMAGE" "$SCRIPT_DIR"

echo "==> Pushing $IMAGE"
docker push "$IMAGE"

digest="$(docker inspect --format='{{index .RepoDigests 0}}' "$IMAGE" | sed 's/^[^@]*@//')"
[ -n "$digest" ] || { echo "Error: no pushed digest found for $IMAGE" >&2; exit 1; }

echo
echo "Pushed $IMAGE@$digest"
echo "Pin it wherever the app is deployed:"
echo "  image: $IMAGE@$digest"
