FROM node:24-alpine

ENV NODE_ENV=production \
    DATAPATH=/data \
    APPPATH=/usr/src/app \
    PORT=1880 \
    OPERATION_TIMEOUT_SECONDS=30 \
    OPERATION_POLL_MS=3000 \
    CREATE_CONFIGURE_DELAY_MS=5000 \
    CREATE_RECREATE_DELAY_MS=5000 \
    REGISTRY_WEBHOOK_SECRET="" \
    APP_OWNER_EMAIL="" \
    ADMIN_ALLOWED_EMAILS="" \
    PUBLIC_IMAGE=false \
    PUBLIC_API_ALLOWED_ORIGINS="" \
    PUBLIC_API_SECRET="" \
    TURNSTILE_SECRET_KEY="" \
    OIDC_ENABLED=true \
    OIDC_ISSUER_URL="" \
    OIDC_CLIENT_ID="" \
    OIDC_CLIENT_SECRET="" \
    OIDC_REDIRECT_URI="" \
    SESSION_SECRET="" 

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --omit=dev

COPY public ./public
COPY lib ./lib
COPY api ./api
COPY Dockerfile ./Dockerfile
COPY server.js ./server.js

RUN mkdir -p /data && chown -R node:node /data /usr/src/app

USER node
EXPOSE 1880

CMD ["node", "server.js"]
