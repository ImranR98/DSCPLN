#!/usr/bin/env bash
# Example helper for your config repo ("hello, tool").
# Writes a timestamped manifest of the files it is given:
#
#   hello-tool.sh DEST FILE...
#
# It is copied into the task-runner image, so the example config can call it as
# {{scriptroot}}/hello-tool.sh. Replace it with your own tools.

set -euo pipefail

dest="${1:?usage: hello-tool.sh DEST FILE...}"
shift

mkdir -p "$dest"
manifest="$dest/manifest-$(date +%Y%m%d-%H%M%S).txt"
{
  echo "D\$CPLN example tool"
  echo "when: $(date)"
  for file in "$@"; do
    echo "$(basename "$file")  $(wc -c < "$file") bytes"
  done
} > "$manifest"

echo "wrote $manifest"
