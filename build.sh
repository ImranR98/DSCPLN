#!/bin/bash
# DESC: Build and push the backupctl image and print the pushed registry digest
# so a deployment can pin it. Submodules are baked into the image.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
IMAGE="${IMAGE:-imranrdev/backupctl:latest}"
ENGINE="${ENGINE:-podman}"

command -v "$ENGINE" >/dev/null 2>&1 || { echo "Error: $ENGINE not found" >&2; exit 1; }

echo "==> Ensuring submodules are checked out"
git -C "$SCRIPT_DIR" submodule update --init --recursive

echo "==> Building $IMAGE (linux/amd64)"
"$ENGINE" build --platform linux/amd64 -t "$IMAGE" "$SCRIPT_DIR"

echo "==> Pushing $IMAGE"
digestfile="$(mktemp)"
trap 'rm -f "$digestfile"' EXIT
"$ENGINE" push --digestfile "$digestfile" "$IMAGE"

digest="$(cat "$digestfile")"
[ -n "$digest" ] || { echo "Error: no pushed digest found for $IMAGE" >&2; exit 1; }

echo
echo "Pushed $IMAGE@$digest"
echo "Pin it wherever the app is deployed:"
echo "  image: $IMAGE@$digest"
