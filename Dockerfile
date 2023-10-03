FROM node
COPY . .
RUN npm install
CMD npm start

# docker build -t dscpln .
# docker run -v ~/expenses.md:/data.txt dscpln # Note: Keep this in mind: https://stackoverflow.com/a/52897306
# docker tag dscpln imranrdev/dscpln