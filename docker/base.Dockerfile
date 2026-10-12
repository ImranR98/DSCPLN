# Shared build base for every D$CPLN app image: the monorepo plus its full
# node_modules workspace install. App Dockerfiles start FROM this image, add
# their system packages, build their UI, then prune the dev dependencies for
# their own layer.
#
#   scripts/build-base.sh    # builds and pushes imranrdev/dscpln-base:latest
#
# The image is referenced by tag because it is an internal build input: each
# app image still gets pinned by digest in the deployment repo.
FROM node:24-slim

WORKDIR /app

# Build context is the monorepo root.
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm install --no-audit --no-fund
