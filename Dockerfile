# syntax=docker/dockerfile:1

# ==============================================================================
# Stage 1: Builder (installs full workspace deps, compiles TS & Vite bundle)
# ==============================================================================
FROM node:22-alpine AS builder
WORKDIR /app

# 1. Copy package manifests first to maximize Docker layer cache hits
COPY package*.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
COPY shared/package.json ./shared/

RUN npm ci

# 2. Copy workspace TypeScript configs and source code
COPY tsconfig.base.json tsconfig.json ./
COPY shared ./shared
COPY server ./server
COPY client ./client

# 3. Compile shared + server TypeScript and build Vite client production bundle
RUN npm run build

# ==============================================================================
# Stage 2: Production Runner (no devDependencies, non-root user, < 200 MB)
# ==============================================================================
FROM node:22-alpine AS runner
WORKDIR /app

ARG GIT_SHA=v1.0.0
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    LOG_LEVEL=info \
    GIT_SHA=${GIT_SHA}

# 1. Install production-only dependencies using cached lockfile layer
COPY package*.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
COPY shared/package.json ./shared/

RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# 2. Copy only compiled artifacts from builder stage
COPY --chown=node:node --from=builder /app/shared/dist ./shared/dist
COPY --chown=node:node --from=builder /app/server/dist ./server/dist
COPY --chown=node:node --from=builder /app/client/dist ./client/dist

# 3. Prepare writable match log directory for non-root user
RUN mkdir -p /app/logs && chown -R node:node /app/logs

USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

# Exec-form CMD so SIGTERM is delivered directly to PID 1 (Node.js), not a shell/npm wrapper
CMD ["node", "server/dist/index.js"]
