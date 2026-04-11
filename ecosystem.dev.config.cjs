/**
 * PM2 ecosystem config for development mode.
 *
 * Runs tsx watch (server) and vite build --watch (client) as PM2-managed processes.
 * Use this instead of `npm run dev` to keep processes alive across SSH sessions.
 *
 * Setup:
 *   npm run up:dev          # start
 *   npm run down            # stop all steward processes
 *   pm2 logs                # tail all logs
 *
 * Dev cycle:
 *   nginx proxies dev.steward.yourdomain.com → :5173 (Vite dev server, HMR enabled).
 *   Vite proxies /api → :3002 (steward-server). WebSocket upgrades are forwarded
 *   by nginx using the ws-map in /etc/nginx/conf.d/ws-map.conf.
 *
 * Processes:
 *   steward-server  — Express HTTP API (tsx watch, port 3002)
 *   steward-worker  — Claude job runner (tsx watch, Unix socket /tmp/claude-worker.sock)
 *   steward-client  — Vite HMR dev server (port 5173)
 *   steward-safe    — frozen emergency terminal (port 3003)
 *
 * Upgrade flow in dev:
 *   process.exit(0) → PM2 restarts steward-server → tsx watch picks up changes
 *   Client changes: Vite HMR pushes updates instantly, no page refresh needed.
 *
 * steward-safe runs identically to production and is always included.
 * FROZEN — do not modify the steward-safe entry or the safe/ directory.
 */

const path = require('path')

module.exports = {
  apps: [
    {
      name: 'steward-server',
      script: 'npm',
      args: 'run dev --workspace=server',
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'development',
        PORT: '3002',
        DATABASE_PATH: path.join(__dirname, 'server/steward-dev.db'),
        // APP_DOMAIN and VAPID_* are loaded from .env by dotenv at startup.
        // Do NOT set APP_DOMAIN here — it would override .env and break WebAuthn (rpID mismatch).
      },
    },
    {
      name: 'steward-worker',
      script: 'npx',
      args: 'tsx watch server/src/worker/main.ts',
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'development',
        DATABASE_PATH: path.join(__dirname, 'server/steward-dev.db'),
        WORKER_SOCKET: '/tmp/claude-worker.sock',
        WORKER_DB_PATH: '/tmp/claude-worker.db',
      },
    },
    {
      name: 'steward-apps',
      script: 'npx',
      args: 'tsx watch server/src/apps/sidecar.ts',
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'development',
        APPS_SOCKET: '/tmp/claude-apps.sock',
      },
    },
    {
      name: 'steward-client',
      script: 'npm',
      args: 'run dev --workspace=client',
      autorestart: true,
      watch: false,
      env: {
        VITE_API_PORT: '3002',
      },
    },
    {
      // FROZEN — do not modify this process config or the safe/ directory.
      name: 'steward-safe',
      script: './safe/server.js',
      autorestart: true,
      watch: false,
    },
  ],
}
