import type { ITool, IMessage, IProvider, TokenUsage } from '../providers/types'
import type { MiddlewareConfig } from '../agent/types'
import { AgentLoop, type AgentLoopOptions } from '../agent/loop'
import { ToolRegistry } from '../agent/tool-registry'
import type { CompactionConfig } from '../agent/context-compaction'
import type { SubagentConfig } from '../config/types'

/** Tools that should never be available to subagents */
const EXCLUDED_TOOLS = new Set(['subagent', 'ask_user'])

export interface SubagentToolOptions {
  provider: IProvider
  tools: ToolRegistry
  model: string
  systemPrompt?: string
  middleware?: Partial<MiddlewareConfig>
  thinking?: 'low' | 'medium' | 'high'
  compaction?: CompactionConfig
  toolTimeout?: number
  /** Recipe-author config for subagent behavior */
  config?: SubagentConfig
  /** Max nesting depth (default: 2) */
  maxDepth?: number
  /** @internal */
  _depth?: number
}

export function subagentTool(options: SubagentToolOptions): ITool {
  const depth = options._depth ?? 0
  const maxDepth = options.maxDepth ?? 2
  const cfg = options.config ?? {}
  const maxConcurrency = cfg.maxConcurrency ?? 4
  const maxIterations = cfg.maxTurns ?? 5

  return {
    name: 'subagent',
    description:
      'Run one or more tasks in parallel using independent sub-agents. ' +
      'Each task gets its own agent loop with a fresh conversation. ' +
      'Use this to parallelize independent work rather than doing things sequentially.',
    inputSchema: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: 'Tasks to run in parallel.',
          items: {
            type: 'object',
            properties: {
              task: { type: 'string', description: 'The task prompt. Be specific about what to do and return.' },
              systemPrompt: { type: 'string', description: 'Optional system prompt for this task.' },
            },
            required: ['task'],
          },
          minItems: 1,
          maxItems: maxConcurrency,
        },
      },
      required: ['tasks'],
    },

    async execute(input: unknown) {
      const { tasks } = input as { tasks: { task: string; systemPrompt?: string }[] }
      if (!tasks?.length) throw new Error('At least one task is required')

      // Build child tool registry lazily so we pick up tools registered
      // after subagentTool() was constructed (e.g. MCP tools)
      const childTools = new ToolRegistry()
      const allowedSet = cfg.allowedTools ? new Set(cfg.allowedTools) : null
      for (const tool of options.tools.all()) {
        if (EXCLUDED_TOOLS.has(tool.name)) continue
        if (allowedSet && !allowedSet.has(tool.name)) continue
        childTools.register(tool)
      }
      if (depth + 1 < maxDepth) {
        childTools.register(subagentTool({ ...options, tools: childTools, _depth: depth + 1 }))
      }

      // Resolve model — config override or parent's model
      const childModel = cfg.model ?? options.model

      // Resolve system prompt from config
      const configSystem = resolveSystemPrompt(cfg.system, options.systemPrompt)

      // Resolve thinking level
      const childThinking = cfg.thinking ?? options.thinking

      const loopOptions: AgentLoopOptions = {
        provider: options.provider,
        tools: childTools,
        model: childModel,
        maxIterations,
        middleware: options.middleware,
        thinking: childThinking,
        compaction: options.compaction,
        toolTimeout: options.toolTimeout,
      }

      const results = await Promise.all(tasks.map(async ({ task, systemPrompt }) => {
        const messages: IMessage[] = []

        // System prompt priority: per-task override > config-level
        const effectiveSystem = systemPrompt ?? configSystem
        if (effectiveSystem) messages.push({ role: 'system', content: effectiveSystem })

        messages.push({ role: 'user', content: task })

        try {
          const result = await new AgentLoop(loopOptions).run(messages)
          const last = result.messages.findLast(m => m.role === 'assistant')
          return {
            task,
            status: 'completed' as const,
            result: last ? (typeof last.content === 'string' ? last.content : JSON.stringify(last.content)) : '(no response)',
            iterations: result.iterations,
            usage: result.usage,
          }
        } catch (err) {
          return {
            task,
            status: 'error' as const,
            result: err instanceof Error ? err.message : String(err),
            iterations: 0,
            usage: { inputTokens: 0, outputTokens: 0 } as TokenUsage,
          }
        }
      }))

      // Compute aggregate usage for parent rollup
      const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 }
      for (const r of results) {
        totalUsage.inputTokens += r.usage.inputTokens
        totalUsage.outputTokens += r.usage.outputTokens
        if (r.usage.thinkingTokens) {
          totalUsage.thinkingTokens = (totalUsage.thinkingTokens ?? 0) + r.usage.thinkingTokens
        }
      }

      return { results, usage: totalUsage }
    },
  }
}

/** Resolve the system prompt based on config value */
function resolveSystemPrompt(configValue: SubagentConfig['system'], parentSystem?: string): string | undefined {
  if (configValue === undefined || configValue === 'none') return undefined
  if (configValue === 'inherit') return parentSystem
  return configValue // custom string
}
