import type { ITool } from '../providers/types'

/** Normalize a tool name: lowercase, replace hyphens with underscores. */
export function normalizeToolName(name: string): string {
  return name.toLowerCase().replace(/-/g, '_')
}

export class ToolRegistry {
  private tools = new Map<string, ITool>()
  /** Maps normalized names to canonical (registered) names for fuzzy lookup. */
  private normalized = new Map<string, string>()
  /** Maps alias names to canonical names. */
  private aliases = new Map<string, string>()

  register(tool: ITool): void {
    this.tools.set(tool.name, tool)
    this.normalized.set(normalizeToolName(tool.name), tool.name)
  }

  /** Register an alias that resolves to an existing tool name. */
  alias(aliasName: string, canonicalName: string): void {
    this.aliases.set(normalizeToolName(aliasName), canonicalName)
  }

  /** Resolve a name through aliases and normalization to find the matching tool. */
  private resolve(name: string): ITool | undefined {
    // 1. Exact match (fastest path)
    const exact = this.tools.get(name)
    if (exact) return exact

    // 2. Alias lookup (normalized)
    const norm = normalizeToolName(name)
    const aliasTarget = this.aliases.get(norm)
    if (aliasTarget) {
      const aliased = this.tools.get(aliasTarget)
      if (aliased) return aliased
    }

    // 3. Normalized match (case-insensitive, hyphens → underscores)
    const canonical = this.normalized.get(norm)
    if (canonical) return this.tools.get(canonical)

    return undefined
  }

  get(name: string): ITool | undefined {
    return this.resolve(name)
  }

  all(): ITool[] {
    return Array.from(this.tools.values()).sort((a, b) => a.name.localeCompare(b.name))
  }

  async execute(name: string, input: unknown): Promise<unknown> {
    const tool = this.resolve(name)
    if (!tool) {
      throw new Error(`Tool not found: ${name}`)
    }
    return tool.execute(input)
  }
}
