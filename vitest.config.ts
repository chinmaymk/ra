import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      'bun:test': resolve(__dirname, 'tests/node/bun-test-shim.ts'),
      'bun:sqlite': resolve(__dirname, 'tests/node/bun-sqlite-shim.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/integration/**'],
  },
})
