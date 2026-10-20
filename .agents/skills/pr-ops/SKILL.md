---
name: pr-ops
description: Triage, merge, and ship open dependency-update PRs in the D$CPLN monorepo. Use when asked to review or merge dependency PRs (label deps), handle npm/docker version bumps, or rebuild and pin the affected app images after such a merge. Covers risk tiering (patch/minor vs major and 0.x, runtime vs build-only vs tooling deps, the node base image), changelog research for risky bumps, consent gates for risky merges and all image rebuilds/pins, per-app image impact mapping, and reporting.
---

# PR ops (dependency updates)

Triage, risk-assess, merge, and (after consent) ship open dependency-update PRs.
Scope is dependency PRs — label `deps`, head branches prefixed `renovate/*`; the
update stream (grouping, labels, which majors are allowed) is configured by
`renovate.json` at the repo root, so edit it there to change future PRs. Other
PRs use the same validate/merge/ship phases with judgment.

`docs/ARCHITECTURE.md` (Operations runbook, image build/pin/deploy, hardening)
and `README.md` (safety conventions) are the source of truth for repo layout and
the deploy flow; this skill encodes the recurring dependency-PR workflow on top
of them.

## Hard rules

- Never read or print runtime config/state: `config.json`, `.env`, `DEPLOY.md`,
  `apps/task-runner/config.mjs`, `logs/`, `data/` — gitignored, may hold secrets
  and personal data.
- Never merge on red or pending CI; never bypass or admin-merge past checks.
- One merge at a time: land it on `main` (and confirm `main` CI) before the next.
- Never commit generated files (`apps/*/static/`) or runtime files.
- Never rebuild/re-pin images or deploy without explicit user consent, asked once
  per batch.
- Never push to a dependency PR branch; conflicts wait for a refresh (or are
  applied on `main` with consent).
- Never leave a floating tag unpinned in the deployment repo.
- Stash the user's WIP (`git stash push -m "pr-ops"`) before checkouts and
  restore it when done.

## Autonomy contract

| | Tier A | Tier B | Tier C |
|---|---|---|---|
| Research | none | changelog skim | required, with evidence |
| Merge | autonomous when CI green | autonomous when CI green + local tests | user consent required |
| Ship (rebuild/pin/deploy) | n/a — never ships | user consent | user consent, separate from the merge ask |

- Tier A/B merges proceed without prompting once their gate passes.
- Every image rebuild/pin/deploy waits for explicit go-ahead, asked once per
  batch: apps, exact commands, verification plan, and rollback.
- Tier C asks present findings, risk, recommendation, then wait.
- An explicit pre-authorization ("merge and ship whatever is safe") overrides
  these gates for the named items.
- When unsure, escalate one tier.

Tier assignment (change magnitude × impact) is documented in
[references/risk-assessment.md](references/risk-assessment.md).

## Phase 1 — Preflight

- `git status --short`; stash WIP if present.
- `gh auth status` (needs repo scope); `git fetch origin` and confirm local
  `main` == `origin/main`.
- Node 22+ (24 recommended); workspaces install from the root lockfile.

## Phase 2 — Triage

1. List PRs: `bash .agents/skills/pr-ops/scripts/list-prs.sh` (`--json` for raw).
   Skip drafts.
2. Read each PR body — it embeds the update table and release notes; grouped
   batches update more packages than the title suggests, so enumerate every
   package in the table.
3. Diff: `gh pr diff <n> --name-only` to see which manifests change, then
   `gh pr diff <n>` for details. A manifest change plus lockfile entries tells
   runtime (`dependencies`) from build-time and tooling (`devDependencies`).
4. Classify with the risk reference: magnitude (major / 0.x / minor / patch /
   node image tag) × impact (which workspaces and apps; runtime vs build vs
   tooling).
5. Check CI: `gh pr checks <n>` (job `test`, roughly a minute).

## Phase 3 — Research (Tier B/C)

Work the per-type checklists in the risk reference: express majors, chokidar
majors, exiftool-vendored majors, the node base image, UI toolchain majors.
Collect concrete evidence (versions, breaking-change and migration notes) — it
goes into the consent ask.

## Phase 4 — Validate & merge

Per approved PR, one at a time:

```bash
gh pr checkout <n>
npm ci
npm run lint
npm run check:html
npm test
gh pr merge <n> --merge
git checkout main && git pull --ff-only
```

- Tier A: CI green is the gate; a local run is optional.
- Tier B/C: run the full local suite above on the PR checkout before merging.
- `npm test` builds every UI and runs every suite; browser tests skip when no
  Chromium is available, so they are a bonus, not a gate.
- After each merge, confirm the `main` push CI passes:
  `gh run list --branch main --limit 1`.
- `gh` unusable? Fallback: `git fetch origin pull/<n>/head:pr/<n>`, validate,
  `git merge --no-ff -m "Merge pull request #<n> from <owner>/<branch>" -m "<title>" pr/<n>`,
  `git push origin main`.
- Lockfile conflict after another merge: do not hand-resolve blindly — ask for
  a dependency-bot refresh, or (with consent) apply the manifest change on
  `main` and regenerate with `npm install`.

Restore the stash once all merges are done.

## Phase 5 — Ship (on consent)

Only when the user wants merged changes running. Determine image impact from
[references/deploy-and-verify.md](references/deploy-and-verify.md), then present
one consolidated ask, then:

1. Confirm `INFRA_DIR` (the deployment-repo checkout; ask if unset) and that it
   is clean.
2. `scripts/build-all.sh --pin <apps...>` — builds the unified image once,
   pushes the requested app tags, prints the digest table, and rewrites the
   deployment templates' digests.
3. Review `git -C "$INFRA_DIR" diff` — only the intended image lines.
4. Roll out via the deployment repo's runbook (helm + rollout status), or print
   the pending commands if this machine lacks deploy access.

## Phase 6 — Verify & report

Never claim a deploy from build output alone — verify the running state per the
deploy reference.

Report format:

- **Merged** — PR number and one-line title.
- **Shipped** — apps rebuilt/pinned; deploy done or pending.
- **Held** — PR plus reason, evidence, and what the next run re-checks.
- **Pending commands** — anything this agent could not run.
