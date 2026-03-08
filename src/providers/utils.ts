import type { IMessage } from './types'

/** Token budgets for extended thinking (Anthropic/Bedrock). Google uses different values. */
export const THINKING_BUDGETS = { low: 1000, medium: 8000, high: 32000 } as const

/** Safely parse tool call arguments JSON, defaulting to empty object. */
export function parseToolArgs(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw || '{}') } catch { return {} }
}

export function extractSystemMessages(messages: IMessage[]): { system: string | undefined; filtered: IMessage[] } {
  const systemParts: string[] = []
  const filtered: IMessage[] = []

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemParts.push(typeof msg.content === 'string'
        ? msg.content
        : msg.content.filter(p => p.type === 'text').map(p => (p as { type: 'text'; text: string }).text).join(''))
    } else {
      filtered.push(msg)
    }
  }

  return {
    system: systemParts.length > 0 ? systemParts.join('\n') : undefined,
    filtered,
  }
}
