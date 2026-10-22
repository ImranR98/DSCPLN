# Generic D$CPLN archive agent. This image is intentionally small: the agent
# uses Node built-ins and GNU tar, and contains no host-specific config.
FROM node:26-alpine

RUN apk add --no-cache tar gzip \
    && tar --version | head -1

WORKDIR /app
COPY apps/agent/ ./
RUN mkdir -p /state && chown node:node /state

ENV NODE_ENV=production
EXPOSE 8788
USER node
ENTRYPOINT ["node", "server.mjs"]
