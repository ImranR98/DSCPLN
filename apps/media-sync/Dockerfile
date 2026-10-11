FROM node:24-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg perl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Monorepo install (build context = repo root).
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm install --no-audit --no-fund \
    && npm run build:ui --workspace dscpln-media-sync \
    && npm prune --omit=dev

ENV NODE_ENV=production
# Writable home so the app's "~" defaults resolve inside the mounted config
# volume (and os.homedir() never fails for a UID with no passwd entry).
ENV HOME=/config
EXPOSE 8791

ENTRYPOINT ["node", "apps/media-sync/src/index.js", "--config", "/config/config.json", "--bind", "0.0.0.0"]

# Build from the monorepo root:
#   podman build --platform linux/amd64 -f apps/media-sync/Dockerfile -t docker.io/imranrdev/dscpln-media-sync:latest .
