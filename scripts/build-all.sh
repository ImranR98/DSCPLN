#!/usr/bin/env bash
# Build the unified D$CPLN image once, tag/push every app tag, print a digest
# table, and optionally pin the digests into a deployment repo's templates.
#
#   scripts/build-all.sh                 # build all
#   scripts/build-all.sh portal balance  # build a subset (one image, two tags)
#   scripts/build-all.sh --pin           # build all + rewrite deployment templates
#
# REGISTRY/IMAGE_ORG choose where images are pushed (default docker.io/imranrdev).
# --pin needs DEPLOY_DIR (or the legacy INFRA_DIR) and TEMPLATES_DIR (default
# targets/srv0/k3s-apps/templates) and refuses a dirty checkout.
set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
DEPLOY_DIR="${DEPLOY_DIR:-${INFRA_DIR:-}}"
TEMPLATES_DIR="${TEMPLATES_DIR:-targets/srv0/k3s-apps/templates}"

source "$ROOT/scripts/images.sh"

PIN=0
APPS=()
for arg in "$@"; do
    case "$arg" in
        --pin) PIN=1 ;;
        -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
        *) APPS+=("$arg") ;;
    esac
done
if [ "${#APPS[@]}" -eq 0 ]; then
    APPS=("${ALL_APPS[@]}")
fi

if [ "$PIN" = 1 ] && [ -z "$DEPLOY_DIR" ]; then
    echo "Error: --pin needs DEPLOY_DIR (or INFRA_DIR) pointing at your deployment repo" >&2
    exit 1
fi
if [ "$PIN" = 1 ] && [ -n "$(git -C "$DEPLOY_DIR" status --porcelain 2>/dev/null)" ]; then
    echo "Error: $DEPLOY_DIR has uncommitted changes; commit or stash before --pin" >&2
    exit 1
fi

ENGINE="${ENGINE:-}"
if [ -z "$ENGINE" ]; then
    if command -v podman >/dev/null 2>&1; then ENGINE=podman
    elif command -v docker >/dev/null 2>&1; then ENGINE=docker
    else echo "Error: neither podman nor docker found" >&2; exit 1
    fi
fi

IMAGE_ORG="${IMAGE_ORG:-imranrdev}"
REGISTRY="${REGISTRY:-docker.io}"
BUILD_IMAGE="${REGISTRY}/${IMAGE_ORG}/dscpln-app:latest"

echo "==> Building unified image ($ENGINE, linux/amd64)"
"$ENGINE" build --platform linux/amd64 -f "$ROOT/docker/app.Dockerfile" -t "$BUILD_IMAGE" "$ROOT"

declare -A DIGESTS=()
for app in "${APPS[@]}"; do
    [[ -n "${IMAGE_NAMES[$app]:-}" ]] || { echo "Error: unknown app '$app'" >&2; exit 1; }
    image="${REGISTRY}/${IMAGE_ORG}/${IMAGE_NAMES[$app]}:latest"
    echo "=================== $app ==================="
    "$ENGINE" tag "$BUILD_IMAGE" "$image"
    digest_file="$(mktemp)"
    "$ENGINE" push --digestfile "$digest_file" "$image" >/dev/null
    digest="$(cat "$digest_file")"
    rm -f "$digest_file"
    [ -n "$digest" ] || { echo "Error: push produced no digest for $app" >&2; exit 1; }
    DIGESTS[$app]="$digest"
done

echo
echo "=================== digests ==================="
for app in "${APPS[@]}"; do
    printf '%-18s %s\n' "$app" "${DIGESTS[$app]}"
done

if [ "$PIN" = 1 ]; then
    echo
    echo "==> Pinning digests in $DEPLOY_DIR"
    for app in "${APPS[@]}"; do
        template="$DEPLOY_DIR/$TEMPLATES_DIR/${TEMPLATES[$app]:-}"
        [ -n "${TEMPLATES[$app]:-}" ] && [ -f "$template" ] || { echo "Error: no template for $app" >&2; exit 1; }
        APP="$app" IMAGE_NAME="${IMAGE_NAMES[$app]}" DIGEST="${DIGESTS[$app]#sha256:}" TEMPLATE="$template" node -e '
            const fs = require("fs");
            const file = process.env.TEMPLATE;
            const text = fs.readFileSync(file, "utf8");
            // Keep the existing image reference; swap only the digest. Match
            // the app image specifically: templates can also have init or
            // sidecar images (busybox, selenium) before the app container.
            const name = process.env.IMAGE_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const re = new RegExp(`(          image: \\S*/${name}:latest@sha256:)[0-9a-f]+`);
            const next = text.replace(re, `$1${process.env.DIGEST}`);
            if (next === text) {
                console.error(`Error: ${process.env.APP}: image line for ${process.env.IMAGE_NAME} not found in ${file}`);
                process.exit(1);
            }
            fs.writeFileSync(file, next);
            console.log(`pinned ${process.env.APP} -> ${file}`);
        '
    done
    echo "==> Review and commit the digest changes in $DEPLOY_DIR, then deploy as usual."
fi
