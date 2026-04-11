import { useState, useCallback, useEffect, useMemo } from 'react'
import { useSessionList } from '@/hooks/useSessionList'
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut'
import { Sidebar } from '@/components/layout/Sidebar'
import { AgentsView } from '@/pages/AgentsView'
import { QueueView } from '@/pages/QueueView'
import { SessionDetail } from '@/pages/SessionDetail'
import { ConfigPage } from '@/pages/ConfigPage'
import { ToolsPage } from '@/pages/ToolsPage'
import { MiddlewarePage } from '@/pages/MiddlewarePage'
import { TerminalPage } from '@/pages/TerminalPage'
import { PromptsPage } from '@/pages/PromptsPage'
import { KnowledgePage } from '@/pages/KnowledgePage'
import { CommandPalette } from '@/components/CommandPalette'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import type { CreateSessionOptions } from '@/lib/types'
import { useTheme } from '@/hooks/useTheme'

type View =
  | { type: 'agents' }
  | { type: 'queue'; index: number }
  | { type: 'detail'; sessionId: string }
  | { type: 'config' }
  | { type: 'tools' }
  | { type: 'middleware' }
  | { type: 'terminal' }
  | { type: 'prompts' }
  | { type: 'knowledge' }

type NavTarget = 'agents' | 'config' | 'tools' | 'middleware' | 'prompts' | 'knowledge' | 'terminal'

export function App() {
  const { sessions, needsInput, refresh } = useSessionList()
  const [view, setView] = useState<View>({ type: 'agents' })
  const [paletteOpen, setPaletteOpen] = useState(false)
  const { theme, cycle } = useTheme()

  // If queue empties while we're in queue mode, return to agents
  useEffect(() => {
    if (view.type === 'queue' && needsInput.length === 0) {
      setView({ type: 'agents' })
    }
  }, [needsInput.length, view.type])

  const handleNewSession = useCallback(async (message: string, options?: CreateSessionOptions) => {
    try {
      const session = await api.sessions.create(message, options)
      refresh()
      setView({ type: 'detail', sessionId: session.id })
    } catch (err) {
      console.error('Failed to create session:', err)
    }
  }, [refresh])

  const handleInspect = useCallback((id: string) => {
    setView({ type: 'detail', sessionId: id })
  }, [])

  const handleStop = useCallback(async (id: string) => {
    await api.sessions.stop(id).catch(() => {})
    refresh()
  }, [refresh])

  const handleDelete = useCallback(async (id: string) => {
    await api.sessions.delete(id).catch(() => {})
    refresh()
    setView(prev => {
      if (prev.type === 'detail' && prev.sessionId === id) return { type: 'agents' }
      return prev
    })
  }, [refresh])

  const handleSkip = useCallback(() => {
    setView(prev => {
      if (prev.type !== 'queue') return prev
      const next = (prev.index + 1) % Math.max(1, needsInput.length)
      return { type: 'queue', index: next }
    })
  }, [needsInput.length])

  const handleAdvance = useCallback(() => {
    setView(prev => {
      if (prev.type !== 'queue') return prev
      if (needsInput.length <= 1) return { type: 'agents' }
      const next = prev.index >= needsInput.length - 1 ? 0 : prev.index
      return { type: 'queue', index: next }
    })
  }, [needsInput.length])

  const processQueue = useCallback(() => {
    if (needsInput.length > 0) setView({ type: 'queue', index: 0 })
  }, [needsInput.length])

  const goAgents = useCallback(() => setView({ type: 'agents' }), [])

  const navigate = useCallback((target: NavTarget) => {
    setView({ type: target })
  }, [])

  // Keyboard shortcuts
  useKeyboardShortcut(useMemo(() => [
    { key: 'k', meta: true, handler: () => setPaletteOpen(o => !o) },
    { key: ',', meta: true, handler: () => setView({ type: 'config' }) },
    // Cmd+I = Inbox (process queue). Cmd+Shift+A is intercepted by Chrome ("Search Tabs")
    { key: 'i', meta: true, handler: () => processQueue() },
    { key: 'Tab', handler: () => {
      if (view.type !== 'queue') return
      handleSkip()
    }},
    { key: 'Escape', preventDefault: false, handler: () => {
      if (paletteOpen) return
      goAgents()
    }},
  ], [view.type, processQueue, handleSkip, goAgents, paletteOpen]))

  const activeSessionId =
    view.type === 'detail' ? view.sessionId :
    view.type === 'queue' ? needsInput[view.index]?.id ?? null :
    null

  const sidebarView: NavTarget =
    view.type === 'detail' || view.type === 'queue' || view.type === 'agents' ? 'agents' :
    view.type

  return (
    <TooltipProvider delayDuration={300}>
      <div className="h-screen flex bg-background overflow-hidden">
        <Sidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          view={sidebarView}
          needsInputCount={needsInput.length}
          theme={theme}
          onSelectSession={handleInspect}
          onNewSession={goAgents}
          onNavigate={navigate}
          onStopSession={handleStop}
          onDeleteSession={handleDelete}
          onProcessQueue={processQueue}
          onCyclTheme={cycle}
          onOpenPalette={() => setPaletteOpen(true)}
        />

        {/* Main content */}
        <main className="flex-1 min-w-0 min-h-0 overflow-hidden">
          {view.type === 'agents' && (
            <AgentsView
              sessions={sessions}
              onNewSession={handleNewSession}
              onInspect={handleInspect}
              onStop={handleStop}
              onDelete={handleDelete}
              onProcessQueue={processQueue}
            />
          )}
          {view.type === 'queue' && needsInput[view.index] && (
            <QueueView
              session={needsInput[view.index]!}
              queuePosition={view.index + 1}
              queueTotal={needsInput.length}
              onSkip={handleSkip}
              onInspect={handleInspect}
              onAdvance={handleAdvance}
            />
          )}
          {view.type === 'detail' && <SessionDetail key={view.sessionId} sessionId={view.sessionId} onBack={goAgents} />}
          {view.type === 'config' && <ConfigPage onBack={goAgents} />}
          {view.type === 'tools' && <ToolsPage onBack={goAgents} />}
          {view.type === 'middleware' && <MiddlewarePage onBack={goAgents} />}
          {view.type === 'prompts' && <PromptsPage onBack={goAgents} />}
          {view.type === 'knowledge' && <KnowledgePage onBack={goAgents} />}
          {view.type === 'terminal' && <TerminalPage onBack={goAgents} />}
        </main>

        <CommandPalette
          open={paletteOpen}
          setOpen={setPaletteOpen}
          sessions={sessions}
          onNavigate={navigate}
          onSelectSession={handleInspect}
          onNewSession={goAgents}
          onStopSession={handleStop}
          onDeleteSession={handleDelete}
        />
      </div>
    </TooltipProvider>
  )
}
