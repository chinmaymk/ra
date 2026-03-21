import {
  errorMessage,
  AgentLoop,
  ToolRegistry,
  accumulateUsage,
  serializeContent,
  type ITool,
  type IMessage,
  type IProvider,
  type TokenUsage,
  type MiddlewareConfig,
  type AgentLoopOptions,
  type CompactionConfig,
  type Logger,
} from '@chinmaymk/ra'

/** Tools that can't work from a background fork */
const EXCLUDED_TOOLS = new Set(['Agent', 'AskUserQuestion'])

export interface SubagentToolOptions {
  provider: IProvider
  tools: ToolRegistry
  model: string
  systemPrompt?: string
  middleware?: Partial<MiddlewareConfig>
  thinking?: 'low' | 'medium' | 'high'
  compaction?: CompactionConfig
  toolTimeout?: number
  maxIterations?: number
  maxConcurrency?: number
  logger?: Logger
  /** Max nesting depth (default: 2) */
  maxDepth?: number
  /** @internal */
  _depth?: number
}

export function subagentTool(options: SubagentToolOptions): ITool {
  const depth = options._depth ?? 0
  const maxDepth = options.maxDepth ?? 2
  const maxConcurrency = options.maxConcurrency ?? 4
  const maxIterations = options.maxIterations ?? 50

  return {
    name: 'Agent',
    description:
      'Fork parallel copies of yourself to work on independent tasks simultaneously. ' +
      'Each fork inherits your tools, model, and system prompt but gets a fresh conversation. ' +
      'Use this to parallelize independent work rather than doing things sequentially.',
    inputSchema: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: 'Tasks to run in parallel. Each gets a forked copy of yourself.',
          items: {
            type: 'object',
            properties: {
              task: { type: 'string', description: 'The task prompt. Be specific about what to do and return.' },
              role: { type: 'string', description: 'Optional system prompt override that defines this agent\'s specialized role. When omitted the parent system prompt is inherited.' },
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
      const { tasks } = input as { tasks: { task: string; role?: string }[] }
      if (!tasks?.length) throw new Error('At least one task is required')

      // Build child tool registry lazily so we pick up tools registered
      // after subagentTool() was constructed (e.g. MCP tools)
      const childTools = new ToolRegistry()
      for (const tool of options.tools.all()) {
        if (EXCLUDED_TOOLS.has(tool.name)) continue
        childTools.register(tool)
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
        logger: options.logger,
      }

      const results = await Promise.all(tasks.map(async ({ task, role }) => {
        const messages: IMessage[] = []
        const systemPrompt = role ?? options.systemPrompt
        if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
        messages.push({ role: 'user', content: task })

        try {
          const result = await new AgentLoop(loopOptions).run(messages)
          const last = result.messages.findLast(m => m.role === 'assistant')
          return {
            task,
            status: 'completed' as const,
            result: last ? serializeContent(last.content) : '(no response)',
            iterations: result.iterations,
            usage: result.usage,
          }
        } catch (err) {
          return {
            task,
            status: 'error' as const,
            result: errorMessage(err),
            iterations: 0,
            usage: { inputTokens: 0, outputTokens: 0 } as TokenUsage,
          }
        }
      }))

      // Compute aggregate usage for parent rollup
      const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 }
      for (const r of results) accumulateUsage(totalUsage, r.usage)

      return { results, usage: totalUsage }
    },
  }
}
