# Ship & verify

"Shipping" here means: pin the published app image digests in the deployment
repo and let that repo roll them out. CI publishes all five tags from every
green `main` build; pinning and deploying are the consent-gated parts. The apps
run from the deployment repo's Helm templates, not from this repo's source tree.

## Impact map (what to rebuild)

Determine impact from `gh pr diff <n> --name-only`, not from the lockfile alone:

| Changed | Rebuild |
|---|---|
| `docker/app.Dockerfile`, `packages/*` (`server-kit`, `ui-kit`, `test-kit`) | all 5 app tags (CI does this on merge) |
| `apps/<app>/package.json` (deps or devDeps), `apps/<app>/ui/**` | that app tag locally (`scripts/build.sh <app>`); CI still tags all five |
| `package-lock.json` | follow the manifest that changed (the rows above) |
| root `package.json` devDeps only (eslint, playwright-core, …), `scripts/`, `docs/`, tests | nothing — image contents are unchanged, though CI still publishes a new digest |
| `.github/workflows/ci.yml` | nothing in the image; verify a publish-pipeline change with a `workflow_dispatch` run |

Apps: `portal balance-xlsx file-pipelines whatsapp-txt task-runner`
(`scripts/images.sh`).

## Rebuild & pin

Every app tag is the same unified image (`docker/app.Dockerfile`); the
deployment's `APP` env selects the server. CI builds it once and pushes every tag
after each green `main` build. Pinning writes each digest into
`$INFRA_DIR/targets/srv0/k3s-apps/templates/<app>.yaml` via the `TEMPLATES` map
in `scripts/images.sh`.

Preconditions:

- Merged and pushed `main`; the PR's changes validated (Phase 4).
- The `publish` job is green for that commit (preferred), or a container engine
  is available for a local fallback.
- `INFRA_DIR` set to the deployment-repo checkout (ask the user if unset; do not
  guess) and **clean** — `--pin` refuses a dirty checkout.
- Local fallback only: a container engine on PATH (`podman` preferred, `docker`
  fallback; both push `linux/amd64`) and active GHCR auth. Local pushes need a
  PAT with `write:packages` (`podman/docker login ghcr.io`).

Preferred flow — pin the CI build without rebuilding:

```bash
gh run download <run-id> -n image-digests-<sha>
# the artifact contains ready-to-paste `image:` lines; drop them into the
# matching deployment templates, then review:
git -C "$INFRA_DIR" diff -- targets/
```

Manual fallback — only when CI did not publish and a local rebuild is approved:

```bash
scripts/build-all.sh --pin <apps...>      # subsets: scripts/build-all.sh --pin file-pipelines
git -C "$INFRA_DIR" diff -- targets/      # only the intended image digest lines
```

- The digest table in the CI run summary/artifact (or the local build output) is
  the source of truth; `build-all.sh` fails if a digest cannot be parsed.
- `scripts/build-all.sh --pin` rewrites both the registry/org reference and the
  digest, which also handles the one-time Docker Hub → GHCR cutover.
- Do not commit the pin here: commit it through the deployment repo's own
  workflow, then roll out from there. If that machine renders uncommitted files
  (Helm does), deploy only after the pin is committed there.
- Rollback is a redeploy of the previous pinned digest (revert the pin in the
  deployment repo; images are immutable).

## Rollout

The deployment repo owns deployment access (kubeconfig unlock, Helm releases).
Follow its runbook; the shape is:

```bash
helm upgrade --install <release> <chart> -n apps
kubectl -n apps rollout status deploy/<deployment> --timeout=120s
```

If this machine cannot reach the cluster, print the pending commands instead of
running them — never claim a deploy you did not verify.

## Verification checklist

- Published digest (CI summary/artifact or local build table) matches the pinned
  line: `grep image "$INFRA_DIR/targets/srv0/k3s-apps/templates/<app>.yaml"`.
- Running image matches the pin after rollout:
  `kubectl -n apps get deploy <name> -o jsonpath='{.spec.template.spec.containers[0].image}'`.
- `kubectl -n apps rollout status deploy/<name> --timeout=120s` for each
  rebuilt app.
- App health: `GET ${BASE_PATH}/api/health` for each app (root `/api/health`
  also answers), and the portal's status pills / "N need attention" count.
- Scheduled apps: `GET /<path>/api/state` shows no missed/broken last run.
- Browser apps: open the UI once when the bump touched the UI toolchain.

## When not to ship

- Tooling-only PRs (root lint/screenshot deps, CI, docs, scripts): image contents
  are unchanged, but CI still publishes a new digest. Say explicitly that no
  pin/deploy is needed unless the user wants that build running.
- The user only wanted merges: report the ship as pending, with the exact
  commands (the images have already been published by CI), and stop.
