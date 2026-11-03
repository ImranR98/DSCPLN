# Generic D$CPLN agent. This image is intentionally small: the agent uses Node
# built-ins, GNU tar, and curl for the generic artifact fetch. The GTK-capable
# variant (agent-gtk.Dockerfile) adds the runtime libraries for tools such as
# Ludusavi.
#
# Track the Node latest Alpine tag (currently Node 26) and pin its digest,
# matching the unified app image's rolling-latest policy. Renovate refreshes
# the digest so major transitions arrive automatically.
FROM node:alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797

RUN apk add --no-cache tar gzip curl ca-certificates \
    && tar --version | head -1

WORKDIR /app
COPY apps/agent/ ./
RUN chmod 0755 /app/fetch-artifact.sh \
    && mkdir -p /state && chown node:node /state

ENV NODE_ENV=production
EXPOSE 8788
USER node
ENTRYPOINT ["node", "server.mjs"]
