# Operations

This page covers deployment, images, health checks, upgrades, backups and the
optional remote agent. For first-time setup, start with
[Getting started](GETTING-STARTED.md).

## How a deployment is shaped

Each app is an independent container. The Portal links them together and shows
their health, but it is not required for the other apps to run.

A typical deployment has:

- one container per app, with persistent config and data volumes;
- a reverse proxy or ingress for a single hostname;
- one Task Runner instance with schedules enabled if you use scheduled tasks;
- optionally, one D$CPLN Agent per remote machine that the Task Runner needs to
  archive.

The apps only need a writable config/state location and the paths they are
configured to use. There is no central database.

## Images and digests

Published images:

| Image | Purpose |
|---|---|
| `ghcr.io/imranr98/dscpln-portal` | Portal |
| `ghcr.io/imranr98/dscpln-balance` | Balance XLSX |
| `ghcr.io/imranr98/dscpln-file-pipelines` | File Pipelines |
| `ghcr.io/imranr98/dscpln-watxt` | WhatsApp TXT |
| `ghcr.io/imranr98/dscpln-task-runner` | Task Runner |
| `ghcr.io/imranr98/dscpln-lockdown` | Lockdown |
| `ghcr.io/imranr98/dscpln-agent` | Remote archive agent |

The app tags are built from one unified image; the `APP` environment
variable selects the server at runtime. The agent is a separate image.

CI builds and publishes after every green `main` build. The publish job writes
the image digests to the run summary and uploads them as an
`image-digests-<sha>` artifact. Pin those digests in your deployment; a
floating `latest` tag does not update a running container.

Renovate refreshes the pinned digests, the Node `26-*` base image digests,
the restic/kubectl versions and every package dependency. Node Docker majors
are proposed as PRs but not auto-merged until the new major is the project's
chosen LTS. Digest PRs from this repo are what eventually move the deployment
templates in the infra repo.

For a local or offline build:

```sh
scripts/build.sh <app>       # build one app from the unified image
scripts/build-all.sh         # build and push every app tag
scripts/build-agent.sh       # build and push the agent
```

`scripts/build-all.sh` can also write the published digests into a deployment
checkout with `--pin` (see the script for the required directory variables).
`REGISTRY` and `IMAGE_ORG` choose the registry destination; local pushes need a
token with package-write permission.

### Private GHCR packages

New GHCR packages are private by default. Either make the seven `dscpln-*`
packages public, or add an `imagePullSecret` with `read:packages` to the
deployment. Do not put registry credentials in this repository.

## Reverse proxy and base paths

Run apps on separate ports when you are trying them out. For one hostname, set
`BASE_PATH` per app and route that prefix to the matching container:

| App | Base path |
|---|---|
| Portal | `/` (always) |
| Balance XLSX | `/balance` |
| File Pipelines | `/pipelines` |
| WhatsApp TXT | `/watxt` |
| Task Runner | `/tasks` |
| Lockdown | `/lockdown` |

The apps generate links relative to their base path. The Portal intentionally
ignores `BASE_PATH` and uses absolute subpaths.

If the proxy provides authentication, leave the app APIs behind the same
protection unless the app documents a token-protected endpoint. The Balance
external API is protected by its own bearer token; the Portal notification
relay must be reachable by the other apps without the user-facing login header.

## Health, status and logs

- Every app exposes `GET <basePath>/api/health`.
- The Portal polls each app and shows `online`, `unreachable` and a short
  detail line. A down app still has a working link.
- Container logs: `docker compose logs <service>` or
  `kubectl -n <namespace> logs deploy/<name>`.
- File Pipelines keeps its activity log in the configured `logDir`.
- Task Runner writes the last run to its state directory and exposes it in the
  UI and `/api/log`.

Run one health check directly:

```sh
curl -fsS http://localhost:8085/tasks/api/health
```

## Upgrades and rollbacks

1. Read the release notes or changed README page.
2. Back up config and state.
3. Pin the new image digest in the deployment.
4. Apply the change and watch the rollout.
5. Check `/api/health` and the app's main page.

To roll back, restore the previous image digest and, if the data format
changed, the matching state/config backup. Keep config and state on volumes so
replacing a container does not remove them.

## Backups

Back up the things you cannot rebuild:

| What | Where |
|---|---|
| Private config repo | Your git remote or config backup |
| Balance workbook | Its git repository; also back up the workbook directory |
| File Pipelines state, review and trash dirs | The configured data volume |
| WhatsApp TXT conversations | Its data directory |
| Task Runner config and state | The private config repo and `BACKUPCTL_STATE_DIR` |
| Portal settings | Its config file/volume |
| Agent state | Its `stateDir` (contains the enrollment hash) |

The Balance workbook must live in a git repository; the app commits every write
there. File Pipelines moves cleaned originals to trash instead of deleting them
immediately. Neither behavior replaces a backup of the volume.

## Notifications

The Portal owns the notification channel. Configure its ntfy URL and token in
Portal Settings, then set `DSCPLN_PORTAL_URL` on apps that should send
notifications. If the Portal is unavailable, notifications are skipped; the
sending app's state and logs still record the run.

## Remote archive agent

Use the [D$CPLN Agent](../apps/agent/README.md) when Task Runner needs files
from another machine and you do not want to expose a shared filesystem or a
remote shell.

The agent:

- exposes only configured archive jobs;
- accepts a job ID, never an arbitrary path or command;
- returns a `tar.gz` archive and a SHA-256 header;
- enrolls a Task Runner-generated token on first use and stores only its hash.

Run it on the remote host, restrict enrollment to the Task Runner's address,
and keep its config/state on persistent storage. The Task Runner-side setup is
a generic `webhook` task; see the
[Task Runner webhook documentation](../apps/task-runner/README.md#webhook-tasks).

## Troubleshooting

**A container restarts or exits**

Check its logs first. Common causes are a missing mounted path, an invalid
config file, a port conflict or a read-only config directory that the app needs
to write.

**The portal says an app is unreachable**

Check the app container, its port and its base path. The health URL must match
the path configured in the Portal's card list.

**A config edit did not apply**

Most apps load config at startup. Restart the container after editing a mounted
file. Settings saved through the UI are written atomically and usually apply
immediately.

**A Task Runner task cannot find a path**

The path must exist inside the Task Runner container and be readable by the
task user. Check the volume mount and `run_as` setting.

**An image cannot be pulled**

Make the GHCR package public or configure an `imagePullSecret`. Verify the
digest, not just the tag, when debugging a stale deployment.

**A scheduled task missed a run**

Check that exactly one instance has schedules enabled, that the task is
unattended-compatible, and whether the instance was down over the scheduled
time. `catchUp: true` runs missed occurrences; `catchUp: false` records them as
missed.
