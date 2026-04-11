import { useWebPanels } from '@/hooks/useWebPanels'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, LayoutGrid } from 'lucide-react'

interface PanelsPageProps {
  onBack: () => void
}

export function PanelsPage({ onBack }: PanelsPageProps) {
  const panels = useWebPanels()

  return (
    <div className="flex flex-col h-full">
      <div className="px-8 pt-7 pb-5 border-b border-border bg-gradient-to-b from-surface-1/40 to-transparent">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center justify-center h-7 w-7 mt-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight gradient-text">Web panels</h1>
            <p className="text-[0.9375rem] text-muted-foreground mt-1">
              Session sidebar panels are loaded from <code className="mono text-[0.8125rem]">agent.web.panels</code>
              {' '}(builtin ids like <code className="mono text-[0.8125rem]">diff</code> or paths to panel modules).
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-4xl mx-auto space-y-3">
          {panels.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No panels are enabled. Add entries under <code className="mono text-[0.9375rem]">agent.web.panels</code> in your ra config.
            </p>
          ) : (
            <ul className="space-y-2">
              {panels.map(p => (
                <li
                  key={p.id}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border bg-surface-1/40"
                >
                  <LayoutGrid className="h-4 w-4 text-dim-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{p.title}</div>
                    <div className="text-[0.875rem] text-dim-foreground mono truncate">{p.id}</div>
                  </div>
                  <Badge variant="outline" className="mono text-[0.8125rem] shrink-0">
                    {p.source === 'builtin' ? 'builtin' : 'custom'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
