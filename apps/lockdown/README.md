# Lockdown

**Block selected srv0 host ports for a limited time.**

Lockdown is a small D$CPLN control app for emergency containment. It sends a
preset to a privileged port-blocker container, which applies nftables rules in
the srv0 host network namespace. The browser never talks to the blocker
directly, and the blocker never accepts arbitrary ports or commands.

## At a glance

| | |
|---|---|
| Runs at | `/lockdown` (or port `8086` locally) |
| Config | `PORT_BLOCKER_URL`, `PORT_BLOCKER_TOKEN` |
| Access | D$CPLN ingress, Authelia admin policy |
| Block duration | 10 minutes to 24 hours; `vpn-only` can be indefinite |
| Persistence | nftables only; a srv0 reboot clears all blocks |

## Presets

| Preset | Ports | Indefinite |
|---|---|---|
| `vpn-only` | TCP 80, 8443 | Yes |
| `traefik-off` | TCP 80, 443, 8443 | No |
| `srv0-tunnel-cut` | UDP 51822 outbound | No |

`vpn-only` cuts the public path through vps0 while leaving TCP 443 available
over VPN or LAN. `traefik-off` cuts all Traefik ingress, so this page is
unreachable until the timer expires or srv0 reboots. `srv0-tunnel-cut` blocks
the srv0 side of the public-exposure tunnel, which also removes the VPN path;
the page remains available only on the LAN.

Every action requires an informational confirmation dialog and an exact
phrase. The UI warns that nftables rules do not survive a reboot.

## Quick start

The UI needs the blocker. For local development, run the blocker with a token
and a local nftables-capable host:

```sh
PORT_BLOCKER_TOKEN=dev-token node apps/lockdown/blocker.mjs
PORT_BLOCKER_URL=http://127.0.0.1:8794 PORT_BLOCKER_TOKEN=dev-token npm run lockdown
```

The blocker requires `nft` and `CAP_NET_ADMIN` on the host network. In the
Kubernetes deployment it is a separate host-network pod pinned to srv0.

## API

The UI server exposes:

- `GET /lockdown/api/status`
- `POST /lockdown/api/block`
- `POST /lockdown/api/clear`

The block body is `{preset, durationSeconds|null, confirmation}`. Durations are
integer seconds from 600 through 86400. The blocker API is internal and
bearer-token protected.

## Deployment

The Kubernetes template is `targets/srv0/k3s-apps/templates/lockdown.yaml` in
the private Infra repo. It creates:

- the UI Deployment and Service;
- the port-blocker Deployment with `hostNetwork`, `CAP_NET_ADMIN` and a PVC-free
  nftables state;
- a generated token Secret shared by both;
- a NetworkPolicy allowing only the UI to call the blocker.

The app is routed on both `websecure` and `websecure-proxy`, behind the usual
D$CPLN geoblock, CrowdSec and Authelia filters.

## Development

```sh
npm test   # build the UI and run policy/server tests
```
