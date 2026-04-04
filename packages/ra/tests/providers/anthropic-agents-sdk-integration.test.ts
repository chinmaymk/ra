import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { AgentLoop, ToolRegistry } from '@chinmaymk/ra'
import type { ChatRequest, StreamChunk, IMessage } from '@chinmaymk/ra'

// ── Mock the Agent SDK ──────────────────────────────────────────────
const mockQuery = mock()
const mockCreateSdkMcpServer = mock()
const mockSdkTool = mock()

mock.module('@anthropic-ai/claude-agent-sdk', () => ({
  query: mockQuery,
  createSdkMcpServer: mockCreateSdkMcpServer,
  tool: mockSdkTool,
}))

import { AnthropicAgentsSdkProvider } from '@chinmaymk/ra'

// ── Helpers ─────────────────────────────────────────────────────────

/** Wrap a BetaRawMessageStreamEvent as an SDKPartialAssistantMessage. */
function streamEvent(event: unknown) {
  return { type: 'stream_event', event, parent_tool_use_id: null, uuid: 'u', session_id: 's' }
}

/** Build an SDK result message with usage. */
function resultMsg(usage: Record<string, number> = { input_tokens: 10, output_tokens: 5 }) {
  return { type: 'result', subtype: 'success', usage, uuid: 'u', session_id: 's' }
}

/**
 * Set up mockQuery to return different responses for sequential calls.
 * Each entry is an array of SDK messages for one query() call.
 */
function mockQuerySequence(sequences: unknown[][]) {
  let callIndex = 0
  mockQuery.mockImplementation(() => {
    const msgs = sequences[callIndex++] ?? [resultMsg()]
    return (async function* () { for (const m of msgs) yield m })()
  })
}

describe('AnthropicAgentsSdkProvider + AgentLoop integration', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockCreateSdkMcpServer.mockReset()
    mockSdkTool.mockReset()
    mockSdkTool.mockImplementation((name: string, desc: string, schema: unknown, handler: unknown) => ({
      name, description: desc, inputSchema: schema, handler,
    }))
    mockCreateSdkMcpServer.mockReturnValue({ type: 'sdk', instance: {} })
  })

  it('single turn: text response flows through the loop', async () => {
    mockQuerySequence([
      [
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello world' } }),
        resultMsg(),
      ],
    ])

    const provider = new AnthropicAgentsSdkProvider()
    const loop = new AgentLoop({ provider, tools: new ToolRegistry(), maxIterations: 10, model: 'claude-sonnet-4-6' })
    const result = await loop.run([{ role: 'user', content: 'say hello' }])

    expect(result.iterations).toBe(1)
    expect(result.messages.at(-1)?.content).toBe('Hello world')
    // Normal completion (no tool calls) has no stopReason
    expect(result.stopReason).toBeUndefined()
  })

  it('multi-turn tool loop: model calls tool, gets result, responds', async () => {
    // Turn 1: model calls a tool
    // Turn 2: model sees tool result, responds with text
    mockQuerySequence([
      [
        streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tc_1', name: 'add' } }),
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"a":1,"b":2}' } }),
        streamEvent({ type: 'content_block_stop', index: 0 }),
        resultMsg(),
      ],
      [
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'The sum is 3' } }),
        resultMsg(),
      ],
    ])

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

    expect(result.iterations).toBe(2)
    expect(result.messages.at(-1)?.content).toBe('The sum is 3')
    // Verify tool was called
    const toolMsg = result.messages.find(m => m.role === 'tool')
    expect(toolMsg).toBeDefined()
    expect(toolMsg!.content).toBe('3')
  })

  it('conversation history is passed to subsequent calls', async () => {
    mockQuerySequence([
      [
        streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tc_1', name: 'echo' } }),
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"text":"hi"}' } }),
        streamEvent({ type: 'content_block_stop', index: 0 }),
        resultMsg(),
      ],
      [
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } }),
        resultMsg(),
      ],
    ])

    const tools = new ToolRegistry()
    tools.register({ name: 'echo', description: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } } }, execute: async (input: { text: string }) => input.text })

    const provider = new AnthropicAgentsSdkProvider()
    const loop = new AgentLoop({ provider, tools, maxIterations: 10, model: 'claude-sonnet-4-6' })
    await loop.run([{ role: 'user', content: 'echo hi' }])

    // Second call should receive full conversation history in the prompt
    expect(mockQuery).toHaveBeenCalledTimes(2)
    const secondCallPrompt = mockQuery.mock.calls[1]![0].prompt as string
    expect(secondCallPrompt).toContain('[User]')
    expect(secondCallPrompt).toContain('[Assistant]')
    expect(secondCallPrompt).toContain('[Tool Result')
    expect(secondCallPrompt).toContain('tool_call id="tc_1"')
  })

  it('system prompt is passed through correctly', async () => {
    mockQuerySequence([
      [
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Arrr!' } }),
        resultMsg(),
      ],
    ])

    const provider = new AnthropicAgentsSdkProvider()
    const loop = new AgentLoop({ provider, tools: new ToolRegistry(), maxIterations: 10, model: 'claude-sonnet-4-6' })
    // System prompt is passed as a system-role message (same as other providers)
    await loop.run([
      { role: 'system', content: 'You are a pirate.' },
      { role: 'user', content: 'hello' },
    ])

    const opts = mockQuery.mock.calls[0]![0].options
    expect(opts.systemPrompt).toBe('You are a pirate.')
  })

  it('tool definitions are registered as MCP tools', async () => {
    mockQuerySequence([
      [
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }),
        resultMsg(),
      ],
    ])

    const tools = new ToolRegistry()
    tools.register({
      name: 'Read',
      description: 'Read a file',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      execute: async () => 'file contents',
    })
    tools.register({
      name: 'Write',
      description: 'Write a file',
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } },
      execute: async () => 'ok',
    })

    const provider = new AnthropicAgentsSdkProvider()
    const loop = new AgentLoop({ provider, tools, maxIterations: 10, model: 'claude-sonnet-4-6' })
    await loop.run([{ role: 'user', content: 'hi' }])

    // Both tools registered via sdkTool
    expect(mockSdkTool).toHaveBeenCalledTimes(2)
    expect(mockSdkTool.mock.calls[0]![0]).toBe('Read')
    expect(mockSdkTool.mock.calls[1]![0]).toBe('Write')
    // MCP server created
    expect(mockCreateSdkMcpServer).toHaveBeenCalledTimes(1)
    // Passed in options
    const opts = mockQuery.mock.calls[0]![0].options
    expect(opts.mcpServers).toBeDefined()
    expect(opts.mcpServers['ra-tools']).toBeDefined()
  })

  it('thinking level flows through to SDK', async () => {
    mockQuerySequence([
      [
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Hmm...' } }),
        streamEvent({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'answer' } }),
        resultMsg(),
      ],
    ])

    const provider = new AnthropicAgentsSdkProvider()
    const loop = new AgentLoop({ provider, tools: new ToolRegistry(), maxIterations: 10, model: 'claude-sonnet-4-6', thinking: 'high' })
    await loop.run([{ role: 'user', content: 'think hard' }])

    const opts = mockQuery.mock.calls[0]![0].options
    expect(opts.thinking).toEqual({ type: 'enabled', budgetTokens: 32000 })
    expect(opts.effort).toBe('high')
  })

  it('respects maxIterations', async () => {
    const toolCallChunks = [
      streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tc', name: 'noop' } }),
      streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } }),
      streamEvent({ type: 'content_block_stop', index: 0 }),
      resultMsg(),
    ]
    // Always return tool calls — loop should stop at maxIterations
    mockQuerySequence(Array(20).fill(toolCallChunks))

    const tools = new ToolRegistry()
    tools.register({ name: 'noop', description: 'noop', inputSchema: {}, execute: async () => 'ok' })

    const provider = new AnthropicAgentsSdkProvider()
    const loop = new AgentLoop({ provider, tools, maxIterations: 3, model: 'claude-sonnet-4-6' })
    const result = await loop.run([{ role: 'user', content: 'loop forever' }])

    expect(result.iterations).toBeLessThanOrEqual(3)
  })

  it('usage is accumulated across turns', async () => {
    mockQuerySequence([
      [
        streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tc_1', name: 'noop' } }),
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } }),
        streamEvent({ type: 'content_block_stop', index: 0 }),
        resultMsg({ input_tokens: 100, output_tokens: 20 }),
      ],
      [
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } }),
        resultMsg({ input_tokens: 150, output_tokens: 30 }),
      ],
    ])

    const tools = new ToolRegistry()
    tools.register({ name: 'noop', description: 'noop', inputSchema: {}, execute: async () => 'ok' })

    const provider = new AnthropicAgentsSdkProvider()
    const loop = new AgentLoop({ provider, tools, maxIterations: 10, model: 'claude-sonnet-4-6' })
    const result = await loop.run([{ role: 'user', content: 'go' }])

    expect(result.usage.inputTokens).toBe(250)
    expect(result.usage.outputTokens).toBe(50)
  })

  it('all SDK magic is disabled on every call', async () => {
    mockQuerySequence([
      [
        streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tc', name: 'noop' } }),
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } }),
        streamEvent({ type: 'content_block_stop', index: 0 }),
        resultMsg(),
      ],
      [
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }),
        resultMsg(),
      ],
    ])

    const tools = new ToolRegistry()
    tools.register({ name: 'noop', description: 'noop', inputSchema: {}, execute: async () => 'ok' })

    const provider = new AnthropicAgentsSdkProvider()
    const loop = new AgentLoop({ provider, tools, maxIterations: 10, model: 'claude-sonnet-4-6' })
    await loop.run([{ role: 'user', content: 'go' }])

    // Both calls must have magic disabled
    for (let i = 0; i < mockQuery.mock.calls.length; i++) {
      const opts = mockQuery.mock.calls[i]![0].options
      // Context isolation — ra owns all context engineering
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
      expect(opts.maxTurns).toBe(1)
      // System prompt is a plain string (replaces SDK default, no hidden instructions)
      expect(typeof opts.systemPrompt).toBe('string')
    }
  })

  it('middleware hooks fire correctly with the provider', async () => {
    const events: string[] = []
    mockQuerySequence([
      [
        streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tc', name: 'noop' } }),
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } }),
        streamEvent({ type: 'content_block_stop', index: 0 }),
        resultMsg(),
      ],
      [
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }),
        resultMsg(),
      ],
    ])

    const tools = new ToolRegistry()
    tools.register({ name: 'noop', description: 'noop', inputSchema: {}, execute: async () => 'ok' })

    const provider = new AnthropicAgentsSdkProvider()
    const loop = new AgentLoop({
      provider,
      tools,
      maxIterations: 10,
      model: 'claude-sonnet-4-6',
      middleware: {
        beforeModelCall: [async () => { events.push('beforeModelCall') }],
        afterModelResponse: [async () => { events.push('afterModelResponse') }],
        beforeToolExecution: [async () => { events.push('beforeToolExecution') }],
        afterToolExecution: [async () => { events.push('afterToolExecution') }],
      },
    })
    await loop.run([{ role: 'user', content: 'go' }])

    expect(events).toEqual([
      'beforeModelCall',     // turn 1: model call
      'afterModelResponse',  // turn 1: response received
      'beforeToolExecution', // turn 1: tool execution
      'afterToolExecution',  // turn 1: tool result
      'beforeModelCall',     // turn 2: model call with results
      'afterModelResponse',  // turn 2: final response
    ])
  })

  it('parallel tool calls are executed by the loop', async () => {
    mockQuerySequence([
      [
        streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tc_a', name: 'echo' } }),
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"text":"a"}' } }),
        streamEvent({ type: 'content_block_stop', index: 0 }),
        streamEvent({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tc_b', name: 'echo' } }),
        streamEvent({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"text":"b"}' } }),
        streamEvent({ type: 'content_block_stop', index: 1 }),
        resultMsg(),
      ],
      [
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Got a and b' } }),
        resultMsg(),
      ],
    ])

    const tools = new ToolRegistry()
    tools.register({
      name: 'echo',
      description: 'echo text',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      execute: async (input: { text: string }) => input.text,
    })

    const provider = new AnthropicAgentsSdkProvider()
    const loop = new AgentLoop({ provider, tools, maxIterations: 10, model: 'claude-sonnet-4-6' })
    const result = await loop.run([{ role: 'user', content: 'echo a and b' }])

    // Two tool messages (one for each parallel call)
    const toolMsgs = result.messages.filter(m => m.role === 'tool')
    expect(toolMsgs).toHaveLength(2)
    expect(result.iterations).toBe(2)
    expect(result.messages.at(-1)?.content).toBe('Got a and b')
  })

  it('tool error results are passed back to the model', async () => {
    mockQuerySequence([
      [
        streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tc', name: 'fail' } }),
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } }),
        streamEvent({ type: 'content_block_stop', index: 0 }),
        resultMsg(),
      ],
      [
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Tool failed, sorry' } }),
        resultMsg(),
      ],
    ])

    const tools = new ToolRegistry()
    tools.register({
      name: 'fail',
      description: 'always fails',
      inputSchema: {},
      execute: async () => { throw new Error('boom') },
    })

    const provider = new AnthropicAgentsSdkProvider()
    const loop = new AgentLoop({ provider, tools, maxIterations: 10, model: 'claude-sonnet-4-6' })
    const result = await loop.run([{ role: 'user', content: 'run fail' }])

    const toolMsg = result.messages.find(m => m.role === 'tool')
    expect(toolMsg?.isError).toBe(true)
    expect(result.messages.at(-1)?.content).toBe('Tool failed, sorry')
  })

  it('abort stops the loop', async () => {
    // The query yields nothing useful then hangs — abort cuts it short
    mockQuery.mockImplementation((params: { options: { abortController: AbortController } }) => {
      const ac = params.options.abortController
      return (async function* () {
        // Wait until aborted or a long timeout
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
