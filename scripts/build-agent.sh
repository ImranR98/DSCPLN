#!/usr/bin/env bash
# Build and push the generic D$CPLN agent images. The same agent code runs on
# every host; host-specific jobs come from the mounted agent config. The slim
# image is the default; the GTK variant adds the runtime libraries needed by
# tools such as Ludusavi.
#
#   scripts/build-agent.sh
#   REGISTRY=ghcr.io IMAGE_ORG=example scripts/build-agent.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
source "$ROOT/scripts/images.sh"

REGISTRY="${REGISTRY:-$DEFAULT_REGISTRY}"
IMAGE_ORG="${IMAGE_ORG:-$DEFAULT_IMAGE_ORG}"
REGISTRY="${REGISTRY,,}"
IMAGE_ORG="${IMAGE_ORG,,}"

ENGINE="${ENGINE:-}"
if [ -z "$ENGINE" ]; then
    if command -v podman >/dev/null 2>&1; then ENGINE=podman
    elif command -v docker >/dev/null 2>&1; then ENGINE=docker
    else echo "Error: neither docker nor podman found" >&2; exit 1
    fi
fi

build_one() {
    local dockerfile="$1"
    local image="$2"
    local digest_file digest

    echo "==> Building $image (linux/amd64, $ENGINE)"
    "$ENGINE" build --platform linux/amd64 -f "$dockerfile" -t "$image" "$ROOT"

    digest_file="$(mktemp)"
    echo "==> Pushing $image"
    "$ENGINE" push --digestfile "$digest_file" "$image"
    digest="$(cat "$digest_file")"
    rm -f "$digest_file"
    [ -n "$digest" ] || { echo "Error: push produced no digest for $image" >&2; exit 1; }

    echo
    echo "Pushed $image@$digest"
    echo "Pin it in the Infra agent template:"
    echo "  image: $image@$digest"
    echo
}

build_one "$ROOT/docker/agent.Dockerfile" "${REGISTRY}/${IMAGE_ORG}/${AGENT_IMAGE}:latest"
build_one "$ROOT/docker/agent-gtk.Dockerfile" "${REGISTRY}/${IMAGE_ORG}/${AGENT_GTK_IMAGE}:latest"
