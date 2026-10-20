# Ship & verify

"Shipping" here means: rebuild the affected app images, pin their digests in the
deployment repo, and let that repo roll them out. The apps run from the
deployment repo's Helm templates, not from this repo's source tree.

## Impact map (what to rebuild)

Determine impact from `gh pr diff <n> --name-only`, not from the lockfile alone:

| Changed | Rebuild |
|---|---|
| `docker/app.Dockerfile`, `packages/*` (`server-kit`, `ui-kit`, `test-kit`) | all 5 app tags (`scripts/build-all.sh`) |
| `apps/<app>/package.json` (deps or devDeps), `apps/<app>/ui/**` | that app tag (`scripts/build.sh <app>`) |
| `package-lock.json` | follow the manifest that changed (the rows above) |
| root `package.json` devDeps only (eslint, playwright-core, …), `scripts/`, `docs/`, `.github/`, tests | nothing — never ships |

Apps: `portal balance-xlsx file-pipelines whatsapp-txt task-runner`
(`scripts/images.sh`).

## Rebuild & pin

Every app tag is the same unified image (`docker/app.Dockerfile`); the
deployment's `APP` env selects the server. `build-all.sh` builds it once and
pushes every tag. Pinning writes each digest into
`$INFRA_DIR/targets/srv0/k3s-apps/templates/<app>.yaml` via the `TEMPLATES` map
in `scripts/images.sh`.

Preconditions:

- Merged and pushed `main`; the PR's changes validated (Phase 4).
- `INFRA_DIR` set to the deployment-repo checkout (ask the user if unset; do not
  guess) and **clean** — `--pin` refuses a dirty checkout.
- A container engine on PATH (`podman` preferred, `docker` fallback; both push
  `linux/amd64`). Registry auth for `docker.io/imranrdev` must be active; a
  failed push means `podman/docker login`.

```bash
scripts/build-all.sh --pin <apps...>      # subsets: scripts/build-all.sh --pin file-pipelines
git -C "$INFRA_DIR" diff -- targets/      # only the intended image digest lines
```

- The digest table printed at the end is the source of truth for what to
  verify; `build-all.sh` fails if a digest cannot be parsed.
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

- Built digest from the `digests` table matches the pinned line:
  `grep image "$INFRA_DIR/targets/srv0/k3s-apps/templates/<app>.yaml"`.
- Running image matches the pin after rollout:
  `kubectl -n apps get deploy <name> -o jsonpath='{.spec.template.spec.containers[0].image}'`.
- `kubectl -n apps rollout status deploy/<name> --timeout=120s` for each
  rebuilt app.
- App health: `GET ${BASE_PATH}/api/health` for each app (root `/api/health`
  also answers), and the portal's status pills / "N need attention" count.
- Scheduled apps: `GET /<path>/api/state` shows no missed/broken last run.
- Browser apps: open the UI once when the bump touched the UI toolchain.

## When not to ship

- Tooling-only PRs (root lint/screenshot deps, CI, docs, scripts): say
  explicitly that no image rebuild is needed.
- The user only wanted merges: report the ship as pending, with the exact
  commands, and stop.
