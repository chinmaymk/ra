import { describe, it, expect } from 'bun:test'
import { runCli } from '../../src/interfaces/cli'
import { ToolRegistry } from '../../src/agent/tool-registry'
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

describe('runCli', () => {
  it('runs and collects output', async () => {
    const chunks: string[] = []
    await runCli({
      prompt: 'hello',
      model: 'test',
      provider: mockProvider('world'),
      tools: new ToolRegistry(),
      onChunk: (text) => chunks.push(text),
    })
    expect(chunks.join('')).toBe('world')
  })

  it('includes systemPrompt as system message', async () => {
    const messages: any[] = []
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error() },
      async *stream(req) {
        messages.push(...req.messages)
        yield { type: 'text', delta: 'ok' }
        yield { type: 'done' }
      },
    }
    await runCli({
      prompt: 'test',
      model: 'x',
      provider,
      tools: new ToolRegistry(),
      systemPrompt: 'You are helpful',
    })
    expect(messages.find(m => m.role === 'system')?.content).toBe('You are helpful')
  })
})
