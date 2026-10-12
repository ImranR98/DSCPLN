FROM node:24-slim

# Runtime tools used by the configured bash tasks: file operations, git
# commits, age encryption, archives, JSON, SSH and the Python pty helper.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash rsync openssh-client git age jq unzip tar wget python3 ca-certificates adb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Monorepo install (build context = repo root): the shared kits, this app and
# the config/state. Tasks may provision venvs/npm deps at run time, so the app tree
# must be writable by the runtime user.
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm install --no-audit --no-fund \
    && npm run build:ui --workspace dscpln-task-runner \
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
