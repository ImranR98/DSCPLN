FROM node:22-bookworm-slim

# Runtime tools used by the configured bash tasks: file operations, git
# commits, age encryption, archives, JSON, SSH and the Python pty helper.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash rsync openssh-client git age jq unzip tar wget python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App code and the scripts/ submodules. Tasks may provision venvs/npm deps at
# run time, so the app tree must be writable by the runtime user.
COPY . .
RUN chown -R node:node /app

# The server instance uses a mounted config (BACKUPCTL_CONFIG_FILE) and mounts
# the shared ~/Main tree at this path; see README.md for the k8s layout.
ENV HOME=/home/node
ENV NODE_ENV=production
EXPOSE 8085

USER node
CMD ["node", "server.mjs", "--host", "0.0.0.0", "--port", "8085", "--no-browser"]

# docker build -t backupctl .
# docker run --rm -p 8085:8085 -v ~/Main:/home/node/Main -v backupctl-home:/home/node backupctl
