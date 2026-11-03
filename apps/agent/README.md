# D$CPLN Agent

**Archive configured directories from another machine.**

The agent is a small headless service for files that the Task Runner should not
reach through a shared filesystem or remote shell. One image runs on every
host; a private config decides which archive jobs that host exposes.

## Do I need it?

Use the agent when:

- files live on a machine that is not the Task Runner host;
- mounting that machine's filesystem into Task Runner is inconvenient or
  unsafe;
- you want a narrow API that can only run preconfigured archive jobs.

Do not use it for arbitrary remote commands. The agent accepts a job ID, not a
path or a shell command.

## At a glance

| | |
|---|---|
| Image | `ghcr.io/imranr98/dscpln-agent:latest` (slim) or `dscpln-agent-gtk:latest` |
| Config | `/config/agent.json`, or `DSCPLN_AGENT_CONFIG` |
| State | `stateDir` in the agent config |
| API | `POST /v1/jobs/<job-id>/archive` and `/run` |
| First use | Task Runner generates a token and enrolls it |
| Security | Trust-on-first-use, restricted by source CIDR |

## How it works

1. You define a job in the agent config. An `archive` job has a root path and
   optional filters; a `process` job has a fixed binary, args, config file and
   output directory.
2. The Task Runner calls `POST /v1/jobs/<job-id>/archive` or
   `POST /v1/jobs/<job-id>/run`.
3. Archive jobs return a `tar.gz` with a SHA-256 header; process jobs run the
   configured binary and return a JSON summary.
4. The Task Runner downloads the archive or records the summary and runs any
   follow-up commands.
5. On first use, the Task Runner generates a bearer token, enrolls it with
   `POST /v1/enroll`, and reuses the stored token.

The request never supplies a command or a path. Archive roots, process
binaries, args, and output directories all come from the deployment-owned
agent config. Process jobs accept only an optional config file body.

The agent stores only a SHA-256 hash of the token, in
`<stateDir>/token.sha256` with mode `0600`. No token needs to be created by
hand.

## Configuration

Mount a JSON config at `/config/agent.json`:

```json
{
  "listen": "0.0.0.0",
  "port": 8788,
  "stateDir": "/state",
  "enrollment": {
    "windowSeconds": 0,
    "allowFrom": ["10.0.0.0/8"]
  },
  "jobs": {
    "example-archive": {
      "type": "archive",
      "root": "/data/example",
      "exclude": ["**/*.log"],
      "format": "tar.gz",
      "maxBytes": 1073741824
    }
  }
}
```

A process job runs a deployment-configured binary. The request body, when
`configFile` is set, is written to `<configDir>/<configFile>`; the binary can
write to `outputDir` and print JSON for the summary/success check:

```json
{
  "jobs": {
    "example-process": {
      "type": "process",
      "binary": "/state/tool/bin/tool",
      "args": ["--config", "{configDir}", "--output", "{outputDir}"],
      "configDir": "/state/tool/config",
      "configFile": "config.yaml",
      "outputDir": "/data/output",
      "home": "/home/user",
      "timeoutSeconds": 1800,
      "result": {
        "json": "overall",
        "summary": "tool: {processedGames} games",
        "require": { "processedGames": 1 }
      }
    }
  }
}
```

Archive job fields:

| Field | Description |
|---|---|
| `type` | `archive` |
| `root` | Absolute directory to archive |
| `include` | Optional relative glob patterns; when set, only matching paths are archived |
| `exclude` | Optional tar exclude patterns |
| `ignoreReadErrors` | Continue when live files vanish or change while tar reads them. Tar exit 1 is treated as a usable snapshot |
| `format` | `tar.gz` |
| `maxBytes` | Maximum archive size; defaults to 1 GiB |
| `timeoutSeconds` | Maximum tar runtime; defaults to 30 minutes |

Process job fields:

| Field | Description |
|---|---|
| `type` | `process` |
| `binary` | Absolute path to the executable |
| `args` | Fixed string list; `{configDir}`, `{configFile}` and `{outputDir}` are substituted from the job config |
| `configDir` | Absolute writable directory for the config, manifest/cache and `XDG_CACHE_HOME` |
| `configFile` | File name inside `configDir` that receives the request body; omit to run without a body |
| `outputDir` | Optional absolute output directory, created before the run |
| `home` | Optional `HOME` for the process (`~` paths in tools such as Ludusavi) |
| `timeoutSeconds` | Maximum runtime; defaults to 30 minutes |
| `maxStdoutBytes` | Maximum captured stdout; defaults to 16 MiB |
| `result.json` | Optional dot path to the JSON node used for summary/require |
| `result.summary` | Optional summary template; `{field}` reads from the result node |
| `result.require` | Optional map of field → minimum numeric value |

`timeoutSeconds` applies to both job types.

Enrollment fields:

| Field | Description |
|---|---|
| `enabled` | Set `false` to disable first-use enrollment |
| `windowSeconds` | Seconds after startup when enrollment is allowed; `0` disables the time limit |
| `allowFrom` | Source CIDRs allowed to enroll |

The defaults allow loopback and RFC1918 addresses. Set `allowFrom` to the Task
Runner's address or subnet and keep the agent off public interfaces.

Optional TLS:

```json
{
  "tls": {
    "certFile": "/config/tls.crt",
    "keyFile": "/config/tls.key"
  }
}
```

## API

- `GET /healthz`: unauthenticated liveness check.
- `POST /v1/enroll`: bearer token; stores its hash; `204` on success.
- `POST /v1/jobs/<job-id>/archive`: bearer token; returns
  `application/gzip`.
- `POST /v1/jobs/<job-id>/run`: bearer token; runs a `process` job. The body
  is the config file when the job sets `configFile`. Returns JSON with
  `summary` and `durationMs`.

The archive response includes:

- `X-DSCPLN-SHA256`: archive SHA-256.
- `X-DSCPLN-Summary`: a short summary.

Only one job runs at a time per agent; concurrent requests get `429`.

## Artifact fetch helper

The agent images include `fetch-artifact.sh` for initContainers that download a
versioned `.tar.gz` release into a canonical destination. It is deliberately
version-keyed: the same version is reused indefinitely, while a different
version replaces the binary and prunes stale copies. There is no checksum or
time-based refresh.

| Variable | Description |
|---|---|
| `ARTIFACT_URL` | Release archive URL |
| `ARTIFACT_VERSION` | Cache key, version stamp and check needle |
| `ARTIFACT_DEST` | Canonical destination path |
| `ARTIFACT_MEMBER` | File name inside the tar archive |
| `ARTIFACT_CHECK_ARGS` | Optional args that print the version, e.g. `--version` |

The GTK image (`dscpln-agent-gtk`) contains the GTK3 runtime needed by tools
such as Ludusavi; the slim image is the default for archive-only agents. Both
images contain the same process/artifact code.

## Compose example

```yaml
services:
  dscpln-agent:
    image: ghcr.io/imranr98/dscpln-agent:latest
    restart: unless-stopped
    user: "1000:1000"
    read_only: true
    cap_drop: [ALL]
    security_opt:
      - no-new-privileges:true
    ports:
      - "10.0.0.5:8788:8788"
    volumes:
      - ./agent.json:/config/agent.json:ro
      - ./archive-data:/data:ro
      - ./agent-state:/state
    tmpfs:
      - /tmp
```

Replace the bind address, UID/GID and paths in your private deployment. The
`/state` volume must persist so enrollment survives restarts.

With Compose bridge networking, the agent sees the Docker bridge gateway as the
source address, not the remote host. Either include the bridge subnet in
`enrollment.allowFrom`, or use `network_mode: host` and bind `listen` to the
private host address. Host networking is the clearer choice for a narrow
`allowFrom` rule.

Create the state directory with the agent UID/GID:

```sh
install -d -o 1000 -g 1000 ./agent-state
```

## Task Runner setup

The Task Runner calls the agent through a generic `webhook` task. The task needs
a URL, a persistent `tokenFile`, and optionally an `enrollUrl`. See
[Webhook tasks](../task-runner/README.md#webhook-tasks) for the full example.

Keep the token file on persistent storage, not in the per-run temporary
directory. If the token file is lost, the agent will not recognize the new
client until it is re-enrolled.

## Token rotation

To re-enroll:

1. Delete the client's `tokenFile`.
2. Delete `<stateDir>/token.sha256` on the agent.
3. Run the webhook task again; the client generates a new token and enrolls it.

No token needs to be created by hand.

## Building

```sh
scripts/build-agent.sh
```

This builds and pushes both `dscpln-agent` (slim, Alpine) and
`dscpln-agent-gtk` (Debian + GTK3). The same code runs on every host;
configuration, token state, runtime image choice and data mounts are
host-specific and belong in the private deployment repository.
