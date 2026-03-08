import type { IMessage, IProvider } from '../providers/types'

/**
 * An extracted memory entry before it's saved.
 */
export interface MemoryEntry {
  content: string
  tags: string
  layer: 'session' | 'long-term'
}

/**
 * Pattern-based extraction rule. Each pattern is a regex
 * applied to messages, with a tag and layer assignment.
 */
export interface ExtractionPattern {
  /** Regex pattern to match against message content */
  pattern: string
  /** Which message roles to apply this to (default: all) */
  roles?: ('user' | 'assistant' | 'tool' | 'system')[]
  /** Tag to assign to extracted memories */
  tag: string
  /** Which layer to store in (default: session) */
  layer?: 'session' | 'long-term'
  /** Max content length to consider (skip long messages). 0 = no limit */
  maxLength?: number
  /**
   * If 'match', store the matched group (first capture group or full match).
   * If 'full', store the entire message content.
   * Default: 'match'
   */
  capture?: 'match' | 'full'
}

/**
 * A memory extractor pulls structured memories from conversation messages.
 */
export interface MemoryExtractor {
  extract(messages: IMessage[]): MemoryEntry[]
}

/** Default extraction patterns — the baseline set */
export const DEFAULT_PATTERNS: ExtractionPattern[] = [
  // Explicit [REMEMBER: ...] markers from any role
  {
    pattern: '\\[REMEMBER:\\s*(.+?)\\]',
    tag: 'explicit',
    layer: 'session',
    capture: 'match',
  },
  // User corrections and preferences (short messages)
  {
    pattern: '^(actually|no,|instead|i prefer|always use|never use|remember that|don\'t forget|keep in mind|my name is|i use|i work with)\\b',
    roles: ['user'],
    tag: 'user-preference',
    layer: 'session',
    maxLength: 300,
    capture: 'full',
  },
]

/**
 * Pattern-based extractor. Applies configurable regex patterns to messages.
 * You can extend the default patterns or replace them entirely.
 */
export class PatternExtractor implements MemoryExtractor {
  private compiled: { re: RegExp; rule: ExtractionPattern }[]

  constructor(patterns: ExtractionPattern[] = DEFAULT_PATTERNS) {
    this.compiled = patterns.map(rule => ({
      re: new RegExp(rule.pattern, 'gi'),
      rule,
    }))
  }

  extract(messages: IMessage[]): MemoryEntry[] {
    const entries: MemoryEntry[] = []
    const seen = new Set<string>()

    for (const msg of messages) {
      const text = typeof msg.content === 'string' ? msg.content : ''
      if (!text) continue

      for (const { re, rule } of this.compiled) {
        // Role filter
        if (rule.roles && !rule.roles.includes(msg.role)) continue
        // Length filter
        if (rule.maxLength && text.length > rule.maxLength) continue

        // Reset regex state for each message
        const regex = new RegExp(re.source, re.flags)
        let match: RegExpExecArray | null
        while ((match = regex.exec(text)) !== null) {
          const content = rule.capture === 'full'
            ? text
            : (match[1] ?? match[0]).trim()

          // Deduplicate within this extraction pass
          const key = `${rule.tag}:${content}`
          if (seen.has(key)) continue
          seen.add(key)

          entries.push({
            content,
            tags: rule.tag,
            layer: rule.layer ?? 'session',
          })

          // For 'full' capture, one match per message is enough
          if (rule.capture === 'full') break
        }
      }
    }

    return entries
  }
}

// Keep backward compat alias
export { PatternExtractor as DefaultMemoryExtractor }

export const DEFAULT_REFLECTION_PROMPT = `You are a memory extraction system. Analyze the following conversation and identify learnings that deserve to be promoted to long-term memory — facts, preferences, and decisions that would be valuable across future conversations.

For each memory, output a JSON array of objects with these fields:
- "content": the memory text (concise, self-contained, factual)
- "tags": comma-separated tags for categorization

The bar for long-term memory is high. Only extract things that have proven importance — patterns that recur, preferences the user has reinforced, or decisions with lasting impact.

Extract:
- User preferences and working style that were reinforced or corrected
- Technical decisions with lasting architectural impact
- Project conventions or constraints that will apply going forward
- Corrections the user made emphatically or repeatedly

Do NOT extract:
- One-off task context or ephemeral details
- Trivial conversational exchanges
- Information that's only relevant to the current session
- Anything uncertain — when in doubt, leave it out

If there's nothing worth promoting to long-term memory, return an empty array: []

Output ONLY valid JSON, no other text.

<conversation>
{CONVERSATION}
</conversation>`

/**
 * LLM-driven reflective extractor. Sends the conversation to a model
 * and asks it to extract structured learnings.
 *
 * The prompt must contain {CONVERSATION} which gets replaced with the transcript.
 */
export class ReflectiveExtractor implements MemoryExtractor {
  private provider: IProvider
  private model: string
  private prompt: string

  constructor(provider: IProvider, model?: string, prompt?: string) {
    this.provider = provider
    this.model = model ?? 'default'
    this.prompt = prompt ?? DEFAULT_REFLECTION_PROMPT
  }

  /** Synchronous extract returns empty — use extractAsync for LLM-driven flow */
  extract(_messages: IMessage[]): MemoryEntry[] {
    return []
  }

  /** Async LLM-driven extraction */
  async extractAsync(messages: IMessage[]): Promise<MemoryEntry[]> {
    // Filter to substantive messages only
    const substantive = messages.filter(m =>
      (m.role === 'user' || m.role === 'assistant') &&
      typeof m.content === 'string' &&
      m.content.length > 10,
    )
    if (substantive.length < 2) return []

    // Build a condensed conversation transcript
    const transcript = substantive.slice(-30).map(m => {
      const text = typeof m.content === 'string' ? m.content : ''
      // Truncate very long messages
      const truncated = text.length > 1000 ? text.slice(0, 1000) + '...' : text
      return `[${m.role}]: ${truncated}`
    }).join('\n\n')

    const prompt = this.prompt.replace('{CONVERSATION}', transcript)

    try {
      const response = await this.provider.chat({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
      })

      const text = typeof response.message.content === 'string'
        ? response.message.content
        : ''

      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (!jsonMatch) return []

      const parsed = JSON.parse(jsonMatch[0]) as Array<{ content: string; tags: string }>
      return parsed
        .filter(e => e.content && typeof e.content === 'string')
        .map(e => ({
          content: e.content,
          tags: e.tags ?? '',
          layer: 'long-term' as const,
        }))
    } catch {
      // Reflection is best-effort — never fail the main flow
      return []
    }
  }
}
