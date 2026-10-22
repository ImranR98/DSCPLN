# D$CPLN Agent

A small, generic archive agent for hosts that the Task Runner should not reach
over SSH. One image runs on every host; the mounted configuration decides which
paths that host allows the agent to archive.

```
ghcr.io/imranr98/dscpln-agent:latest
```

The agent has no personal paths, hostnames, or credentials. Those belong in the
private config/repo mounted into the container.

## How it works

- The agent exposes `POST /v1/jobs/<job-id>/archive`.
- A job is an `archive` job: a configured root, optional excludes, `tar.gz`
  output, and a size limit.
- The request contains no path or command. It can only name a configured job.
- The Task Runner downloads the archive and can run follow-up commands (for
  example, restic).
- On first use, the Task Runner generates the bearer token itself, enrolls it
  with `POST /v1/enroll`, and then calls the archive endpoint. No manual token
  creation or copying is required.
- The agent stores only a SHA-256 hash of the token, in
  `<stateDir>/token.sha256` with mode `0600`.
- The first enrollment is trust-on-first-use, restricted by source CIDR and an
  optional startup window. Bind the agent to a private network, firewall it to
  the Task Runner, and use TLS where the network is not fully trusted.

## Configuration

Mount a JSON config at `/config/agent.json` (or set
`DSCPLN_AGENT_CONFIG=/path/to/agent.json`).

```json
{
  "listen": "0.0.0.0",
  "port": 8788,
  "stateDir": "/state",
  "enrollment": {
    "windowSeconds": 0,
    "allowFrom": [
      "10.0.0.0/8",
      "192.168.0.0/16"
    ]
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

Job fields:

| Field | Description |
|---|---|
| `type` | `archive` (the only type for now) |
| `root` | Absolute directory to archive |
| `include` | Optional list of relative glob patterns; when set, only matching paths are archived |
| `exclude` | Optional list of tar exclude patterns |
| `format` | `tar.gz` |
| `maxBytes` | Maximum archive size; defaults to 1 GiB |
| `timeoutSeconds` | Maximum tar runtime; defaults to 30 minutes |

Enrollment fields:

| Field | Description |
|---|---|
| `enabled` | Set `false` to disable first-use enrollment entirely |
| `windowSeconds` | Seconds after agent start in which enrollment is allowed; `0` disables the time limit |
| `allowFrom` | Source CIDRs allowed to enroll |

The defaults allow loopback and RFC1918 addresses. Set `allowFrom` to the
Task Runner's address/subnet and keep the agent off public interfaces.

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

- `GET /healthz` — unauthenticated liveness check
- `POST /v1/enroll` — bearer token; stores its hash; `204` on success
- `POST /v1/jobs/<job-id>/archive` — bearer token; returns `application/gzip`

The archive response includes:

- `X-DSCPLN-SHA256` — archive SHA-256
- `X-DSCPLN-Summary` — a short summary

Only one archive runs at a time per agent; concurrent requests receive `429`.

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

Replace the bind address, UID/GID, and paths in the private deployment. The
`/state` volume must persist so enrollment survives restarts.

With Compose bridge networking, the agent sees the Docker bridge gateway as the
source address, not the remote host. Either include the bridge subnet in
`enrollment.allowFrom`, or use `network_mode: host` and set `listen` to the
private host address when you want to allow only the Task Runner's address.
Host networking is the clearer choice for a narrow `allowFrom` rule.

Create the state directory with the agent UID/GID (for example
`install -d -o 1000 -g 1000 ./agent-state`) so the token hash and temporary
archives are writable.

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

The same image is used on every host. The configuration, token state, and data
mounts are host-specific and live in the private deployment repo.
