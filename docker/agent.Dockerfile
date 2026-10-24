# Generic D$CPLN archive agent. This image is intentionally small: the agent
# uses Node built-ins and GNU tar, and contains no host-specific config.
#
# Track the Node latest Alpine tag (currently Node 26) and pin its digest,
# matching the unified app image's rolling-latest policy. Renovate refreshes
# the digest so major transitions arrive automatically.
FROM node:alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797

RUN apk add --no-cache tar gzip \
    && tar --version | head -1

WORKDIR /app
COPY apps/agent/ ./
RUN mkdir -p /state && chown node:node /state

ENV NODE_ENV=production
EXPOSE 8788
USER node
ENTRYPOINT ["node", "server.mjs"]
