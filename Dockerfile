FROM python:3.12-slim

ARG UID=1000
ARG GID=1000

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash rsync openssh-client unzip tar git age jq wget ca-certificates \
    nodejs npm libimage-exiftool-perl ffmpeg imagemagick \
 && rm -rf /var/lib/apt/lists/*

RUN groupadd -g $GID user && useradd -m -u $UID -g $GID user

WORKDIR /app
COPY pyproject.toml ./
COPY backupctl ./backupctl
RUN pip install --no-cache-dir .

USER user
RUN git config --global user.name "Backupctl" && git config --global user.email "backupctl@localhost"
EXPOSE 8080
ENV BACKUPCTL_CONFIG_DIR=/app/config
ENV BACKUPCTL_REPO_DIR=/home/node/Main/Code/Automation/ImranR-Backup
CMD ["backupctl", "--no-browser", "--host", "0.0.0.0"]
