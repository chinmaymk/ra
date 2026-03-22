import { describe, it, expect } from 'bun:test'
import { AgentLoop, ToolRegistry } from '@chinmaymk/ra'
import type { IProvider, StreamChunk, ProgressInfo, CheckpointEvent } from '@chinmaymk/ra'
import { mockProvider } from './test-utils'

/** Provider that always emits a tool call to the given tool, then a final text response. */
function toolCallProvider(toolName: string, args = '{}', iterations = 1): IProvider {
  let callIndex = 0
  return {
    name: 'mock',
    chat: async () => { throw new Error('use stream') },
    async *stream() {
      callIndex++
      if (callIndex <= iterations) {
        yield { type: 'tool_call_start' as const, id: `tc${callIndex}`, name: toolName }
        yield { type: 'tool_call_delta' as const, id: `tc${callIndex}`, argsDelta: args }
        yield { type: 'tool_call_end' as const, id: `tc${callIndex}` }
        yield { type: 'done' as const }
      } else {
        yield { type: 'text' as const, delta: 'done' }
        yield { type: 'done' as const }
      }
    },
  }
}

/** Provider that emits multiple tool calls per iteration. */
function multiToolProvider(toolNames: string[], iterations = 1): IProvider {
  let callIndex = 0
  return {
    name: 'mock',
    chat: async () => { throw new Error('use stream') },
    async *stream() {
      callIndex++
      if (callIndex <= iterations) {
        for (let i = 0; i < toolNames.length; i++) {
          const id = `tc${callIndex}-${i}`
          yield { type: 'tool_call_start' as const, id, name: toolNames[i] }
          yield { type: 'tool_call_delta' as const, id, argsDelta: '{}' }
          yield { type: 'tool_call_end' as const, id }
        }
        yield { type: 'done' as const }
      } else {
        yield { type: 'text' as const, delta: 'done' }
        yield { type: 'done' as const }
      }
    },
  }
}

describe('Parallel tool execution', () => {
  it('executes multiple tool calls concurrently when parallelToolCalls is true', async () => {
    const startTimes: number[] = []
    const endTimes: number[] = []
    const tools = new ToolRegistry()

    tools.register({
      name: 'slow_a',
      description: 'slow a',
      inputSchema: {},
      execute: async () => {
        startTimes.push(Date.now())
        await new Promise(r => setTimeout(r, 100))
        endTimes.push(Date.now())
        return 'a'
      },
    })
    tools.register({
      name: 'slow_b',
      description: 'slow b',
      inputSchema: {},
      execute: async () => {
        startTimes.push(Date.now())
        await new Promise(r => setTimeout(r, 100))
        endTimes.push(Date.now())
        return 'b'
      },
    })

    const provider = multiToolProvider(['slow_a', 'slow_b'])
    const loop = new AgentLoop({ provider, tools, model: 'test', maxIterations: 5, parallelToolCalls: true })
    const result = await loop.run([{ role: 'user', content: 'go' }])

    expect(result.iterations).toBe(2)
    // Both tools should have started before either finished (parallel execution)
    expect(startTimes).toHaveLength(2)
    expect(endTimes).toHaveLength(2)
    // The second tool should start before the first finishes
    expect(startTimes[1]).toBeLessThan(endTimes[0])
  })

  it('preserves tool result ordering even with parallel execution', async () => {
    const tools = new ToolRegistry()
    tools.register({
      name: 'fast',
      description: 'fast',
      inputSchema: {},
      execute: async () => 'fast_result',
    })
    tools.register({
      name: 'slow',
      description: 'slow',
      inputSchema: {},
      execute: async () => { await new Promise(r => setTimeout(r, 50)); return 'slow_result' },
    })

    // slow is called first, fast second — results should still be in call order
    const provider = multiToolProvider(['slow', 'fast'])
    const loop = new AgentLoop({ provider, tools, model: 'test', maxIterations: 5, parallelToolCalls: true })
    const result = await loop.run([{ role: 'user', content: 'go' }])

    const toolResults = result.messages.filter(m => m.role === 'tool')
    expect(toolResults[0].content).toBe('slow_result')
    expect(toolResults[1].content).toBe('fast_result')
  })

  it('falls back to sequential when parallelToolCalls is false (default)', async () => {
    const startTimes: number[] = []
    const endTimes: number[] = []
    const tools = new ToolRegistry()

    tools.register({
      name: 'slow_a',
      description: 'slow a',
      inputSchema: {},
      execute: async () => {
        startTimes.push(Date.now())
        await new Promise(r => setTimeout(r, 50))
        endTimes.push(Date.now())
        return 'a'
      },
    })
    tools.register({
      name: 'slow_b',
      description: 'slow b',
      inputSchema: {},
      execute: async () => {
        startTimes.push(Date.now())
        await new Promise(r => setTimeout(r, 50))
        endTimes.push(Date.now())
        return 'b'
      },
    })

    const provider = multiToolProvider(['slow_a', 'slow_b'])
    const loop = new AgentLoop({ provider, tools, model: 'test', maxIterations: 5 })
    await loop.run([{ role: 'user', content: 'go' }])

    // Sequential: second tool starts after first finishes
    expect(startTimes[1]).toBeGreaterThanOrEqual(endTimes[0])
  })
})

describe('Token budget enforcement', () => {
  it('stops the loop when token budget is exceeded', async () => {
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('use stream') },
      async *stream() {
        yield { type: 'tool_call_start' as const, id: 'tc1', name: 'noop' }
        yield { type: 'tool_call_delta' as const, id: 'tc1', argsDelta: '{}' }
        yield { type: 'tool_call_end' as const, id: 'tc1' }
        yield { type: 'done' as const, usage: { inputTokens: 500, outputTokens: 500 } }
      },
    }
    const tools = new ToolRegistry()
    tools.register({ name: 'noop', description: 'noop', inputSchema: {}, execute: async () => 'ok' })

    const loop = new AgentLoop({ provider, tools, model: 'test', maxIterations: 100, tokenBudget: 1500 })
    const result = await loop.run([{ role: 'user', content: 'go' }])

    expect(result.stopReason).toBe('token_budget')
    // First iteration uses 1000 tokens (under budget), second would exceed 1500
    expect(result.iterations).toBeLessThanOrEqual(2)
  })

  it('does not enforce when tokenBudget is 0 (default)', async () => {
    const provider = mockProvider([
      [{ type: 'text', delta: 'hi' }, { type: 'done', usage: { inputTokens: 99999, outputTokens: 99999 } }],
    ])
    const loop = new AgentLoop({ provider, tools: new ToolRegistry(), model: 'test' })
    const result = await loop.run([{ role: 'user', content: 'hi' }])
    expect(result.stopReason).toBeUndefined()
  })
})

describe('Graceful drain', () => {
  it('finishes the current iteration then stops when drain is called', async () => {
    let iterationCount = 0
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('use stream') },
      async *stream() {
        yield { type: 'tool_call_start' as const, id: `tc${++iterationCount}`, name: 'noop' }
        yield { type: 'tool_call_delta' as const, id: `tc${iterationCount}`, argsDelta: '{}' }
        yield { type: 'tool_call_end' as const, id: `tc${iterationCount}` }
        yield { type: 'done' as const }
      },
    }
    const tools = new ToolRegistry()
    tools.register({ name: 'noop', description: 'noop', inputSchema: {}, execute: async () => 'ok' })

    const loop = new AgentLoop({
      provider,
      tools,
      model: 'test',
      maxIterations: 100,
      middleware: {
        afterLoopIteration: [async (ctx) => {
          if (ctx.iteration >= 2) ctx.drain('enough')
        }],
      },
    })

    const result = await loop.run([{ role: 'user', content: 'go' }])
    expect(result.stopReason).toBe('enough')
    // Should complete iteration 2, then stop before iteration 3
    expect(result.iterations).toBe(2)
  })

  it('drain does not abort the current stream — loop finishes normally', async () => {
    const events: string[] = []
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('use stream') },
      async *stream() {
        yield { type: 'text' as const, delta: 'hello' }
        yield { type: 'done' as const }
      },
    }

    const loop = new AgentLoop({
      provider,
      tools: new ToolRegistry(),
      model: 'test',
      maxIterations: 5,
      middleware: {
        beforeModelCall: [async (ctx) => {
          events.push('beforeModelCall')
          ctx.drain('draining')
        }],
        afterModelResponse: [async () => { events.push('afterModelResponse') }],
        afterLoopIteration: [async () => { events.push('afterLoopIteration') }],
      },
    })

    const result = await loop.run([{ role: 'user', content: 'hi' }])
    // The iteration should complete even though drain was called during beforeModelCall
    expect(events).toContain('afterModelResponse')
    expect(events).toContain('afterLoopIteration')
    expect(result.stopReason).toBe('draining')
  })
})

describe('maxDuration', () => {
  it('stops the loop when wall-clock time exceeds maxDuration', async () => {
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('use stream') },
      async *stream() {
        yield { type: 'tool_call_start' as const, id: 'tc1', name: 'slow' }
        yield { type: 'tool_call_delta' as const, id: 'tc1', argsDelta: '{}' }
        yield { type: 'tool_call_end' as const, id: 'tc1' }
        yield { type: 'done' as const }
      },
    }
    const tools = new ToolRegistry()
    tools.register({
      name: 'slow',
      description: 'slow',
      inputSchema: {},
      execute: async () => { await new Promise(r => setTimeout(r, 80)); return 'ok' },
    })

    const loop = new AgentLoop({ provider, tools, model: 'test', maxIterations: 100, maxDuration: 150 })
    const result = await loop.run([{ role: 'user', content: 'go' }])

    expect(result.stopReason).toBe('max_duration')
    // At ~80ms per iteration, should get 1-2 iterations within 150ms
    expect(result.iterations).toBeGreaterThanOrEqual(1)
    expect(result.iterations).toBeLessThanOrEqual(3)
  })

  it('does not enforce when maxDuration is 0 (default)', async () => {
    const provider = mockProvider([[{ type: 'text', delta: 'hi' }, { type: 'done' }]])
    const loop = new AgentLoop({ provider, tools: new ToolRegistry(), model: 'test' })
    const result = await loop.run([{ role: 'user', content: 'hi' }])
    expect(result.stopReason).toBeUndefined()
  })
})

describe('Progress reporting', () => {
  it('calls onProgress at each milestone', async () => {
    const events: ProgressInfo[] = []
    const tools = new ToolRegistry()
    tools.register({ name: 'noop', description: 'noop', inputSchema: {}, execute: async () => 'ok' })

    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc1', name: 'noop' },
        { type: 'tool_call_delta', id: 'tc1', argsDelta: '{}' },
        { type: 'tool_call_end', id: 'tc1' },
        { type: 'done' },
      ],
      [{ type: 'text', delta: 'result' }, { type: 'done' }],
    ])

    const loop = new AgentLoop({
      provider,
      tools,
      model: 'test',
      maxIterations: 5,
      onProgress: (info) => events.push({ ...info }),
    })
    await loop.run([{ role: 'user', content: 'go' }])

    // Should have: model_response(iter1), tool_execution(iter1), iteration_complete(iter1),
    //              model_response(iter2), iteration_complete(iter2)
    const phases = events.map(e => e.phase)
    expect(phases).toContain('model_response')
    expect(phases).toContain('tool_execution')
    expect(phases).toContain('iteration_complete')
    expect(events.every(e => e.elapsedMs >= 0)).toBe(true)
    expect(events.every(e => e.iteration > 0)).toBe(true)
  })
})

describe('Mid-execution checkpointing', () => {
  it('calls onCheckpoint after each tool result', async () => {
    const checkpoints: CheckpointEvent[] = []
    const tools = new ToolRegistry()
    tools.register({ name: 'tool_a', description: 'a', inputSchema: {}, execute: async () => 'result_a' })
    tools.register({ name: 'tool_b', description: 'b', inputSchema: {}, execute: async () => 'result_b' })

    const provider = multiToolProvider(['tool_a', 'tool_b'])
    const loop = new AgentLoop({
      provider,
      tools,
      model: 'test',
      maxIterations: 5,
      onCheckpoint: (event) => checkpoints.push({ ...event }),
    })
    await loop.run([{ role: 'user', content: 'go' }])

    expect(checkpoints).toHaveLength(2)
    expect(checkpoints[0].toolName).toBe('tool_a')
    expect(checkpoints[0].content).toBe('result_a')
    expect(checkpoints[0].isError).toBe(false)
    expect(checkpoints[1].toolName).toBe('tool_b')
    expect(checkpoints[1].content).toBe('result_b')
  })

  it('checkpoints include error state when tool fails', async () => {
    const checkpoints: CheckpointEvent[] = []
    const tools = new ToolRegistry()
    tools.register({ name: 'fail', description: 'fails', inputSchema: {}, execute: async () => { throw new Error('broken') } })

    const provider = toolCallProvider('fail')
    const loop = new AgentLoop({
      provider,
      tools,
      model: 'test',
      maxIterations: 5,
      onCheckpoint: (event) => checkpoints.push({ ...event }),
    })
    await loop.run([{ role: 'user', content: 'go' }])

    expect(checkpoints).toHaveLength(1)
    expect(checkpoints[0].isError).toBe(true)
    expect(checkpoints[0].content).toContain('broken')
  })

  it('onCheckpoint works with parallelToolCalls', async () => {
    const checkpoints: CheckpointEvent[] = []
    const tools = new ToolRegistry()
    tools.register({ name: 'tool_a', description: 'a', inputSchema: {}, execute: async () => 'a' })
    tools.register({ name: 'tool_b', description: 'b', inputSchema: {}, execute: async () => 'b' })

    const provider = multiToolProvider(['tool_a', 'tool_b'])
    const loop = new AgentLoop({
      provider,
      tools,
      model: 'test',
      maxIterations: 5,
      parallelToolCalls: true,
      onCheckpoint: (event) => checkpoints.push({ ...event }),
    })
    await loop.run([{ role: 'user', content: 'go' }])

    expect(checkpoints).toHaveLength(2)
    expect(checkpoints.map(c => c.toolName)).toEqual(['tool_a', 'tool_b'])
  })
})

describe('Heartbeat liveness detection', () => {
  it('tool completes successfully when heartbeat is called periodically', async () => {
    const tools = new ToolRegistry()
    tools.register({
      name: 'long_task',
      description: 'long task with heartbeat',
      inputSchema: {},
      execute: async (_input, options) => {
        for (let i = 0; i < 3; i++) {
          await new Promise(r => setTimeout(r, 30))
          options?.heartbeat()
        }
        return 'completed'
      },
    })

    const provider = toolCallProvider('long_task')
    const loop = new AgentLoop({
      provider,
      tools,
      model: 'test',
      maxIterations: 5,
      heartbeatTimeout: 100,
    })
    const result = await loop.run([{ role: 'user', content: 'go' }])

    const toolResult = result.messages.find(m => m.role === 'tool')
    expect(toolResult?.content).toBe('completed')
    expect(toolResult?.isError).toBeUndefined()
  })

  it('tool is terminated when heartbeat times out', async () => {
    const tools = new ToolRegistry()
    tools.register({
      name: 'hung_task',
      description: 'never heartbeats',
      inputSchema: {},
      execute: async () => {
        // Never calls heartbeat, hangs for a long time
        await new Promise(r => setTimeout(r, 5000))
        return 'should not reach'
      },
    })

    const provider = toolCallProvider('hung_task')
    const loop = new AgentLoop({
      provider,
      tools,
      model: 'test',
      maxIterations: 5,
      heartbeatTimeout: 50,
    })
    const result = await loop.run([{ role: 'user', content: 'go' }])

    const toolResult = result.messages.find(m => m.role === 'tool')
    expect(toolResult?.isError).toBe(true)
    expect(toolResult?.content).toContain('heartbeat timeout')
  })

  it('heartbeat is not enforced when heartbeatTimeout is 0 (default)', async () => {
    const tools = new ToolRegistry()
    tools.register({
      name: 'no_heartbeat',
      description: 'works without heartbeat',
      inputSchema: {},
      execute: async () => {
        await new Promise(r => setTimeout(r, 20))
        return 'ok'
      },
    })

    const provider = toolCallProvider('no_heartbeat')
    const loop = new AgentLoop({ provider, tools, model: 'test', maxIterations: 5 })
    const result = await loop.run([{ role: 'user', content: 'go' }])

    const toolResult = result.messages.find(m => m.role === 'tool')
    expect(toolResult?.content).toBe('ok')
  })
})

describe('elapsedMs on LoopContext', () => {
  it('provides elapsed time in middleware contexts', async () => {
    let capturedElapsed = -1
    const provider = mockProvider([[{ type: 'text', delta: 'hi' }, { type: 'done' }]])
    const loop = new AgentLoop({
      provider,
      tools: new ToolRegistry(),
      model: 'test',
      middleware: {
        afterModelResponse: [async (ctx) => { capturedElapsed = ctx.loop.elapsedMs }],
      },
    })
    await loop.run([{ role: 'user', content: 'hi' }])
    expect(capturedElapsed).toBeGreaterThanOrEqual(0)
  })
})
