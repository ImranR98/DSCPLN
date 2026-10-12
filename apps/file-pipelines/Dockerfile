FROM node:24-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg perl ca-certificates curl rsync bash tar gzip \
    && rm -rf /var/lib/apt/lists/*

# kubectl drives the remote pipeline Jobs (keep it in step with the k3s
# version); pipeline commands themselves use bash/rsync from above.
ARG TARGETARCH=amd64
RUN curl -fsSL "https://dl.k8s.io/release/v1.37.1/bin/linux/${TARGETARCH}/kubectl" -o /usr/local/bin/kubectl \
    && chmod +x /usr/local/bin/kubectl

WORKDIR /app

# Monorepo install (build context = repo root).
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm install --no-audit --no-fund \
    && npm run build:ui --workspace dscpln-file-pipelines \
    && npm prune --omit=dev

ENV NODE_ENV=production
# Writable home so the app's "~" defaults resolve inside the mounted config
# volume (and os.homedir() never fails for a UID with no passwd entry).
ENV HOME=/config
EXPOSE 8791

ENTRYPOINT ["node", "apps/file-pipelines/src/index.js", "--config", "/config/config.json", "--bind", "0.0.0.0"]

# Build from the monorepo root:
#   podman build --platform linux/amd64 -f apps/file-pipelines/Dockerfile -t docker.io/imranrdev/dscpln-file-pipelines:latest .
