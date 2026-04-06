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

/** Create a mock async generator from messages. */
function mockSession(messages: unknown[]) {
  return (async function* () { for (const m of messages) yield m })()
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
    mockQuery.mockReturnValue(mockSession([
      streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } }),
      resultMsg(),
    ]))

    const loop = new AgentLoop({ provider: new AnthropicAgentsSdkProvider(), tools: new ToolRegistry(), maxIterations: 10, model: 'x' })
    const result = await loop.run([{ role: 'user', content: 'hi' }])
    expect(result.iterations).toBe(1)
    expect(result.messages.at(-1)?.content).toContain('Hello')
  })

  it('ra loop handles tool calls — executes tools and iterates', async () => {
    let callCount = 0
    mockQuery.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return mockSession([
          streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Let me check.' } }),
          streamEvent({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tc_1', name: 'calc' } }),
          streamEvent({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"x":21}' } }),
          streamEvent({ type: 'content_block_stop', index: 1 }),
          resultMsg(),
        ])
      }
      return mockSession([
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'The answer is 42.' } }),
        resultMsg(),
      ])
    })

    const tools = new ToolRegistry()
    tools.register({ name: 'calc', description: 'calc', inputSchema: { type: 'object', properties: { x: { type: 'number' } } }, execute: async (input: { x: number }) => input.x * 2 })

    const loop = new AgentLoop({ provider: new AnthropicAgentsSdkProvider(), tools, maxIterations: 10, model: 'x' })
    const result = await loop.run([{ role: 'user', content: 'calculate' }])

    expect(result.iterations).toBe(2)
    expect(result.messages.at(-1)?.content).toContain('The answer is 42.')
    const toolResult = result.messages.find(m => m.role === 'tool')
    expect(toolResult).toBeDefined()
    expect(toolResult!.content).toBe('42')
  })

  it('ra middleware fires for tool execution', async () => {
    let callCount = 0
    mockQuery.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return mockSession([
          streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tc_1', name: 'echo' } }),
          streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } }),
          streamEvent({ type: 'content_block_stop', index: 0 }),
          resultMsg(),
        ])
      }
      return mockSession([
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } }),
        resultMsg(),
      ])
    })

    const tools = new ToolRegistry()
    tools.register({ name: 'echo', description: 'echo', inputSchema: {}, execute: async () => 'ok' })

    const middlewareCalls: string[] = []
    const loop = new AgentLoop({
      provider: new AnthropicAgentsSdkProvider(),
      tools,
      maxIterations: 10,
      model: 'x',
      middleware: {
        beforeToolExecution: [async (ctx) => { middlewareCalls.push(`before:${ctx.toolCall.name}`) }],
        afterToolExecution: [async (ctx) => { middlewareCalls.push(`after:${ctx.toolCall.name}`) }],
      },
    })
    await loop.run([{ role: 'user', content: 'go' }])

    expect(middlewareCalls).toEqual(['before:echo', 'after:echo'])
  })

  it('permissions middleware can deny tool calls', async () => {
    let callCount = 0
    mockQuery.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return mockSession([
          streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tc_1', name: 'danger' } }),
          streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } }),
          streamEvent({ type: 'content_block_stop', index: 0 }),
          resultMsg(),
        ])
      }
      return mockSession([
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }),
        resultMsg(),
      ])
    })

    const executed: string[] = []
    const tools = new ToolRegistry()
    tools.register({ name: 'danger', description: 'danger', inputSchema: {}, execute: async () => { executed.push('danger'); return 'bad' } })

    const loop = new AgentLoop({
      provider: new AnthropicAgentsSdkProvider(),
      tools,
      maxIterations: 10,
      model: 'x',
      middleware: {
        beforeToolExecution: [async (ctx) => { if (ctx.toolCall.name === 'danger') ctx.deny('blocked by ra') }],
      },
    })
    const result = await loop.run([{ role: 'user', content: 'go' }])

    expect(executed).toEqual([])
    const toolResult = result.messages.find(m => m.role === 'tool')
    expect(toolResult?.isError).toBe(true)
    expect(toolResult?.content).toBe('blocked by ra')
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
