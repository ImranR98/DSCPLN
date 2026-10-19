FROM imranrdev/dscpln-base:latest

WORKDIR /app
# The shared base image contains the rest of the monorepo. Add the current
# portal source so a source/UI change is actually reflected in the image.
COPY apps/portal ./apps/portal
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
