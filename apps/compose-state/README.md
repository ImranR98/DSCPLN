# Infra Compose State

Scheduled backups of Docker Compose runtime state. For each target it captures
what Compose knows about the running stack (containers, networks, volumes and
list output) into a timestamped archive, keeps the newest `retention` archives
per target, and notifies through the portal on failures (and optionally successes).

Targets run in one of two modes:

- `local` — the app runs Compose itself (the container needs access to the
  Docker socket/state directory you point it at).
- `ssh` — the app opens an SSH connection to a remote host and streams the
  state back. The app generates its own key pair; add the public key shown in
  Settings to the remote's `authorized_keys`.

## Configuration

| Field | Meaning |
|---|---|
| `targets` | `[{ name, mode: 'local' \| 'ssh', host, user, path }]`; `path` is the directory holding the Compose runtime state to archive (`~/Infra/current_target/compose_live_state` style paths are just examples) |
| `destination` | where archives are written (default `~/compose_state_backups`) |
| `retention` | archives kept per target (default 1; the old archive is removed only after the new one is written) |
| `sshPublicKey` / `sshPrivateKey` | generated on first boot; the private half lives on the app's volume (masked in API responses) |
| `schedule` / `notifySuccess` | `{enabled, days, at, catchUp}` (default Sundays 04:00) and whether successful runs notify |

A fresh install starts with no targets — add them in Settings and press Save;
the run summary lists the target names.

## Running

```sh
npm start --workspace dscpln-compose       # http://localhost:8080
```

Container: mount a writable volume for config/state (the image uses `/data`),
and mount the archives destination plus whatever local Compose state the
targets point at.

## Development

UI is React under `ui/` (built into `static/`):

```sh
npm run build:ui --workspace dscpln-compose
npm test --workspace dscpln-compose        # builds, then unit + browser tests
```
