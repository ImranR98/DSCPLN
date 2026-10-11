FROM node:24-slim

WORKDIR /app

# Monorepo install (build context = repo root). The portal only needs the kit.
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm install --omit=dev --no-audit --no-fund

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
EXPOSE 8080

USER node

CMD ["node", "apps/portal/server.mjs"]

# Build from the monorepo root:
#   podman build --platform linux/amd64 -f apps/portal/Dockerfile -t docker.io/imranrdev/dscpln-portal:latest .
