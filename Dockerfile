FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash rsync openssh-client unzip tar git age jq wget ca-certificates \
    python3 python3-venv python3-pip libimage-exiftool-perl ffmpeg imagemagick \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --omit=dev
COPY . .

USER node
RUN git config --global user.name "Backupctl" && git config --global user.email "backupctl@localhost"
EXPOSE 8080
ENV BACKUPCTL_CONFIG_DIR=/app/config
ENV BACKUPCTL_REPO_DIR=/home/node/Main/Code/Automation/ImranR-Backup
CMD ["node", "server.mjs", "--no-browser", "--host", "0.0.0.0"]
