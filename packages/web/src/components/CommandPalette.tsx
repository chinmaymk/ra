import { useEffect, useMemo, useState, type ComponentType } from 'react'
import type { SessionInfo } from '@/lib/types'
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from '@/components/ui/command'
import { StatusDot } from './StatusDot'
import { Settings, Wrench, Layers, BookOpen, Home, Plus, Trash2, Square, LayoutGrid } from 'lucide-react'

type NavTarget = 'agents' | 'config' | 'tools' | 'middleware' | 'knowledge' | 'panels' | 'prompts' | 'terminal'

interface CommandPaletteProps {
  open: boolean
  setOpen: (v: boolean) => void
  sessions: SessionInfo[]
  onNavigate: (view: NavTarget) => void
  onSelectSession: (id: string) => void
  onNewSession: () => void
  onStopSession: (id: string) => void
  onDeleteSession: (id: string) => void
}

interface Action {
  icon: ComponentType<{ className?: string }>
  label: string
  run: () => void
  shortcut?: string
}

export function CommandPalette({
  open, setOpen, sessions,
  onNavigate, onSelectSession, onNewSession, onStopSession, onDeleteSession,
}: CommandPaletteProps) {
  const [search, setSearch] = useState('')

  // Clear the query when the dialog closes so the next open starts fresh.
  useEffect(() => {
    if (!open) setSearch('')
  }, [open])

  // Toggle with ⇧⌘P (or ⇧Ctrl P). ⌘K is wired higher up in App.tsx.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.shiftKey && (e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault()
        setOpen(!open)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, setOpen])

  const runCommand = (cmd: () => void) => {
    setOpen(false)
    cmd()
  }

  const actions: Action[] = useMemo(() => [
    { icon: Plus, label: 'Start new session', run: onNewSession, shortcut: '⌘N' },
    { icon: Home, label: 'Go to agents', run: () => onNavigate('agents'), shortcut: 'Esc' },
    { icon: Settings, label: 'Open config editor', run: () => onNavigate('config'), shortcut: '⌘,' },
    { icon: Wrench, label: 'Browse tools', run: () => onNavigate('tools') },
    { icon: Layers, label: 'Inspect middleware', run: () => onNavigate('middleware') },
    { icon: LayoutGrid, label: 'Web panels', run: () => onNavigate('panels') },
    { icon: BookOpen, label: 'Manage knowledge bases', run: () => onNavigate('knowledge') },
  ], [onNewSession, onNavigate])

  const running = useMemo(() => sessions.filter(s => s.status === 'running'), [sessions])
  const stopped = useMemo(() => sessions.filter(s => s.status !== 'running'), [sessions])

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Search sessions, navigate, run commands..."
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Actions">
          {actions.map(({ icon: Icon, label, run, shortcut }) => (
            <CommandItem key={label} onSelect={() => runCommand(run)}>
              <Icon className="h-4 w-4" />
              <span>{label}</span>
              {shortcut && <CommandShortcut>{shortcut}</CommandShortcut>}
            </CommandItem>
          ))}
        </CommandGroup>

        {sessions.length > 0 && (
          <CommandGroup heading="Sessions">
            {sessions.map(s => (
              <CommandItem
                key={s.id}
                value={`session-${s.id}-${s.name}`}
                onSelect={() => runCommand(() => onSelectSession(s.id))}
              >
                <StatusDot status={s.status} size="sm" animated={false} />
                <span className="truncate">{s.name}</span>
                <span className="ml-auto text-[0.9375rem] text-muted-foreground">{s.model}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <SessionActionGroup
          heading="Stop running"
          items={running}
          keyPrefix="stop"
          icon={<Square className="h-4 w-4 text-warning" />}
          verb="Stop"
          onSelect={id => runCommand(() => onStopSession(id))}
        />
        <SessionActionGroup
          heading="Delete"
          items={stopped}
          keyPrefix="delete"
          icon={<Trash2 className="h-4 w-4 text-destructive" />}
          verb="Delete"
          onSelect={id => runCommand(() => onDeleteSession(id))}
        />
      </CommandList>
    </CommandDialog>
  )
}

function SessionActionGroup({
  heading, items, keyPrefix, icon, verb, onSelect,
}: {
  heading: string
  items: SessionInfo[]
  keyPrefix: string
  icon: React.ReactNode
  verb: string
  onSelect: (id: string) => void
}) {
  if (items.length === 0) return null
  return (
    <CommandGroup heading={heading}>
      {items.map(s => (
        <CommandItem
          key={`${keyPrefix}-${s.id}`}
          value={`${keyPrefix}-${s.id}-${s.name}`}
          onSelect={() => onSelect(s.id)}
        >
          {icon}
          <span className="truncate">{verb} {s.name}</span>
        </CommandItem>
      ))}
    </CommandGroup>
  )
}
