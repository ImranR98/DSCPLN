# D$CPLN unified app image: one build, six tags.
#
# The image contains the whole monorepo, every app's production dependencies
# and the superset of runtime tools. Deployments select the app with APP=...
# (see docker/entrypoint.sh); system packages are therefore shared instead of
# copied into six near-identical images.
#
# The app requires Node 26+, so pin the 26 line rather than `lts` (which still
# points at Node 24 until 26 reaches LTS). Renovate pins/refreshes the digest;
# Node majors are proposed as PRs but not auto-merged (see renovate.json).
FROM node:26-slim

ARG RESTIC_VERSION=0.19.1
ARG KUBECTL_VERSION=v1.37.1

WORKDIR /app

# Runtime tools used by one or more apps:
#   file-pipelines: ffmpeg, perl, rsync, tar
#   whatsapp-txt:   unzip
#   balance-xlsx:   git (workbook commits)
#   task-runner:    restic, kubectl, adb, python3, age, jq
#   lockdown:       nftables (privileged port-blocker mode)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash rsync git age jq unzip tar wget nftables \
        python3 python3-venv python3-pip ca-certificates adb curl bzip2 \
        ffmpeg perl gzip \
    && curl -fsSL "https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_linux_amd64.bz2" -o /tmp/restic.bz2 \
    && bzip2 -d /tmp/restic.bz2 \
    && install -m 0755 /tmp/restic /usr/local/bin/restic \
    && curl -fsSL "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl" -o /usr/local/bin/kubectl \
    && chmod 0755 /usr/local/bin/kubectl \
    && rm -rf /var/lib/apt/lists/* /tmp/restic

COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps

# Install from the lockfile, build every UI, then prune the build-time
# workspace dependencies. `npm ci` guarantees the image uses exactly the
# versions CI tested (a drifted lockfile fails the build instead).
RUN npm ci --no-audit --no-fund \
    && npm run build:ui --workspaces --if-present \
    && npm prune --omit=dev \
    && chown -R node:node /app

COPY docker/entrypoint.sh /usr/local/bin/dscpln-entrypoint
RUN chmod 0755 /usr/local/bin/dscpln-entrypoint

ENV NODE_ENV=production
ENV HOME=/home/node
ENV BACKUPCTL_REPO_DIR=/app
EXPOSE 3300 8080 8085 8086 8787 8791 8794

USER node
ENTRYPOINT ["/usr/local/bin/dscpln-entrypoint"]

# Build from the monorepo root:
#   scripts/build.sh portal
#   scripts/build-all.sh
