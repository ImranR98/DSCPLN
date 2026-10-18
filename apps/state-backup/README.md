# State Backups

Scheduled restic backups of the K3s application PVCs and the srv0/vps0 Compose
runtime state. One repository holds both sources, so there is one schedule,
one Run-now button and one snapshot history.

This app is **backup-only**. Restore is a separate operator command in the
Infra repo (`scripts/restic-restore.sh`), because a fresh cluster cannot rely
on this app being deployed.

## What a run does

1. Lists PVCs labelled `auto-backup=true` with `kubectl`.
2. Maps each to its host path under `appDataRoot`.
3. Fetches each SSH Compose target into a temporary staging directory.
4. Runs `restic backup` over the app-data paths, the local Compose state and
   the fetched Compose state.
5. Applies `restic forget --keep-last <retention> --prune`.
6. Runs `restic check --read-data-subset=1%`.

## Configuration

| Field | Meaning |
|---|---|
| `destination` | restic repository path (default `~/Main/Infra/state_backups/restic`) |
| `appDataRoot` | host path containing `nfs-apps/<namespace>/<pvc>` |
| `appDataLabel` | PVC label selector (default `auto-backup=true`) |
| `targets` | `[{ name, mode: 'local' \| 'ssh', host, user, path }]` for Compose state |
| `retention` | number of restic snapshots to keep (default 7) |
| `resticPassword` | secret; defaults to the app's built-in value when blank |
| `sshPublicKey` / `sshPrivateKey` | key shown in Settings; the deployment can mount a key instead |
| `schedule` / `notifySuccess` | cron-like schedule and success notifications |

The deployment mounts the existing vps0 key as `SSH_KEY_FILE`; the app then
uses it instead of its config field. Set `SSH_PUBLIC_KEY_FILE` to show the
matching public key in Settings.

## Running

```sh
npm start --workspace dscpln-state-backup
```

Container: mount a writable volume at `/data`, the restic repository, the
app-data root, the Compose state, and the SSH key Secret.

## Development

```sh
npm run build:ui --workspace dscpln-state-backup
npm test --workspace dscpln-state-backup
```
