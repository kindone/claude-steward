/**
 * PM2 ecosystem config for production deployment.
 *
 * Setup:
 *   npm install -g pm2
 *   npm run build
 *   pm2 start ecosystem.config.cjs
 *   pm2 save && pm2 startup   # survive reboots
 *
 * Upgrade flow (triggered by POST /api/admin/reload after a successful build):
 *   1. Server broadcasts reload event to all clients
 *   2. Server calls process.exit(0)
 *   3. PM2 detects clean exit and restarts steward-main with new dist/
 *   4. steward-safe is unaffected — it runs independently and is never restarted
 *      as part of the upgrade cycle
 */

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
