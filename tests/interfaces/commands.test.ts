import { describe, it, expect, mock } from 'bun:test'
import { showDryRunConfig } from '../../src/interfaces/commands'
import { ToolRegistry } from '../../src/agent/tool-registry'
import type { AppContext } from '../../src/bootstrap'
import type { RaConfig } from '../../src/config/types'
import { defaultConfig } from '../../src/config/defaults'

function makeApp(overrides?: Partial<RaConfig>): AppContext {
  const config = { ...defaultConfig, ...overrides } as RaConfig
  const tools = new ToolRegistry()
  tools.register({
    name: 'test_tool',
    description: 'A test tool',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => 'ok',
  })
  const skillMap = new Map()
  skillMap.set('code-review', {
    metadata: { name: 'code-review', description: 'Reviews code' },
    body: '',
    dir: '/skills/code-review',
    scripts: [],
    references: [],
    assets: [],
  })

  return {
    config,
    provider: { name: 'mock', chat: async () => '', async *stream() { yield { type: 'done' as const } } },
    tools,
    middleware: {},
    skillMap,
    storage: {} as any,
    sessionId: 'test-session',
    contextMessages: [],
    memoryStore: undefined,
    mcpClient: {} as any,
    logger: { info: () => {}, flush: async () => {} } as any,
    tracer: { flush: async () => {} } as any,
    shutdown: async () => {},
  }
}

describe('showDryRunConfig', () => {
  it('prints resolved config without errors', () => {
    const logs: string[] = []
    const originalLog = console.log
    console.log = (...args: unknown[]) => logs.push(args.join(' '))
    try {
      showDryRunConfig(makeApp())
      const output = logs.join('\n')
      expect(output).toContain('ra — resolved configuration')
      expect(output).toContain('Core')
      expect(output).toContain('anthropic')
      expect(output).toContain('test_tool')
      expect(output).toContain('code-review')
    } finally {
      console.log = originalLog
    }
  })

  it('shows provider and model from config', () => {
    const logs: string[] = []
    const originalLog = console.log
    console.log = (...args: unknown[]) => logs.push(args.join(' '))
    try {
      showDryRunConfig(makeApp({ provider: 'openai' as any, model: 'gpt-4.1' }))
      const output = logs.join('\n')
      expect(output).toContain('openai')
      expect(output).toContain('gpt-4.1')
    } finally {
      console.log = originalLog
    }
  })

  it('shows context files when present', () => {
    const logs: string[] = []
    const originalLog = console.log
    console.log = (...args: unknown[]) => logs.push(args.join(' '))
    try {
      const app = makeApp()
      app.contextMessages = [
        { role: 'user', content: '<context-file path="CLAUDE.md">\nsome content\n</context-file>' },
      ]
      showDryRunConfig(app)
      const output = logs.join('\n')
      expect(output).toContain('CLAUDE.md')
      expect(output).toContain('Discovered context files')
    } finally {
      console.log = originalLog
    }
  })

  it('shows middleware hooks when configured', () => {
    const logs: string[] = []
    const originalLog = console.log
    console.log = (...args: unknown[]) => logs.push(args.join(' '))
    try {
      const app = makeApp()
      app.middleware = {
        beforeModelCall: [async () => {}],
        afterToolExecution: [async () => {}, async () => {}],
      }
      showDryRunConfig(app)
      const output = logs.join('\n')
      expect(output).toContain('beforeModelCall')
      expect(output).toContain('1 hook(s)')
      expect(output).toContain('afterToolExecution')
      expect(output).toContain('2 hook(s)')
    } finally {
      console.log = originalLog
    }
  })

  it('masks HTTP token', () => {
    const logs: string[] = []
    const originalLog = console.log
    console.log = (...args: unknown[]) => logs.push(args.join(' '))
    try {
      showDryRunConfig(makeApp({ http: { port: 3000, token: 'secret-token' } }))
      const output = logs.join('\n')
      expect(output).toContain('***')
      expect(output).not.toContain('secret-token')
    } finally {
      console.log = originalLog
    }
  })

  it('shows memory info when enabled', () => {
    const logs: string[] = []
    const originalLog = console.log
    console.log = (...args: unknown[]) => logs.push(args.join(' '))
    try {
      const app = makeApp({ memory: { enabled: true, maxMemories: 500, ttlDays: 30, injectLimit: 3 } })
      app.memoryStore = { count: () => 42 } as any
      showDryRunConfig(app)
      const output = logs.join('\n')
      expect(output).toContain('true')
      expect(output).toContain('500')
      expect(output).toContain('42')
    } finally {
      console.log = originalLog
    }
  })
})
