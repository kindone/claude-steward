Run the appropriate test suite for the changes made.

Choose based on scope:
- **Server changes only**: `npm test --workspace=server`
- **Client changes only**: `npm test --workspace=client`
- **Both**: `npm test`
- **E2E smoke tests**: `npm run test:e2e` (auto-starts dev servers)
- **Everything**: `npm run test:all`

After any TypeScript changes in `client/`, also run: `cd client && npx tsc --noEmit`
After any TypeScript changes in `server/`, also run: `cd server && npx tsc --noEmit`

Tests run in ~4s and require no running servers (unit + component only). E2E tests are slower and start real dev servers.
