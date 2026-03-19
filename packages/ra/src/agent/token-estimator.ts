import type { IMessage, ITool } from '../providers/types'

/**
 * Estimate token count using a chars/4 heuristic.
 *
 * Accepts a string, an array of messages, or an array of tool definitions.
 */
export function estimateTokens(input: string | IMessage[] | ITool[]): number {
  if (typeof input === 'string') {
    return Math.ceil(input.length / 4)
  }
  if (input.length === 0) return 0

  // Distinguish ITool[] vs IMessage[] by checking for 'inputSchema'
  if ('inputSchema' in input[0]!) {
    return estimateToolArrayTokens(input as ITool[])
  }
  return estimateMessageArrayTokens(input as IMessage[])
}

function estimateMessageArrayTokens(messages: IMessage[]): number {
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

function estimateToolArrayTokens(tools: ITool[]): number {
  let total = 0
  for (const t of tools) {
    total += estimateTokens(t.name)
    total += estimateTokens(t.description)
    total += estimateTokens(JSON.stringify(t.inputSchema))
  }
  return total
}
