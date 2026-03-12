// Shim that re-exports vitest APIs under the bun:test module name.
// Used by vitest.config.ts alias so existing tests work on Node.js.
export {
  test,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  vi as mock,
} from 'vitest'
import { vi } from 'vitest'
export const spyOn = vi.spyOn
