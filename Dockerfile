# syntax=docker/dockerfile:1
# Baby Tracker — single-container image: Fastify server + built PWA frontend.
# Build:  docker compose build   (or: docker build -t baby-tracker .)
# Run:    docker compose up -d   (see deploy.md)

# ---------------------------------------------------------------------------
# Stage 1: "build" — compile the React/Vite frontend to static files (/app/dist)
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Install deps first so this layer caches across source-only changes.
COPY package.json package-lock.json ./
RUN npm ci

# Copy only what the frontend build needs (never node_modules/dist — see .dockerignore).
COPY tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src

# tsc type-check + vite build → /app/dist
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2: "serverdeps" — install server production deps.
# better-sqlite3 is a NATIVE module; musl (alpine) prebuilt binaries may not
# exist for this node version, so provide a toolchain for node-gyp to compile
# from source if needed. These build tools never reach the final image.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS serverdeps
RUN apk add --no-cache python3 make g++
WORKDIR /srv
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# ---------------------------------------------------------------------------
# Stage 3: final runtime image — server source + compiled deps + built frontend.
# No compilers, no dev deps, no frontend toolchain.
# ---------------------------------------------------------------------------
FROM node:22-alpine
WORKDIR /srv

ENV NODE_ENV=production \
    PORT=8080 \
    DB_PATH=/data/baby.sqlite

# package.json carries "type": "module" — required for the plain-ESM server.
COPY server/package.json ./
COPY --from=serverdeps /srv/node_modules ./node_modules
COPY server/*.js ./

# Built PWA; @fastify/static serves this directory with SPA fallback.
COPY --from=build /app/dist ./public

# SQLite lives here; docker-compose bind-mounts ./data over it for persistence.
RUN mkdir -p /data

EXPOSE 8080

# busybox wget ships with alpine; /api/health is unauthenticated.
HEALTHCHECK --interval=60s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO /dev/null "http://127.0.0.1:${PORT}/api/health" || exit 1

CMD ["node", "index.js"]
