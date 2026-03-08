import type {
  LoopContext,
  ModelCallContext,
  ToolExecutionContext,
  ToolResultContext,
  ErrorContext,
} from "@chinmaymk/ra"
import { appendFile } from "node:fs/promises"
import { join } from "path"

/**
 * Decision-log middleware — records structured decision records at every lifecycle point.
 *
 * Produces a decisions.jsonl alongside messages.jsonl that captures:
 * - What tools were available when the model was called
 * - Which tools the model chose and why (thinking content)
 * - Tool inputs and outputs (truncated for size)
 * - Errors and their phases
 * - Iteration boundaries and token usage
 *
 * Output: .ra/sessions/<id>/decisions.jsonl
 */

interface DecisionRecord {
  timestamp: string
  iteration: number
  phase: string
  event: string
  detail: Record<string, unknown>
}

const MAX_CONTENT_LEN = 500

function truncate(s: string | unknown, max = MAX_CONTENT_LEN): string {
  const str = typeof s === "string" ? s : JSON.stringify(s)
  if (str.length <= max) return str
  return str.slice(0, max) + `... (${str.length - max} chars truncated)`
}

async function append(sessionId: string, record: DecisionRecord): Promise<void> {
  const dir = join(".ra", "sessions", sessionId)
  await Bun.$`mkdir -p ${dir}`.quiet()
  const line = JSON.stringify(record) + "\n"
  await appendFile(join(dir, "decisions.jsonl"), line)
}

function record(iteration: number, phase: string, event: string, detail: Record<string, unknown>): DecisionRecord {
  return { timestamp: new Date().toISOString(), iteration, phase, event, detail }
}

export async function beforeModelCall(ctx: ModelCallContext): Promise<void> {
  const toolNames = (ctx.request.tools || []).map((t) => t.name)
  const r = record(ctx.loop.iteration, "model_call", "calling_model", {
    model: ctx.request.model,
    messageCount: ctx.request.messages.length,
    availableTools: toolNames,
    thinking: ctx.request.thinking || "off",
    estimatedInputTokens: ctx.loop.lastUsage?.inputTokens,
  })
  await append(ctx.loop.sessionId, r)
}

export async function afterModelResponse(ctx: ModelCallContext): Promise<void> {
  const msgs = ctx.loop.messages
  const last = msgs[msgs.length - 1]
  if (!last || last.role !== "assistant") return

  const content = typeof last.content === "string" ? last.content : JSON.stringify(last.content)
  const toolCalls = (last.toolCalls || []).map((tc) => ({
    name: tc.name,
    argsPreview: truncate(tc.arguments, 200),
  }))

  const r = record(ctx.loop.iteration, "model_response", "model_responded", {
    responsePreview: truncate(content),
    toolCallCount: toolCalls.length,
    toolCalls,
    usage: ctx.loop.lastUsage,
  })
  await append(ctx.loop.sessionId, r)
}

export async function beforeToolExecution(ctx: ToolExecutionContext): Promise<void> {
  const r = record(ctx.loop.iteration, "tool_execution", "tool_starting", {
    tool: ctx.toolCall.name,
    toolCallId: ctx.toolCall.id,
    argsPreview: truncate(ctx.toolCall.arguments, 300),
  })
  await append(ctx.loop.sessionId, r)
}

export async function afterToolExecution(ctx: ToolResultContext): Promise<void> {
  const content = typeof ctx.result.content === "string" ? ctx.result.content : JSON.stringify(ctx.result.content)
  const r = record(ctx.loop.iteration, "tool_execution", "tool_completed", {
    tool: ctx.toolCall.name,
    toolCallId: ctx.toolCall.id,
    isError: ctx.result.isError || false,
    resultPreview: truncate(content),
  })
  await append(ctx.loop.sessionId, r)
}

export async function afterLoopIteration(ctx: LoopContext): Promise<void> {
  const r = record(ctx.iteration, "loop", "iteration_complete", {
    iteration: ctx.iteration,
    maxIterations: ctx.maxIterations,
    messageCount: ctx.messages.length,
    cumulativeUsage: ctx.usage,
  })
  await append(ctx.sessionId, r)
}

export async function afterLoopComplete(ctx: LoopContext): Promise<void> {
  const r = record(ctx.iteration, "loop", "loop_complete", {
    totalIterations: ctx.iteration,
    finalMessageCount: ctx.messages.length,
    totalUsage: ctx.usage,
  })
  await append(ctx.sessionId, r)
}

export async function onError(ctx: ErrorContext): Promise<void> {
  const r = record(ctx.loop.iteration, "error", "error_occurred", {
    phase: ctx.phase,
    message: ctx.error.message,
    stack: truncate(ctx.error.stack || "", 300),
  })
  await append(ctx.loop.sessionId, r)
}
