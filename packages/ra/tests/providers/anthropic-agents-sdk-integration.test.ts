import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { AgentLoop, ToolRegistry } from '@chinmaymk/ra'
import type { StreamChunk } from '@chinmaymk/ra'

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

describe('AnthropicAgentsSdkProvider + AgentLoop integration', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockCreateSdkMcpServer.mockReset()
    mockSdkTool.mockReset()
    // sdkTool captures the real handler so we can verify it's wired up
    mockSdkTool.mockImplementation((name: string, desc: string, schema: unknown, handler: unknown) => ({
      name, description: desc, inputSchema: schema, handler,
    }))
    mockCreateSdkMcpServer.mockReturnValue({ type: 'sdk', instance: {} })
  })

  it('text-only response flows through the loop (1 iteration)', async () => {
    mockQuery.mockReturnValue((async function* () {
      yield streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello world' } })
      yield resultMsg()
    })())

    const provider = new AnthropicAgentsSdkProvider()
    const loop = new AgentLoop({ provider, tools: new ToolRegistry(), maxIterations: 10, model: 'claude-sonnet-4-6' })
    const result = await loop.run([{ role: 'user', content: 'say hello' }])

    expect(result.iterations).toBe(1)
    expect(result.messages.at(-1)?.content).toBe('Hello world')
  })

  it('SDK handles tool execution autonomously — ra sees final text only', async () => {
    // Simulate: model calls a tool → SDK executes it → model responds with text
    // The stream events include tool call AND final text from the multi-turn session
    mockQuery.mockReturnValue((async function* () {
      // Turn 1: model generates a tool call (SDK will handle it)
      yield streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tc_1', name: 'add' } })
      yield streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"a":1,"b":2}' } })
      yield streamEvent({ type: 'content_block_stop', index: 0 })
      // Turn 2: model responds with final text after seeing tool result
      yield streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'The sum is 3' } })
      yield resultMsg({ input_tokens: 100, output_tokens: 20 })
    })())

    const tools = new ToolRegistry()
    tools.register({
      name: 'add',
      description: 'Add two numbers',
      inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
      execute: async (input: { a: number; b: number }) => input.a + input.b,
    })

    const provider = new AnthropicAgentsSdkProvider()
    const loop = new AgentLoop({ provider, tools, maxIterations: 10, model: 'claude-sonnet-4-6' })
    const result = await loop.run([{ role: 'user', content: 'add 1+2' }])

    // Loop completes in 1 iteration — SDK handled tools internally
    expect(result.iterations).toBe(1)
    expect(result.messages.at(-1)?.content).toBe('The sum is 3')
    // No tool messages in ra's message list — SDK handled them
    expect(result.messages.filter(m => m.role === 'tool')).toHaveLength(0)
  })

  it('MCP tool handlers are wired to real tool.execute()', async () => {
    mockQuery.mockReturnValue((async function* () {
      yield streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } })
      yield resultMsg()
    })())

    const executeCalls: unknown[] = []
    const tools = new ToolRegistry()
    tools.register({
      name: 'echo',
      description: 'echo',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      execute: async (input: { text: string }) => { executeCalls.push(input); return input.text },
    })

    const provider = new AnthropicAgentsSdkProvider()
    const loop = new AgentLoop({ provider, tools, maxIterations: 10, model: 'claude-sonnet-4-6' })
    await loop.run([{ role: 'user', content: 'echo hi' }])

    // Verify the MCP tool handler calls the real execute function
    expect(mockSdkTool).toHaveBeenCalledTimes(1)
    const handler = mockSdkTool.mock.calls[0]![3] as (args: Record<string, unknown>) => Promise<unknown>
    const mcpResult = await handler({ text: 'hello' }) as { content: { text: string }[] }
    expect(mcpResult.content[0]!.text).toBe('hello')
    expect(executeCalls).toHaveLength(1)
  })

  it('system prompt is passed through', async () => {
    mockQuery.mockReturnValue((async function* () {
      yield resultMsg()
    })())

    const provider = new AnthropicAgentsSdkProvider()
    const loop = new AgentLoop({ provider, tools: new ToolRegistry(), maxIterations: 10, model: 'claude-sonnet-4-6' })
    await loop.run([
      { role: 'system', content: 'You are a pirate.' },
      { role: 'user', content: 'hello' },
    ])

    expect(mockQuery.mock.calls[0]![0].options.systemPrompt).toBe('You are a pirate.')
  })

  it('thinking level flows through to SDK', async () => {
    mockQuery.mockReturnValue((async function* () {
      yield streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Hmm...' } })
      yield streamEvent({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'answer' } })
      yield resultMsg()
    })())

    const provider = new AnthropicAgentsSdkProvider()
    const loop = new AgentLoop({ provider, tools: new ToolRegistry(), maxIterations: 10, model: 'claude-sonnet-4-6', thinking: 'high' })
    await loop.run([{ role: 'user', content: 'think hard' }])

    const opts = mockQuery.mock.calls[0]![0].options
    expect(opts.thinking).toEqual({ type: 'enabled', budgetTokens: 32000 })
    expect(opts.effort).toBe('high')
  })

  it('usage is reported in loop result', async () => {
    mockQuery.mockReturnValue((async function* () {
      yield streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } })
      yield resultMsg({ input_tokens: 150, output_tokens: 30, cache_read_input_tokens: 50 })
    })())

    const provider = new AnthropicAgentsSdkProvider()
    const loop = new AgentLoop({ provider, tools: new ToolRegistry(), maxIterations: 10, model: 'claude-sonnet-4-6' })
    const result = await loop.run([{ role: 'user', content: 'go' }])

    expect(result.usage.inputTokens).toBe(200) // 150 + 50 cache
    expect(result.usage.outputTokens).toBe(30)
  })

  it('all SDK magic is disabled on every call', async () => {
    mockQuery.mockReturnValue((async function* () {
      yield streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } })
      yield resultMsg()
    })())

    const provider = new AnthropicAgentsSdkProvider()
    const loop = new AgentLoop({ provider, tools: new ToolRegistry(), maxIterations: 10, model: 'claude-sonnet-4-6' })
    await loop.run([{ role: 'user', content: 'go' }])

    const opts = mockQuery.mock.calls[0]![0].options
    // Context isolation
    expect(opts.settingSources).toEqual([])
    expect(opts.settings.autoMemoryEnabled).toBe(false)
    expect(opts.settings.autoDreamEnabled).toBe(false)
    expect(opts.settings.includeGitInstructions).toBe(false)
    expect(opts.settings.respectGitignore).toBe(false)
    expect(opts.persistSession).toBe(false)
    expect(opts.enableFileCheckpointing).toBe(false)
    expect(opts.plugins).toEqual([])
    // Tool & permission isolation
    expect(opts.tools).toEqual([])
    expect(opts.permissionMode).toBe('bypassPermissions')
    expect(opts.allowDangerouslySkipPermissions).toBe(true)
    // System prompt is a string (replaces SDK default)
    expect(typeof opts.systemPrompt).toBe('string')
    // No maxTurns — SDK runs autonomously
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

    const provider = new AnthropicAgentsSdkProvider()
    const loop = new AgentLoop({ provider, tools: new ToolRegistry(), maxIterations: 10, model: 'claude-sonnet-4-6' })

    setTimeout(() => loop.abort(), 50)
    const result = await loop.run([{ role: 'user', content: 'wait' }])

    expect(result.stopReason).toBe('aborted')
  })
})
