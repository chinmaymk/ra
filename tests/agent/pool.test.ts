import { describe, it, expect } from 'bun:test'
import { AgentPool } from '../../src/agent/pool'
import type { IProvider, StreamChunk } from '../../src/providers/types'
import { ToolRegistry } from '../../src/agent/tool-registry'

function mockProvider(responses: StreamChunk[][]): IProvider {
  let callIndex = 0
  return {
    name: 'mock',
    chat: async () => { throw new Error('use stream') },
    async *stream() {
      const chunks = responses[callIndex++] ?? [{ type: 'text', delta: 'done' }, { type: 'done' }]
      for (const chunk of chunks) yield chunk
    },
  }
}

function makePool(provider?: IProvider) {
  return new AgentPool({
    provider: provider ?? mockProvider([[{ type: 'text', delta: 'hi' }, { type: 'done' }]]),
    tools: new ToolRegistry(),
    model: 'test-model',
  })
}

describe('AgentPool', () => {
  it('creates and lists agents', () => {
    const pool = makePool()
    pool.create('agent-a')
    pool.create('agent-b')
    expect(pool.list()).toHaveLength(2)
    expect(pool.list().map(a => a.name).sort()).toEqual(['agent-a', 'agent-b'])
  })

  it('rejects duplicate agent names', () => {
    const pool = makePool()
    pool.create('dup')
    expect(() => pool.create('dup')).toThrow('already exists')
  })

  it('gets agent info', () => {
    const pool = makePool()
    pool.create('x', { model: 'custom-model' })
    const info = pool.get('x')
    expect(info).toBeDefined()
    expect(info!.name).toBe('x')
    expect(info!.overrides.model).toBe('custom-model')
    expect(info!.running).toBe(false)
  })

  it('returns undefined for unknown agent', () => {
    const pool = makePool()
    expect(pool.get('nope')).toBeUndefined()
  })

  it('chats with an agent and accumulates messages', async () => {
    const provider = mockProvider([
      [{ type: 'text', delta: 'hello!' }, { type: 'done' }],
      [{ type: 'text', delta: 'world!' }, { type: 'done' }],
    ])
    const pool = makePool(provider)
    pool.create('chatty')

    const r1 = await pool.chat('chatty', [{ role: 'user', content: 'hi' }])
    expect(r1.messages).toHaveLength(1)
    expect(r1.messages[0]?.content).toBe('hello!')

    // Second chat — agent remembers prior messages
    const r2 = await pool.chat('chatty', [{ role: 'user', content: 'again' }])
    expect(r2.messages).toHaveLength(1)
    expect(r2.messages[0]?.content).toBe('world!')

    // Internal message count includes system + user + assistant from both turns
    const info = pool.get('chatty')!
    expect(info.messageCount).toBeGreaterThanOrEqual(4) // 2 user + 2 assistant
  })

  it('throws when chatting with unknown agent', async () => {
    const pool = makePool()
    await expect(pool.chat('ghost', [{ role: 'user', content: 'hi' }])).rejects.toThrow('not found')
  })

  it('removes an agent', () => {
    const pool = makePool()
    pool.create('temp')
    expect(pool.size).toBe(1)
    pool.remove('temp')
    expect(pool.size).toBe(0)
    expect(pool.get('temp')).toBeUndefined()
  })

  it('throws when removing unknown agent', () => {
    const pool = makePool()
    expect(() => pool.remove('nope')).toThrow('not found')
  })

  it('applies system prompt from pool config', () => {
    const pool = new AgentPool({
      provider: mockProvider([]),
      tools: new ToolRegistry(),
      model: 'test',
      systemPrompt: 'You are a helper.',
    })
    pool.create('with-sys')
    const info = pool.get('with-sys')!
    // System prompt message was prepended
    expect(info.messageCount).toBe(1)
  })

  it('per-agent system prompt overrides pool default', () => {
    const pool = new AgentPool({
      provider: mockProvider([]),
      tools: new ToolRegistry(),
      model: 'test',
      systemPrompt: 'default prompt',
    })
    pool.create('custom', { systemPrompt: 'custom prompt' })
    // Agent has 1 message (its custom system prompt, not the default)
    expect(pool.get('custom')!.messageCount).toBe(1)
  })

  it('runs multiple agents concurrently', async () => {
    let callCount = 0
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('use stream') },
      async *stream() {
        const i = callCount++
        yield { type: 'text' as const, delta: `response-${i}` }
        yield { type: 'done' as const }
      },
    }
    const pool = new AgentPool({ provider, tools: new ToolRegistry(), model: 'test' })
    pool.create('a')
    pool.create('b')
    pool.create('c')

    const [ra, rb, rc] = await Promise.all([
      pool.chat('a', [{ role: 'user', content: 'go' }]),
      pool.chat('b', [{ role: 'user', content: 'go' }]),
      pool.chat('c', [{ role: 'user', content: 'go' }]),
    ])

    expect(ra.messages).toHaveLength(1)
    expect(rb.messages).toHaveLength(1)
    expect(rc.messages).toHaveLength(1)
    expect(callCount).toBe(3)
  })

  it('size reflects agent count', () => {
    const pool = makePool()
    expect(pool.size).toBe(0)
    pool.create('one')
    expect(pool.size).toBe(1)
    pool.create('two')
    expect(pool.size).toBe(2)
    pool.remove('one')
    expect(pool.size).toBe(1)
  })
})
