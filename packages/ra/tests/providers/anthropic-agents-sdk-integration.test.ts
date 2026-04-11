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

  it('SDK handles tool calls internally — ra sees text-only, one iteration', async () => {
    // The SDK runs its own loop: model → tool → model.
    // Ra only sees text chunks, no tool_call chunks. One iteration.
    mockQuery.mockReturnValue(mockSession([
      // First model response: text + tool_use (tool_use not surfaced to ra)
      streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Checking...' } }),
      streamEvent({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tc_1', name: 'calc' } }),
      streamEvent({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"x":21}' } }),
      streamEvent({ type: 'content_block_stop', index: 1 }),
      // SDK executes tool via MCP, then second model response:
      streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' Answer is 42.' } }),
      resultMsg(),
    ]))

    const tools = new ToolRegistry()
    tools.register({ name: 'calc', description: 'calc', inputSchema: { type: 'object', properties: { x: { type: 'number' } } }, execute: async (input: { x: number }) => input.x * 2 })

    const loop = new AgentLoop({ provider: new AnthropicAgentsSdkProvider(), tools, maxIterations: 10, model: 'x' })
    const result = await loop.run([{ role: 'user', content: 'calculate' }])

    // Only one iteration because ra sees no tool calls
    expect(result.iterations).toBe(1)
    expect(result.messages.at(-1)?.content).toContain('Checking...')
    expect(result.messages.at(-1)?.content).toContain(' Answer is 42.')
    // No tool messages in ra's history — SDK handled them internally
    expect(result.messages.find(m => m.role === 'tool')).toBeUndefined()
  })

  it('tools are registered with real execute handlers', async () => {
    mockQuery.mockReturnValue(mockSession([resultMsg()]))

    const executeFn = mock(() => Promise.resolve('result'))
    const tools = new ToolRegistry()
    tools.register({ name: 'myTool', description: 'test', inputSchema: { type: 'object', properties: {} }, execute: executeFn })

    const loop = new AgentLoop({ provider: new AnthropicAgentsSdkProvider(), tools, maxIterations: 1, model: 'x' })
    await loop.run([{ role: 'user', content: 'go' }])

    // Verify the handler passed to sdkTool is a real function, not a no-op
    const handler = mockSdkTool.mock.calls[0]![3] as (input: unknown) => Promise<unknown>
    const handlerResult = await handler({}) as { content: { text: string }[] }
    expect(executeFn).toHaveBeenCalled()
    expect(handlerResult.content[0]!.text).toBe('result')
  })

  it('abort stops the loop via query.interrupt()', async () => {
    // The persistent-session provider uses query.interrupt() — not an
    // options.abortController — to stop a long-running turn without tearing
    // down the subprocess.
    mockQuery.mockImplementation(() => {
      let interrupted = false
      let interruptResolve: (() => void) | undefined
      const interruptedPromise = new Promise<void>(r => { interruptResolve = r })
      const q = {
        next: async (): Promise<IteratorResult<unknown>> => {
          if (interrupted) return { value: undefined, done: true }
          await Promise.race([
            interruptedPromise,
            new Promise<void>(r => setTimeout(r, 10000)),
          ])
          return { value: resultMsg(), done: false }
        },
        interrupt: async () => { interrupted = true; interruptResolve?.() },
        close: () => { interrupted = true; interruptResolve?.() },
        [Symbol.asyncIterator]() { return this },
      }
      return q
    })

    const loop = new AgentLoop({ provider: new AnthropicAgentsSdkProvider(), tools: new ToolRegistry(), maxIterations: 10, model: 'x' })
    setTimeout(() => loop.abort(), 50)
    const result = await loop.run([{ role: 'user', content: 'wait' }])
    expect(result.stopReason).toBe('aborted')
  })
})
