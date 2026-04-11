import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { StatusBadge } from '@/components/StatusDot'
import { CostDisplay } from '@/components/CostDisplay'
import { Hash, Database, Activity, Brain } from '@/components/icons'
import { formatTokens, timeAgo, cn } from '@/lib/utils'
import type { SessionInfo, WebPanelInfo } from '@/lib/types'
import { DiffPanel } from '@/components/session/panels/DiffPanel'

interface SessionSidebarProps {
  info: SessionInfo
  sessionId: string
  webPanels: WebPanelInfo[]
  onSendFeedback: (message: string) => Promise<void>
}

export function SessionSidebar({ info, sessionId, webPanels, onSendFeedback }: SessionSidebarProps) {
  return (
    <aside className="w-80 min-h-0 border-l border-border bg-surface-0/40 flex flex-col slide-in-right">
      <Tabs defaultValue="stats" className="flex-1 flex flex-col min-h-0">
        <div className="px-4 pt-3 pb-3 border-b border-border">
          <TabsList className="w-full flex flex-wrap h-auto gap-1 justify-start">
            <TabsTrigger value="stats" className="text-[0.875rem] px-2">Stats</TabsTrigger>
            <TabsTrigger value="cost" className="text-[0.875rem] px-2">Cost</TabsTrigger>
            <TabsTrigger value="meta" className="text-[0.875rem] px-2">Meta</TabsTrigger>
            {webPanels.map(p => (
              <TabsTrigger key={p.id} value={`panel-${p.id}`} className="text-[0.875rem] px-2">
                {p.title}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="stats" className="flex-1 px-5 py-4 space-y-5 mt-0 overflow-y-auto">
          <StatsTab info={info} />
        </TabsContent>

        <TabsContent value="cost" className="flex-1 px-5 py-4 mt-0 overflow-y-auto">
          <CostDisplay provider={info.provider} tokenUsage={info.tokenUsage} />
        </TabsContent>

        <TabsContent value="meta" className="flex-1 px-5 py-4 space-y-3.5 mt-0 overflow-y-auto">
          {buildMetaSections(info).map(section => (
            <MetaSection key={section.title} title={section.title}>
              {section.rows.map(row => (
                <MetaRow key={row.label} {...row} />
              ))}
            </MetaSection>
          ))}
        </TabsContent>

        {webPanels.map(p => (
          <TabsContent
            key={p.id}
            value={`panel-${p.id}`}
            className="flex-1 px-4 py-3 mt-0 min-h-0 flex flex-col overflow-hidden outline-none"
          >
            <PanelBody
              panel={p}
              sessionId={sessionId}
              cwd={info.cwd}
              status={info.status}
              onSendFeedback={onSendFeedback}
            />
          </TabsContent>
        ))}
      </Tabs>

      <div className="px-4 py-2.5 border-t border-border text-[0.8125rem] text-dim-foreground flex items-center gap-1.5 mono">
        <LiveDot />
        live via SSE
      </div>
    </aside>
  )
}

/** Live stats blocks: tokens / cache / loop / reasoning. */
function StatsTab({ info }: { info: SessionInfo }) {
  const { inputTokens, outputTokens, thinkingTokens } = info.tokenUsage
  const cacheRead = info.tokenUsage.cacheReadTokens ?? 0
  const cacheWrite = info.tokenUsage.cacheCreationTokens ?? 0
  const totalTokens = inputTokens + outputTokens
  const cachePercent = inputTokens > 0 ? Math.round((cacheRead / inputTokens) * 100) : 0

  return (
    <>
      <StatBlock
        icon={<Hash className="h-3.5 w-3.5" />}
        label="Tokens"
        primary={formatTokens(totalTokens)}
        caption={cachePercent > 0 ? `${cachePercent}% cached` : 'no cache hits'}
      >
        <StatBar label="Input" value={inputTokens} max={totalTokens} color="status-running" />
        <StatBar label="Output" value={outputTokens} max={totalTokens} color="primary" />
        {thinkingTokens > 0 && (
          <StatBar label="Thinking" value={thinkingTokens} max={totalTokens} color="purple" />
        )}
      </StatBlock>

      {(cacheRead > 0 || cacheWrite > 0) && (
        <StatBlock
          icon={<Database className="h-3.5 w-3.5" />}
          label="Cache"
          primary={`${cachePercent}%`}
          caption="hit rate"
        >
          <StatRow label="reads" value={formatTokens(cacheRead)} />
          <StatRow label="writes" value={formatTokens(cacheWrite)} />
        </StatBlock>
      )}

      <StatBlock
        icon={<Activity className="h-3.5 w-3.5" />}
        label="Loop"
        primary={String(info.iteration)}
        caption="iterations"
      >
        <StatRow label="status" value={<StatusBadge status={info.status} />} />
        {info.currentTool && (
          <StatRow label="tool" value={<span className="mono text-warning">{info.currentTool}</span>} />
        )}
      </StatBlock>

      {thinkingTokens > 0 && (
        <StatBlock
          icon={<Brain className="h-3.5 w-3.5" />}
          label="Reasoning"
          primary={formatTokens(thinkingTokens)}
          caption="thinking tokens"
        />
      )}
    </>
  )
}

/** Render the contents of one web panel tab. Unknown panel ids show a dev hint. */
function PanelBody({
  panel, sessionId, cwd, status, onSendFeedback,
}: {
  panel: WebPanelInfo
  sessionId: string
  cwd: string
  status: SessionInfo['status']
  onSendFeedback: (message: string) => Promise<void>
}) {
  if (panel.id === 'diff') {
    return <DiffPanel sessionId={sessionId} cwd={cwd} status={status} onSendFeedback={onSendFeedback} />
  }
  const kind = panel.source === 'builtin' ? 'builtin' : 'custom module'
  return (
    <p className="text-[0.875rem] text-muted-foreground leading-relaxed">
      Panel <span className="mono text-foreground">{panel.id}</span> is registered on the server ({kind})
      but has no UI component in ra-web yet. Add a case for this id next to the diff panel in{' '}
      <span className="mono text-[0.8125rem]">SessionSidebar.tsx</span>.
    </p>
  )
}

/** Pulsing dot next to the "live via SSE" label in the sidebar footer. */
function LiveDot() {
  return (
    <span className="relative flex h-1.5 w-1.5">
      <span className="absolute inline-flex h-full w-full rounded-full bg-status-running pulse-ring" />
      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-status-running" />
    </span>
  )
}

interface MetaRowData {
  label: string
  value: string
  mono?: boolean
  small?: boolean
}

interface MetaSectionData {
  title: string
  rows: MetaRowData[]
}

/** Flattens a SessionInfo into the rows the Meta tab renders. */
function buildMetaSections(info: SessionInfo): MetaSectionData[] {
  const sections: MetaSectionData[] = [
    {
      title: 'Identity',
      rows: [
        { label: 'ID', value: info.id, mono: true, small: true },
        { label: 'Name', value: info.name },
        { label: 'Created', value: timeAgo(info.createdAt) },
      ],
    },
    {
      title: 'Model',
      rows: [
        { label: 'Provider', value: info.provider },
        { label: 'Model', value: info.model, mono: true },
      ],
    },
    {
      title: 'Workspace',
      rows: [{ label: 'cwd', value: info.cwd, mono: true, small: true }],
    },
  ]
  if (info.worktree) {
    sections.push({
      title: 'Worktree',
      rows: [
        { label: 'Branch', value: info.worktree.branch, mono: true },
        { label: 'Path', value: info.worktree.path, mono: true, small: true },
      ],
    })
  }
  return sections
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
          <div className="text-[0.8125rem] uppercase tracking-[0.08em] font-semibold text-muted-foreground">{label}</div>
        </div>
        <div className="text-right">
          <div className="text-xl font-semibold mono tabular tracking-tight gradient-text">{primary}</div>
          {caption && <div className="text-[0.6875rem] text-dim-foreground mt-0.5">{caption}</div>}
        </div>
      </div>
      {children && <div className="space-y-1.5">{children}</div>}
    </div>
  )
}

type BarColor = 'status-running' | 'primary' | 'purple'
const BAR_STYLES: Record<BarColor, string> = {
  'status-running': 'bg-status-running',
  'primary':        'bg-primary',
  'purple':         'bg-purple',
}

function StatBar({ label, value, max, color }: { label: string; value: number; max: number; color: BarColor }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[0.8125rem]">
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
    <div className="flex items-center justify-between text-[0.875rem]">
      <span className="text-muted-foreground">{label}</span>
      <div className="mono tabular">{value}</div>
    </div>
  )
}

function MetaSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-[0.6875rem] uppercase tracking-[0.08em] font-semibold text-dim-foreground">{title}</div>
      <div className="space-y-1.5 pl-0.5">{children}</div>
    </div>
  )
}

function MetaRow({ label, value, mono, small }: { label: string; value: string; mono?: boolean; small?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-2 text-[0.875rem]">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={cn('text-right break-all text-foreground', mono && 'mono', small && 'text-[0.8125rem]')}>{value}</span>
    </div>
  )
}
