import { useState, useEffect, useMemo } from 'react'
import type { SessionInfo, CreateSessionOptions, ProviderInfo } from '@/lib/types'
import { ChatComposer } from '@/components/ChatComposer'
import { StatusDot, StatusBadge } from '@/components/StatusDot'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { timeAgo, formatTokens, cn } from '@/lib/utils'
import {
  Trash2, Square, GitBranch, Activity, Sparkles, Filter, ArrowRight,
  Grid3x3, List, MoreVertical, Eye, Zap, Check, Hourglass, DollarSign,
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

/** Compute USD cost for a session based on provider pricing. */
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
  if (usd === 0) return '$0.00'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

type FilterMode = 'all' | 'needs-input' | 'running' | 'done'
type LayoutMode = 'grid' | 'list'

export function AgentsView({
  sessions,
  onNewSession,
  onInspect,
  onStop,
  onDelete,
  onProcessQueue,
}: AgentsViewProps) {
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [currentConfig, setCurrentConfig] = useState<{ provider: string; model: string } | null>(null)
  const [filter, setFilter] = useState<FilterMode>('all')
  const [layout, setLayout] = useState<LayoutMode>('grid')

  useEffect(() => {
    api.providers.list().then(setProviders).catch(() => {})
    api.config.get().then(c => setCurrentConfig({ provider: c.provider, model: c.model })).catch(() => {})
  }, [])

  const counts = useMemo(() => ({
    all: sessions.length,
    'needs-input': sessions.filter(s => s.status === 'needs-input').length,
    running: sessions.filter(s => s.status === 'running').length,
    done: sessions.filter(s => s.status === 'done' || s.status === 'error').length,
  }), [sessions])

  const filtered = useMemo(() => {
    const sorted = [...sessions].sort((a, b) => {
      // Priority: needs-input > running > idle > done > error
      const order: Record<string, number> = {
        'needs-input': 0, running: 1, idle: 2, done: 3, error: 4,
      }
      const diff = (order[a.status] ?? 5) - (order[b.status] ?? 5)
      if (diff !== 0) return diff
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })

    if (filter === 'all') return sorted
    if (filter === 'done') return sorted.filter(s => s.status === 'done' || s.status === 'error')
    return sorted.filter(s => s.status === filter)
  }, [sessions, filter])

  const totalTokens = sessions.reduce((sum, s) => sum + s.tokenUsage.inputTokens + s.tokenUsage.outputTokens, 0)
  const totalIterations = sessions.reduce((sum, s) => sum + s.iteration, 0)
  const totalCost = useMemo(() => sessions.reduce((sum, s) => sum + sessionCost(s, providers), 0), [sessions, providers])

  return (
    <TooltipProvider>
      <div className="flex flex-col h-full">
        {/* ── Hero header with stats ───────────────────────────────── */}
        <div className="border-b border-border bg-gradient-to-b from-surface-1/40 to-transparent">
        <div className="max-w-5xl mx-auto px-8 pt-8 pb-6">
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="flex items-center gap-3 mb-1.5">
                <h1 className="text-2xl font-semibold tracking-tight gradient-text leading-none">Agents</h1>
                {counts.running > 0 && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-status-running/10 border border-status-running/25">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-status-running pulse-ring" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-status-running" />
                    </span>
                    <span className="text-[11px] font-medium text-status-running">{counts.running} live</span>
                  </div>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {sessions.length === 0 ? 'No sessions yet — start one below' : `${sessions.length} session${sessions.length > 1 ? 's' : ''} · ${formatTokens(totalTokens)} total tokens · ${totalIterations} iterations`}
              </p>
            </div>

            {counts['needs-input'] > 0 && (
              <button
                onClick={onProcessQueue}
                className="group relative flex items-center gap-3 px-5 py-3 rounded-lg bg-status-waiting/10 border border-status-waiting/30 text-status-waiting hover:bg-status-waiting/15 transition-all slide-in-right"
              >
                <div className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-status-waiting pulse-ring" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-status-waiting" />
                </div>
                <div className="text-left">
                  <div className="text-sm font-semibold">{counts['needs-input']} agent{counts['needs-input'] > 1 ? 's' : ''} waiting</div>
                  <div className="text-[11px] opacity-70 mt-0.5">Press ⌘I to process queue</div>
                </div>
                <ArrowRight className="h-4 w-4 ml-2 opacity-70 group-hover:translate-x-0.5 transition-transform" />
              </button>
            )}
          </div>

          {/* Stat tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <StatTile
              label="Waiting"
              value={counts['needs-input']}
              icon={<Hourglass className="h-3.5 w-3.5" />}
              color="status-waiting"
              active={filter === 'needs-input'}
              onClick={() => setFilter(filter === 'needs-input' ? 'all' : 'needs-input')}
            />
            <StatTile
              label="Running"
              value={counts.running}
              icon={<Zap className="h-3.5 w-3.5" />}
              color="status-running"
              active={filter === 'running'}
              onClick={() => setFilter(filter === 'running' ? 'all' : 'running')}
            />
            <StatTile
              label="Done"
              value={counts.done}
              icon={<Check className="h-3.5 w-3.5" />}
              color="status-done"
              active={filter === 'done'}
              onClick={() => setFilter(filter === 'done' ? 'all' : 'done')}
            />
            <StatTile
              label="Total tokens"
              value={formatTokens(totalTokens)}
              icon={<Activity className="h-3.5 w-3.5" />}
              color="primary"
              mono
            />
            <StatTile
              label="Total Cost"
              value={formatCost(totalCost)}
              icon={<DollarSign className="h-3.5 w-3.5" />}
              color="primary"
              mono
            />
          </div>
        </div>
        </div>

        {/* ── Toolbar ───────────────────────────────────────────────── */}
        {sessions.length > 0 && (
          <div className="border-b border-border">
          <div className="max-w-5xl mx-auto flex items-center justify-between px-8 py-2.5">
            <div className="flex items-center gap-1.5">
              <FilterChip label="All" count={counts.all} active={filter === 'all'} onClick={() => setFilter('all')} />
              <FilterChip label="Waiting" count={counts['needs-input']} active={filter === 'needs-input'} onClick={() => setFilter('needs-input')} />
              <FilterChip label="Running" count={counts.running} active={filter === 'running'} onClick={() => setFilter('running')} />
              <FilterChip label="Done" count={counts.done} active={filter === 'done'} onClick={() => setFilter('done')} />
            </div>
            <div className="flex items-center gap-1 p-0.5 bg-surface-1 rounded-md border border-border">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setLayout('grid')}
                    className={cn(
                      'p-1.5 rounded transition-colors',
                      layout === 'grid' ? 'bg-surface-3 text-foreground' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <Grid3x3 className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Grid view</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setLayout('list')}
                    className={cn(
                      'p-1.5 rounded transition-colors',
                      layout === 'list' ? 'bg-surface-3 text-foreground' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <List className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>List view</TooltipContent>
              </Tooltip>
            </div>
          </div>
          </div>
        )}

        {/* ── Content ───────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-8 py-6">
          {sessions.length === 0 ? (
            <EmptyState />
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Filter className="h-8 w-8 text-dim-foreground mb-3" />
              <p className="text-sm text-muted-foreground">No agents match this filter</p>
              <Button variant="ghost" size="sm" onClick={() => setFilter('all')} className="mt-3">
                Show all
              </Button>
            </div>
          ) : layout === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filtered.map((s, i) => (
                <AgentCard
                  key={s.id}
                  session={s}
                  index={i}
                  providers={providers}
                  onInspect={onInspect}
                  onStop={onStop}
                  onDelete={onDelete}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-1.5">
              {filtered.map((s, i) => (
                <AgentRow
                  key={s.id}
                  session={s}
                  index={i}
                  onInspect={onInspect}
                  onStop={onStop}
                  onDelete={onDelete}
                />
              ))}
            </div>
          )}
        </div>
        </div>

        {/* ── New session composer ──────────────────────────────────── */}
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

/* ─── Stat tile (clickable filter) ───────────────────────────────── */
type TileColor = 'status-waiting' | 'status-running' | 'status-done' | 'primary'

const TILE_STYLES: Record<TileColor, { text: string; bg: string }> = {
  'status-waiting': { text: 'text-status-waiting', bg: 'bg-status-waiting/10' },
  'status-running': { text: 'text-status-running', bg: 'bg-status-running/10' },
  'status-done':    { text: 'text-status-done',    bg: 'bg-status-done/10' },
  'primary':        { text: 'text-primary',        bg: 'bg-primary/10' },
}

function StatTile({
  label, value, icon, color, active, onClick, mono,
}: {
  label: string
  value: number | string
  icon: React.ReactNode
  color: TileColor
  active?: boolean
  onClick?: () => void
  mono?: boolean
}) {
  const styles = TILE_STYLES[color]

  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        'group relative overflow-hidden rounded-xl border px-5 py-4 text-left transition-all',
        'bg-surface-1/40',
        onClick && 'hover:bg-surface-1 hover:border-border-strong hover:-translate-y-0.5 cursor-pointer',
        active ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/30' : 'border-border'
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] uppercase tracking-[0.08em] font-semibold text-muted-foreground">{label}</span>
        <div className={cn('flex h-7 w-7 items-center justify-center rounded-md', styles.bg, styles.text)}>
          {icon}
        </div>
      </div>
      <div className={cn('text-3xl font-semibold tabular tracking-tight leading-none', mono && 'mono', styles.text)}>
        {value}
      </div>
    </button>
  )
}

/* ─── Filter chip ────────────────────────────────────────────────── */
function FilterChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all',
        active
          ? 'bg-foreground/10 text-foreground border border-border-strong'
          : 'text-muted-foreground hover:text-foreground hover:bg-surface-1 border border-transparent'
      )}
    >
      {label}
      <span className={cn('text-[10px] tabular', active ? 'opacity-70' : 'opacity-50')}>{count}</span>
    </button>
  )
}

/* ─── Agent card (grid view) ─────────────────────────────────────── */
function AgentCard({
  session: s, index, providers, onInspect, onStop, onDelete,
}: {
  session: SessionInfo
  index: number
  providers: ProviderInfo[]
  onInspect: (id: string) => void
  onStop: (id: string) => void
  onDelete: (id: string) => void
}) {
  const isPriority = s.status === 'needs-input'
  const isLive = s.status === 'running'
  const totalTokens = s.tokenUsage.inputTokens + s.tokenUsage.outputTokens
  const cost = sessionCost(s, providers)

  return (
    <div
      onClick={() => onInspect(s.id)}
      className={cn(
        'group relative overflow-hidden rounded-xl border bg-surface-1/40 cursor-pointer slide-up',
        'transition-all duration-200',
        'hover:bg-surface-1 hover:border-border-strong hover:-translate-y-0.5',
        'hover:shadow-lg',
        isPriority && 'border-status-waiting/40 bg-status-waiting/5 ring-1 ring-status-waiting/20',
        isLive && !isPriority && 'border-status-running/30',
        !isPriority && !isLive && 'border-border'
      )}
      style={{ animationDelay: `${Math.min(index * 30, 300)}ms` }}
    >
      {/* Status accent bar */}
      <div className={cn(
        'absolute left-0 top-0 bottom-0 w-0.5',
        s.status === 'needs-input' && 'bg-status-waiting',
        s.status === 'running' && 'bg-status-running',
        s.status === 'error' && 'bg-status-error',
        s.status === 'done' && 'bg-status-done',
        s.status === 'idle' && 'bg-status-idle'
      )} />

      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <StatusDot status={s.status} size="md" />
            <span className="font-semibold text-[15px] truncate tracking-tight">{s.name}</span>
          </div>
          <div onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-surface-3 text-muted-foreground transition-all">
                  <MoreVertical className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => onInspect(s.id)}>
                  <Eye className="h-3.5 w-3.5" /> Inspect
                </DropdownMenuItem>
                {s.status === 'running' && (
                  <DropdownMenuItem onClick={() => onStop(s.id)} className="text-warning">
                    <Square className="h-3.5 w-3.5" /> Stop
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onDelete(s.id)} className="text-destructive">
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Badges */}
        <div className="flex items-center flex-wrap gap-1.5 mb-3">
          <StatusBadge status={s.status} />
          <Badge variant="outline" className="mono text-[10px] normal-case tracking-normal">{s.model}</Badge>
          {s.worktree && (
            <Badge variant="success" className="gap-1">
              <GitBranch className="h-2.5 w-2.5" />
              {s.worktree.branch.replace(/^ra\//, '')}
            </Badge>
          )}
        </div>

        {/* Last message preview */}
        {s.lastAssistantMessage && (
          <p className="text-[13px] text-muted-foreground line-clamp-2 mb-3 leading-relaxed">
            {s.lastAssistantMessage}
          </p>
        )}

        {/* Live activity */}
        {isLive && s.currentTool && (
          <div className="flex items-center gap-2 px-3 py-2 mb-3 rounded-md bg-surface-2/60 border border-border">
            <div className="h-1.5 w-1.5 rounded-full bg-warning pulse" />
            <span className="text-[12px] text-muted-foreground">running</span>
            <span className="text-[12px] mono text-warning font-medium">{s.currentTool}</span>
          </div>
        )}

        {/* Footer stats */}
        <div className="flex items-center justify-between text-[11px] text-dim-foreground mono pt-3 border-t border-border">
          <span>{timeAgo(s.createdAt)}</span>
          <div className="flex items-center gap-2">
            {s.iteration > 0 && <span>iter {s.iteration}</span>}
            {totalTokens > 0 && (
              <>
                <span className="opacity-40">·</span>
                <span>{formatTokens(totalTokens)}</span>
              </>
            )}
            {cost > 0 && (
              <>
                <span className="opacity-40">·</span>
                <span>{formatCost(cost)}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Agent row (list view) ──────────────────────────────────────── */
function AgentRow({
  session: s, index, onInspect, onStop, onDelete,
}: {
  session: SessionInfo
  index: number
  onInspect: (id: string) => void
  onStop: (id: string) => void
  onDelete: (id: string) => void
}) {
  const isPriority = s.status === 'needs-input'

  return (
    <div
      onClick={() => onInspect(s.id)}
      className={cn(
        'group flex items-center gap-3 px-4 py-2.5 rounded-lg border bg-surface-1/30 cursor-pointer fade-in',
        'transition-all duration-150 hover:bg-surface-1 hover:border-border-strong',
        isPriority ? 'border-status-waiting/30' : 'border-border'
      )}
      style={{ animationDelay: `${Math.min(index * 15, 200)}ms` }}
    >
      <StatusDot status={s.status} size="md" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{s.name}</span>
          {s.worktree && (
            <Badge variant="success" className="gap-1 normal-case tracking-normal">
              <GitBranch className="h-2.5 w-2.5" />
              {s.worktree.branch.replace(/^ra\//, '')}
            </Badge>
          )}
        </div>
        {s.lastAssistantMessage && (
          <div className="text-[11px] text-muted-foreground/80 truncate mt-0.5">
            {s.lastAssistantMessage}
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 text-[10px] text-dim-foreground mono">
        <span className="hidden md:inline">{s.model}</span>
        <span>{timeAgo(s.createdAt)}</span>
        {s.iteration > 0 && <span>iter {s.iteration}</span>}
        {s.currentTool && s.status === 'running' && (
          <span className="text-warning">{s.currentTool}</span>
        )}
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
        {s.status === 'running' && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={() => onStop(s.id)} className="p-1.5 rounded hover:bg-warning/10 text-warning">
                <Square className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Stop</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={() => onDelete(s.id)} className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
              <Trash2 className="h-3 w-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Delete</TooltipContent>
        </Tooltip>
      </div>
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
      <div className="mt-10 flex flex-wrap items-center justify-center gap-4 text-[12px] text-dim-foreground">
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
