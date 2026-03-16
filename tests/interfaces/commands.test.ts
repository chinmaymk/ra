import { describe, it, expect } from 'bun:test'
import { showDryRunConfig, type DryRunInfo } from '../../src/interfaces/commands'
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

function makeInfo(overrides?: Partial<RaConfig>): DryRunInfo {
  const config = { ...defaultConfig, ...overrides } as RaConfig
  return {
    config,
    toolNames: ['test_tool'],
    middleware: {},
    skillMap: new Map([
      ['code-review', {
        metadata: { name: 'code-review', description: 'Reviews code' },
        body: '',
        dir: '/skills/code-review',
        scripts: [],
        references: [],
        assets: [],
      }],
    ]),
    contextMessages: [],
  }
}

describe('showDryRunConfig', () => {
  it('prints resolved config without errors', () => {
    const output = captureLog(() => showDryRunConfig(makeInfo()))
    expect(output).toContain('ra — resolved configuration')
    expect(output).toContain('Core')
    expect(output).toContain('anthropic')
    expect(output).toContain('test_tool')
    expect(output).toContain('code-review')
  })

  it('shows provider and model from config', () => {
    const output = captureLog(() => showDryRunConfig(makeInfo({ provider: 'openai' as any, model: 'gpt-4.1' })))
    expect(output).toContain('openai')
    expect(output).toContain('gpt-4.1')
  })

  it('shows context files when present', () => {
    const info = makeInfo()
    info.contextMessages = [
      { role: 'user', content: '<context-file path="CLAUDE.md">\nsome content\n</context-file>' },
    ]
    const output = captureLog(() => showDryRunConfig(info))
    expect(output).toContain('CLAUDE.md')
    expect(output).toContain('Discovered context files')
  })

  it('shows middleware hooks when configured', () => {
    const info = makeInfo()
    info.middleware = {
      beforeModelCall: [async () => {}],
      afterToolExecution: [async () => {}, async () => {}],
    }
    const output = captureLog(() => showDryRunConfig(info))
    expect(output).toContain('beforeModelCall')
    expect(output).toContain('1 hook(s)')
    expect(output).toContain('afterToolExecution')
    expect(output).toContain('2 hook(s)')
  })

  it('masks HTTP token', () => {
    const output = captureLog(() => showDryRunConfig(makeInfo({ http: { port: 3000, token: 'secret-token' } })))
    expect(output).toContain('***')
    expect(output).not.toContain('secret-token')
  })

  it('shows memory config when enabled', () => {
    const output = captureLog(() => showDryRunConfig(makeInfo({ memory: { enabled: true, maxMemories: 500, ttlDays: 30, injectLimit: 3 } })))
    expect(output).toContain('true')
    expect(output).toContain('500')
  })

  it('notes MCP tools are not shown in dry-run', () => {
    const output = captureLog(() => showDryRunConfig(makeInfo({
      mcp: { client: [{ name: 'test', transport: 'stdio', command: 'echo' }], server: { enabled: false, port: 0, tool: { name: '', description: '' } }, lazySchemas: false },
    })))
    expect(output).toContain('MCP tools not shown in dry-run')
  })
})
