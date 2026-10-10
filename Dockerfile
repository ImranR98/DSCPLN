FROM node:24-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg perl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY ExifTool.config ./
COPY src ./src
COPY bin ./bin
COPY public ./public

ENV NODE_ENV=production
# Writable home so the app's "~" defaults resolve inside the mounted config
# volume (and os.homedir() never fails for a UID with no passwd entry).
ENV HOME=/config
EXPOSE 8791

ENTRYPOINT ["node", "src/index.js", "--config", "/config/config.json", "--bind", "0.0.0.0"]
