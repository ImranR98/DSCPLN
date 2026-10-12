FROM imranrdev/dscpln-base:latest

RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

# Build this app's UI, then drop the build-time dependencies from the shared
# base image's workspace install.
RUN npm run build:ui --workspace dscpln-balance-xlsx \
    && npm prune --omit=dev
USER node
CMD ["node", "apps/balance-xlsx/server.mjs"]

# Build from the monorepo root:
#   podman build --platform linux/amd64 -f apps/balance-xlsx/Dockerfile -t docker.io/imranrdev/dscpln-balance:latest .
# The app reads config.json from the working directory (or DSCPLN_CONFIG).
# The workbook (providers.<name>.workbookFile) must live in a git repository
# writable by the container user so changes can be committed.
