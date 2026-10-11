FROM node:24-slim

WORKDIR /app

# Monorepo install + UI build (build context = repo root). The portal only
# needs the kit at runtime; Vite/Svelte are pruned after building static/.
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm install --no-audit --no-fund \
    && npm run build:ui --workspace dscpln-portal \
    && npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
EXPOSE 8080

USER node

CMD ["node", "apps/portal/server.mjs"]

# Build from the monorepo root:
#   podman build --platform linux/amd64 -f apps/portal/Dockerfile -t docker.io/imranrdev/dscpln-portal:latest .
