import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { StatusBadge } from '@/components/StatusDot'
import { CostDisplay } from '@/components/CostDisplay'
import { Hash, Database, Activity, Brain } from '@/components/icons'
import { formatTokens, timeAgo, cn } from '@/lib/utils'
import type { SessionInfo } from '@/lib/types'

interface SessionSidebarProps {
  info: SessionInfo
}

export function SessionSidebar({ info }: SessionSidebarProps) {
  const totalTokens = info.tokenUsage.inputTokens + info.tokenUsage.outputTokens
  const cachePercent = info.tokenUsage.inputTokens > 0
    ? Math.round((info.tokenUsage.cacheReadTokens / info.tokenUsage.inputTokens) * 100)
    : 0

  return (
    <aside className="w-80 border-l border-border bg-surface-0/40 flex flex-col slide-in-right">
      <Tabs defaultValue="stats" className="flex-1 flex flex-col">
        <div className="px-4 pt-3 pb-3 border-b border-border">
          <TabsList className="w-full">
            <TabsTrigger value="stats" className="flex-1">Stats</TabsTrigger>
            <TabsTrigger value="cost" className="flex-1">Cost</TabsTrigger>
            <TabsTrigger value="meta" className="flex-1">Metadata</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="stats" className="flex-1 px-5 py-4 space-y-5 mt-0 overflow-y-auto">
          <StatBlock
            icon={<Hash className="h-3.5 w-3.5" />}
            label="Tokens"
            primary={formatTokens(totalTokens)}
            caption={cachePercent > 0 ? `${cachePercent}% cached` : 'no cache hits'}
          >
            <StatBar label="Input" value={info.tokenUsage.inputTokens} max={totalTokens} color="status-running" />
            <StatBar label="Output" value={info.tokenUsage.outputTokens} max={totalTokens} color="primary" />
            {info.tokenUsage.thinkingTokens > 0 && (
              <StatBar label="Thinking" value={info.tokenUsage.thinkingTokens} max={totalTokens} color="purple" />
            )}
          </StatBlock>

          {(info.tokenUsage.cacheReadTokens > 0 || info.tokenUsage.cacheCreationTokens > 0) && (
            <StatBlock
              icon={<Database className="h-3.5 w-3.5" />}
              label="Cache"
              primary={`${cachePercent}%`}
              caption="hit rate"
            >
              <StatRow label="reads" value={formatTokens(info.tokenUsage.cacheReadTokens)} />
              <StatRow label="writes" value={formatTokens(info.tokenUsage.cacheCreationTokens)} />
            </StatBlock>
          )}

          <StatBlock
            icon={<Activity className="h-3.5 w-3.5" />}
            label="Loop"
            primary={String(info.iteration)}
            caption="iterations"
          >
            <StatRow label="status" value={<StatusBadge status={info.status} />} />
            {info.currentTool && <StatRow label="tool" value={<span className="mono text-warning">{info.currentTool}</span>} />}
          </StatBlock>

          {info.tokenUsage.thinkingTokens > 0 && (
            <StatBlock
              icon={<Brain className="h-3.5 w-3.5" />}
              label="Reasoning"
              primary={formatTokens(info.tokenUsage.thinkingTokens)}
              caption="thinking tokens"
            />
          )}
        </TabsContent>

        <TabsContent value="cost" className="flex-1 px-5 py-4 mt-0 overflow-y-auto">
          <CostDisplay provider={info.provider} tokenUsage={info.tokenUsage} />
        </TabsContent>

        <TabsContent value="meta" className="flex-1 px-5 py-4 space-y-3.5 mt-0 overflow-y-auto">
          <MetaSection title="Identity">
            <MetaRow label="ID" value={info.id} mono small />
            <MetaRow label="Name" value={info.name} />
            <MetaRow label="Created" value={timeAgo(info.createdAt)} />
          </MetaSection>

          <MetaSection title="Model">
            <MetaRow label="Provider" value={info.provider} />
            <MetaRow label="Model" value={info.model} mono />
          </MetaSection>

          {info.worktree && (
            <MetaSection title="Worktree">
              <MetaRow label="Branch" value={info.worktree.branch} mono />
              <MetaRow label="Path" value={info.worktree.path} mono small />
            </MetaSection>
          )}
        </TabsContent>
      </Tabs>

      <div className="px-4 py-2.5 border-t border-border text-[10px] text-dim-foreground flex items-center gap-1.5 mono">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-status-running pulse-ring" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-status-running" />
        </span>
        live via SSE
      </div>
    </aside>
  )
}

/* ─── Stat helpers ───────────────────────────────────────────────── */

function StatBlock({
  icon, label, primary, caption, children,
}: {
  icon: React.ReactNode
  label: string
  primary: string
  caption?: string
  children?: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2.5">
        <div className="flex items-center gap-1.5">
          <div className="flex h-4 w-4 items-center justify-center rounded text-dim-foreground">
            {icon}
          </div>
          <div className="text-[10px] uppercase tracking-[0.08em] font-semibold text-muted-foreground">{label}</div>
        </div>
        <div className="text-right">
          <div className="text-xl font-semibold mono tabular tracking-tight gradient-text">{primary}</div>
          {caption && <div className="text-[9px] text-dim-foreground mt-0.5">{caption}</div>}
        </div>
      </div>
      {children && <div className="space-y-1.5">{children}</div>}
    </div>
  )
}

type BarColor = 'status-running' | 'primary' | 'purple' | 'status-done'
const BAR_STYLES: Record<BarColor, string> = {
  'status-running': 'bg-status-running',
  'primary':        'bg-primary',
  'purple':         'bg-purple',
  'status-done':    'bg-status-done',
}

function StatBar({ label, value, max, color }: { label: string; value: number; max: number; color: BarColor }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="mono tabular text-foreground">{formatTokens(value)}</span>
      </div>
      <div className="h-1 rounded-full bg-surface-2 overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', BAR_STYLES[color])} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <div className="mono tabular">{value}</div>
    </div>
  )
}

function MetaSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-[9px] uppercase tracking-[0.08em] font-semibold text-dim-foreground">{title}</div>
      <div className="space-y-1.5 pl-0.5">{children}</div>
    </div>
  )
}

function MetaRow({ label, value, mono, small }: { label: string; value: string; mono?: boolean; small?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-2 text-[11px]">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={cn('text-right break-all text-foreground', mono && 'mono', small && 'text-[10px]')}>{value}</span>
    </div>
  )
}
