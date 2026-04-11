import { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from '@/hooks/useSession'
import { useWebPanels } from '@/hooks/useWebPanels'
import { ConversationThread } from '@/components/session/ConversationThread'
import { SessionSidebar } from '@/components/session/SessionSidebar'
import { ChatComposer } from '@/components/ChatComposer'
import { StatusBadge, StatusDot } from '@/components/StatusDot'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ArrowLeft, ArrowUp, Square, GitBranch, PanelRightClose, PanelRightOpen, Activity, CheckCircle2 } from '@/components/icons'
import type { SessionInfo } from '@/lib/types'
import { cn, formatTokens } from '@/lib/utils'

interface SessionDetailProps {
  sessionId: string
  onBack: () => void
}

export function SessionDetail({ sessionId, onBack }: SessionDetailProps) {
  const { info, messages, streaming, send, stop, markDone } = useSession(sessionId)
  const webPanels = useWebPanels()
  const scrollRef = useRef<HTMLDivElement>(null)
  const didInitialScrollRef = useRef(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [showScrollUp, setShowScrollUp] = useState(false)

  const hasContent = messages.some(m => m.role === 'user' || m.role === 'assistant')

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    // On first render with content, pin instantly to the bottom so the
    // user lands on the latest message without a jarring scroll animation.
    if (!didInitialScrollRef.current && hasContent) {
      el.scrollTop = el.scrollHeight
      didInitialScrollRef.current = true
      setShowScrollUp(el.scrollTop > 40)
      return
    }

    // Subsequent updates: only auto-scroll if the reader is already near
    // the bottom, so we don't yank them away from content they're reading.
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distance < 240) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    }
  }, [hasContent, messages.length, streaming.text.length, streaming.toolCalls.size])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setShowScrollUp(el.scrollTop > 40)
  }, [])

  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

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
  const cacheRead = info.tokenUsage.cacheReadTokens ?? 0
  const cachePercent = info.tokenUsage.inputTokens > 0
    ? Math.round((cacheRead / info.tokenUsage.inputTokens) * 100)
    : 0

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
              {info.status === 'running' ? (
                <button
                  onClick={stop}
                  className="flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[0.875rem] font-medium bg-warning/10 text-warning border border-warning/25 hover:bg-warning/15 transition-colors"
                >
                  <Square className="h-2.5 w-2.5 fill-current" />
                  Stop
                </button>
              ) : info.status !== 'done' && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={markDone}
                      className="flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[0.875rem] font-medium bg-success/10 text-success border border-success/25 hover:bg-success/15 transition-colors"
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      Mark done
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Archive this session — you can still reopen it from history</TooltipContent>
                </Tooltip>
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
          <div className="relative flex-1 min-h-0">
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="absolute inset-0 overflow-y-auto"
            >
              {!hasContent && !streaming.isStreaming ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm text-center px-8">
                  <div className="h-10 w-10 rounded-xl bg-surface-1 border border-border flex items-center justify-center mb-3">
                    <Activity className="h-5 w-5 text-dim-foreground" />
                  </div>
                  <p>No messages yet</p>
                  <p className="text-[0.9375rem] text-dim-foreground mt-1">Send a message below to start the conversation</p>
                </div>
              ) : (
                <div className="py-2">
                  <ConversationThread messages={messages} streaming={streaming} />
                </div>
              )}
            </div>

            {/* Scroll-to-top affordance — lands at bottom by default,
                so this lets the reader reach earlier messages. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={scrollToTop}
                  aria-label="Scroll to top"
                  className={cn(
                    'absolute bottom-4 right-4 h-9 w-9 rounded-full border border-border-strong bg-surface-2/90 backdrop-blur-md text-muted-foreground shadow-lg flex items-center justify-center hover:text-foreground hover:bg-surface-3 hover:border-border-bright transition-all',
                    showScrollUp
                      ? 'opacity-100 translate-y-0 pointer-events-auto'
                      : 'opacity-0 translate-y-2 pointer-events-none',
                  )}
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">Scroll to top</TooltipContent>
            </Tooltip>
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
        {sidebarOpen && (
          <SessionSidebar
            info={info}
            sessionId={sessionId}
            webPanels={webPanels}
            onSendFeedback={send}
          />
        )}
      </div>
    </TooltipProvider>
  )
}

const Sep = () => <span className="opacity-30">·</span>
const Num = ({ children }: { children: React.ReactNode }) => (
  <span className="text-muted-foreground tabular">{children}</span>
)

function StatsFooter({ info, totalTokens, cachePercent }: { info: SessionInfo; totalTokens: number; cachePercent: number }) {
  const { thinkingTokens } = info.tokenUsage
  return (
    <div className="flex items-center gap-3 px-5 h-7 text-[10.5px] text-dim-foreground border-t border-border bg-surface-0/40 mono">
      <span>iter <Num>{info.iteration}</Num></span>
      <Sep />
      <span><Num>{formatTokens(totalTokens)}</Num> tokens</span>
      {cachePercent > 0 && <><Sep /><span>cache <Num>{cachePercent}%</Num></span></>}
      {thinkingTokens > 0 && <><Sep /><span><span className="text-purple tabular">{formatTokens(thinkingTokens)}</span> thinking</span></>}
      {info.currentTool && info.status === 'running' && <><Sep /><span className="text-warning">{info.currentTool}</span></>}
      {info.errorMessage && <><Sep /><span className="text-destructive truncate max-w-xs">{info.errorMessage}</span></>}
    </div>
  )
}
