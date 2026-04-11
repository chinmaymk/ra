import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '@/lib/api'
import type { MiddlewareInfo } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Layers, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MiddlewarePageProps {
  onBack: () => void
}

const HOOK_DESCRIPTIONS: Record<string, string> = {
  beforeLoopBegin: 'Runs once before the agent loop starts. Can inject initial state.',
  beforeModelCall: 'Runs before each provider call. Can modify messages, tools, or request.',
  onStreamChunk: 'Runs for each streaming chunk (text, thinking, tool calls).',
  afterModelResponse: 'Runs after the full model response is collected.',
  beforeToolExecution: 'Runs before each tool call. Can deny execution.',
  afterToolExecution: 'Runs after each tool call completes. Inspects results.',
  afterLoopIteration: 'Runs at the end of each loop iteration.',
  afterLoopComplete: 'Runs once when the loop finishes.',
  onError: 'Runs when an error occurs during execution.',
}

export function MiddlewarePage({ onBack }: MiddlewarePageProps) {
  const [hooks, setHooks] = useState<MiddlewareInfo[]>([])

  useEffect(() => {
    api.middleware.list().then(setHooks).catch(() => {})
  }, [])

  const hookRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const total = hooks.reduce((sum, h) => sum + h.names.length, 0)
  const activeHooks = hooks.filter(h => h.names.length > 0).length

  const scrollToHook = useCallback((hookName: string) => {
    const el = hookRefs.current.get(hookName)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  return (
    <div className="flex flex-col h-full">
      <div className="px-8 pt-7 pb-5 border-b border-border bg-gradient-to-b from-surface-1/40 to-transparent">
        <div className="flex items-start gap-3">
          <button
            onClick={onBack}
            className="flex items-center justify-center h-7 w-7 mt-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight gradient-text">Middleware</h1>
            <p className="text-xs text-muted-foreground mt-1">
              <span className="tabular text-foreground">{total}</span> middleware function{total !== 1 ? 's' : ''}
              <span className="opacity-30 mx-1.5">·</span>
              <span className="tabular text-foreground">{activeHooks}</span> active hook{activeHooks !== 1 ? 's' : ''}
              <span className="opacity-30 mx-1.5">·</span>
              <span>{hooks.length} total hook points</span>
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-4xl mx-auto space-y-3">
          {/* Timeline visualization */}
          {hooks.length > 0 && (
            <div className="flex items-center justify-center gap-0 mb-6 px-4 py-4 rounded-xl border border-border bg-surface-1/40">
              {hooks.map((hook, i) => {
                const isActive = hook.names.length > 0
                return (
                  <div key={hook.hook} className="flex items-center">
                    <button
                      onClick={() => scrollToHook(hook.hook)}
                      className="group flex flex-col items-center gap-1.5 px-1 transition-all"
                      title={hook.hook}
                    >
                      <div
                        className={cn(
                          'h-3.5 w-3.5 rounded-full border-2 transition-all cursor-pointer group-hover:scale-125',
                          isActive
                            ? 'bg-primary border-primary shadow-sm shadow-primary/30'
                            : 'bg-transparent border-dim-foreground/40 group-hover:border-muted-foreground'
                        )}
                      />
                      <span className={cn(
                        'text-[8px] font-mono leading-none max-w-[60px] text-center truncate transition-colors',
                        isActive ? 'text-primary font-semibold' : 'text-dim-foreground group-hover:text-muted-foreground'
                      )}>
                        {hook.hook.replace(/^(before|after|on)/, '')}
                      </span>
                    </button>
                    {i < hooks.length - 1 && (
                      <div className={cn(
                        'h-[2px] w-6 -mx-0.5',
                        isActive && hooks[i + 1]?.names.length > 0
                          ? 'bg-primary/40'
                          : 'bg-border'
                      )} />
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <div className="text-[11px] text-muted-foreground mb-4 px-1 leading-relaxed">
            Middleware hooks execute in array order during the agent loop. All contexts extend{' '}
            <code className="mono bg-surface-2 px-1.5 py-0.5 rounded text-foreground">StoppableContext</code>
            {' '}and can call <code className="mono bg-surface-2 px-1.5 py-0.5 rounded text-foreground">stop()</code> to halt execution.
          </div>

          {hooks.map((hook, i) => {
            const hasMiddleware = hook.names.length > 0
            return (
              <div
                key={hook.hook}
                ref={(el) => { if (el) hookRefs.current.set(hook.hook, el); else hookRefs.current.delete(hook.hook) }}
                className={cn(
                  'rounded-xl border bg-surface-1/40 transition-all fade-in',
                  hasMiddleware
                    ? 'border-border hover:bg-surface-1'
                    : 'border-border opacity-60'
                )}
                style={{ animationDelay: `${Math.min(i * 30, 250)}ms` }}
              >
                <div className="p-5">
                  <div className="flex items-start gap-4">
                    <div className={cn(
                      'h-9 w-9 rounded-lg flex items-center justify-center shrink-0 border',
                      hasMiddleware
                        ? 'bg-gradient-to-br from-primary/20 to-primary/5 border-primary/30 text-primary'
                        : 'bg-surface-2 border-border text-dim-foreground'
                    )}>
                      <Layers className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="mono font-semibold text-sm">{hook.hook}</span>
                        <Badge variant={hasMiddleware ? 'default' : 'muted'} className="h-4 px-1.5 normal-case tracking-normal">
                          {hook.names.length}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">
                        {HOOK_DESCRIPTIONS[hook.hook]}
                      </p>
                      {hasMiddleware && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-3 border-t border-border">
                          <span className="text-[9px] uppercase tracking-[0.08em] text-dim-foreground font-semibold mr-1">
                            Pipeline
                          </span>
                          {hook.names.map((name, idx) => (
                            <div key={idx} className="flex items-center gap-1.5">
                              <div className="mono text-[10px] bg-surface-0 px-2 py-0.5 rounded border border-border-strong text-foreground/90">
                                {name}
                              </div>
                              {idx < hook.names.length - 1 && (
                                <ArrowRight className="h-3 w-3 text-dim-foreground" />
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
