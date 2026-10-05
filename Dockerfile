FROM node
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*
COPY . .
RUN npm install
USER node
CMD ["node", "server.js"]

# The app reads config.json from the working directory (or DSCPLN_CONFIG).
# The workbook (providers.<name>.workbookFile) must live in a git repository
# writable by the container user so changes can be committed.
# docker build -t dscpln .
# docker run -p 3300:3300 -v ./config.json:/app/config.json -v ./dscpln-data:/data dscpln
