# D$CPLN unified app image: one build, six tags.
#
# The image contains the whole monorepo, every app's production dependencies
# and the superset of runtime tools. Deployments select the app with APP=...
# (see docker/entrypoint.sh); system packages are therefore shared instead of
# copied into six near-identical images.
#
# Track the Node latest tag (currently Node 26 on Debian 13) and pin its
# digest. Renovate refreshes the digest, so Node 27 arrives automatically and
# the CI suite (node-version: latest) moves with it.
#
# Do not switch this to node:lts-slim: that tag currently resolves to Debian
# 12/bookworm, whose nftables 1.0.6 breaks the lockdown port-blocker. The
# Debian trixie image ships nftables 1.1.x.
FROM node:latest@sha256:a98e6fda54fdbb22d4238054cca9a2a113bcd1191c09193a535aae22f400aa8e

ARG RESTIC_VERSION=0.19.1
ARG KUBECTL_VERSION=v1.37.2

WORKDIR /app

# Runtime tools used by one or more apps:
#   file-pipelines: ffmpeg, perl, rsync, tar
#   whatsapp-txt:   python3 (zip extraction), unzip (validation)
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
