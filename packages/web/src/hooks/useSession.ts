import { useState, useEffect, useCallback, useRef } from 'react'
import type { SessionInfo, SessionEvent, Message, ToolCall, ImageAttachment, CreateSessionOptions } from '@/lib/types'
import { api } from '@/lib/api'

interface StreamingState {
  text: string
  thinking: string
  toolCalls: Map<string, ToolCall>
  isStreaming: boolean
}

export function useSession(sessionId: string | null) {
  const [info, setInfo] = useState<SessionInfo | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [streaming, setStreaming] = useState<StreamingState>({
    text: '',
    thinking: '',
    toolCalls: new Map(),
    isStreaming: false,
  })
  const eventSourceRef = useRef<EventSource | null>(null)

  // Load session info and messages
  useEffect(() => {
    // Reset all per-session state whenever the sessionId changes, so streaming
    // content from a previous session never leaks into the new one.
    setInfo(null)
    setMessages([])
    setStreaming({ text: '', thinking: '', toolCalls: new Map(), isStreaming: false })

    if (!sessionId) return

    let cancelled = false
    const load = async () => {
      try {
        const [sessionInfo, sessionMessages] = await Promise.all([
          api.sessions.get(sessionId),
          api.sessions.messages(sessionId),
        ])
        if (cancelled) return
        setInfo(sessionInfo)
        setMessages(sessionMessages)
        // Auto-subscribe for sessions that are still active
        if (sessionInfo.status !== 'done') {
          subscribe(sessionId)
        }
      } catch {
        // Session may not exist yet
      }
    }
    load()
    return () => {
      cancelled = true
      closeEventSource()
    }
  }, [sessionId])

  const closeEventSource = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
  }, [])

  const subscribe = useCallback((id: string) => {
    // Don't open duplicate connections
    if (eventSourceRef.current) return

    const es = api.subscribe(id)
    eventSourceRef.current = es

    es.onmessage = (event) => {
      const data = JSON.parse(event.data) as SessionEvent

      switch (data.type) {
        case 'text':
          setStreaming(prev => ({
            ...prev,
            text: prev.text + data.delta,
            isStreaming: true,
          }))
          break

        case 'thinking':
          setStreaming(prev => ({
            ...prev,
            thinking: prev.thinking + data.delta,
            isStreaming: true,
          }))
          break

        case 'tool_call_start':
          setStreaming(prev => {
            const next = new Map(prev.toolCalls)
            next.set(data.id, { id: data.id, name: data.name, arguments: '' })
            return { ...prev, toolCalls: next, isStreaming: true }
          })
          break

        case 'tool_call_delta':
          setStreaming(prev => {
            const next = new Map(prev.toolCalls)
            const tc = next.get(data.id)
            if (tc) next.set(data.id, { ...tc, arguments: tc.arguments + data.argsDelta })
            return { ...prev, toolCalls: next }
          })
          break

        case 'tool_call_end':
          // Tool call args complete — no state change needed
          break

        case 'tool_result':
          setStreaming(prev => {
            const next = new Map(prev.toolCalls)
            const tc = next.get(data.toolCallId)
            if (tc) next.set(data.toolCallId, { ...tc, result: data.content, isError: data.isError })
            return { ...prev, toolCalls: next }
          })
          break

        case 'status':
          setInfo(prev => prev ? { ...prev, status: data.status, name: data.name ?? prev.name } : prev)
          if (data.status === 'needs-input' || data.status === 'done' || data.status === 'error') {
            // Flush streaming state into messages and reload
            flushStreaming()
          }
          break

        case 'stats':
          setInfo(prev => prev ? {
            ...prev,
            iteration: data.iteration,
            tokenUsage: data.usage,
            currentTool: data.currentTool,
          } : prev)
          break

        case 'snapshot':
          // Server-replayed in-progress turn — restores streaming state for
          // clients that reconnected mid-stream (e.g. navigated away and back).
          setStreaming({
            text: data.text,
            thinking: data.thinking,
            toolCalls: new Map(data.toolCalls.map(tc => [tc.id, tc])),
            isStreaming: true,
          })
          break

        case 'done':
          setStreaming(prev => ({ ...prev, isStreaming: false }))
          // Reload messages to get the final state
          api.sessions.messages(id).then(setMessages).catch(() => {})
          break

        case 'error':
          setInfo(prev => prev ? { ...prev, status: 'error', errorMessage: data.error } : prev)
          setStreaming(prev => ({ ...prev, isStreaming: false }))
          break
      }
    }

    es.onerror = () => {
      // EventSource auto-reconnects, but mark as not streaming
      setStreaming(prev => ({ ...prev, isStreaming: false }))
    }
  }, [])

  const flushStreaming = useCallback(() => {
    setStreaming(prev => {
      if (!prev.text && prev.toolCalls.size === 0) return prev
      // Build the assistant message from accumulated streaming state
      const assistantMsg: Message = {
        role: 'assistant',
        content: prev.text,
        thinking: prev.thinking || undefined,
        toolCalls: prev.toolCalls.size > 0 ? Array.from(prev.toolCalls.values()) : undefined,
      }
      setMessages(msgs => [...msgs, assistantMsg])
      return { text: '', thinking: '', toolCalls: new Map(), isStreaming: false }
    })
  }, [])

  const send = useCallback(async (message: string, options?: CreateSessionOptions) => {
    if (!sessionId) return
    const attachments: ImageAttachment[] | undefined = options?.attachments
    // Optimistically add user message
    setMessages(prev => [...prev, { role: 'user', content: message }])
    setStreaming({ text: '', thinking: '', toolCalls: new Map(), isStreaming: true })
    // Ensure SSE is connected before sending (may have been skipped for done sessions)
    subscribe(sessionId)
    await api.sessions.send(sessionId, message, attachments)
  }, [sessionId, subscribe])

  const stop = useCallback(async () => {
    if (!sessionId) return
    await api.sessions.stop(sessionId)
  }, [sessionId])

  const markDone = useCallback(async () => {
    if (!sessionId) return
    await api.sessions.markDone(sessionId)
  }, [sessionId])

  return { info, messages, streaming, send, stop, markDone }
}
