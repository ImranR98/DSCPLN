FROM node
WORKDIR /app
COPY . .
RUN npm install
USER node
CMD ["node", "server.js"]

# The app reads config.json from the working directory (or DSCPLN_CONFIG).
# dataFile/budgetFile in that config must point at a writable directory.
# docker build -t dscpln .
# docker run -p 3300:3300 -v ./config.json:/app/config.json -v ./dscpln-data:/data dscpln
