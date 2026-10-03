FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.mjs ./
COPY public ./public

# The conversation directory is expected to be mounted at /data:
#   docker run --rm -p 8787:8787 -v "/path/to/WhatsApp TXT:/data:ro" whatsapptxt-browser
ENV DATA_DIR=/data
ENV HOST=0.0.0.0
ENV PORT=8787

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD wget -qO- "http://127.0.0.1:${PORT}/api/state" > /dev/null || exit 1

USER node

CMD ["sh", "-c", "exec node server.mjs --dir \"$DATA_DIR\" --host \"$HOST\" --port \"$PORT\""]
