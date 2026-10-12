FROM imranrdev/dscpln-base:latest

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssh-client tar ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Build this app's UI, then drop the build-time dependencies from the shared
# base image's workspace install.
RUN npm run build:ui --workspace dscpln-compose \
    && npm prune --omit=dev

ENV NODE_ENV=production
# The Main tree is mounted at this path so ~/Main defaults resolve; config,
# state and known_hosts live on DSCPLN_DATA_DIR (PVC).
ENV HOME=/home/node
ENV DSCPLN_DATA_DIR=/data
ENV TZ=America/Toronto
EXPOSE 8080

USER node

CMD ["node", "apps/compose-state/server.mjs"]

# Build from the monorepo root:
#   podman build --platform linux/amd64 -f apps/compose-state/Dockerfile -t docker.io/imranrdev/dscpln-compose:latest .
