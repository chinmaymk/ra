import { useState, useEffect, useMemo } from 'react'
import type { SessionInfo, CreateSessionOptions, ProviderInfo } from '@/lib/types'
import { ChatComposer } from '@/components/ChatComposer'
import { StatusDot } from '@/components/StatusDot'
import { TooltipProvider } from '@/components/ui/tooltip'
import { timeAgo, formatTokens, cn } from '@/lib/utils'
import {
  Sparkles, ArrowRight, AlertCircle, AlertTriangle, CheckCircle2, Square, Trash2,
} from 'lucide-react'
import { api } from '@/lib/api'

interface AgentsViewProps {
  sessions: SessionInfo[]
  onNewSession: (message: string, options?: CreateSessionOptions) => void
  onInspect: (id: string) => void
  onStop: (id: string) => void
  onDelete: (id: string) => void
  onProcessQueue: () => void
}

/** USD cost for a session based on provider pricing. */
function sessionCost(session: SessionInfo, providers: ProviderInfo[]): number {
  for (const p of providers) {
    const model = p.models.find(m => m.name === session.model)
    if (model?.inputTokenCostPer1M != null && model?.outputTokenCostPer1M != null) {
      return (
        (session.tokenUsage.inputTokens / 1_000_000) * model.inputTokenCostPer1M +
        (session.tokenUsage.outputTokens / 1_000_000) * model.outputTokenCostPer1M
      )
    }
  }
  return 0
}

function formatCost(usd: number): string {
  if (usd === 0) return '$0'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Working late'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export function AgentsView({
  sessions, onNewSession, onInspect, onStop, onDelete, onProcessQueue,
}: AgentsViewProps) {
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [currentConfig, setCurrentConfig] = useState<{ provider: string; model: string } | null>(null)

  useEffect(() => {
    api.providers.list().then(setProviders).catch(() => {})
    api.config.get().then(c => setCurrentConfig({ provider: c.provider, model: c.model })).catch(() => {})
  }, [])

  const { needsInput, running, errors } = useMemo(() => ({
    needsInput: sessions.filter(s => s.status === 'needs-input'),
    running: sessions.filter(s => s.status === 'running'),
    errors: sessions.filter(s => s.status === 'error'),
  }), [sessions])

  const totals = useMemo(() => {
    const tokens = sessions.reduce((sum, s) => sum + s.tokenUsage.inputTokens + s.tokenUsage.outputTokens, 0)
    const cost = sessions.reduce((sum, s) => sum + sessionCost(s, providers), 0)
    return { tokens, cost }
  }, [sessions, providers])

  const isCalm = needsInput.length === 0 && running.length === 0 && errors.length === 0

  return (
    <TooltipProvider>
      <div className="flex flex-col h-full">
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-8 py-10">
            {sessions.length === 0 ? (
              <EmptyState />
            ) : (
              <>
                {/* ── Hero: greeting + one-line summary ─────────────── */}
                <header className="mb-10 fade-in">
                  <h1 className="text-[1.875rem] font-semibold tracking-tight leading-tight mb-2">
                    {greeting()}
                  </h1>
                  <p className="text-[1rem] text-muted-foreground tabular">
                    {sessions.length} session{sessions.length > 1 ? 's' : ''}
                    {running.length > 0 && (
                      <>
                        <Dot />
                        <span className="text-status-running inline-flex items-center gap-1.5">
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="absolute inline-flex h-full w-full rounded-full bg-status-running pulse-ring" />
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-status-running" />
                          </span>
                          {running.length} running
                        </span>
                      </>
                    )}
                    {totals.tokens > 0 && <><Dot /><span className="mono">{formatTokens(totals.tokens)}</span> tokens</>}
                    {totals.cost > 0 && <><Dot /><span className="mono">{formatCost(totals.cost)}</span></>}
                  </p>
                </header>

                {/* ── Needs your input ──────────────────────────────── */}
                {needsInput.length > 0 && (
                  <Section
                    icon={<AlertCircle className="h-3.5 w-3.5" />}
                    title="Needs your input"
                    count={needsInput.length}
                    accent="status-waiting"
                    action={needsInput.length > 1 && (
                      <button
                        onClick={onProcessQueue}
                        className="flex items-center gap-1.5 text-[0.875rem] font-medium text-status-waiting hover:underline"
                      >
                        Process all
                        <kbd>⌘I</kbd>
                      </button>
                    )}
                  >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {needsInput.slice(0, 4).map(s => (
                        <PriorityCard key={s.id} session={s} onInspect={onInspect} />
                      ))}
                    </div>
                    {needsInput.length > 4 && (
                      <p className="text-[0.875rem] text-dim-foreground mt-2.5 px-1">
                        +{needsInput.length - 4} more in sidebar
                      </p>
                    )}
                  </Section>
                )}

                {/* ── Live activity ────────────────────────────────── */}
                {running.length > 0 && (
                  <Section
                    icon={
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full rounded-full bg-status-running pulse-ring" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-status-running" />
                      </span>
                    }
                    title="Live"
                    count={running.length}
                    accent="status-running"
                  >
                    <div className="space-y-1">
                      {running.map(s => (
                        <LiveRow key={s.id} session={s} onInspect={onInspect} onStop={onStop} />
                      ))}
                    </div>
                  </Section>
                )}

                {/* ── Errors ────────────────────────────────────────── */}
                {errors.length > 0 && (
                  <Section
                    icon={<AlertTriangle className="h-3.5 w-3.5" />}
                    title="Failed"
                    count={errors.length}
                    accent="status-error"
                  >
                    <div className="space-y-1">
                      {errors.slice(0, 3).map(s => (
                        <ErrorRow key={s.id} session={s} onInspect={onInspect} onDelete={onDelete} />
                      ))}
                    </div>
                    {errors.length > 3 && (
                      <p className="text-[0.875rem] text-dim-foreground mt-2.5 px-1">
                        +{errors.length - 3} more in sidebar
                      </p>
                    )}
                  </Section>
                )}

                {/* ── Calm state ────────────────────────────────────── */}
                {isCalm && (
                  <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-border bg-surface-1/40 fade-in">
                    <CheckCircle2 className="h-4 w-4 text-status-done shrink-0" />
                    <div className="text-[13.5px] text-muted-foreground leading-relaxed">
                      All caught up. Start another task below, or pick a session from the sidebar to review.
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <ChatComposer
          onSubmit={onNewSession}
          placeholder={sessions.length === 0 ? 'What should the agent do?' : 'Start another agent...'}
          showOptions
          providers={providers}
          currentProvider={currentConfig?.provider}
          currentModel={currentConfig?.model}
          autoFocus
        />
      </div>
    </TooltipProvider>
  )
}

/* ─── Dot separator ──────────────────────────────────────────────── */
function Dot() {
  return <span className="mx-2 opacity-30">·</span>
}

/* ─── Section wrapper ────────────────────────────────────────────── */
type SectionAccent = 'status-waiting' | 'status-running' | 'status-error'

const ACCENT_TEXT: Record<SectionAccent, string> = {
  'status-waiting': 'text-status-waiting',
  'status-running': 'text-status-running',
  'status-error':   'text-status-error',
}

function Section({
  icon, title, count, accent, action, children,
}: {
  icon: React.ReactNode
  title: string
  count: number
  accent: SectionAccent
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="mb-8 fade-in">
      <div className="flex items-center justify-between mb-3 px-0.5">
        <div className={cn('flex items-center gap-2 text-[0.8125rem] uppercase tracking-[0.12em] font-semibold', ACCENT_TEXT[accent])}>
          {icon}
          <span>{title}</span>
          <span className="opacity-50 tabular">{count}</span>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

/* ─── Priority card (needs-input) ────────────────────────────────── */
function PriorityCard({
  session: s, onInspect,
}: {
  session: SessionInfo
  onInspect: (id: string) => void
}) {
  return (
    <button
      onClick={() => onInspect(s.id)}
      className="group relative text-left overflow-hidden rounded-xl border border-status-waiting/30 bg-status-waiting/[0.04] p-4 transition-all hover:bg-status-waiting/10 hover:border-status-waiting/50 hover:-translate-y-px"
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="font-semibold text-[1rem] truncate">{s.name}</span>
        <ArrowRight className="h-3.5 w-3.5 text-status-waiting shrink-0 opacity-70 group-hover:translate-x-0.5 transition-transform" />
      </div>
      {s.lastAssistantMessage && (
        <p className="text-[0.9375rem] text-muted-foreground line-clamp-2 leading-relaxed mb-2">
          {s.lastAssistantMessage}
        </p>
      )}
      <div className="text-[0.8125rem] text-dim-foreground mono">
        {timeAgo(s.createdAt)}
        {s.iteration > 0 && <> · iter {s.iteration}</>}
      </div>
    </button>
  )
}

/* ─── Live row (running) ─────────────────────────────────────────── */
function LiveRow({
  session: s, onInspect, onStop,
}: {
  session: SessionInfo
  onInspect: (id: string) => void
  onStop: (id: string) => void
}) {
  return (
    <div
      onClick={() => onInspect(s.id)}
      className="group flex items-center gap-3 px-3.5 py-2.5 rounded-lg border border-status-running/20 bg-status-running/[0.03] cursor-pointer hover:bg-status-running/[0.08] hover:border-status-running/35 transition-colors"
    >
      <StatusDot status="running" size="sm" animated />
      <span className="text-[1rem] font-medium truncate flex-1 min-w-0">{s.name}</span>
      {s.currentTool && (
        <span className="text-[10.5px] mono text-status-running bg-status-running/10 px-2 py-0.5 rounded truncate max-w-[160px]">
          {s.currentTool}
        </span>
      )}
      <span className="text-[0.8125rem] text-dim-foreground mono hidden sm:inline tabular">iter {s.iteration}</span>
      <button
        onClick={(e) => { e.stopPropagation(); onStop(s.id) }}
        className="opacity-0 group-hover:opacity-100 p-1 rounded text-dim-foreground hover:text-status-error transition-all"
        aria-label="Stop"
      >
        <Square className="h-3 w-3" />
      </button>
    </div>
  )
}

/* ─── Error row ──────────────────────────────────────────────────── */
function ErrorRow({
  session: s, onInspect, onDelete,
}: {
  session: SessionInfo
  onInspect: (id: string) => void
  onDelete: (id: string) => void
}) {
  return (
    <div
      onClick={() => onInspect(s.id)}
      className="group flex items-center gap-3 px-3.5 py-2.5 rounded-lg border border-status-error/20 bg-status-error/[0.03] cursor-pointer hover:bg-status-error/[0.08] hover:border-status-error/35 transition-colors"
    >
      <StatusDot status="error" size="sm" />
      <div className="flex-1 min-w-0">
        <div className="text-[1rem] font-medium truncate">{s.name}</div>
        {s.lastAssistantMessage && (
          <div className="text-[0.875rem] text-muted-foreground/80 truncate mt-0.5">
            {s.lastAssistantMessage}
          </div>
        )}
      </div>
      <span className="text-[0.8125rem] text-dim-foreground mono shrink-0">{timeAgo(s.createdAt)}</span>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(s.id) }}
        className="opacity-0 group-hover:opacity-100 p-1 rounded text-dim-foreground hover:text-status-error transition-all"
        aria-label="Delete"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  )
}

/* ─── Empty state ────────────────────────────────────────────────── */
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center fade-in">
      <div className="relative mb-8">
        <div className="absolute inset-0 bg-primary/10 blur-3xl rounded-full" />
        <div className="relative h-20 w-20 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center float">
          <Sparkles className="h-9 w-9 text-primary" />
        </div>
      </div>
      <h2 className="text-xl font-semibold mb-2 tracking-tight">No agents yet</h2>
      <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
        Describe a task below and ra will spin up an agent. Each session can run in
        its own git worktree for safe parallel work.
      </p>
      <div className="mt-10 flex flex-wrap items-center justify-center gap-4 text-[0.9375rem] text-dim-foreground">
        <div className="flex items-center gap-2">
          <kbd>⌘K</kbd>
          <span>command palette</span>
        </div>
        <div className="opacity-30">·</div>
        <div className="flex items-center gap-2">
          <kbd>⌘,</kbd>
          <span>config</span>
        </div>
        <div className="opacity-30">·</div>
        <div className="flex items-center gap-2">
          <kbd>⌘I</kbd>
          <span>process queue</span>
        </div>
      </div>
    </div>
  )
}
