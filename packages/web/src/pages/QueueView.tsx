import { useEffect, useRef, useState } from 'react'
import type { SessionInfo } from '@/lib/types'
import { useSession } from '@/hooks/useSession'
import { ConversationThread } from '@/components/session/ConversationThread'
import { ChatComposer } from '@/components/ChatComposer'
import { StatusBadge, StatusDot } from '@/components/StatusDot'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { SkipForward, Eye, GitBranch, Inbox } from 'lucide-react'
import { formatTokens } from '@/lib/utils'

interface QueueViewProps {
  session: SessionInfo
  queuePosition: number
  queueTotal: number
  onSkip: () => void
  onInspect: (id: string) => void
  onAdvance: () => void
}

export function QueueView({ session, queuePosition, queueTotal, onSkip, onInspect, onAdvance }: QueueViewProps) {
  const { info, messages, streaming, send, stop } = useSession(session.id)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [advanced, setAdvanced] = useState(false)
  const current = info ?? session

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages.length, streaming.text.length, streaming.toolCalls.size])

  useEffect(() => {
    if (current.status === 'running') {
      setAdvanced(true)
      onAdvance()
    }
  }, [current.status, onAdvance])

  const totalTokens = current.tokenUsage.inputTokens + current.tokenUsage.outputTokens

  return (
    <TooltipProvider>
      <div className="flex flex-col h-full">
        {/* Queue progress bar */}
        <div className="px-6 pt-3 pb-3 border-b border-border bg-gradient-to-b from-status-waiting/5 to-transparent">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-status-waiting/10 border border-status-waiting/20">
                <Inbox className="h-3 w-3 text-status-waiting" />
              </div>
              <span className="text-[0.9375rem] font-semibold text-status-waiting">Queue mode</span>
              <span className="text-[0.8125rem] text-muted-foreground">
                Process waiting agents one by one
              </span>
            </div>
            <div className="text-[0.8125rem] text-muted-foreground mono">
              <span className="text-foreground tabular font-semibold">{queuePosition}</span>
              <span className="opacity-50"> / {queueTotal}</span>
            </div>
          </div>
          <div className="h-1 rounded-full bg-surface-2 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-status-waiting to-status-waiting/60 transition-all duration-500"
              style={{ width: `${(queuePosition / queueTotal) * 100}%` }}
            />
          </div>
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 h-12 border-b border-border glass-strong">
          <div className="flex items-center gap-3 min-w-0">
            <StatusDot status={current.status} size="md" />
            <span className="font-semibold text-sm truncate">{current.name}</span>
            <Badge variant="outline" className="mono normal-case tracking-normal">{current.model}</Badge>
            {current.worktree && (
              <Badge variant="success" className="gap-1 normal-case tracking-normal">
                <GitBranch className="h-2.5 w-2.5" />
                {current.worktree.branch.replace(/^ra\//, '')}
              </Badge>
            )}
            <StatusBadge status={current.status} />
          </div>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onInspect(session.id)}
                  className="flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[0.875rem] font-medium text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
                >
                  <Eye className="h-3 w-3" />
                  Inspect
                </button>
              </TooltipTrigger>
              <TooltipContent>Open full conversation</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onSkip}
                  className="flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[0.875rem] font-medium text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
                >
                  <SkipForward className="h-3 w-3" />
                  Skip
                </button>
              </TooltipTrigger>
              <TooltipContent>Skip to next <kbd>Tab</kbd></TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Recent context preview */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto py-2">
          {messages.length === 0 && !streaming.isStreaming && (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              No messages yet
            </div>
          )}
          <ConversationThread messages={messages} streaming={streaming} compact tail={4} />
        </div>

        {/* Stats footer */}
        <div className="flex items-center gap-3 px-5 h-7 text-[0.8125rem] text-dim-foreground border-t border-border bg-surface-0/40 mono">
          <span>iter <span className="text-muted-foreground tabular">{current.iteration}</span></span>
          <span className="opacity-30">·</span>
          <span><span className="text-muted-foreground tabular">{formatTokens(totalTokens)}</span> tokens</span>
          {current.currentTool && (
            <>
              <span className="opacity-30">·</span>
              <span className="text-warning">{current.currentTool}</span>
            </>
          )}
        </div>

        {/* Advance notice */}
        {advanced && (
          <div className="px-5 py-1.5 text-[0.9375rem] text-muted-foreground text-center fade-in">
            ✨ Session resumed — switching to full view...
          </div>
        )}

        {/* Composer */}
        <ChatComposer
          onSubmit={(msg) => send(msg)}
          placeholder="Reply and the next waiting agent appears..."
          disabled={current.status === 'running'}
          running={current.status === 'running'}
          onStop={stop}
          autoFocus
        />
      </div>
    </TooltipProvider>
  )
}
