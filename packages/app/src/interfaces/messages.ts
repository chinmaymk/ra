import {
  AgentLoop,
  mergeMiddleware,
  type IMessage,
  type IProvider,
  type ToolRegistry,
  type MiddlewareConfig,
  type CompactionConfig,
  type Logger,
  type LogLevel,
  type ThinkingMode,
} from '@chinmaymk/ra'
import type { SkillIndex } from '../skills/types'
import type { SessionStorage } from '../storage/sessions'
import type { AppContext } from '../bootstrap'
import { createSessionMiddleware } from '../agent/session'
import { buildAvailableSkillsXml } from '../skills/loader'

/** Fields shared by all interface option types (CLI, REPL, HTTP). */
export interface BaseLoopOptions {
  model: string
  provider: IProvider
  tools: ToolRegistry
  systemPrompt?: string
  skillIndex?: Map<string, SkillIndex>
  middleware?: Partial<MiddlewareConfig>
  maxIterations?: number
  maxRetries?: number
  toolTimeout?: number
  maxToolResponseSize?: number
  thinking?: ThinkingMode
  thinkingBudgetCap?: number
  compaction?: CompactionConfig
  contextMessages?: IMessage[]
  logger?: Logger
  logsEnabled?: boolean
  logLevel?: LogLevel
  tracesEnabled?: boolean
  storage?: SessionStorage
  sessionId?: string
}

/** Build BaseLoopOptions from an AppContext — reads current (possibly reloaded) state. */
export function buildLoopOptions(ctx: AppContext): BaseLoopOptions {
  const { config, provider, tools, middleware, skillIndex, contextMessages, logger } = ctx
  const { agent, app } = config
  return {
    model: agent.model,
    provider,
    tools,
    systemPrompt: agent.systemPrompt,
    skillIndex,
    middleware,
    maxIterations: agent.maxIterations,
    maxRetries: agent.maxRetries,
    toolTimeout: agent.toolTimeout,
    maxToolResponseSize: agent.tools.maxResponseSize,
    thinking: agent.thinking,
    thinkingBudgetCap: agent.thinkingBudgetCap,
    compaction: agent.compaction,
    contextMessages,
    logger,
    logsEnabled: app.logsEnabled,
    logLevel: app.logLevel,
    tracesEnabled: app.tracesEnabled,
  }
}

/**
 * Build the standard message prefix shared across all interfaces:
 *   system prompt → available skills XML → context files
 *
 * Skills are activated via the /skill-name pattern resolver in prompts,
 * not through config. The available skills XML lists all loaded skills
 * so the model knows what's available.
 *
 * Each interface appends its own messages after this prefix
 * (e.g. session history, user input).
 */
export function buildMessagePrefix(options: {
  systemPrompt?: string
  skillIndex?: Map<string, SkillIndex>
  contextMessages?: IMessage[]
}): IMessage[] {
  const messages: IMessage[] = []

  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt })
  }

  // Available skills — summary XML so the model knows what skills can be activated via /skill-name
  if (options.skillIndex && options.skillIndex.size > 0) {
    const xml = buildAvailableSkillsXml(options.skillIndex)
    if (xml) messages.push({ role: 'user', content: xml })
  }

  // Context files
  if (options.contextMessages?.length) {
    messages.push(...options.contextMessages)
  }

  return messages
}

/**
 * Build the full message thread for a loop invocation.
 *
 * New session (storedMessages is empty): builds the prefix and returns priorCount=0
 * so the history middleware saves everything.
 *
 * Existing session / resume: copies storedMessages (prefix is already there)
 * and returns priorCount = storedMessages.length so only new messages get saved.
 *
 * Callers append their user message(s) to the returned array.
 */
export function buildThreadMessages(options: {
  storedMessages: IMessage[]
  systemPrompt?: string
  skillIndex?: Map<string, SkillIndex>
  contextMessages?: IMessage[]
}): { messages: IMessage[]; priorCount: number } {
  if (options.storedMessages.length === 0) {
    return {
      messages: buildMessagePrefix({
        systemPrompt: options.systemPrompt,
        skillIndex: options.skillIndex,
        contextMessages: options.contextMessages,
      }),
      priorCount: 0,
    }
  }
  return {
    messages: [...options.storedMessages],
    priorCount: options.storedMessages.length,
  }
}

/**
 * Create an AgentLoop with session middleware, extracting common fields from BaseLoopOptions.
 * Consolidates the repeated pattern across CLI, REPL, and HTTP interfaces.
 */
export function createSessionLoop(
  options: BaseLoopOptions,
  params: {
    storage: SessionStorage
    sessionId: string
    priorCount: number
    resumed: boolean
    extraMiddleware?: Partial<MiddlewareConfig>
  },
): { loop: AgentLoop; logger: Logger } {
  const session = createSessionMiddleware(options.middleware, {
    storage: params.storage,
    sessionId: params.sessionId,
    priorCount: params.priorCount,
    logsEnabled: options.logsEnabled,
    logLevel: options.logLevel,
    tracesEnabled: options.tracesEnabled,
    logger: options.logger,
  })
  const loop = new AgentLoop({
    provider: options.provider,
    tools: options.tools,
    model: options.model,
    maxIterations: options.maxIterations,
    maxRetries: options.maxRetries,
    toolTimeout: options.toolTimeout,
    maxToolResponseSize: options.maxToolResponseSize,
    thinking: options.thinking,
    thinkingBudgetCap: options.thinkingBudgetCap,
    compaction: options.compaction,
    sessionId: params.sessionId,
    logger: session.logger,
    middleware: mergeMiddleware(params.extraMiddleware, session.middleware),
    resumed: params.resumed,
  })
  return { loop, logger: session.logger }
}
