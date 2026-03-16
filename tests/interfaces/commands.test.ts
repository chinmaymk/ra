import { describe, it, expect } from 'bun:test'
import { showDryRunConfig } from '../../src/interfaces/commands'
import type { RaConfig } from '../../src/config/types'
import { defaultConfig } from '../../src/config/defaults'

function captureLog(fn: () => void): string {
  const logs: string[] = []
  const originalLog = console.log
  console.log = (...args: unknown[]) => logs.push(args.join(' '))
  try {
    fn()
    return logs.join('\n')
  } finally {
    console.log = originalLog
  }
}

describe('showDryRunConfig', () => {
  it('prints valid JSON', () => {
    const output = captureLog(() => showDryRunConfig(defaultConfig as RaConfig))
    const parsed = JSON.parse(output)
    expect(parsed.provider).toBe('anthropic')
  })

  it('reflects overridden values', () => {
    const config = { ...defaultConfig, provider: 'openai', model: 'gpt-4.1' } as RaConfig
    const output = captureLog(() => showDryRunConfig(config))
    const parsed = JSON.parse(output)
    expect(parsed.provider).toBe('openai')
    expect(parsed.model).toBe('gpt-4.1')
  })

  it('redacts http.token', () => {
    const config = { ...defaultConfig, http: { port: 3000, token: 'secret-token' } } as RaConfig
    const output = captureLog(() => showDryRunConfig(config))
    expect(output).not.toContain('secret-token')
    expect(output).toContain('***')
  })

  it('includes all config sections', () => {
    const output = captureLog(() => showDryRunConfig(defaultConfig as RaConfig))
    const parsed = JSON.parse(output)
    expect(parsed.compaction).toBeDefined()
    expect(parsed.memory).toBeDefined()
    expect(parsed.mcp).toBeDefined()
    expect(parsed.context).toBeDefined()
    expect(parsed.permissions).toBeDefined()
  })

  it('includes context files when provided', () => {
    const output = captureLog(() => showDryRunConfig(defaultConfig as RaConfig, ['CLAUDE.md', '.cursorrules']))
    const parsed = JSON.parse(output)
    expect(parsed.context.files).toEqual(['CLAUDE.md', '.cursorrules'])
  })
})
