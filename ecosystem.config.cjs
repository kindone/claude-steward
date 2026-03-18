/**
 * PM2 ecosystem config for production deployment.
 *
 * Setup:
 *   npm install -g pm2
 *   npm run build
 *   pm2 start ecosystem.config.cjs
 *   pm2 save && pm2 startup   # survive reboots
 *
 * Processes:
 *   steward-main    — Express HTTP API (node dist/index.js, port 3001)
 *   steward-worker  — Claude job runner (node dist/worker/main.js, Unix socket)
 *   steward-safe    — frozen emergency terminal (port 3003)
 *
 * Upgrade flow (triggered by POST /api/admin/reload after a successful build):
 *   1. Server broadcasts reload event to all clients
 *   2. Server calls process.exit(0)
 *   3. PM2 detects clean exit and restarts steward-main with new dist/
 *   4. steward-worker auto-restarts via PM2 as well (clean exit on SIGTERM)
 *   5. steward-safe is unaffected — it runs independently and is never restarted
 *      as part of the upgrade cycle
 */

const path = require('path')

module.exports = {
  apps: [
    {
      name: 'steward-main',
      script: './server/dist/index.js',
      // Restart on clean exit (exit code 0) so the reload flow works.
      // PM2 default is to restart on any exit; autorestart: true covers this.
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        DATABASE_PATH: path.join(__dirname, 'server/steward.db'),
        // APP_DOMAIN and VAPID_* are loaded from .env by dotenv at startup.
        // Do NOT set APP_DOMAIN here — it would override .env and break WebAuthn (rpID mismatch).
      },
    },
    {
      name: 'steward-worker',
      script: './server/dist/worker/main.js',
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        DATABASE_PATH: path.join(__dirname, 'server/steward.db'),
        WORKER_SOCKET: '/tmp/claude-worker.sock',
        WORKER_DB_PATH: '/tmp/claude-worker.db',
      },
    },
    {
      // FROZEN — do not modify this process config or the safe/ directory.
      // This process runs independently and is never part of the upgrade cycle.
      name: 'steward-safe',
      script: './safe/server.js',
      autorestart: true,
      watch: false,
    },
  ],
}
