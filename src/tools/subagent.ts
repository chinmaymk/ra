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
  /** Max iterations per subagent (default: 5) */
  maxIterations?: number
  /** Max recursion depth (default: 2) */
  maxDepth?: number
  /** Max concurrent subagents per call (default: 4) */
  maxConcurrency?: number
  /** Tool timeout passed to child loops (default: 0) */
  toolTimeout?: number
  /** Current depth — set internally, do not pass from user config */
  _depth?: number
}

interface SubagentTask {
  /** A short description of what this subagent should accomplish */
  task: string
  /** Optional system prompt override for this subagent */
  systemPrompt?: string
}

interface SubagentInput {
  tasks: SubagentTask[]
}

interface SubagentResult {
  task: string
  status: 'completed' | 'error'
  result: string
  iterations: number
  usage: TokenUsage
}

/**
 * Creates a subagent tool that can run multiple tasks in parallel,
 * each in its own AgentLoop instance. Subagents share the parent's
 * provider and tools but get independent message histories.
 */
export function subagentTool(options: SubagentToolOptions): ITool {
  const depth = options._depth ?? 0
  const maxDepth = options.maxDepth ?? 2
  const maxConcurrency = options.maxConcurrency ?? 4
  const subagentMaxIterations = options.maxIterations ?? 5

  return {
    name: 'subagent',
    description:
      'Run one or more tasks in parallel using independent sub-agents. ' +
      'Each task gets its own agent loop with a fresh conversation. ' +
      'Use this to parallelize independent work — research, file analysis, code generation — ' +
      'rather than doing things sequentially. Returns results from all tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: 'Tasks to run in parallel. Each task is an independent agent invocation.',
          items: {
            type: 'object',
            properties: {
              task: {
                type: 'string',
                description: 'The task prompt for the sub-agent. Be specific about what it should do and return.',
              },
              systemPrompt: {
                type: 'string',
                description: 'Optional system prompt override for this sub-agent.',
              },
            },
            required: ['task'],
          },
          minItems: 1,
          maxItems: maxConcurrency,
        },
      },
      required: ['tasks'],
    },

    async execute(input: unknown): Promise<unknown> {
      const { tasks } = input as SubagentInput

      if (!tasks || tasks.length === 0) {
        throw new Error('At least one task is required')
      }
      if (tasks.length > maxConcurrency) {
        throw new Error(`Maximum ${maxConcurrency} concurrent tasks allowed`)
      }

      // Build child tool registry — include subagent tool if not at max depth
      const childTools = new ToolRegistry()
      for (const tool of options.tools.all()) {
        if (tool.name === 'subagent') continue // will re-add with incremented depth below
        childTools.register(tool)
      }

      if (depth + 1 < maxDepth) {
        childTools.register(subagentTool({
          ...options,
          tools: childTools,
          _depth: depth + 1,
        }))
      }

      const runTask = async (task: SubagentTask): Promise<SubagentResult> => {
        const messages: IMessage[] = []

        if (task.systemPrompt) {
          messages.push({ role: 'system', content: task.systemPrompt })
        }

        messages.push({ role: 'user', content: task.task })

        const loopOptions: AgentLoopOptions = {
          provider: options.provider,
          tools: childTools,
          model: options.model,
          maxIterations: subagentMaxIterations,
          middleware: options.middleware,
          thinking: options.thinking,
          compaction: options.compaction,
          toolTimeout: options.toolTimeout,
        }

        try {
          const result = await new AgentLoop(loopOptions).run(messages)

          // Extract the final assistant text
          const lastAssistant = [...result.messages]
            .reverse()
            .find(m => m.role === 'assistant')
          const text = lastAssistant
            ? (typeof lastAssistant.content === 'string'
                ? lastAssistant.content
                : JSON.stringify(lastAssistant.content))
            : '(no response)'

          return {
            task: task.task,
            status: 'completed',
            result: text,
            iterations: result.iterations,
            usage: result.usage,
          }
        } catch (err) {
          return {
            task: task.task,
            status: 'error',
            result: err instanceof Error ? err.message : String(err),
            iterations: 0,
            usage: { inputTokens: 0, outputTokens: 0 },
          }
        }
      }

      const results = await Promise.allSettled(tasks.map(runTask))

      return results.map((r, i) => {
        if (r.status === 'fulfilled') return r.value
        return {
          task: tasks[i]!.task,
          status: 'error' as const,
          result: r.reason instanceof Error ? r.reason.message : String(r.reason),
          iterations: 0,
          usage: { inputTokens: 0, outputTokens: 0 },
        }
      })
    },
  }
}
