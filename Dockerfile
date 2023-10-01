FROM node
COPY . .
RUN npm install
CMD npm start

# docker build -t dscpln .
# docker run -v ~/expenses.md:/data.txt dscpln
# docker tag dscpln imranrdev/dscpln