# Risk assessment

## Change magnitude

| Magnitude | Examples | Baseline |
|---|---|---|
| Patch/minor, tooling-only | root devDeps (`eslint`, `globals`, `@eslint/js`, `eslint-plugin-react-hooks`, `playwright-core` for screenshots), CI workflow bumps | Tier A — never ships in images |
| Patch/minor, UI build deps | `vite`, `@vitejs/plugin-react`, `react`, `react-dom` in every app workspace | Tier B — changes the built UIs; unit + browser tests cover it |
| Patch/minor, app runtime deps | `axios`/`exceljs` (balance-xlsx), `chokidar`/`exiftool-vendored` (file-pipelines), `express` minors | Tier B — verify the affected app's suite |
| Grouped non-major batch | one PR, many packages, branch `renovate/npm-deps-(non-major)` | Tier = riskiest member; enumerate the PR body table |
| 0.x minor | `0.5.3` → `0.6.0` | Tier B/C — 0.x minors may break; read the changelog |
| Major | `express` 4→5, `chokidar` 4→5, `exiftool-vendored` 35→39, UI majors | Tier C |
| node base image | `docker/base.Dockerfile` `node:24-slim` → `node:26-slim` | Tier C — every image plus the Node floor for the whole repo |

## Impact (what a bump can reach)

- **Shipped runtime** — anything in a workspace's `dependencies`, including
  `packages/server-kit` (all 7 apps run through it; it owns express for them).
  These end up in the app images.
- **Build-time** — devDeps used by the UI build (`vite`, `react`,
  `@vitejs/plugin-react`, `@dscpln/ui-kit`): they change the UIs that ship in
  `static/`, not server runtime.
- **Tooling-only** — root devDeps, `scripts/`, `.github/`, docs: never copied
  into images (the base Dockerfile copies only the package manifests,
  `packages/` and `apps/`).
- **App consequence** — file-pipelines (moves and deletes user media after
  verification) and task-runner (runs configured bash on user data) are the
  highest-consequence; balance-xlsx (external token API) and whatsapp-txt
  (merge outputs) next; the rest are recoverable.

## Tier rules

- **Tier A** — merge autonomously when CI is green: tooling-only patches/minors;
  docs/CI. Never triggers an image rebuild.
- **Tier B** — CI green plus local `npm test` on the PR checkout, then merge:
  non-major shipped deps (runtime, UI build, or grouped batch with no Tier C
  member).
- **Tier C** — user consent to merge: any major; a 0.x minor with breaking
  signals; a grouped batch containing either; the node base image; changes to
  `packages/server-kit` behavior; CI red or flaky; a PR that needs code changes
  to go green.
- Escalate one tier when unsure. Tier C merge consent and ship consent are
  separate asks.
- Ship tiers: tooling-only changes never ship; anything else asks for consent
  when the user wants it running (see the deploy reference for impact mapping).

## Research recipes

### Any major bump

- Start with the PR body: dependency PRs embed the release notes for every
  package, with links.
- Read upstream migration/breaking-changes notes for the exact versions, then
  grep the workspaces for the package's API usage
  (`grep -rn "from '<pkg>'\|require('<pkg>')" packages apps --include="*.mjs"`).
- Run the affected suite locally (`npm test --workspace <pkg>` or the full
  suite) on the PR checkout.

### express 4 → 5

- express 5 uses path-to-regexp v8: `*` wildcards must be named (`/*splat`),
  optional `:param?` syntax changed, regex-in-path usage changed; check
  `packages/server-kit/app.mjs` and route registrations in every app before
  merging.
- Verify the version ranges move together: `packages/server-kit`,
  `apps/balance-xlsx`, `apps/task-runner`, `apps/whatsapp-txt`.
- `83a35b6 server-kit: make the auth test express-5 compatible` is already on
  `main`; check what else the PR still needs.

### chokidar 4 → 5 (file-pipelines)

- Check the release notes for the Node version floor and ESM/CJS interop; the
  daemon watches configured folders — its tests (`daemon.test.js`) are the gate.

### exiftool-vendored 35 → 39 (file-pipelines)

- The package bundles its own exiftool build and Perl runtime, so majors often
  jump the bundled exiftool; check its release notes and the file-pipelines
  `exif`/`standardize` tests (they gate on `have()` for system tools).

### node base image

- Confirm the tag exists (`podman pull node:<tag>-slim`) and its support status
  at merge time (even-numbered April releases become LTS in October).
- Cross-check the floors: root `engines.node >= 22`, file-pipelines `>= 24`,
  CI `node-version: 24` in `.github/workflows/ci.yml` (moving CI is a separate
  change; note it in the ask).
- After merging, the rebuilt base changes every image, so treat it as a
  repo-wide ship.

### UI toolchain majors (vite / react)

- Every app workspace pins the same UI versions; a partial bump breaks the
  build, so upgrade all workspaces in one PR. Run `npm run ui` and `npm test`
  (they build every UI).

## Repo-specific couplings and gotchas

- `packages/server-kit` is express for every app; a server-kit dependency bump
  reaches all 7 apps, and balance-xlsx / task-runner / whatsapp-txt also carry
  their own express dependency.
- All apps share `vite`/`react`/`@vitejs/plugin-react` versions from their
  devDeps — bump them uniformly.
- `npm test` at the root builds every UI first; browser tests use optional
  Chromium and skip when it is unavailable, so green does not prove UI
  behavior.
- `apps/*/static/` is generated (Vite) and gitignored; never commit it.
- `npm run check:html` guards generated `ui/*.html` drift via
  `scripts/sync-app-html.mjs`; CI runs it before tests.
- Grouped batches can mix tooling, build and runtime deps — enumerate the PR
  body table, and let the riskiest member set the tier.
- `renovate.json` groups npm non-major updates into one PR and keeps majors
  separate; editing it changes future PRs, not open ones.
- Dependency PR branches are refreshed (re-pushed) when they conflict; never
  push to them yourself.

## Worked examples

- **`playwright-core` 1.63.0 → 1.64.1 (grouped non-major PR)** — root devDep
  used by the screenshot script; never ships. Tier A; merge on green, no
  rebuild.
- **express 4 → 5** — major across server-kit and three apps; path-to-regexp
  route syntax is the migration surface. Tier C; after merge, rebuild every
  app image.
- **chokidar 4 → 5 / exiftool-vendored 35 → 39** — file-pipelines runtime deps.
  Tier C; after merge, rebuild only `dscpln-file-pipelines`.
- **node 24-slim → 26-slim** — base image. Tier C; after merge, rebuild all
  images (the base is an input to every app build).
