#!/usr/bin/env bash
# Build and push the shared D$CPLN build base (docker/base.Dockerfile). The
# app Dockerfiles FROM it, so run this before building an app image; build-all
# calls it automatically.
set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
REGISTRY="${REGISTRY:-docker.io}"
IMAGE_ORG="${IMAGE_ORG:-imranrdev}"
IMAGE="${REGISTRY}/${IMAGE_ORG}/dscpln-base:latest"

ENGINE="${ENGINE:-}"
if [ -z "$ENGINE" ]; then
    if command -v podman >/dev/null 2>&1; then ENGINE=podman
    elif command -v docker >/dev/null 2>&1; then ENGINE=docker
    else echo "Error: neither podman nor docker found" >&2; exit 1
    fi
fi

echo "==> Building $IMAGE (linux/amd64, $ENGINE)"
"$ENGINE" build --platform linux/amd64 -f "$ROOT/docker/base.Dockerfile" -t "$IMAGE" "$ROOT"
echo "==> Pushing $IMAGE"
"$ENGINE" push "$IMAGE" >/dev/null
echo "base image ready: $IMAGE"
