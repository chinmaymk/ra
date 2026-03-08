import type { ITool, IMessage, IProvider, TokenUsage } from '../providers/types'
import type { MiddlewareConfig } from '../agent/types'
import { AgentLoop, type AgentLoopOptions } from '../agent/loop'
import { ToolRegistry } from '../agent/tool-registry'
import type { CompactionConfig } from '../agent/context-compaction'

export interface SubagentToolOptions {
  provider: IProvider
  tools: ToolRegistry
  model: string
  middleware?: Partial<MiddlewareConfig>
  thinking?: 'low' | 'medium' | 'high'
  compaction?: CompactionConfig
  maxIterations?: number
  maxDepth?: number
  maxConcurrency?: number
  toolTimeout?: number
  /** @internal */
  _depth?: number
}

export function subagentTool(options: SubagentToolOptions): ITool {
  const depth = options._depth ?? 0
  const maxDepth = options.maxDepth ?? 2
  const maxConcurrency = options.maxConcurrency ?? 4
  const maxIterations = options.maxIterations ?? 5

  // Build child tool registry once at construction
  const childTools = new ToolRegistry()
  for (const tool of options.tools.all()) {
    if (tool.name !== 'subagent') childTools.register(tool)
  }
  if (depth + 1 < maxDepth) {
    childTools.register(subagentTool({ ...options, tools: childTools, _depth: depth + 1 }))
  }

  const loopOptions: AgentLoopOptions = {
    provider: options.provider,
    tools: childTools,
    model: options.model,
    maxIterations,
    middleware: options.middleware,
    thinking: options.thinking,
    compaction: options.compaction,
    toolTimeout: options.toolTimeout,
  }

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
              systemPrompt: { type: 'string', description: 'Optional system prompt override.' },
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

      return Promise.all(tasks.map(async ({ task, systemPrompt }) => {
        const messages: IMessage[] = []
        if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
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
    },
  }
}
