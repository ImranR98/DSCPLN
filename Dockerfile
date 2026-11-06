# D$CPLN: one Node process, one image.
FROM node:latest@sha256:a98e6fda54fdbb22d4238054cca9a2a113bcd1191c09193a535aae22f400aa8e

WORKDIR /app

# Workbook writes are git commits.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY kit ./kit
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build:ui \
    && npm prune --omit=dev \
    && chown -R node:node /app

ENV NODE_ENV=production
ENV HOME=/home/node
EXPOSE 3300

USER node
CMD ["node", "server.mjs"]
