const MODEL_FAMILIES: [string, number][] = [
  ['claude-sonnet', 200_000],
  ['claude-haiku', 200_000],
  ['claude-opus', 200_000],
  ['claude-3.5', 200_000],
  ['claude-3', 200_000],
  ['gpt-4o', 128_000],
  ['gpt-4-turbo', 128_000],
  ['gpt-4', 8_192],
  ['gpt-3.5', 16_385],
  ['o1', 200_000],
  ['o3', 200_000],
  ['gemini-2.5', 1_048_576],
  ['gemini-2.0', 1_048_576],
  ['gemini-1.5', 1_048_576],
]

const SORTED_FAMILIES = MODEL_FAMILIES.sort((a, b) => b[0].length - a[0].length)

const DEFAULT_CONTEXT_WINDOW = 200_000

export interface ContextWindowSource {
  contextWindow?(model: string): number | undefined
}

/**
 * Resolve context window size.
 * Priority: userOverride → provider.contextWindow() → model family registry → fallback.
 */
export function getContextWindowSize(model: string, userOverride?: number, provider?: ContextWindowSource): number {
  if (userOverride !== undefined) return userOverride
  const fromProvider = provider?.contextWindow?.(model)
  if (fromProvider !== undefined) return fromProvider
  for (const [prefix, size] of SORTED_FAMILIES) {
    if (model.startsWith(prefix)) return size
  }
  return DEFAULT_CONTEXT_WINDOW
}

const DEFAULT_COMPACTION_MODELS: Record<string, string> = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4o-mini',
  google: 'gemini-2.0-flash',
  ollama: '',
  bedrock: 'anthropic.claude-haiku-4-5-20251001',
  azure: 'gpt-4o-mini',
}

export function getDefaultCompactionModel(provider: string): string {
  return DEFAULT_COMPACTION_MODELS[provider] ?? ''
}
