/**
 * Inspector stats and timeline aggregation — pure functions that transform
 * raw trace spans and log entries into summary objects for the inspector UI.
 */
import { cacheHitPercent } from '@chinmaymk/ra'

// ── Types ────────────────────────────────────────────────────────────

export interface TraceSpan {
  name?: string
  spanId?: string
  parentSpanId?: string
  timestamp?: string
  durationMs?: number
  status?: string
  attributes?: Record<string, unknown>
  events?: Array<{ name: string; attributes?: Record<string, unknown> }>
}

interface LogEntry {
  timestamp?: string
  level?: string
  message?: string
  [key: string]: unknown
}

// ── Helpers ──────────────────────────────────────────────────────────

function numAttr(attrs: Record<string, unknown>, key: string): number {
  return (attrs[key] as number) || 0
}

// ── Stats ────────────────────────────────────────────────────────────

export function buildStats(
  traces: TraceSpan[],
  messages: Array<{ role?: string; toolCalls?: unknown[]; isError?: boolean; content?: unknown }>,
) {
  const loopSpan = traces.find(s => s.name === 'agent.loop')
  const iterations = traces.filter(s => s.name === 'agent.iteration')
  const modelCalls = traces.filter(s => s.name === 'agent.model_call')
  const toolExecs = traces.filter(s => s.name === 'agent.tool_execution')

  // Token totals — always sum from model calls for accuracy
  let inputTokens = 0
  let outputTokens = 0
  let thinkingTokens = 0
  let cacheReadTokens = 0
  let cacheCreationTokens = 0
  for (const mc of modelCalls) {
    const a = mc.attributes || {}
    inputTokens += numAttr(a, 'inputTokens')
    outputTokens += numAttr(a, 'outputTokens')
    thinkingTokens += numAttr(a, 'thinkingTokens')
    cacheReadTokens += numAttr(a, 'cacheReadTokens')
    cacheCreationTokens += numAttr(a, 'cacheCreationTokens')
  }

  // Tool frequency map
  const toolCounts: Record<string, { calls: number; errors: number; totalMs: number }> = {}
  for (const t of toolExecs) {
    const name = (t.attributes?.tool as string) || 'unknown'
    if (!toolCounts[name]) toolCounts[name] = { calls: 0, errors: 0, totalMs: 0 }
    toolCounts[name].calls++
    if (t.status === 'error') toolCounts[name].errors++
    toolCounts[name].totalMs += t.durationMs || 0
  }
  const tools = Object.entries(toolCounts)
    .map(([name, s]) => ({ name, ...s }))
    .sort((a, b) => b.calls - a.calls)

  // Per-iteration breakdown
  const iterationStats = iterations.map((it, i) => {
    const a = modelCalls.find(m => m.parentSpanId === it.spanId)?.attributes || {}
    const input = numAttr(a, 'inputTokens')
    const cacheRead = numAttr(a, 'cacheReadTokens')
    const iterTools = toolExecs.filter(t => t.parentSpanId === it.spanId)
    return {
      iteration: i + 1,
      durationMs: it.durationMs || 0,
      inputTokens: input,
      outputTokens: numAttr(a, 'outputTokens'),
      thinkingTokens: numAttr(a, 'thinkingTokens'),
      cacheReadTokens: cacheRead,
      cacheCreationTokens: numAttr(a, 'cacheCreationTokens'),
      cacheHitPercent: cacheHitPercent(input, cacheRead || undefined),
      toolCalls: iterTools.length,
      toolErrors: iterTools.filter(t => t.status === 'error').length,
      toolNames: iterTools.map(t => (t.attributes?.tool as string) || '?'),
    }
  })

  // Error count from messages
  const errorMessages = messages.filter(m => m.isError)

  return {
    totalDurationMs: loopSpan?.durationMs || iterations.reduce((s, i) => s + (i.durationMs || 0), 0),
    iterations: iterations.length,
    inputTokens,
    outputTokens,
    thinkingTokens,
    cacheReadTokens,
    cacheCreationTokens,
    cacheHitPercent: cacheHitPercent(inputTokens, cacheReadTokens || undefined),
    totalTokens: inputTokens + outputTokens + thinkingTokens,
    totalToolCalls: toolExecs.length,
    totalToolErrors: toolExecs.filter(t => t.status === 'error').length,
    totalMessages: messages.length,
    errorMessages: errorMessages.length,
    tools,
    iterationStats,
    status: loopSpan?.status || (traces.some(s => s.status === 'error') ? 'error' : 'ok'),
  }
}

// ── Timeline ─────────────────────────────────────────────────────────

export function buildTimeline(traces: TraceSpan[], logs: LogEntry[]) {
  const events: Array<{ ts: string; type: string; label: string; detail?: string; status?: string; durationMs?: number }> = []

  // From traces — start events for key spans
  for (const span of traces) {
    if (!span.timestamp) continue
    const name = span.name || ''
    if (name === 'agent.loop') {
      events.push({ ts: span.timestamp, type: 'loop', label: 'Loop started', status: span.status, durationMs: span.durationMs })
    } else if (name === 'agent.iteration') {
      const it = (span.attributes?.iteration as number) ?? '?'
      events.push({ ts: span.timestamp, type: 'iteration', label: 'Iteration ' + it, status: span.status, durationMs: span.durationMs })
    } else if (name === 'agent.model_call') {
      const a = span.attributes || {}
      const model = (a.model as string) || ''
      const inTok = numAttr(a, 'inputTokens')
      const outTok = numAttr(a, 'outputTokens')
      const cacheRead = numAttr(a, 'cacheReadTokens')
      const cachePct = cacheHitPercent(inTok, cacheRead || undefined)
      const cacheDetail = cachePct ? ' (' + cachePct + '% cached)' : ''
      events.push({
        ts: span.timestamp, type: 'model_call', label: 'Model call' + (model ? ' (' + model + ')' : ''),
        detail: inTok + ' in / ' + outTok + ' out tokens' + cacheDetail,
        status: span.status, durationMs: span.durationMs,
      })
    } else if (name === 'agent.tool_execution') {
      const tool = (span.attributes?.tool as string) || '?'
      const err = span.status === 'error' ? (span.attributes?.error as string) : undefined
      events.push({
        ts: span.timestamp, type: 'tool', label: 'Tool: ' + tool,
        detail: err || undefined,
        status: span.status, durationMs: span.durationMs,
      })
    }
  }

  // From logs — warn and error entries
  for (const log of logs) {
    const level = (log.level || '').toLowerCase()
    if (level === 'error' || level === 'warn') {
      events.push({
        ts: log.timestamp || '',
        type: 'log_' + level,
        label: '[' + level.toUpperCase() + '] ' + (log.message || ''),
        detail: Object.keys(log).filter(k => !['timestamp', 'level', 'message', 'sessionId'].includes(k))
          .map(k => k + '=' + JSON.stringify(log[k])).join(' ') || undefined,
      })
    }
  }

  events.sort((a, b) => (a.ts || '').localeCompare(b.ts || ''))
  return events
}
