import type { IMessage } from '../providers/types'

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
