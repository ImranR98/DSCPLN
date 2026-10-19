#!/usr/bin/env bash
# Build and push every D$CPLN app image (or the ones given), print a digest
# table, and optionally pin the digests into a deployment repo's templates.
#
#   scripts/build-all.sh                 # build all
#   scripts/build-all.sh ytmusic portal  # build a subset
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
        -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
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

# Every app image builds FROM the shared base, so refresh it first.
"$ROOT/scripts/build-base.sh"

declare -A DIGESTS=()
for app in "${APPS[@]}"; do
    image="${REGISTRY:-docker.io}/${IMAGE_ORG:-imranrdev}/${IMAGE_NAMES[$app]:-dscpln-$app}:latest"
    echo "=================== $app ==================="
    output="$("$ROOT/scripts/build.sh" "$app")"
    digest="$(grep -oE 'sha256:[0-9a-f]{64}' <<<"$output" | tail -1)"
    [ -n "$digest" ] || { echo "Error: could not parse digest for $app" >&2; exit 1; }
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
        APP="$app" DIGEST="${DIGESTS[$app]#sha256:}" TEMPLATE="$template" node -e '
            const fs = require("fs");
            const file = process.env.TEMPLATE;
            const text = fs.readFileSync(file, "utf8");
            // Keep the existing image reference; swap only the digest.
            const next = text.replace(/(          image: \S+?@sha256:)[0-9a-f]+/, `$1${process.env.DIGEST}`);
            if (next === text) {
                console.error(`Error: ${process.env.APP}: image line not found in ${file}`);
                process.exit(1);
            }
            fs.writeFileSync(file, next);
            console.log(`pinned ${process.env.APP} -> ${file}`);
        '
    done
    echo "==> Review and commit the digest changes in $DEPLOY_DIR, then deploy as usual."
fi
