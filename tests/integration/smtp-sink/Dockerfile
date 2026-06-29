FROM node:24-alpine

RUN apk add --no-cache openssl \
  && mkdir -p /cert /mail \
  && openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout /cert/key.pem \
    -out /cert/cert.pem \
    -days 3650 \
    -subj "/CN=integration-smtp"

WORKDIR /app
COPY server.js /app/server.js

EXPOSE 587
CMD ["node", "/app/server.js"]
