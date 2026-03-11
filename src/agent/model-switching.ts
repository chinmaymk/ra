import type { Middleware, ModelCallContext } from './types'
import type { IProvider, IMessage } from '../providers/types'

export interface ModelSwitchRule {
  /** Target model to switch to when this rule matches */
  model: string
  /** Optional: switch to a different provider (requires providerOptions in config) */
  provider?: string
  /** Switch after N loop iterations */
  afterIteration?: number
  /** Switch when cumulative input tokens exceed this */
  inputTokensAbove?: number
  /** Switch when cumulative output tokens exceed this */
  outputTokensAbove?: number
  /** Switch when total tool calls in message history exceed this */
  toolCallCountAbove?: number
  /** Switch when latest user message complexity matches this level */
  complexity?: 'simple' | 'moderate' | 'complex'
}

export interface ModelSwitchConfig {
  enabled: boolean
  rules: ModelSwitchRule[]
  /** Optional: use a cheap LLM to classify complexity instead of heuristics */
  classifierModel?: string
}

// ---------------------------------------------------------------------------
// Heuristic complexity scorer
// ---------------------------------------------------------------------------

export type ComplexityLevel = 'simple' | 'moderate' | 'complex'

/** Count occurrences of a pattern in a string */
function countMatches(text: string, pattern: RegExp): number {
  const matches = text.match(pattern)
  return matches ? matches.length : 0
}

/** Extract text content from the last user message */
function getLastUserContent(messages: IMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'user') {
      const c = messages[i]!.content
      return typeof c === 'string' ? c : c.map(p => ('text' in p ? p.text : '')).join(' ')
    }
  }
  return ''
}

/**
 * Score the complexity of the latest user message using fast heuristics.
 * Returns 'simple', 'moderate', or 'complex'.
 */
export function scoreComplexity(messages: IMessage[]): ComplexityLevel {
  const lastUserContent = getLastUserContent(messages)
  if (!lastUserContent) return 'simple'

  let score = 0
  const len = lastUserContent.length

  // Length-based scoring
  if (len > 2000) score += 3
  else if (len > 500) score += 2
  else if (len > 150) score += 1

  // Code blocks
  const codeBlocks = countMatches(lastUserContent, /```/g)
  score += Math.min(codeBlocks, 4)

  // Multi-step language markers
  const multiStep = /\b(then|after that|next|also|additionally|finally|step \d|first|second|third)\b/gi
  score += Math.min(countMatches(lastUserContent, multiStep), 3)

  // File/path references
  const filePaths = countMatches(lastUserContent, /(?:\/[\w.-]+){2,}|[\w.-]+\.\w{1,4}\b/g)
  score += Math.min(filePaths, 3)

  // Broad-scope keywords (refactor, across, entire, all files, whole codebase)
  const broadScope = /\b(refactor|across|entire|all files|whole|codebase|every|migrate|redesign|overhaul|rewrite)\b/gi
  score += Math.min(countMatches(lastUserContent, broadScope) * 2, 4)

  // Line count (multi-line prompts tend to be more complex)
  const lines = lastUserContent.split('\n').length
  if (lines > 10) score += 2
  else if (lines > 4) score += 1

  if (score >= 8) return 'complex'
  if (score >= 4) return 'moderate'
  return 'simple'
}

// ---------------------------------------------------------------------------
// LLM-based classifier (optional, uses a cheap model)
// ---------------------------------------------------------------------------

const CLASSIFIER_PROMPT = `Classify the complexity of this user request as exactly one word: "simple", "moderate", or "complex".

- simple: short questions, single-file edits, lookups, explanations
- moderate: multi-file changes, debugging, moderate reasoning
- complex: large refactors, architectural changes, multi-step tasks, broad codebase changes

User request:
`

export async function classifyComplexity(
  provider: IProvider,
  model: string,
  messages: IMessage[],
): Promise<ComplexityLevel> {
  const lastUserContent = getLastUserContent(messages)
  if (!lastUserContent) return 'simple'

  // Truncate very long messages for the classifier
  const truncated = lastUserContent.length > 1000
    ? lastUserContent.slice(0, 1000) + '...'
    : lastUserContent

  try {
    const response = await provider.chat({
      model,
      messages: [{ role: 'user', content: CLASSIFIER_PROMPT + truncated }],
    })
    const text = typeof response.message.content === 'string'
      ? response.message.content.trim().toLowerCase()
      : ''

    if (text.includes('complex')) return 'complex'
    if (text.includes('moderate')) return 'moderate'
    return 'simple'
  } catch {
    // Fall back to heuristic on classifier failure
    return scoreComplexity(messages)
  }
}

// ---------------------------------------------------------------------------
// Rule evaluation
// ---------------------------------------------------------------------------

function countToolCalls(messages: IMessage[]): number {
  let count = 0
  for (const msg of messages) {
    if (msg.toolCalls) count += msg.toolCalls.length
  }
  return count
}

/** Check if a single rule matches the current loop state */
export function ruleMatches(
  rule: ModelSwitchRule,
  ctx: {
    iteration: number
    inputTokens: number
    outputTokens: number
    toolCallCount: number
    complexity: ComplexityLevel
  },
): boolean {
  // All specified conditions must match (AND logic)
  if (rule.afterIteration !== undefined && ctx.iteration <= rule.afterIteration) return false
  if (rule.inputTokensAbove !== undefined && ctx.inputTokens <= rule.inputTokensAbove) return false
  if (rule.outputTokensAbove !== undefined && ctx.outputTokens <= rule.outputTokensAbove) return false
  if (rule.toolCallCountAbove !== undefined && ctx.toolCallCount <= rule.toolCallCountAbove) return false
  if (rule.complexity !== undefined && ctx.complexity !== rule.complexity) return false

  // At least one condition must have been specified
  return (
    rule.afterIteration !== undefined ||
    rule.inputTokensAbove !== undefined ||
    rule.outputTokensAbove !== undefined ||
    rule.toolCallCountAbove !== undefined ||
    rule.complexity !== undefined
  )
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

export interface ModelSwitchingDeps {
  /** The default provider (used for same-provider model switches and LLM classifier) */
  defaultProvider: IProvider
  /** Factory to create a provider by name (lazily called, results are cached) */
  createProvider?: (name: string) => IProvider
}

export function createModelSwitchingMiddleware(
  config: ModelSwitchConfig,
  deps: ModelSwitchingDeps,
): Middleware<ModelCallContext> {
  // Cache complexity per iteration to avoid re-computing
  let cachedIteration = -1
  let cachedComplexity: ComplexityLevel = 'simple'

  // Lazily created provider instances for cross-provider switching
  const providerCache = new Map<string, IProvider>()

  function getProvider(name: string): IProvider {
    let cached = providerCache.get(name)
    if (cached) return cached
    if (!deps.createProvider) throw new Error(`Cannot switch to provider "${name}" — no createProvider factory provided`)
    cached = deps.createProvider(name)
    providerCache.set(name, cached)
    return cached
  }

  return async (ctx: ModelCallContext): Promise<void> => {
    const { loop, request } = ctx
    const hasComplexityRule = config.rules.some(r => r.complexity !== undefined)

    // Compute complexity once per iteration
    let complexity: ComplexityLevel = 'simple'
    if (hasComplexityRule) {
      if (cachedIteration === loop.iteration) {
        complexity = cachedComplexity
      } else if (config.classifierModel) {
        complexity = await classifyComplexity(deps.defaultProvider, config.classifierModel, loop.messages)
        cachedIteration = loop.iteration
        cachedComplexity = complexity
      } else {
        complexity = scoreComplexity(loop.messages)
        cachedIteration = loop.iteration
        cachedComplexity = complexity
      }
    }

    const evalCtx = {
      iteration: loop.iteration,
      inputTokens: loop.usage.inputTokens,
      outputTokens: loop.usage.outputTokens,
      toolCallCount: countToolCalls(loop.messages),
      complexity,
    }

    // Last matching rule wins
    let targetModel: string | undefined
    let targetProvider: ProviderName | undefined
    for (const rule of config.rules) {
      if (ruleMatches(rule, evalCtx)) {
        targetModel = rule.model
        targetProvider = rule.provider
      }
    }

    if (targetModel) {
      request.model = targetModel
    }
    if (targetProvider) {
      ctx.provider = getProvider(targetProvider)
    }
  }
}
