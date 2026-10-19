FROM imranrdev/dscpln-base:latest

ARG RESTIC_VERSION=0.19.1
ARG KUBECTL_VERSION=v1.34.1

# Runtime tools used by the configured bash tasks: file operations, git
# commits, age encryption, archives, JSON, SSH, the Python pty helper, and the
# backup tools (restic + kubectl) that scheduled backup tasks commonly use.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash rsync openssh-client git age jq unzip tar wget python3 python3-venv python3-pip ca-certificates adb curl bzip2 \
    && curl -fsSL "https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_linux_amd64.bz2" -o /tmp/restic.bz2 \
    && bzip2 -d /tmp/restic.bz2 \
    && install -m 0755 /tmp/restic /usr/local/bin/restic \
    && curl -fsSL "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl" -o /usr/local/bin/kubectl \
    && chmod 0755 /usr/local/bin/kubectl \
    && rm -rf /var/lib/apt/lists/* /tmp/restic

# Tasks may provision venvs/npm deps at run time, so the app tree must be
# writable by the runtime user; prune dev dependencies from the shared base
# image's workspace install after building the UI.
RUN npm run build:ui --workspace dscpln-task-runner \
    && npm prune --omit=dev
RUN chown -R node:node /app

# The server instance uses a mounted config (BACKUPCTL_CONFIG_FILE), the
# monorepo root as {{repo_dir}} (BACKUPCTL_REPO_DIR=/app) and mounts the shared
# ~/Main tree at this path; see README.md for the k8s layout.
ENV HOME=/home/node
ENV NODE_ENV=production
ENV BACKUPCTL_REPO_DIR=/app
EXPOSE 8085

USER node
CMD ["node", "apps/task-runner/server.mjs", "--host", "0.0.0.0", "--port", "8085", "--no-browser"]

# Build from the monorepo root:
#   podman build --platform linux/amd64 -f apps/task-runner/Dockerfile -t docker.io/imranrdev/dscpln-task-runner:latest .
