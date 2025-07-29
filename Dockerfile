FROM nodered/node-red:4.0.9-debian
USER node-red
WORKDIR /usr/src/node-red

COPY package.json /usr/src/node-red/package.json
RUN ln -s /usr/src/node-red/package.json /data/package.json

RUN npm install --omit=dev

COPY public /usr/src/node-red/public
COPY flows.json /usr/src/node-red/flows.json
COPY settings.js /data

ENV FLOWS=/usr/src/node-red/flows.json
ENV DATAPATH=/data
ENV APPPATH=/usr/src/node-red
