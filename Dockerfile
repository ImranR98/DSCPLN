FROM node
WORKDIR /app
COPY . .
RUN npm install
CMD ["node", "server.js"]

# docker build -t dscpln .
# docker run -p 3300:3300 -v ~/expenses.md:/app/data.txt -v ./config.json:/app/config.json dscpln
