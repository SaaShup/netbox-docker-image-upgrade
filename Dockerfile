FROM node:24-alpine

ENV NODE_ENV=production
ENV DATAPATH=/data
ENV APPPATH=/usr/src/app
ENV PORT=1880

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --omit=dev

COPY public ./public
COPY lib ./lib
COPY server.js ./server.js

RUN mkdir -p /data && chown -R node:node /data /usr/src/app

USER node
EXPOSE 1880

CMD ["node", "server.js"]
