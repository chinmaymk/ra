import { useState, useMemo } from 'react'
import type { SessionInfo } from '@/lib/types'
import { StatusDot } from '@/components/StatusDot'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn, timeAgo } from '@/lib/utils'
import {
  Plus, Settings, Wrench, Layers, Bookmark, BookOpen, Terminal as TerminalLucide,
  Search, Sun, Moon, Monitor, Command as CommandIcon, Inbox, Trash2, Square,
  LayoutGrid,
} from 'lucide-react'
import type { Theme } from '@/hooks/useTheme'

type View = 'agents' | 'config' | 'tools' | 'middleware' | 'prompts' | 'knowledge' | 'terminal' | 'panels'

type IconComponent = React.ComponentType<{ className?: string }>

interface SessionGroupSpec {
  key: 'waiting' | 'running' | 'idle' | 'done'
  label: string
  tone?: 'waiting' | 'running'
}

/** Map a raw session status to the sidebar bucket it belongs in. */
const BUCKET_BY_STATUS: Record<SessionInfo['status'], SessionGroupSpec['key'] | null> = {
  'needs-input': 'waiting',
  running: 'running',
  idle: 'idle',
  done: 'done',
  error: 'done',
}

interface SidebarProps {
  sessions: SessionInfo[]
  activeSessionId: string | null
  view: View
  needsInputCount: number
  theme: Theme
  onSelectSession: (id: string) => void
  onNewSession: () => void
  onNavigate: (view: View) => void
  onStopSession: (id: string) => void
  onDeleteSession: (id: string) => void
  onProcessQueue: () => void
  onCyclTheme: () => void
  onOpenPalette: () => void
}

export function Sidebar({
  sessions, activeSessionId, view, needsInputCount, theme,
  onSelectSession, onNewSession, onNavigate,
  onStopSession, onDeleteSession, onProcessQueue, onCyclTheme, onOpenPalette,
}: SidebarProps) {
  const [search, setSearch] = useState('')

  // Filter by search, then bucket by status. Within each bucket, newest first.
  const { groups, totalVisible } = useMemo(() => {
    const q = search.toLowerCase().trim()
    const matches = q
      ? sessions.filter(s =>
          s.name.toLowerCase().includes(q) ||
          s.model.toLowerCase().includes(q) ||
          s.lastAssistantMessage?.toLowerCase().includes(q))
      : sessions

    const buckets: Record<SessionGroupSpec['key'], SessionInfo[]> = {
      waiting: [], running: [], idle: [], done: [],
    }
    for (const s of matches) {
      const bucket = BUCKET_BY_STATUS[s.status]
      if (bucket) buckets[bucket].push(s)
    }
    for (const list of Object.values(buckets)) {
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    }
    return { groups: buckets, totalVisible: matches.length }
  }, [sessions, search])

  return (
    <TooltipProvider delayDuration={300}>
      <aside className="flex flex-col h-full w-[260px] shrink-0 border-r border-border bg-surface/50">
        {/* Brand */}
        <div className="flex items-center justify-between h-12 px-3 border-b border-border">
          <button
            onClick={() => onNavigate('agents')}
            className="flex items-center gap-2 px-1 py-1 rounded-md hover:bg-surface-2 transition-colors"
          >
            <img src="/favicon.svg" alt="ra" className="h-5 w-5" />
            <span className="text-[1rem] font-semibold tracking-tight">ra</span>
            <span className="text-[0.8125rem] font-medium text-dim-foreground">web</span>
          </button>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onOpenPalette}
                className="flex items-center gap-1 h-6 px-1.5 rounded text-dim-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
              >
                <CommandIcon className="h-3 w-3" />
                <kbd>K</kbd>
              </button>
            </TooltipTrigger>
            <TooltipContent>Command palette</TooltipContent>
          </Tooltip>
        </div>

        {/* New session + queue */}
        <div className="px-3 pt-3 pb-2 space-y-2">
          <button
            onClick={onNewSession}
            className="w-full flex items-center gap-2 h-8 px-3 rounded-md gradient-primary text-primary-foreground text-[0.9375rem] font-medium shadow-sm hover:opacity-90 transition-opacity"
          >
            <Plus className="h-3.5 w-3.5" />
            New agent
          </button>
          {needsInputCount > 0 && (
            <button
              onClick={onProcessQueue}
              className="w-full flex items-center gap-2 h-7 px-2.5 rounded-md bg-status-waiting/10 border border-status-waiting/25 text-status-waiting text-[0.875rem] font-medium hover:bg-status-waiting/15 transition-colors"
            >
              <Inbox className="h-3 w-3" />
              <span className="tabular">{needsInputCount}</span>
              <span>waiting</span>
              <kbd className="ml-auto">⌘I</kbd>
            </button>
          )}
        </div>

        {/* Search */}
        {sessions.length > 0 && (
          <div className="px-3 pb-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-dim-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search agents..."
                className="w-full h-7 pl-7 pr-2 rounded-md bg-surface-1 border border-border text-[0.9375rem] placeholder:text-dim-foreground"
              />
            </div>
          </div>
        )}

        {/* Session list */}
        <div className="flex-1 overflow-y-auto px-2 pb-2 min-h-0">
          {totalVisible === 0 && (
            <div className="px-2 py-6 text-center text-[0.875rem] text-dim-foreground">
              {sessions.length === 0 ? 'No agents yet' : 'No matches'}
            </div>
          )}
          {SESSION_GROUPS.map(g => {
            const items = groups[g.key]
            if (items.length === 0) return null
            return (
              <SessionGroup key={g.key} label={g.label} tone={g.tone}>
                {items.map(s => (
                  <SessionRow
                    key={s.id}
                    session={s}
                    active={s.id === activeSessionId}
                    onSelect={onSelectSession}
                    onStop={onStopSession}
                    onDelete={onDeleteSession}
                  />
                ))}
              </SessionGroup>
            )
          })}
        </div>

        {/* Bottom nav */}
        <div className="border-t border-border px-2 py-2 space-y-0.5">
          {NAV_ITEMS.map(item => (
            <NavRow
              key={item.view}
              icon={item.icon}
              label={item.label}
              active={view === item.view}
              onClick={() => onNavigate(item.view)}
              shortcut={item.shortcut}
            />
          ))}
          <ThemeButton theme={theme} onCycle={onCyclTheme} />
        </div>
      </aside>
    </TooltipProvider>
  )
}

// ─── Data tables ─────────────────────────────────────────────────────────

const SESSION_GROUPS: readonly SessionGroupSpec[] = [
  { key: 'waiting', label: 'Waiting', tone: 'waiting' },
  { key: 'running', label: 'Running', tone: 'running' },
  { key: 'idle',    label: 'Idle' },
  { key: 'done',    label: 'Recent' },
]

interface NavItem {
  view: Exclude<View, 'agents'>
  icon: IconComponent
  label: string
  shortcut?: string
}

const NAV_ITEMS: readonly NavItem[] = [
  { view: 'config',     icon: Settings,       label: 'Config', shortcut: '⌘,' },
  { view: 'tools',      icon: Wrench,         label: 'Tools' },
  { view: 'middleware', icon: Layers,         label: 'Middleware' },
  { view: 'panels',     icon: LayoutGrid,     label: 'Panels' },
  { view: 'prompts',    icon: Bookmark,       label: 'Prompts' },
  { view: 'knowledge',  icon: BookOpen,       label: 'Knowledge' },
  { view: 'terminal',   icon: TerminalLucide, label: 'Terminal' },
]

const THEME_META: Record<Theme, { icon: IconComponent; label: string }> = {
  dark:   { icon: Moon,    label: 'Dark' },
  light:  { icon: Sun,     label: 'Light' },
  system: { icon: Monitor, label: 'System' },
}

function ThemeButton({ theme, onCycle }: { theme: Theme; onCycle: () => void }) {
  const { icon: Icon, label } = THEME_META[theme]
  return (
    <button
      onClick={onCycle}
      className="w-full flex items-center gap-2 px-2 h-7 rounded-md text-[0.875rem] font-medium text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
    </button>
  )
}

function SessionGroup({ label, tone, children }: { label: string; tone?: 'waiting' | 'running'; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <div className={cn(
        'px-2 py-1 text-[0.6875rem] uppercase tracking-[0.1em] font-semibold',
        tone === 'waiting' ? 'text-status-waiting' :
        tone === 'running' ? 'text-status-running' :
        'text-dim-foreground'
      )}>
        {label}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function SessionRow({
  session: s, active, onSelect, onStop, onDelete,
}: {
  session: SessionInfo
  active: boolean
  onSelect: (id: string) => void
  onStop: (id: string) => void
  onDelete: (id: string) => void
}) {
  const running = s.status === 'running'
  const subtitle = running && s.currentTool
    ? <span className="text-warning">{s.currentTool}</span>
    : timeAgo(s.createdAt)

  return (
    <div
      onClick={() => onSelect(s.id)}
      className={cn(
        'group flex items-start gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors',
        active
          ? 'bg-surface-2 text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-surface-1',
      )}
    >
      <div className="pt-1">
        <StatusDot status={s.status} size="sm" animated />
      </div>
      <div className="flex-1 min-w-0">
        <span className={cn('block text-[0.9375rem] font-medium truncate', active && 'text-foreground')}>
          {s.name}
        </span>
        <div className="text-[0.8125rem] text-dim-foreground truncate">{subtitle}</div>
      </div>
      <div
        className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center"
        onClick={e => e.stopPropagation()}
      >
        {running ? (
          <IconButton icon={Square} onClick={() => onStop(s.id)} tone="warning" />
        ) : (
          <IconButton icon={Trash2} onClick={() => onDelete(s.id)} tone="destructive" />
        )}
      </div>
    </div>
  )
}

function IconButton({
  icon: Icon, onClick, tone,
}: {
  icon: IconComponent
  onClick: () => void
  tone: 'warning' | 'destructive'
}) {
  const classes = tone === 'warning'
    ? 'hover:bg-warning/10 text-warning'
    : 'hover:bg-destructive/10 text-dim-foreground hover:text-destructive'
  return (
    <button onClick={onClick} className={cn('p-1 rounded', classes)}>
      <Icon className="h-3 w-3" />
    </button>
  )
}

function NavRow({
  icon: Icon, label, active, onClick, shortcut,
}: {
  icon: IconComponent
  label: string
  active: boolean
  onClick: () => void
  shortcut?: string
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-2 h-7 rounded-md text-[0.875rem] font-medium transition-colors',
        active
          ? 'text-foreground bg-surface-2'
          : 'text-muted-foreground hover:text-foreground hover:bg-surface-1'
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 text-left">{label}</span>
      {shortcut && <kbd>{shortcut}</kbd>}
    </button>
  )
}
