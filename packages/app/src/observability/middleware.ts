import type { MiddlewareConfig, LoopContext, ModelCallContext, StreamChunkContext, ToolExecutionContext, ToolResultContext, ErrorContext, Logger } from '@chinmaymk/ra'
import type { Tracer, Span } from './tracer'

/**
 * Creates a complete set of observability middleware hooks.
 * This is the single integration point — no logger/tracer params
 * need to be threaded through the rest of the codebase.
 */
export function createObservabilityMiddleware(logger: Logger, tracer: Tracer): Partial<MiddlewareConfig> {
  let loopSpan: Span | undefined
  let iterationSpan: Span | undefined
  let modelSpan: Span | undefined
  const toolSpans = new Map<string, Span>()
  let iterationStartMessageCount = 0

  // Stream metrics — reset per iteration
  let streamChunkCount = 0
  let streamTextLength = 0
  let streamFirstTokenTime: number | undefined
  let streamStartTime: number | undefined

  function resetStreamMetrics(): void {
    streamChunkCount = 0
    streamTextLength = 0
    streamFirstTokenTime = undefined
    streamStartTime = undefined
  }

  /** End all open child spans with error status and clear state for reuse. */
  function drainOpenSpans(status: 'ok' | 'error', attrs?: Record<string, unknown>): void {
    for (const [id, span] of toolSpans) {
      tracer.endSpan(span, status, attrs)
      toolSpans.delete(id)
    }
    if (modelSpan) {
      tracer.endSpan(modelSpan, status, attrs)
      modelSpan = undefined
    }
    if (iterationSpan) {
      tracer.endSpan(iterationSpan, status, attrs)
      iterationSpan = undefined
    }
  }

  const beforeLoopBegin = async (ctx: LoopContext): Promise<void> => {
    // Reset state for reuse across multiple loop runs
    drainOpenSpans('error', { reason: 'stale_from_previous_run' })
    loopSpan = undefined

    if ('setSessionId' in logger) (logger as { setSessionId(id: string): void }).setSessionId(ctx.sessionId)
    tracer.setSessionId(ctx.sessionId)

    loopSpan = tracer.startSpan('agent.loop', {
      maxIterations: ctx.maxIterations,
      initialMessageCount: ctx.messages.length,
      resumed: ctx.resumed,
    })

    logger.info('agent loop starting', {
      maxIterations: ctx.maxIterations,
      messageCount: ctx.messages.length,
      resumed: ctx.resumed,
    })
  }

  const beforeModelCall = async (ctx: ModelCallContext): Promise<void> => {
    iterationStartMessageCount = ctx.request.messages.length
    resetStreamMetrics()

    iterationSpan = tracer.startSpan('agent.iteration', {
      iteration: ctx.loop.iteration,
      messageCount: ctx.request.messages.length,
      model: ctx.request.model,
    }, loopSpan?.spanId)

    modelSpan = tracer.startSpan('agent.model_call', {
      model: ctx.request.model,
      messageCount: ctx.request.messages.length,
      toolCount: ctx.request.tools?.length ?? 0,
    }, iterationSpan.spanId)

    streamStartTime = performance.now()

    logger.debug('calling model', {
      iteration: ctx.loop.iteration,
      model: ctx.request.model,
      messageCount: ctx.request.messages.length,
      toolCount: ctx.request.tools?.length ?? 0,
    })
  }

  const onStreamChunk = async (ctx: StreamChunkContext): Promise<void> => {
    streamChunkCount++

    if (ctx.chunk.type === 'text') {
      // Track first-token latency
      if (streamFirstTokenTime === undefined) {
        streamFirstTokenTime = performance.now()
      }
      streamTextLength += ctx.chunk.delta.length
    } else if (ctx.chunk.type === 'tool_call_start') {
      // First tool call also counts as "first token" if no text preceded it
      if (streamFirstTokenTime === undefined) {
        streamFirstTokenTime = performance.now()
      }
    }
  }

  const afterModelResponse = async (ctx: ModelCallContext): Promise<void> => {
    const usage = ctx.loop.lastUsage
    const lastMsg = ctx.request.messages[ctx.request.messages.length - 1]
    const toolCalls = lastMsg?.role === 'assistant' ? lastMsg.toolCalls : undefined
    const toolNames = toolCalls?.map(t => t.name) ?? []
    const responseText = typeof lastMsg?.content === 'string' ? lastMsg.content : ''

    // Compute time-to-first-token (TTFT)
    const ttftMs = (streamFirstTokenTime !== undefined && streamStartTime !== undefined)
      ? Math.round((streamFirstTokenTime - streamStartTime) * 100) / 100
      : undefined

    if (modelSpan) {
      tracer.endSpan(modelSpan, 'ok', {
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        thinkingTokens: usage?.thinkingTokens ?? null,
        toolCallCount: toolNames.length,
        toolNames,
        responseLength: responseText.length,
        streamChunkCount,
        streamTextLength,
        ...(ttftMs !== undefined && { ttftMs }),
      })
      modelSpan = undefined
    }

    logger.info('model responded', {
      iteration: ctx.loop.iteration,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      thinkingTokens: usage?.thinkingTokens ?? null,
      toolCallCount: toolNames.length,
      toolNames,
      responseLength: responseText.length,
      ...(ttftMs !== undefined && { ttftMs }),
    })
  }

  const beforeToolExecution = async (ctx: ToolExecutionContext): Promise<void> => {
    const attrs: Record<string, unknown> = {
      tool: ctx.toolCall.name,
      toolCallId: ctx.toolCall.id,
    }

    // For Agent calls, parse and log the task list
    if (ctx.toolCall.name === 'Agent' && ctx.toolCall.arguments) {
      try {
        const parsed = JSON.parse(ctx.toolCall.arguments)
        if (Array.isArray(parsed.tasks)) {
          attrs.taskCount = parsed.tasks.length
          attrs.tasks = parsed.tasks.map((t: { task: string }) =>
            t.task.length > 100 ? t.task.slice(0, 100) + '…' : t.task
          )
        }
      } catch { /* not valid JSON yet — streaming may be incomplete */ }
    }

    const span = tracer.startSpan('agent.tool_execution', attrs, iterationSpan?.spanId)
    toolSpans.set(ctx.toolCall.id, span)

    logger.info('executing tool', {
      tool: ctx.toolCall.name,
      toolCallId: ctx.toolCall.id,
      input: ctx.toolCall.arguments ? ctx.toolCall.arguments.slice(0, 200) : '{}',
      ...(attrs.taskCount != null && { taskCount: attrs.taskCount }),
    })
  }

  const afterToolExecution = async (ctx: ToolResultContext): Promise<void> => {
    const span = toolSpans.get(ctx.toolCall.id)

    // For Agent calls, extract per-task results and aggregate usage
    let agentAttrs: Record<string, unknown> | undefined
    if (ctx.toolCall.name === 'Agent' && !ctx.result.isError && typeof ctx.result.content === 'string') {
      try {
        const parsed = JSON.parse(ctx.result.content)
        if (Array.isArray(parsed.results)) {
          const completed = parsed.results.filter((r: { status: string }) => r.status === 'completed').length
          const errored = parsed.results.filter((r: { status: string }) => r.status === 'error').length
          agentAttrs = {
            taskCount: parsed.results.length,
            tasksCompleted: completed,
            tasksErrored: errored,
            totalInputTokens: parsed.usage?.inputTokens,
            totalOutputTokens: parsed.usage?.outputTokens,
          }

          logger.info('Agent tasks complete', {
            toolCallId: ctx.toolCall.id,
            taskCount: parsed.results.length,
            tasksCompleted: completed,
            tasksErrored: errored,
            inputTokens: parsed.usage?.inputTokens,
            outputTokens: parsed.usage?.outputTokens,
          })
        }
      } catch { /* result may not be JSON */ }
    }

    if (span) {
      tracer.endSpan(span, ctx.result.isError ? 'error' : 'ok', {
        resultLength: ctx.result.content.length,
        ...(ctx.result.isError && { error: ctx.result.content.slice(0, 200) }),
        ...agentAttrs,
      })
      toolSpans.delete(ctx.toolCall.id)
    }

    if (ctx.result.isError) {
      logger.error('tool execution failed', {
        tool: ctx.toolCall.name,
        toolCallId: ctx.toolCall.id,
        error: ctx.result.content.slice(0, 200),
      })
    } else {
      logger.info('tool execution complete', {
        tool: ctx.toolCall.name,
        toolCallId: ctx.toolCall.id,
        resultLength: ctx.result.content.length,
      })
    }
  }

  const afterLoopIteration = async (ctx: LoopContext): Promise<void> => {
    const messagesAdded = ctx.messages.length - iterationStartMessageCount
    if (iterationSpan) {
      tracer.endSpan(iterationSpan, 'ok', {
        iteration: ctx.iteration,
        messagesAdded,
      })
      iterationSpan = undefined
    }

    logger.debug('iteration complete', {
      iteration: ctx.iteration,
      messagesAdded,
      totalMessages: ctx.messages.length,
    })
  }

  const afterLoopComplete = async (ctx: LoopContext): Promise<void> => {
    if (loopSpan) {
      tracer.endSpan(loopSpan, 'ok', {
        iterations: ctx.iteration,
        inputTokens: ctx.usage.inputTokens,
        outputTokens: ctx.usage.outputTokens,
        thinkingTokens: ctx.usage.thinkingTokens ?? null,
        totalMessages: ctx.messages.length,
      })
      loopSpan = undefined
    }

    logger.info('agent loop complete', {
      iterations: ctx.iteration,
      inputTokens: ctx.usage.inputTokens,
      outputTokens: ctx.usage.outputTokens,
      thinkingTokens: ctx.usage.thinkingTokens ?? null,
      totalMessages: ctx.messages.length,
    })
  }

  const onError = async (ctx: ErrorContext): Promise<void> => {
    const errorAttrs = { error: ctx.error.message, phase: ctx.phase }

    // End any open child spans before closing the root
    drainOpenSpans('error', errorAttrs)

    if (loopSpan) {
      tracer.endSpan(loopSpan, 'error', {
        ...errorAttrs,
        stack: ctx.error.stack,
        iterations: ctx.loop.iteration,
      })
      loopSpan = undefined
    }

    logger.error('agent loop failed', {
      error: ctx.error.message,
      stack: ctx.error.stack,
      phase: ctx.phase,
      iterations: ctx.loop.iteration,
    })
  }

  return {
    beforeLoopBegin: [beforeLoopBegin],
    beforeModelCall: [beforeModelCall],
    onStreamChunk: [onStreamChunk],
    afterModelResponse: [afterModelResponse],
    beforeToolExecution: [beforeToolExecution],
    afterToolExecution: [afterToolExecution],
    afterLoopIteration: [afterLoopIteration],
    afterLoopComplete: [afterLoopComplete],
    onError: [onError],
  }
}
