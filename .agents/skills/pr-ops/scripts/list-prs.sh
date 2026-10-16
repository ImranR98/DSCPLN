#!/usr/bin/env bash
# DESC: List open PRs for the repo containing this skill, flagging dependency
# update PRs (label "deps", or a renovate/* head branch).
# Uses the authenticated gh CLI. Prints one block per PR (number, updated, kind,
# branch, CI rollup, title, labels); --json prints the raw objects instead.
set -euo pipefail

usage() {
    echo "Usage: $(basename "$0") [--json]"
    echo
    echo "Lists open PRs for the repo's origin remote, flagging dependency PRs."
    echo "Requires gh, authenticated with repo scope (gh auth login)."
    exit 1
}

json=false
case "${1:-}" in
    "") ;;
    --json) json=true ;;
    *) usage ;;
esac

script_dir="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
repo_root="$(cd "$script_dir/../../../.." && pwd)"

command -v gh >/dev/null 2>&1 || {
    echo "Error: gh is not installed" >&2
    exit 1
}
gh auth status >/dev/null 2>&1 || {
    echo "Error: gh is not authenticated (run: gh auth login)" >&2
    exit 1
}

fields="number,title,headRefName,labels,isDraft,mergeable,updatedAt,statusCheckRollup"

if [ "$json" = true ]; then
    cd "$repo_root"
    gh pr list --state open --limit 100 --json "$fields"
    exit 0
fi

out="$(cd "$repo_root" && gh pr list --state open --limit 100 --json "$fields" --jq '
    def checkstate:
        [.statusCheckRollup[]? | ((.conclusion // .state // .status // "pending") | ascii_downcase)] as $s
        | if ($s | length) == 0 then "none"
          elif ($s | any(. == "failure" or . == "error" or . == "timed_out" or . == "cancelled"
                         or . == "action_required" or . == "startup_failure" or . == "stale")) then "failure"
          elif ($s | any(. == "pending" or . == "queued" or . == "in_progress"
                         or . == "waiting" or . == "expected")) then "pending"
          else "pass"
          end;

    sort_by(.number)[]
    | "\(.number)  \(.updatedAt[:10])  [\(if ((.labels | map(.name) | index("deps")) != null) or (.headRefName | startswith("renovate/")) then "dep" else "other" end)]  \(.headRefName)  CI:\(checkstate)\(if .isDraft then "  DRAFT" else "" end)\(if .mergeable == "CONFLICTING" then "  CONFLICT" else "" end)"
      + "\n    \(.title)"
      + "\n    labels=\(.labels | map(.name) | join(",") | if . == "" then "-" else . end)"
')"

if [ -z "$out" ]; then
    echo "No open PRs."
else
    printf '%s\n' "$out"
fi
