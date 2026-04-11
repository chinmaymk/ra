import { useEffect, useState } from 'react'
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
import { Settings, Wrench, Layers, BookOpen, Home, Plus, Trash2, Square, Copy } from 'lucide-react'

interface CommandPaletteProps {
  open: boolean
  setOpen: (v: boolean) => void
  sessions: SessionInfo[]
  onNavigate: (view: 'agents' | 'config' | 'tools' | 'middleware' | 'knowledge') => void
  onSelectSession: (id: string) => void
  onNewSession: () => void
  onStopSession: (id: string) => void
  onDeleteSession: (id: string) => void
  onDuplicateSession: (id: string) => void
}

export function CommandPalette({
  open,
  setOpen,
  sessions,
  onNavigate,
  onSelectSession,
  onNewSession,
  onStopSession,
  onDeleteSession,
  onDuplicateSession,
}: CommandPaletteProps) {
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!open) setSearch('')
  }, [open])

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
          <CommandItem onSelect={() => runCommand(onNewSession)}>
            <Plus className="h-4 w-4" />
            <span>Start new session</span>
            <CommandShortcut>⌘N</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => onNavigate('agents'))}>
            <Home className="h-4 w-4" />
            <span>Go to agents</span>
            <CommandShortcut>Esc</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => onNavigate('config'))}>
            <Settings className="h-4 w-4" />
            <span>Open config editor</span>
            <CommandShortcut>⌘,</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => onNavigate('tools'))}>
            <Wrench className="h-4 w-4" />
            <span>Browse tools</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => onNavigate('middleware'))}>
            <Layers className="h-4 w-4" />
            <span>Inspect middleware</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => onNavigate('knowledge'))}>
            <BookOpen className="h-4 w-4" />
            <span>Manage knowledge bases</span>
          </CommandItem>
        </CommandGroup>

        {sessions.length > 0 && (
          <CommandGroup heading="Sessions">
            {sessions.map(s => (
              <CommandItem
                key={s.id}
                value={`session-${s.id}-${s.name}`}
                onSelect={(value) => {
                  // Shift+click is tracked via a mousedown listener on the item
                }}
                onMouseDown={(e: React.MouseEvent) => {
                  if (e.shiftKey) {
                    e.preventDefault()
                    runCommand(() => onDuplicateSession(s.id))
                  }
                }}
                onClick={(e: React.MouseEvent) => {
                  if (!e.shiftKey) {
                    runCommand(() => onSelectSession(s.id))
                  }
                }}
              >
                <StatusDot status={s.status} size="sm" animated={false} />
                <span className="truncate">{s.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">{s.model}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {sessions.filter(s => s.status !== 'running').length > 0 && (
          <CommandGroup heading="Duplicate">
            {sessions.filter(s => s.status !== 'running').map(s => (
              <CommandItem
                key={`duplicate-${s.id}`}
                value={`duplicate-${s.id}-${s.name}`}
                onSelect={() => runCommand(() => onDuplicateSession(s.id))}
              >
                <Copy className="h-4 w-4" />
                <span className="truncate">Duplicate {s.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {sessions.filter(s => s.status === 'running').length > 0 && (
          <CommandGroup heading="Stop running">
            {sessions.filter(s => s.status === 'running').map(s => (
              <CommandItem
                key={`stop-${s.id}`}
                value={`stop-${s.id}-${s.name}`}
                onSelect={() => runCommand(() => onStopSession(s.id))}
              >
                <Square className="h-4 w-4 text-warning" />
                <span className="truncate">Stop {s.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {sessions.filter(s => s.status !== 'running').length > 0 && (
          <CommandGroup heading="Delete">
            {sessions.filter(s => s.status !== 'running').map(s => (
              <CommandItem
                key={`delete-${s.id}`}
                value={`delete-${s.id}-${s.name}`}
                onSelect={() => runCommand(() => onDeleteSession(s.id))}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
                <span className="truncate">Delete {s.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
