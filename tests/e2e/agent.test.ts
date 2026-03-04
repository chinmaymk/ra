import { describe, it, expect } from 'bun:test'
import { AgentLoop } from '../../src/agent/loop'
import { ToolRegistry } from '../../src/agent/tool-registry'
import { loadConfig } from '../../src/config'
import { createProvider, buildProviderConfig } from '../../src/providers/registry'
import type { IProvider, StreamChunk } from '../../src/providers/types'

function mockProvider(text: string): IProvider {
  return {
    name: 'mock',
    chat: async () => { throw new Error() },
    async *stream() {
      yield { type: 'text', delta: text }
      yield { type: 'done' }
    },
  }
}

describe('e2e: agent flow', () => {
  it('config loads and provider is created', async () => {
    const config = await loadConfig({ cwd: '/tmp/nonexistent', env: { ANTHROPIC_API_KEY: 'test-key' } })
    expect(config.provider).toBe('anthropic')
    const provider = createProvider(buildProviderConfig(config.provider, config.providers[config.provider]))
    expect(provider.name).toBe('anthropic')
  })

  it('full loop: user message -> tool call -> final response', async () => {
    const responses: StreamChunk[][] = [
      [
        { type: 'tool_call_start', id: '1', name: 'greet' },
        { type: 'tool_call_delta', id: '1', argsDelta: '{"name":"world"}' },
        { type: 'tool_call_end', id: '1' },
        { type: 'done' },
      ],
      [{ type: 'text', delta: 'Hello, world!' }, { type: 'done' }],
    ]
    let call = 0
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error() },
      async *stream() { for (const c of responses[call++]!) yield c },
    }
    const tools = new ToolRegistry()
    tools.register({ name: 'greet', description: 'greet', inputSchema: {}, execute: async (input: any) => `Hello, ${input.name}!` })
    const loop = new AgentLoop({ provider, tools, maxIterations: 10 })
    const result = await loop.run([{ role: 'user', content: 'greet me' }])
    expect(result.messages.at(-1)?.content).toBe('Hello, world!')
    expect(result.iterations).toBe(2)
  })
})
