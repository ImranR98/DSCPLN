FROM node:24-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 python3-venv python3-pip ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Monorepo install (build context = repo root).
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm install --omit=dev --no-audit --no-fund

# The downloader's Python environment (ytmusicapi, yt-dlp, dotenv).
RUN python3 -m venv apps/ytmusic/venv \
    && apps/ytmusic/venv/bin/pip install --no-cache-dir --upgrade pip \
    && apps/ytmusic/venv/bin/pip install --no-cache-dir -r apps/ytmusic/downloader/requirements.txt

ENV NODE_ENV=production
# The Main tree is mounted at /home/node/Main so ~/Main defaults resolve.
ENV HOME=/home/node
ENV DSCPLN_DATA_DIR=/data
ENV XDG_CACHE_HOME=/data/cache
ENV TZ=America/Toronto
EXPOSE 8080

USER node

CMD ["node", "apps/ytmusic/server.mjs"]

# Build from the monorepo root:
#   podman build --platform linux/amd64 -f apps/ytmusic/Dockerfile -t docker.io/imranrdev/dscpln-ytmusic:latest .
