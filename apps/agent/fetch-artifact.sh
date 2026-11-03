#!/bin/sh
# Generic artifact fetch for dscpln-agent initContainers.
#
# Downloads a .tar.gz release into a canonical destination. The cache is
# version-keyed: the same version is reused indefinitely, while a different
# version replaces the canonical binary and prunes stale copies.
#
# Required env:
#   ARTIFACT_URL       release archive URL
#   ARTIFACT_VERSION   version string used as the cache key and check needle
#   ARTIFACT_DEST      canonical destination path
#   ARTIFACT_MEMBER    file name inside the tar archive
#
# Optional env:
#   ARTIFACT_CHECK_ARGS  args that print the version, e.g. "--version"
set -eu

: "${ARTIFACT_URL:?ARTIFACT_URL is required}"
: "${ARTIFACT_VERSION:?ARTIFACT_VERSION is required}"
: "${ARTIFACT_DEST:?ARTIFACT_DEST is required}"
: "${ARTIFACT_MEMBER:?ARTIFACT_MEMBER is required}"

artifact_dir=$(dirname "$ARTIFACT_DEST")
artifact_name=$(basename "$ARTIFACT_DEST")
stamp="$artifact_dir/.version"

mkdir -p "$artifact_dir"

check_version() {
    [ -n "${ARTIFACT_CHECK_ARGS:-}" ] || return 0
    # shellcheck disable=SC2086 # deployment-configured, space-separated args
    "$1" $ARTIFACT_CHECK_ARGS 2>&1 | grep -Fq "$ARTIFACT_VERSION"
}

if [ -x "$ARTIFACT_DEST" ] \
    && [ -f "$stamp" ] \
    && [ "$(cat "$stamp")" = "$ARTIFACT_VERSION" ] \
    && check_version "$ARTIFACT_DEST"; then
    echo "$artifact_name $ARTIFACT_VERSION already installed"
    exit 0
fi

tmp=$(mktemp -d)
staged="$artifact_dir/$artifact_name.new"
cleanup() {
    rm -rf "$tmp"
    rm -f "$staged"
}
trap cleanup EXIT

echo "downloading $artifact_name $ARTIFACT_VERSION from $ARTIFACT_URL"
curl -fsSL --retry 3 --retry-delay 2 -o "$tmp/artifact.tar.gz" "$ARTIFACT_URL"
tar -xzf "$tmp/artifact.tar.gz" -C "$tmp"

if [ ! -f "$tmp/$ARTIFACT_MEMBER" ]; then
    echo "artifact archive does not contain $ARTIFACT_MEMBER" >&2
    exit 1
fi

cp "$tmp/$ARTIFACT_MEMBER" "$staged"
chmod 0755 "$staged"
if ! check_version "$staged"; then
    echo "downloaded $artifact_name does not report version $ARTIFACT_VERSION" >&2
    exit 1
fi

# Atomic replace removes the previous canonical binary.
mv "$staged" "$ARTIFACT_DEST"
printf '%s\n' "$ARTIFACT_VERSION" > "$stamp"

# Defensive cleanup for versioned/staged copies from older layouts.
for old in "$artifact_dir/$artifact_name"-* "$artifact_dir/$artifact_name".old* "$artifact_dir/$artifact_name".new*; do
    [ -e "$old" ] || continue
    rm -f "$old"
done

echo "$artifact_name $ARTIFACT_VERSION installed"
