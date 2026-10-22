# Lockdown

**Block configured host ports for a limited time.**

Lockdown sends a named preset to a privileged port-blocker container. The
blocker applies nftables rules in the host network namespace and expires timed
rules in the kernel. The browser never talks to the blocker directly, and the
blocker never accepts arbitrary ports or commands.

Presets are deployment data, not app defaults. The public app contains no host
names, addresses or personal port choices; mount a private config to define
them.

## At a glance

| | |
|---|---|
| Runs at | `/lockdown` (or port `8086` locally) |
| Config | `LOCKDOWN_CONFIG`, default `/config/config.json` |
| Access | Your existing D$CPLN ingress and auth |
| Block duration | 10 minutes to 24 hours; individual presets may allow indefinite |
| Persistence | nftables only; a host reboot clears all blocks |

## Preset config

See [`config.example.json`](config.example.json) for the full schema. A preset
defines:

- `id`: stable identifier used by the UI and blocker
- `label`, `short`, `effect`, `warning`: user-facing copy
- `protocol`: `tcp` or `udp`
- `direction`: `input` or `output`
- `ports`: one or more ports
- `allowIndefinite`: whether “until cleared” is permitted
- `defaultDurationSeconds`: initial timed duration
- `confirmation`: exact phrase required before applying
- `danger`: whether the confirmation uses the danger action style

The UI server and blocker read the same read-only config. The browser can only
submit a preset ID; ports are never accepted from the browser.

## Quick start

Run the blocker with a token and a config, then the UI:

```sh
LOCKDOWN_CONFIG="$PWD/apps/lockdown/config.example.json" \
  PORT_BLOCKER_TOKEN=dev-token node apps/lockdown/blocker.mjs

LOCKDOWN_CONFIG="$PWD/apps/lockdown/config.example.json" \
  PORT_BLOCKER_URL=http://127.0.0.1:8794 \
  PORT_BLOCKER_TOKEN=dev-token \
  npm run lockdown
```

The blocker requires `nft` and `CAP_NET_ADMIN` on the host network. In a
Kubernetes deployment it is a separate host-network pod.

## API

The UI server exposes:

- `GET /lockdown/api/status`
- `POST /lockdown/api/block`
- `POST /lockdown/api/clear`

The block body is `{preset, durationSeconds|null, confirmation}`. Durations are
integer seconds from 600 through 86400. The blocker API is internal and
bearer-token protected.

## Deployment

Deploy the UI and the port blocker with a read-only mount of your private
`apps/lockdown/config.json`, and supply a shared `PORT_BLOCKER_TOKEN` secret.
The exact deployment manifests belong in your deployment repository, not this
one.

The app is designed to be routed like any other D$CPLN app. Its confirmation
dialogs explain the ports, duration, access impact and reboot behaviour for the
preset you configured.

## Development

```sh
npm test   # build the UI and run config/server/UI tests
```
