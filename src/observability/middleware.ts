import type { MiddlewareConfig, LoopContext, ModelCallContext, ToolExecutionContext, ToolResultContext, ErrorContext } from '../agent/types'
import type { Logger } from './logger'
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

  function endSpan(span: Span | undefined, status: 'ok' | 'error', attrs?: Record<string, unknown>): undefined {
    if (span) tracer.endSpan(span, status, attrs)
    return undefined
  }

  function drainOpenSpans(status: 'ok' | 'error', attrs?: Record<string, unknown>): void {
    for (const [id, span] of toolSpans) { tracer.endSpan(span, status, attrs); toolSpans.delete(id) }
    modelSpan = endSpan(modelSpan, status, attrs)
    iterationSpan = endSpan(iterationSpan, status, attrs)
  }

  return {
    beforeLoopBegin: [async (ctx: LoopContext) => {
      drainOpenSpans('error', { reason: 'stale_from_previous_run' })
      loopSpan = undefined
      logger.setSessionId(ctx.sessionId)
      tracer.setSessionId(ctx.sessionId)
      loopSpan = tracer.startSpan('agent.loop', { maxIterations: ctx.maxIterations, initialMessageCount: ctx.messages.length })
      logger.info('agent loop starting', { maxIterations: ctx.maxIterations, messageCount: ctx.messages.length })
    }],

    beforeModelCall: [async (ctx: ModelCallContext) => {
      iterationStartMessageCount = ctx.request.messages.length
      const attrs = { iteration: ctx.loop.iteration, messageCount: ctx.request.messages.length }
      iterationSpan = tracer.startSpan('agent.iteration', attrs, loopSpan?.spanId)
      modelSpan = tracer.startSpan('agent.model_call', { model: ctx.request.model, ...attrs }, iterationSpan.spanId)
      logger.debug('calling model', { model: ctx.request.model, ...attrs })
    }],

    afterModelResponse: [async (ctx: ModelCallContext) => {
      const usage = ctx.loop.lastUsage
      const lastMsg = ctx.request.messages[ctx.request.messages.length - 1]
      const toolNames = (lastMsg?.role === 'assistant' ? lastMsg.toolCalls : undefined)?.map(t => t.name) ?? []
      const responseText = typeof lastMsg?.content === 'string' ? lastMsg.content : ''
      const attrs = {
        inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens,
        thinkingTokens: usage?.thinkingTokens ?? null,
        toolCallCount: toolNames.length, toolNames, responseLength: responseText.length,
      }
      modelSpan = endSpan(modelSpan, 'ok', attrs)
      logger.info('model responded', { iteration: ctx.loop.iteration, ...attrs })
    }],

    beforeToolExecution: [async (ctx: ToolExecutionContext) => {
      const attrs: Record<string, unknown> = { tool: ctx.toolCall.name, toolCallId: ctx.toolCall.id }
      if (ctx.toolCall.name === 'subagent' && ctx.toolCall.arguments) {
        try {
          const parsed = JSON.parse(ctx.toolCall.arguments)
          if (Array.isArray(parsed.tasks)) {
            attrs.taskCount = parsed.tasks.length
            attrs.tasks = parsed.tasks.map((t: { task: string }) => t.task.length > 100 ? t.task.slice(0, 100) + '…' : t.task)
          }
        } catch { /* streaming may be incomplete */ }
      }
      toolSpans.set(ctx.toolCall.id, tracer.startSpan('agent.tool_execution', attrs, iterationSpan?.spanId))
      logger.info('executing tool', {
        tool: ctx.toolCall.name, toolCallId: ctx.toolCall.id,
        input: ctx.toolCall.arguments ? ctx.toolCall.arguments.slice(0, 200) : '{}',
        ...(attrs.taskCount != null && { taskCount: attrs.taskCount }),
      })
    }],

    afterToolExecution: [async (ctx: ToolResultContext) => {
      const span = toolSpans.get(ctx.toolCall.id)
      let extra: Record<string, unknown> | undefined

      if (ctx.toolCall.name === 'subagent' && !ctx.result.isError && typeof ctx.result.content === 'string') {
        try {
          const parsed = JSON.parse(ctx.result.content)
          if (Array.isArray(parsed.results)) {
            const completed = parsed.results.filter((r: { status: string }) => r.status === 'completed').length
            const errored = parsed.results.filter((r: { status: string }) => r.status === 'error').length
            extra = {
              taskCount: parsed.results.length, tasksCompleted: completed, tasksErrored: errored,
              totalInputTokens: parsed.usage?.inputTokens, totalOutputTokens: parsed.usage?.outputTokens,
            }
            logger.info('subagent tasks complete', { toolCallId: ctx.toolCall.id, ...extra })
          }
        } catch { /* result may not be JSON */ }
      }

      if (span) {
        tracer.endSpan(span, ctx.result.isError ? 'error' : 'ok', {
          resultLength: ctx.result.content.length,
          ...(ctx.result.isError && { error: ctx.result.content.slice(0, 200) }),
          ...extra,
        })
        toolSpans.delete(ctx.toolCall.id)
      }

      const logAttrs = { tool: ctx.toolCall.name, toolCallId: ctx.toolCall.id }
      if (ctx.result.isError) logger.error('tool execution failed', { ...logAttrs, error: ctx.result.content.slice(0, 200) })
      else logger.info('tool execution complete', { ...logAttrs, resultLength: ctx.result.content.length })
    }],

    afterLoopIteration: [async (ctx: LoopContext) => {
      const messagesAdded = ctx.messages.length - iterationStartMessageCount
      iterationSpan = endSpan(iterationSpan, 'ok', { iteration: ctx.iteration, messagesAdded })
      logger.debug('iteration complete', { iteration: ctx.iteration, messagesAdded, totalMessages: ctx.messages.length })
    }],

    afterLoopComplete: [async (ctx: LoopContext) => {
      const attrs = { iterations: ctx.iteration, inputTokens: ctx.usage.inputTokens, outputTokens: ctx.usage.outputTokens, totalMessages: ctx.messages.length }
      loopSpan = endSpan(loopSpan, 'ok', attrs)
      logger.info('agent loop complete', attrs)
    }],

    onError: [async (ctx: ErrorContext) => {
      const errorAttrs = { error: ctx.error.message, phase: ctx.phase }
      drainOpenSpans('error', errorAttrs)
      if (loopSpan) {
        tracer.endSpan(loopSpan, 'error', { ...errorAttrs, stack: ctx.error.stack, iterations: ctx.loop.iteration })
        loopSpan = undefined
      }
      logger.error('agent loop failed', { ...errorAttrs, stack: ctx.error.stack, iterations: ctx.loop.iteration })
    }],
  }
}
