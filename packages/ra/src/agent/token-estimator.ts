import type { IMessage, ITool } from '../providers/types'

export function estimateTokens(messages: IMessage[]): number {
  let total = 0
  for (const m of messages) {
    const content = typeof m.content === 'string'
      ? m.content
      : JSON.stringify(m.content)
    const toolCalls = m.toolCalls ? JSON.stringify(m.toolCalls) : ''
    total += Math.ceil((content.length + toolCalls.length) / 4)
  }
  return total
}

/** Estimate tokens for a raw string (chars / 4, rounded up). */
export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** Estimate tokens for tool definitions (name + description + JSON schema). */
export function estimateToolTokens(tools: ITool[]): number {
  let total = 0
  for (const t of tools) {
    total += estimateTextTokens(t.name)
    total += estimateTextTokens(t.description)
    total += estimateTextTokens(JSON.stringify(t.inputSchema))
  }
  return total
}
