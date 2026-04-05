import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { AgentLoop, ToolRegistry } from '@chinmaymk/ra'

const mockQuery = mock()
const mockCreateSdkMcpServer = mock()
const mockSdkTool = mock()

mock.module('@anthropic-ai/claude-agent-sdk', () => ({
  query: mockQuery,
  createSdkMcpServer: mockCreateSdkMcpServer,
  tool: mockSdkTool,
}))

import { AnthropicAgentsSdkProvider } from '@chinmaymk/ra'

function streamEvent(event: unknown) {
  return { type: 'stream_event', event, parent_tool_use_id: null, uuid: 'u', session_id: 's' }
}

function resultMsg(usage: Record<string, number> = { input_tokens: 10, output_tokens: 5 }) {
  return { type: 'result', subtype: 'success', usage, uuid: 'u', session_id: 's' }
}

describe('AnthropicAgentsSdkProvider + AgentLoop', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockCreateSdkMcpServer.mockReset()
    mockSdkTool.mockReset()
    mockSdkTool.mockImplementation((name: string, desc: string, schema: unknown, handler: unknown) => ({
      name, description: desc, inputSchema: schema, handler,
    }))
    mockCreateSdkMcpServer.mockReturnValue({ type: 'sdk', instance: {} })
  })

  it('text response flows through the loop', async () => {
    mockQuery.mockReturnValue((async function* () {
      yield streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } })
      yield resultMsg()
    })())

    const loop = new AgentLoop({ provider: new AnthropicAgentsSdkProvider(), tools: new ToolRegistry(), maxIterations: 10, model: 'x' })
    const result = await loop.run([{ role: 'user', content: 'hi' }])
    expect(result.iterations).toBe(1)
    expect(result.messages.at(-1)?.content).toContain('Hello')
  })

  it('SDK handles tools autonomously — ra sees final text', async () => {
    mockQuery.mockReturnValue((async function* () {
      // SDK runs model → tool → model internally; we get text from all turns
      yield streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Let me check.\n' } })
      // Tool activity would be pushed to toolTextQueue by MCP handler
      yield streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'The answer is 42.' } })
      yield resultMsg()
    })())

    const tools = new ToolRegistry()
    tools.register({ name: 'calc', description: 'calc', inputSchema: {}, execute: async () => 42 })

    const loop = new AgentLoop({ provider: new AnthropicAgentsSdkProvider(), tools, maxIterations: 10, model: 'x' })
    const result = await loop.run([{ role: 'user', content: 'calculate' }])

    expect(result.iterations).toBe(1)
    expect(result.messages.at(-1)?.content).toContain('The answer is 42.')
  })

  it('MCP handlers execute real tools', async () => {
    mockQuery.mockReturnValue((async function* () {
      yield streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } })
      yield resultMsg()
    })())

    const calls: unknown[] = []
    const tools = new ToolRegistry()
    tools.register({
      name: 'track',
      description: 'track',
      inputSchema: { type: 'object', properties: { x: { type: 'number' } } },
      execute: async (input: { x: number }) => { calls.push(input); return input.x * 2 },
    })

    const loop = new AgentLoop({ provider: new AnthropicAgentsSdkProvider(), tools, maxIterations: 10, model: 'x' })
    await loop.run([{ role: 'user', content: 'go' }])

    // Verify the MCP handler calls the real tool
    const handler = mockSdkTool.mock.calls[0]![3] as (args: Record<string, unknown>) => Promise<unknown>
    const result = await handler({ x: 5 }) as { content: { text: string }[] }
    expect(result.content[0]!.text).toBe('10')
    expect(calls).toEqual([{ x: 5 }])
  })

  it('permission check blocks denied tools', async () => {
    mockQuery.mockReturnValue((async function* () {
      yield streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } })
      yield resultMsg()
    })())

    const executed: string[] = []
    const tools = new ToolRegistry()
    tools.register({ name: 'safe', description: 'safe', inputSchema: {}, execute: async () => { executed.push('safe'); return 'ok' } })
    tools.register({ name: 'danger', description: 'danger', inputSchema: {}, execute: async () => { executed.push('danger'); return 'bad' } })

    const provider = new AnthropicAgentsSdkProvider({
      checkToolPermission: async (name) => name === 'danger' ? 'Permission denied: danger is blocked' : undefined,
    })

    const loop = new AgentLoop({ provider, tools, maxIterations: 10, model: 'x' })
    await loop.run([{ role: 'user', content: 'go' }])

    // Find handlers by tool name
    const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>()
    for (const call of mockSdkTool.mock.calls) {
      handlers.set(call![0] as string, call![3] as (args: Record<string, unknown>) => Promise<unknown>)
    }

    // Verify safe tool works
    const safeResult = await handlers.get('safe')!({}) as { content: { text: string }[] }
    expect(safeResult.content[0]!.text).toBe('ok')

    // Verify danger tool is blocked
    const dangerResult = await handlers.get('danger')!({}) as { content: { text: string }[]; isError: boolean }
    expect(dangerResult.isError).toBe(true)
    expect(dangerResult.content[0]!.text).toContain('Permission denied')
    expect(executed).toEqual(['safe']) // danger was never executed
  })

  it('system prompt forwarded', async () => {
    mockQuery.mockReturnValue((async function* () { yield resultMsg() })())
    const loop = new AgentLoop({ provider: new AnthropicAgentsSdkProvider(), tools: new ToolRegistry(), maxIterations: 10, model: 'x' })
    await loop.run([{ role: 'system', content: 'Pirate.' }, { role: 'user', content: 'hi' }])
    expect(mockQuery.mock.calls[0]![0].options.systemPrompt).toBe('Pirate.')
  })

  it('thinking flows through', async () => {
    mockQuery.mockReturnValue((async function* () {
      yield streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Hmm' } })
      yield resultMsg()
    })())
    const loop = new AgentLoop({ provider: new AnthropicAgentsSdkProvider(), tools: new ToolRegistry(), maxIterations: 10, model: 'x', thinking: 'high' })
    await loop.run([{ role: 'user', content: 'think' }])
    const opts = mockQuery.mock.calls[0]![0].options
    expect(opts.thinking).toEqual({ type: 'enabled', budgetTokens: 32000 })
    expect(opts.effort).toBe('high')
  })

  it('all SDK magic disabled', async () => {
    mockQuery.mockReturnValue((async function* () { yield resultMsg() })())
    const loop = new AgentLoop({ provider: new AnthropicAgentsSdkProvider(), tools: new ToolRegistry(), maxIterations: 10, model: 'x' })
    await loop.run([{ role: 'user', content: 'go' }])

    const opts = mockQuery.mock.calls[0]![0].options
    expect(opts.settingSources).toEqual([])
    expect(opts.settings.autoMemoryEnabled).toBe(false)
    expect(opts.settings.autoDreamEnabled).toBe(false)
    expect(opts.settings.includeGitInstructions).toBe(false)
    expect(opts.settings.respectGitignore).toBe(false)
    expect(opts.persistSession).toBe(false)
    expect(opts.enableFileCheckpointing).toBe(false)
    expect(opts.plugins).toEqual([])
    expect(opts.tools).toEqual([])
    expect(opts.permissionMode).toBe('bypassPermissions')
    expect(opts.maxTurns).toBeUndefined()
  })

  it('abort stops the loop', async () => {
    mockQuery.mockImplementation((params: { options: { abortController: AbortController } }) => {
      const ac = params.options.abortController
      return (async function* () {
        await new Promise<void>(resolve => {
          ac.signal.addEventListener('abort', () => resolve(), { once: true })
          setTimeout(resolve, 10000)
        })
        yield resultMsg()
      })()
    })

    const loop = new AgentLoop({ provider: new AnthropicAgentsSdkProvider(), tools: new ToolRegistry(), maxIterations: 10, model: 'x' })
    setTimeout(() => loop.abort(), 50)
    const result = await loop.run([{ role: 'user', content: 'wait' }])
    expect(result.stopReason).toBe('aborted')
  })
})
