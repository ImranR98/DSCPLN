# Generic D$CPLN archive agent. This image is intentionally small: the agent
# uses Node built-ins and GNU tar, and contains no host-specific config.
#
# Track the Node LTS tag and pin its digest, matching the unified app image.
# Renovate refreshes it on LTS transitions and security updates.
FROM node:lts-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53

RUN apk add --no-cache tar gzip \
    && tar --version | head -1

WORKDIR /app
COPY apps/agent/ ./
RUN mkdir -p /state && chown node:node /state

ENV NODE_ENV=production
EXPOSE 8788
USER node
ENTRYPOINT ["node", "server.mjs"]
