FROM node:24-slim
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm install --no-audit --no-fund
USER node
CMD ["node", "apps/balance-xlsx/server.js"]

# Build from the monorepo root:
#   podman build --platform linux/amd64 -f apps/balance-xlsx/Dockerfile -t docker.io/imranrdev/dscpln-balance:latest .
# The app reads config.json from the working directory (or DSCPLN_CONFIG).
# The workbook (providers.<name>.workbookFile) must live in a git repository
# writable by the container user so changes can be committed.
