import { useMemo } from 'react'
import type { Message, ToolCall } from '@/lib/types'
import { resolveMessages, type ResolvedMessage } from '@/lib/resolveMessages'
import { ConversationMessage } from './ConversationMessage'

interface StreamingState {
  text: string
  thinking: string
  toolCalls: Map<string, ToolCall>
  isStreaming: boolean
}

interface ConversationThreadProps {
  messages: Message[]
  streaming: StreamingState
  compact?: boolean
  /** When set, only show the last N resolved messages (useful for queue preview) */
  tail?: number
}

export function ConversationThread({ messages, streaming, compact = false, tail }: ConversationThreadProps) {
  const resolved = useMemo(() => resolveMessages(messages), [messages])

  const visible = tail ? resolved.slice(-tail) : resolved

  // Convert streaming state to a ResolvedMessage if there's anything to show
  const streamingMessage = useMemo((): ResolvedMessage | null => {
    if (!streaming.text && !streaming.thinking && streaming.toolCalls.size === 0 && !streaming.isStreaming) {
      return null
    }
    return {
      role: 'assistant',
      content: streaming.text,
      thinking: streaming.thinking || undefined,
      toolCalls: streaming.toolCalls.size > 0 ? Array.from(streaming.toolCalls.values()) : undefined,
      isStreaming: true,
    }
  }, [streaming.text, streaming.thinking, streaming.toolCalls, streaming.isStreaming])

  return (
    <>
      {visible.map((msg, i) => (
        <ConversationMessage key={i} message={msg} compact={compact} />
      ))}
      {streamingMessage && (
        <ConversationMessage message={streamingMessage} compact={compact} />
      )}
    </>
  )
}
