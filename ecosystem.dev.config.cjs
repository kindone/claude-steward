/**
 * PM2 ecosystem config for development mode.
 *
 * Runs tsx watch (server) and Vite (client) as stable PM2-managed processes.
 * Use this instead of `npm run dev` to keep processes alive across SSH sessions.
 *
 * Setup:
 *   npm run up:dev          # start
 *   npm run down            # stop all steward processes
 *   pm2 logs                # tail all logs
 *
 * The upgrade flow via POST /api/admin/reload still works in dev:
 *   process.exit(0) → PM2 restarts steward-server → tsx watch picks up changes
 *   Client changes are handled by Vite HMR without a restart.
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
        APP_DOMAIN: 'steward.jradoo.com',
        VAPID_PUBLIC_KEY: 'BExVkNt_MaCsC7E5D2WBcSg8JVx9feXilw8Wc6oIzotdXhWRZQrD4DYn4-aqVxUaWTCwACCl7_ZM9UMFJzHG8pk',
        VAPID_PRIVATE_KEY: 'UqfStAGaENDLzpeSR-nRbgiiQfstEseEntpOQ0TTec0',
        VAPID_SUBJECT: 'mailto:admin@steward.jradoo.com',
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
