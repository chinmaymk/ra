/**
 * Pattern resolution engine.
 *
 * A PatternResolver matches references in user text (e.g. `@src/index.ts`)
 * and resolves them to content that gets appended to the message.
 */

export interface PatternResolver {
  /** Human-readable name for this resolver */
  name: string
  /**
   * Regex pattern to match references in message text.
   * Must have exactly one capture group for the reference value.
   * Example: /@([\w.\/\-*]+)/g matches @src/index.ts → capture "src/index.ts"
   */
  pattern: RegExp
  /**
   * Resolve a matched reference to content.
   * Return null to skip (leave the reference as-is).
   */
  resolve: (ref: string, cwd: string) => Promise<string | null>
}

export interface ResolvedReference {
  /** The full matched text, e.g. "@src/index.ts" */
  original: string
  /** The captured reference value, e.g. "src/index.ts" */
  ref: string
  /** The resolved content */
  resolved: string
  /** Name of the resolver that matched */
  resolver: string
}

export interface ResolutionResult {
  /** Original text, unchanged */
  text: string
  /** Resolved references with their content */
  references: ResolvedReference[]
}

/**
 * Scan text for all resolver patterns, resolve matches in parallel,
 * and return the results. The original text is NOT modified — callers
 * decide how to present resolved content (typically appended as XML).
 */
export async function resolvePatterns(
  text: string,
  resolvers: PatternResolver[],
  cwd: string,
): Promise<ResolutionResult> {
  const pending: { original: string; ref: string; resolverName: string; resolve: Promise<string | null> }[] = []
  const seen = new Set<string>()

  for (const resolver of resolvers) {
    // Create a global copy to avoid mutating the original and to ensure
    // the `g` flag is present (without it, exec() loops infinitely).
    const flags = resolver.pattern.flags.includes('g')
      ? resolver.pattern.flags
      : resolver.pattern.flags + 'g'
    const re = new RegExp(resolver.pattern.source, flags)
    let match: RegExpExecArray | null
    while ((match = re.exec(text)) !== null) {
      // Guard against zero-length matches that would loop forever
      if ((match[0] ?? '').length === 0) { re.lastIndex++; continue }
      const original = match[0] as string
      const ref = match[1]
      if (!ref || seen.has(original)) continue
      seen.add(original)
      pending.push({
        original,
        ref,
        resolverName: resolver.name,
        resolve: resolver.resolve(ref, cwd),
      })
    }
  }

  if (pending.length === 0) {
    return { text, references: [] }
  }

  const settled = await Promise.allSettled(pending.map(p => p.resolve))
  const references: ResolvedReference[] = []

  for (let i = 0; i < pending.length; i++) {
    const result = settled[i]
    const entry = pending[i]
    if (!result || !entry) continue
    if (result.status === 'fulfilled' && result.value !== null) {
      references.push({
        original: entry.original,
        ref: entry.ref,
        resolved: result.value,
        resolver: entry.resolverName,
      })
    }
  }

  return { text, references }
}

/**
 * Format resolved references as XML blocks to append to a message.
 */
export function formatResolvedReferences(references: ResolvedReference[]): string {
  if (references.length === 0) return ''
  return references
    .map(r => `<resolved-context ref="${r.original}">\n${r.resolved}\n</resolved-context>`)
    .join('\n\n')
}
