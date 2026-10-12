FROM imranrdev/dscpln-base:latest

# Build the UI, then drop the build-time dependencies from the shared base
# image's workspace install.
RUN npm run build:ui --workspace dscpln-portal \
    && npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
EXPOSE 8080

USER node

CMD ["node", "apps/portal/server.mjs"]

# Build from the monorepo root:
#   podman build --platform linux/amd64 -f apps/portal/Dockerfile -t docker.io/imranrdev/dscpln-portal:latest .
