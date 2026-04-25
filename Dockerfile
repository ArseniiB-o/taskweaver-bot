# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    LOG_LEVEL=info

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        ca-certificates \
        curl \
        openssl \
        poppler-utils \
        qpdf \
        p7zip-full \
        unrar-free \
        dnsutils \
        whois \
        iputils-ping \
        diffutils \
        tini \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist

RUN useradd -r -u 10001 -m -d /home/worker worker \
    && mkdir -p /tmp/tgaiw \
    && chown -R worker:worker /tmp/tgaiw /app

USER worker
ENV TEMP_DIR=/tmp/tgaiw

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
