FROM nodered/node-red:4.1.10-minimal
USER node-red
WORKDIR /usr/src/node-red

COPY package.json /usr/src/node-red/package.json
RUN ln -s /usr/src/node-red/package.json /data/package.json

RUN npm install --omit=dev

COPY public /usr/src/node-red/public
COPY flows.json /usr/src/node-red/flows.json
COPY settings.js /usr/src/node-red/settings.js

ENV FLOWS=/usr/src/node-red/flows.json
ENV DATAPATH=/data
ENV APPPATH=/usr/src/node-red
