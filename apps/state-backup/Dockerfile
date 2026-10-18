FROM imranrdev/dscpln-base:latest

ARG RESTIC_VERSION=0.19.1
ARG KUBECTL_VERSION=v1.34.1

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssh-client rsync ca-certificates curl bzip2 \
    && curl -fsSL "https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_linux_amd64.bz2" -o /tmp/restic.bz2 \
    && bzip2 -d /tmp/restic.bz2 \
    && install -m 0755 /tmp/restic /usr/local/bin/restic \
    && curl -fsSL "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl" -o /usr/local/bin/kubectl \
    && chmod 0755 /usr/local/bin/kubectl \
    && rm -rf /var/lib/apt/lists/* /tmp/restic

WORKDIR /app
# The shared base image contains the rest of the monorepo. Add the new
# workspace and install its workspace link before building the UI.
COPY apps/state-backup ./apps/state-backup
RUN npm install --no-audit --no-fund \
    && npm run build:ui --workspace dscpln-state-backup \
    && npm prune --omit=dev

ENV NODE_ENV=production
# The Main tree is mounted at this path so absolute app-data paths resolve.
ENV HOME=/home/node
ENV DSCPLN_DATA_DIR=/data
ENV TZ=America/Toronto
EXPOSE 8080

USER node

CMD ["node", "apps/state-backup/server.mjs"]

# Build from the monorepo root:
#   podman build --platform linux/amd64 -f apps/state-backup/Dockerfile -t docker.io/imranrdev/dscpln-state-backup:latest .
