import { useState, useMemo } from 'react'
import type { SessionInfo } from '@/lib/types'
import { StatusDot } from '@/components/StatusDot'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn, timeAgo } from '@/lib/utils'
import {
  Plus, Settings, Wrench, Layers, Bookmark, BookOpen, Terminal as TerminalLucide,
  Search, Sun, Moon, Monitor, Command as CommandIcon, Inbox, Trash2, Square,
} from 'lucide-react'
import type { Theme } from '@/hooks/useTheme'

type View = 'agents' | 'config' | 'tools' | 'middleware' | 'prompts' | 'knowledge' | 'terminal'

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

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    const matches = q ? sessions.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.model.toLowerCase().includes(q) ||
      s.lastAssistantMessage?.toLowerCase().includes(q)
    ) : sessions

    // Sort: needs-input first, running, idle, done, error last
    const order: Record<string, number> = {
      'needs-input': 0, running: 1, idle: 2, done: 3, error: 4,
    }
    return [...matches].sort((a, b) => {
      const d = (order[a.status] ?? 5) - (order[b.status] ?? 5)
      if (d !== 0) return d
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })
  }, [sessions, search])

  const groups = useMemo(() => {
    const waiting = filtered.filter(s => s.status === 'needs-input')
    const running = filtered.filter(s => s.status === 'running')
    const idle = filtered.filter(s => s.status === 'idle')
    const done = filtered.filter(s => s.status === 'done' || s.status === 'error')
    return { waiting, running, idle, done }
  }, [filtered])

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
            <span className="text-[13px] font-semibold tracking-tight">ra</span>
            <span className="text-[10px] font-medium text-dim-foreground">web</span>
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
            className="w-full flex items-center gap-2 h-8 px-3 rounded-md gradient-primary text-primary-foreground text-[12px] font-medium shadow-sm hover:opacity-90 transition-opacity"
          >
            <Plus className="h-3.5 w-3.5" />
            New agent
          </button>
          {needsInputCount > 0 && (
            <button
              onClick={onProcessQueue}
              className="w-full flex items-center gap-2 h-7 px-2.5 rounded-md bg-status-waiting/10 border border-status-waiting/25 text-status-waiting text-[11px] font-medium hover:bg-status-waiting/15 transition-colors"
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
                className="w-full h-7 pl-7 pr-2 rounded-md bg-surface-1 border border-border text-[12px] placeholder:text-dim-foreground"
              />
            </div>
          </div>
        )}

        {/* Session list */}
        <div className="flex-1 overflow-y-auto px-2 pb-2 min-h-0">
          {filtered.length === 0 && (
            <div className="px-2 py-6 text-center text-[11px] text-dim-foreground">
              {sessions.length === 0 ? 'No agents yet' : 'No matches'}
            </div>
          )}
          {groups.waiting.length > 0 && (
            <SessionGroup label="Waiting" tone="waiting">
              {groups.waiting.map(s => (
                <SessionRow key={s.id} session={s} active={s.id === activeSessionId} onSelect={onSelectSession} onStop={onStopSession} onDelete={onDeleteSession} />
              ))}
            </SessionGroup>
          )}
          {groups.running.length > 0 && (
            <SessionGroup label="Running" tone="running">
              {groups.running.map(s => (
                <SessionRow key={s.id} session={s} active={s.id === activeSessionId} onSelect={onSelectSession} onStop={onStopSession} onDelete={onDeleteSession} />
              ))}
            </SessionGroup>
          )}
          {groups.idle.length > 0 && (
            <SessionGroup label="Idle">
              {groups.idle.map(s => (
                <SessionRow key={s.id} session={s} active={s.id === activeSessionId} onSelect={onSelectSession} onStop={onStopSession} onDelete={onDeleteSession} />
              ))}
            </SessionGroup>
          )}
          {groups.done.length > 0 && (
            <SessionGroup label="Recent">
              {groups.done.map(s => (
                <SessionRow key={s.id} session={s} active={s.id === activeSessionId} onSelect={onSelectSession} onStop={onStopSession} onDelete={onDeleteSession} />
              ))}
            </SessionGroup>
          )}
        </div>

        {/* Bottom nav */}
        <div className="border-t border-border px-2 py-2 space-y-0.5">
          <NavRow icon={Settings} label="Config" active={view === 'config'} onClick={() => onNavigate('config')} shortcut="⌘," />
          <NavRow icon={Wrench} label="Tools" active={view === 'tools'} onClick={() => onNavigate('tools')} />
          <NavRow icon={Layers} label="Middleware" active={view === 'middleware'} onClick={() => onNavigate('middleware')} />
          <NavRow icon={Bookmark} label="Prompts" active={view === 'prompts'} onClick={() => onNavigate('prompts')} />
          <NavRow icon={BookOpen} label="Knowledge" active={view === 'knowledge'} onClick={() => onNavigate('knowledge')} />
          <NavRow icon={TerminalLucide} label="Terminal" active={view === 'terminal'} onClick={() => onNavigate('terminal')} />
          <button
            onClick={onCyclTheme}
            className="w-full flex items-center gap-2 px-2 h-7 rounded-md text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
          >
            {theme === 'dark' ? <Moon className="h-3.5 w-3.5" /> :
             theme === 'light' ? <Sun className="h-3.5 w-3.5" /> :
             <Monitor className="h-3.5 w-3.5" />}
            <span>{theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'System'}</span>
          </button>
        </div>
      </aside>
    </TooltipProvider>
  )
}

function SessionGroup({ label, tone, children }: { label: string; tone?: 'waiting' | 'running'; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <div className={cn(
        'px-2 py-1 text-[9px] uppercase tracking-[0.1em] font-semibold',
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
  return (
    <div
      onClick={() => onSelect(s.id)}
      className={cn(
        'group flex items-start gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors',
        active
          ? 'bg-surface-2 text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-surface-1'
      )}
    >
      <div className="pt-1">
        <StatusDot status={s.status} size="sm" animated />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={cn('text-[12px] font-medium truncate', active && 'text-foreground')}>
            {s.name}
          </span>
        </div>
        <div className="text-[10px] text-dim-foreground truncate">
          {s.currentTool && s.status === 'running' ? (
            <span className="text-warning">{s.currentTool}</span>
          ) : (
            timeAgo(s.createdAt)
          )}
        </div>
      </div>
      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center" onClick={(e) => e.stopPropagation()}>
        {s.status === 'running' ? (
          <button onClick={() => onStop(s.id)} className="p-1 rounded hover:bg-warning/10 text-warning">
            <Square className="h-3 w-3" />
          </button>
        ) : (
          <button onClick={() => onDelete(s.id)} className="p-1 rounded hover:bg-destructive/10 text-dim-foreground hover:text-destructive">
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  )
}

type IconComponent = React.ComponentType<{ className?: string }>

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
        'w-full flex items-center gap-2 px-2 h-7 rounded-md text-[11px] font-medium transition-colors',
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
