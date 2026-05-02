# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:23-slim AS builder

WORKDIR /app

# Install build tools needed by native deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# mdart is a local file: dependency referenced as ../../mdart/packages/mdart
# from client/. In the container that resolves to /mdart/packages/mdart.
# Pass the package in via: --build-context mdart=/path/to/mdart/packages/mdart
# (compose users: set MDART_DIR in your environment — see docker-compose.yml)
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


# ── Stage 2: runtime-minimal ──────────────────────────────────────────────────
# Default runtime target. Carries only what's needed to boot the server:
# built dist/, built public/, safe/ fallback, and prod-only node_modules.
# No source, no dev deps, no git → cannot self-evolve. Smallest image.
# Picked by docker-compose.yml's `build.target: runtime-minimal`.
FROM node:23-slim AS runtime-minimal

WORKDIR /app

# mdart is needed at runtime too (server/routes/mdart.js imports it directly)
COPY --from=mdart . /mdart/packages/mdart/

# Runtime system deps
# - dumb-init: signal forwarding + zombie reaping for PM2
# - curl + ca-certificates: needed to fetch the opencode binary; kept around
#   for ad-hoc debugging too (small footprint, useful when poking the container)
# pikchr: compiled from source or via apt if available; skip for now — diagrams
# will fall back gracefully. Add `RUN apt-get install -y pikchr` if needed.
RUN apt-get update && apt-get install -y --no-install-recommends \
    dumb-init curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Claude CLI (Node-based) + PM2
RUN npm install -g @anthropic-ai/claude-code pm2

# opencode CLI (Go binary, fetched via official install script).
# Symlinked into /usr/local/bin so it's on PATH for non-login shells.
# The script writes to /root/.opencode/bin/opencode and updates shell rc files,
# but inside the container we don't care about shell init — the symlink is
# enough.
RUN curl -fsSL https://opencode.ai/install | bash \
  && ln -s /root/.opencode/bin/opencode /usr/local/bin/opencode \
  && opencode --version

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


# ── Stage 3: runtime-evolve ───────────────────────────────────────────────────
# Self-evolving runtime: extends runtime-minimal with the full source tree,
# dev dependencies, and git so the in-container steward can run its own
# self-upgrade loop (edit source → npm run build → POST /api/admin/reload).
#
# Activated by:
#   docker compose -f docker-compose.yml -f docker-compose.evolve.yml up --build
#
# The shared mode (docker-compose.shared.yml) also targets this stage —
# bind-mounts overlay /app, but the dev deps + git baked here remain
# accessible for in-container builds.
FROM runtime-minimal AS runtime-evolve

# git: lets the container commit / pull / inspect its own history.
RUN apt-get update && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*

# Overlay the full source tree + dev dependencies on top of the minimal
# image. The builder stage installed --include=dev and built everything,
# so its /app already has source + dev node_modules + fresh dist/public.
# This single COPY replaces runtime-minimal's --omit=dev install.
COPY --from=builder /app /app
