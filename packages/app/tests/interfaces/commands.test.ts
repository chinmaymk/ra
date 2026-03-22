import { describe, it, expect } from 'bun:test'
import { showConfig } from '../../src/interfaces/commands'
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

describe('showConfig', () => {
  it('prints valid JSON', () => {
    const output = captureLog(() => showConfig(defaultConfig as RaConfig))
    const parsed = JSON.parse(output)
    expect(parsed.agent.provider).toBe('anthropic')
  })

  it('reflects overridden values', () => {
    const config = { ...defaultConfig, agent: { ...defaultConfig.agent, provider: 'openai', model: 'gpt-4.1' } } as RaConfig
    const output = captureLog(() => showConfig(config))
    const parsed = JSON.parse(output)
    expect(parsed.agent.provider).toBe('openai')
    expect(parsed.agent.model).toBe('gpt-4.1')
  })

  it('redacts http.token', () => {
    const config = { ...defaultConfig, app: { ...defaultConfig.app, http: { port: 3000, token: 'secret-token' } } } as RaConfig
    const output = captureLog(() => showConfig(config))
    expect(output).not.toContain('secret-token')
    expect(output).toContain('***')
  })

  it('includes all config sections', () => {
    const output = captureLog(() => showConfig(defaultConfig as RaConfig))
    const parsed = JSON.parse(output)
    expect(parsed.agent.compaction).toBeDefined()
    expect(parsed.agent.memory).toBeDefined()
    expect(parsed.app.mcpServers).toBeDefined()
    expect(parsed.agent.context).toBeDefined()
    expect(parsed.agent.permissions).toBeDefined()
  })

  it('includes context files when provided', () => {
    const output = captureLog(() => showConfig(defaultConfig as RaConfig, ['CLAUDE.md', '.cursorrules']))
    const parsed = JSON.parse(output)
    expect(parsed.agent.context.files).toEqual(['CLAUDE.md', '.cursorrules'])
  })
})
