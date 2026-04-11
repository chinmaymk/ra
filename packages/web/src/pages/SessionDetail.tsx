import { useEffect, useRef, useState } from 'react'
import { useSession } from '@/hooks/useSession'
import { ConversationThread } from '@/components/session/ConversationThread'
import { SessionSidebar } from '@/components/session/SessionSidebar'
import { ChatComposer } from '@/components/ChatComposer'
import { StatusBadge, StatusDot } from '@/components/StatusDot'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ArrowLeft, Square, GitBranch, PanelRightClose, PanelRightOpen, Activity } from '@/components/icons'
import { formatTokens } from '@/lib/utils'

interface SessionDetailProps {
  sessionId: string
  onBack: () => void
}

export function SessionDetail({ sessionId, onBack }: SessionDetailProps) {
  const { info, messages, streaming, send, stop } = useSession(sessionId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages.length, streaming.text.length, streaming.toolCalls.size])

  if (!info) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3 text-muted-foreground text-sm">
          <div className="h-8 w-8 rounded-full border-2 border-border border-t-primary animate-spin" />
          <span>Loading session...</span>
        </div>
      </div>
    )
  }

  const totalTokens = info.tokenUsage.inputTokens + info.tokenUsage.outputTokens
  const cachePercent = info.tokenUsage.inputTokens > 0
    ? Math.round((info.tokenUsage.cacheReadTokens / info.tokenUsage.inputTokens) * 100)
    : 0

  const hasContent = messages.some(m => m.role === 'user' || m.role === 'assistant')

  return (
    <TooltipProvider>
      <div className="flex h-full">
        {/* ─── Main chat ─────────────────────────────────────────── */}
        <div className="flex flex-col flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center justify-between px-5 h-11 border-b border-border glass-strong">
            <div className="flex items-center gap-2.5 min-w-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onBack}
                    className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Back to agents <kbd>Esc</kbd></TooltipContent>
              </Tooltip>
              <StatusDot status={info.status} size="md" />
              <span className="font-semibold text-sm truncate">{info.name}</span>
              <Badge variant="outline" className="mono normal-case tracking-normal">{info.model}</Badge>
              {info.worktree && (
                <Badge variant="success" className="gap-1 normal-case tracking-normal">
                  <GitBranch className="h-2.5 w-2.5" />
                  {info.worktree.branch.replace(/^ra\//, '')}
                </Badge>
              )}
              <StatusBadge status={info.status} />
            </div>
            <div className="flex items-center gap-1">
              {info.status === 'running' && (
                <button
                  onClick={stop}
                  className="flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[11px] font-medium bg-warning/10 text-warning border border-warning/25 hover:bg-warning/15 transition-colors"
                >
                  <Square className="h-2.5 w-2.5 fill-current" />
                  Stop
                </button>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setSidebarOpen(!sidebarOpen)}
                    className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
                  >
                    {sidebarOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            {!hasContent && !streaming.isStreaming ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm text-center px-8">
                <div className="h-10 w-10 rounded-xl bg-surface-1 border border-border flex items-center justify-center mb-3">
                  <Activity className="h-5 w-5 text-dim-foreground" />
                </div>
                <p>No messages yet</p>
                <p className="text-xs text-dim-foreground mt-1">Send a message below to start the conversation</p>
              </div>
            ) : (
              <div className="py-2">
                <ConversationThread messages={messages} streaming={streaming} />
              </div>
            )}
          </div>

          {/* Stats footer */}
          <StatsFooter info={info} totalTokens={totalTokens} cachePercent={cachePercent} />

          {/* Composer */}
          <ChatComposer
            onSubmit={send}
            placeholder={info.status === 'running' ? 'Agent is working...' : 'Send a message...'}
            disabled={info.status === 'running'}
            running={info.status === 'running'}
            onStop={stop}
            autoFocus={info.status === 'needs-input'}
          />
        </div>

        {/* ─── Sidebar ───────────────────────────────────────────── */}
        {sidebarOpen && <SessionSidebar info={info} />}
      </div>
    </TooltipProvider>
  )
}

function StatsFooter({ info, totalTokens, cachePercent }: { info: { iteration: number; tokenUsage: { thinkingTokens: number }; currentTool?: string; status: string; errorMessage?: string }; totalTokens: number; cachePercent: number }) {
  return (
    <div className="flex items-center gap-3 px-5 h-7 text-[10.5px] text-dim-foreground border-t border-border bg-surface-0/40 mono">
      <span>iter <span className="text-muted-foreground tabular">{info.iteration}</span></span>
      <span className="opacity-30">·</span>
      <span><span className="text-muted-foreground tabular">{formatTokens(totalTokens)}</span> tokens</span>
      {cachePercent > 0 && (
        <>
          <span className="opacity-30">·</span>
          <span>cache <span className="text-muted-foreground tabular">{cachePercent}%</span></span>
        </>
      )}
      {info.tokenUsage.thinkingTokens > 0 && (
        <>
          <span className="opacity-30">·</span>
          <span><span className="text-purple tabular">{formatTokens(info.tokenUsage.thinkingTokens)}</span> thinking</span>
        </>
      )}
      {info.currentTool && info.status === 'running' && (
        <>
          <span className="opacity-30">·</span>
          <span className="text-warning">{info.currentTool}</span>
        </>
      )}
      {info.errorMessage && (
        <>
          <span className="opacity-30">·</span>
          <span className="text-destructive truncate max-w-xs">{info.errorMessage}</span>
        </>
      )}
    </div>
  )
}
