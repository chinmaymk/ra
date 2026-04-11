import type { Message, ToolCall, ContentPart } from './types'

export interface ResolvedMessage {
  role: 'user' | 'assistant'
  content: string | ContentPart[]
  thinking?: string
  toolCalls?: ToolCall[]
  isStreaming?: boolean
}

/**
 * Takes a raw Message[] (as returned by the API) and produces a resolved list where:
 * - system and tool messages are removed from the output
 * - tool results (role='tool') are paired back onto their corresponding
 *   assistant tool calls by matching toolCallId → tc.id
 * - if a tool call already has a result (e.g. from streaming flush), it's kept as-is
 */
export function resolveMessages(messages: Message[]): ResolvedMessage[] {
  // Index tool-result messages by their toolCallId
  const toolResults = new Map<string, { content: string; isError?: boolean }>()
  for (const msg of messages) {
    if (msg.role === 'tool' && msg.toolCallId) {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
      toolResults.set(msg.toolCallId, { content, isError: msg.isError })
    }
  }

  const resolved: ResolvedMessage[] = []

  for (const msg of messages) {
    if (msg.role === 'system' || msg.role === 'tool') continue

    if (msg.role === 'user') {
      resolved.push({ role: 'user', content: msg.content })
      continue
    }

    // Assistant message — pair tool results
    const toolCalls = msg.toolCalls?.map((tc): ToolCall => {
      // Already has a result (came from streaming flush) — keep it
      if (tc.result !== undefined) return tc
      const result = toolResults.get(tc.id)
      if (result) {
        return { ...tc, result: result.content, isError: result.isError }
      }
      return tc
    })

    resolved.push({
      role: 'assistant',
      content: msg.content,
      thinking: msg.thinking,
      toolCalls,
    })
  }

  return resolved
}
