# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:23-slim AS builder

WORKDIR /app

# Install build tools needed by native deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# mdart is a local file: dependency referenced as ../../mdart/packages/mdart
# from client/. In the container that resolves to /mdart/packages/mdart.
# Pass the package in via: --build-context mdart=/home/ubuntu/mdart/packages/mdart
COPY --from=mdart . /mdart/packages/mdart/

# Install dependencies (client + server workspaces)
COPY package*.json ./
COPY client/package*.json client/
COPY server/package*.json server/
RUN npm install --include=dev

# Copy source and build sequentially (memory constraint)
COPY . .
RUN npm run build --workspace=client
RUN npm run build --workspace=server


# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:23-slim AS runtime

WORKDIR /app

# mdart is needed at runtime too (server/routes/mdart.js imports it directly)
COPY --from=mdart . /mdart/packages/mdart/

# Runtime system deps
# pikchr: compiled from source or via apt if available; skip for now — diagrams
# will fall back gracefully. Add `RUN apt-get install -y pikchr` if needed.
RUN apt-get update && apt-get install -y --no-install-recommends \
    dumb-init \
  && rm -rf /var/lib/apt/lists/*

# Claude CLI + PM2
RUN npm install -g @anthropic-ai/claude-code pm2

# Copy built artefacts and runtime files from builder
COPY --from=builder /app/server/dist         ./server/dist
COPY --from=builder /app/server/public       ./server/public
COPY --from=builder /app/safe                ./safe
COPY --from=builder /app/ecosystem.config.cjs ./ecosystem.config.cjs

# Install production deps via root workspace so file: deps (mdart) resolve
# correctly through workspace hoisting — isolated `cd server && npm install`
# skips hoisting and misses packages that live in the root node_modules.
COPY --from=builder /app/package*.json       ./
COPY --from=builder /app/server/package*.json ./server/
COPY --from=builder /app/client/package*.json ./client/
RUN npm install --omit=dev

# Entrypoint
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Data directory (SQLite lives here at runtime via DATABASE_PATH)
RUN mkdir -p /data

EXPOSE 3001 3003

# dumb-init handles signal forwarding + zombie reaping for PM2
ENTRYPOINT ["dumb-init", "--", "/entrypoint.sh"]
