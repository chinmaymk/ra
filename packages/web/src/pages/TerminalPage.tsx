import { useState, useRef, useCallback, useEffect } from 'react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  ArrowLeft, Play, Square, Send, ChevronDown, ChevronRight,
  Terminal as TerminalIcon, Trash2, Copy, Check,
} from 'lucide-react'
import AnsiToHtml from 'ansi-to-html'

const ansiConverter = new AnsiToHtml({
  fg: '#c9d1d9',
  bg: 'transparent',
  newline: false,
  escapeXML: true,
  colors: {
    0: '#282c34',
    1: '#e06c75',
    2: '#98c379',
    3: '#e5c07b',
    4: '#61afef',
    5: '#c678dd',
    6: '#56b6c2',
    7: '#abb2bf',
    8: '#5c6370',
    9: '#e06c75',
    10: '#98c379',
    11: '#e5c07b',
    12: '#61afef',
    13: '#c678dd',
    14: '#56b6c2',
    15: '#ffffff',
  } as unknown as string[],
})

interface TerminalEntry {
  id: string
  command: string
  cwd?: string
  output: string
  exitCode: number | null
  running: boolean
  startedAt: number
}

interface TerminalPageProps {
  onBack: () => void
}

export function TerminalPage({ onBack }: TerminalPageProps) {
  const [command, setCommand] = useState('')
  const [cwd, setCwd] = useState('')
  const [entries, setEntries] = useState<TerminalEntry[]>([])
  const [stdinInputs, setStdinInputs] = useState<Record<string, string>>({})
  const [copiedEntryId, setCopiedEntryId] = useState<string | null>(null)
  const [collapsedEntries, setCollapsedEntries] = useState<Set<string>>(new Set())
  const [commandHistory, setCommandHistory] = useState<string[]>([])
  const [, setHistoryIndex] = useState(-1)
  const outputEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<Map<string, () => void>>(new Map())
  const terminalIdRef = useRef<Map<string, string>>(new Map())

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      outputEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    })
  }, [])

  const runCommand = useCallback(async () => {
    const cmd = command.trim()
    if (!cmd) return

    const entryId = crypto.randomUUID()
    const entry: TerminalEntry = {
      id: entryId,
      command: cmd,
      cwd: cwd || undefined,
      output: '',
      exitCode: null,
      running: true,
      startedAt: Date.now(),
    }

    setEntries(prev => [...prev, entry])
    setCommand('')
    setCommandHistory(prev => {
      const filtered = prev.filter(c => c !== cmd)
      return [cmd, ...filtered].slice(0, 50)
    })
    setHistoryIndex(-1)

    try {
      const { id: termId } = await api.terminal.create(cmd, cwd || undefined)
      terminalIdRef.current.set(entryId, termId)

      const es = api.terminal.stream(termId)
      abortRef.current.set(entryId, () => es.close())

      es.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data)
          if (event.type === 'stdout' || event.type === 'stderr') {
            setEntries(prev => prev.map(e =>
              e.id === entryId
                ? { ...e, output: e.output + event.data }
                : e
            ))
            scrollToBottom()
          } else if (event.type === 'exit') {
            setEntries(prev => prev.map(e =>
              e.id === entryId
                ? { ...e, exitCode: event.code, running: false }
                : e
            ))
            es.close()
            abortRef.current.delete(entryId)
            terminalIdRef.current.delete(entryId)
          }
        } catch { /* skip malformed */ }
      }

      es.onerror = () => {
        es.close()
        setEntries(prev => prev.map(e =>
          e.id === entryId && e.running
            ? { ...e, running: false, exitCode: -1 }
            : e
        ))
        abortRef.current.delete(entryId)
        terminalIdRef.current.delete(entryId)
      }
    } catch (err) {
      setEntries(prev => prev.map(e =>
        e.id === entryId
          ? { ...e, output: e.output + `\n\x1b[31mError: ${(err as Error).message}\x1b[0m`, running: false, exitCode: -1 }
          : e
      ))
    }
  }, [command, cwd, scrollToBottom])

  const killProcess = useCallback((entryId: string) => {
    const termId = terminalIdRef.current.get(entryId)
    if (termId) {
      api.terminal.kill(termId).catch(() => {})
    }
    const abort = abortRef.current.get(entryId)
    if (abort) abort()
  }, [])

  const sendStdin = useCallback((entryId: string) => {
    const termId = terminalIdRef.current.get(entryId)
    const input = stdinInputs[entryId]
    if (!termId || !input) return
    api.terminal.stdin(termId, input + '\n').catch(() => {})
    setStdinInputs(prev => ({ ...prev, [entryId]: '' }))
  }, [stdinInputs])

  const copyOutput = useCallback((entryId: string, output: string) => {
    navigator.clipboard.writeText(output)
    setCopiedEntryId(entryId)
    setTimeout(() => setCopiedEntryId(null), 1500)
  }, [])

  const toggleCollapse = useCallback((entryId: string) => {
    setCollapsedEntries(prev => {
      const next = new Set(prev)
      if (next.has(entryId)) next.delete(entryId)
      else next.add(entryId)
      return next
    })
  }, [])

  const clearHistory = useCallback(() => {
    setEntries(prev => prev.filter(e => e.running))
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      runCommand()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHistoryIndex(prev => {
        const next = Math.min(prev + 1, commandHistory.length - 1)
        if (next >= 0) setCommand(commandHistory[next] ?? '')
        return next
      })
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHistoryIndex(prev => {
        const next = prev - 1
        if (next < 0) {
          setCommand('')
          return -1
        }
        setCommand(commandHistory[next] ?? '')
        return next
      })
    }
  }, [runCommand, commandHistory])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const activeEntry = entries.find(e => e.running)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-8 pt-7 pb-5 border-b border-border bg-gradient-to-b from-surface-1/40 to-transparent">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <button
              onClick={onBack}
              className="flex items-center justify-center h-7 w-7 mt-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight gradient-text">Terminal</h1>
              <p className="text-xs text-muted-foreground mt-1">
                Run bash commands
                {entries.length > 0 && (
                  <>
                    <span className="opacity-30 mx-1.5">·</span>
                    <span className="tabular text-foreground">{entries.length}</span> commands
                  </>
                )}
                {activeEntry && (
                  <>
                    <span className="opacity-30 mx-1.5">·</span>
                    <span className="text-status-running">1 running</span>
                  </>
                )}
              </p>
            </div>
          </div>
          {entries.some(e => !e.running) && (
            <button
              onClick={clearHistory}
              className="flex items-center gap-1.5 h-7 px-2.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors text-[11px]"
            >
              <Trash2 className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Command input */}
      <div className="px-8 py-4 border-b border-border bg-surface-1/20">
        <div className="flex items-center gap-3">
          <div className="flex-1 flex items-center gap-2 bg-surface-0 border border-border rounded-lg px-3 h-10 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all">
            <span className="text-primary text-sm font-mono">$</span>
            <input
              ref={inputRef}
              type="text"
              value={command}
              onChange={e => setCommand(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter command..."
              className="flex-1 bg-transparent text-sm font-mono text-foreground placeholder:text-dim-foreground outline-none"
              spellCheck={false}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={cwd}
              onChange={e => setCwd(e.target.value)}
              placeholder="cwd (optional)"
              className="w-40 h-10 px-3 text-xs font-mono bg-surface-0 border border-border rounded-lg text-muted-foreground placeholder:text-dim-foreground outline-none focus:border-primary/50 transition-colors"
              spellCheck={false}
            />
            <button
              onClick={runCommand}
              disabled={!command.trim()}
              className={cn(
                'flex items-center gap-1.5 h-10 px-4 rounded-lg text-[12px] font-medium transition-all',
                command.trim()
                  ? 'gradient-primary text-primary-foreground shadow-sm hover:opacity-90'
                  : 'bg-surface-2 text-dim-foreground cursor-not-allowed'
              )}
            >
              <Play className="h-3 w-3" />
              Run
            </button>
          </div>
        </div>
      </div>

      {/* Output area */}
      <div className="flex-1 overflow-y-auto px-8 py-4 space-y-3">
        {entries.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <TerminalIcon className="h-12 w-12 mb-4 opacity-20" />
            <p className="text-sm">No commands yet</p>
            <p className="text-xs mt-1 text-dim-foreground">Type a command above and press Enter or click Run</p>
          </div>
        )}
        {entries.map(entry => {
          const isCollapsed = collapsedEntries.has(entry.id)
          return (
            <div
              key={entry.id}
              className={cn(
                'rounded-lg border transition-all duration-200',
                entry.running
                  ? 'border-primary/30 bg-surface-1 shadow-sm'
                  : entry.exitCode === 0
                    ? 'border-border bg-surface-1/40'
                    : 'border-status-error/20 bg-surface-1/40'
              )}
            >
              {/* Command header */}
              <div
                className="flex items-center gap-2 px-4 py-2.5 cursor-pointer hover:bg-surface-2/50 transition-colors rounded-t-lg"
                onClick={() => !entry.running && toggleCollapse(entry.id)}
              >
                {!entry.running && (
                  isCollapsed
                    ? <ChevronRight className="h-3 w-3 text-dim-foreground shrink-0" />
                    : <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                )}
                {entry.running && (
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-status-running pulse-ring" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-status-running" />
                  </span>
                )}
                <code className="flex-1 text-[12px] font-mono font-semibold text-foreground truncate">
                  {entry.cwd && <span className="text-primary/60">{entry.cwd} </span>}
                  $ {entry.command}
                </code>
                <div className="flex items-center gap-2 shrink-0">
                  {entry.output && !entry.running && (
                    <button
                      onClick={e => { e.stopPropagation(); copyOutput(entry.id, entry.output) }}
                      className="flex items-center gap-1 h-6 px-2 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
                    >
                      {copiedEntryId === entry.id
                        ? <><Check className="h-2.5 w-2.5 text-emerald-500" /><span className="text-emerald-500">Copied</span></>
                        : <><Copy className="h-2.5 w-2.5" />Copy</>
                      }
                    </button>
                  )}
                  {entry.running ? (
                    <button
                      onClick={e => { e.stopPropagation(); killProcess(entry.id) }}
                      className="flex items-center gap-1 h-6 px-2 rounded text-[10px] font-medium bg-status-error/10 text-status-error border border-status-error/20 hover:bg-status-error/20 transition-colors"
                    >
                      <Square className="h-2.5 w-2.5" />
                      Kill
                    </button>
                  ) : (
                    <span className={cn(
                      'text-[10px] font-mono tabular px-1.5 py-0.5 rounded',
                      entry.exitCode === 0
                        ? 'text-status-done bg-status-done/10'
                        : 'text-status-error bg-status-error/10'
                    )}>
                      exit {entry.exitCode}
                    </span>
                  )}
                </div>
              </div>

              {/* Output */}
              {!isCollapsed && (
                <div className="border-t border-border">
                  {entry.output ? (
                    <pre
                      className="px-4 py-3 text-[12px] font-mono leading-relaxed overflow-x-auto max-h-[60vh] overflow-y-auto terminal-output"
                      dangerouslySetInnerHTML={{
                        __html: ansiConverter.toHtml(entry.output)
                      }}
                    />
                  ) : (
                    !entry.running && (
                      <div className="px-4 py-3 text-[11px] text-dim-foreground italic">
                        No output
                      </div>
                    )
                  )}
                  {/* Stdin input for running processes */}
                  {entry.running && (
                    <div className="px-4 py-2 border-t border-border bg-surface-0/50">
                      <div className="flex items-center gap-2">
                        <span className="text-dim-foreground text-xs font-mono">stdin:</span>
                        <input
                          type="text"
                          value={stdinInputs[entry.id] ?? ''}
                          onChange={e => setStdinInputs(prev => ({ ...prev, [entry.id]: e.target.value }))}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              sendStdin(entry.id)
                            }
                          }}
                          placeholder="Send input to process..."
                          className="flex-1 bg-transparent text-xs font-mono text-foreground placeholder:text-dim-foreground outline-none"
                          spellCheck={false}
                        />
                        <button
                          onClick={() => sendStdin(entry.id)}
                          className="flex items-center gap-1 h-6 px-2 rounded text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
                        >
                          <Send className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
        <div ref={outputEndRef} />
      </div>
    </div>
  )
}
