// This file exists solely to catch accidental `vitest run` from the monorepo root.
// Running vitest here skips workspace setupFiles (DATABASE_PATH isolation) and
// pollutes the production server/steward.db with test data.
//
// Always run tests via the workspace scripts:
//   npm test --workspace=server    ← unit / property / contract tests
//   npm test --workspace=client    ← component tests
//   npm test                       ← both of the above
//   npm run test:e2e               ← e2e (real Claude CLI)

throw new Error(
  '\n\n' +
  '  ❌  Do not run vitest from the monorepo root.\n' +
  '      This bypasses setupFiles and writes to the production database.\n\n' +
  '      Use instead:\n' +
  '        npm test                       (server + client unit tests)\n' +
  '        npm test --workspace=server    (server only)\n' +
  '        npm test --workspace=client    (client only)\n' +
  '        npm run test:e2e               (e2e, requires real Claude CLI)\n'
)
