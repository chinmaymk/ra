// Shim that re-exports node:sqlite's DatabaseSync as bun:sqlite's Database.
// Used by vitest.config.ts alias so memory tests work on Node.js.
import { DatabaseSync } from 'node:sqlite'

export { DatabaseSync as Database }
