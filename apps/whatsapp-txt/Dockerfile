FROM node:24-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends unzip ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Monorepo install (build context = repo root).
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm install --omit=dev --no-audit --no-fund

ENV NODE_ENV=production
EXPOSE 8787

ENTRYPOINT ["sh", "-c", "exec node apps/whatsapp-txt/server.mjs --dir \"$DATA_DIR\" --host \"$HOST\" --port \"$PORT\""]

# Build from the monorepo root:
#   podman build --platform linux/amd64 -f apps/whatsapp-txt/Dockerfile -t docker.io/imranrdev/dscpln-watxt:latest .
