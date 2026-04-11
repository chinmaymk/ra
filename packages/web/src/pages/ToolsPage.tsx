import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import type { ToolInfo } from '@/lib/types'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Search, Wrench, Boxes, Package, ChevronRight, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ToolsPageProps {
  onBack: () => void
}

export function ToolsPage({ onBack }: ToolsPageProps) {
  const [tools, setTools] = useState<ToolInfo[]>([])
  const [search, setSearch] = useState('')
  const [expandedTool, setExpandedTool] = useState<string | null>(null)

  useEffect(() => {
    api.tools.list().then(setTools).catch(() => {})
  }, [])

  const filtered = tools.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.description.toLowerCase().includes(search.toLowerCase())
  )

  const grouped = {
    builtin: filtered.filter(t => t.source === 'builtin'),
    custom: filtered.filter(t => t.source === 'custom'),
    mcp: filtered.filter(t => t.source === 'mcp'),
  }

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
              <h1 className="text-2xl font-semibold tracking-tight gradient-text">Tools</h1>
              <p className="text-xs text-muted-foreground mt-1">
                <span className="tabular text-foreground">{tools.length}</span> registered
                <span className="opacity-30 mx-1.5">·</span>
                <span className="tabular text-foreground">{grouped.builtin.length}</span> built-in
                <span className="opacity-30 mx-1.5">·</span>
                <span className="tabular text-foreground">{grouped.mcp.length}</span> MCP
                <span className="opacity-30 mx-1.5">·</span>
                <span className="tabular text-foreground">{grouped.custom.length}</span> custom
              </p>
            </div>
          </div>
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-dim-foreground" />
            <Input
              placeholder="Search tools..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-7">
        {grouped.builtin.length > 0 && (
          <ToolGroup
            title="Built-in"
            icon={<Wrench className="h-3 w-3" />}
            tools={grouped.builtin}
            expandedTool={expandedTool}
            setExpandedTool={setExpandedTool}
          />
        )}
        {grouped.mcp.length > 0 && (
          <ToolGroup
            title="MCP servers"
            icon={<Boxes className="h-3 w-3" />}
            tools={grouped.mcp}
            expandedTool={expandedTool}
            setExpandedTool={setExpandedTool}
          />
        )}
        {grouped.custom.length > 0 && (
          <ToolGroup
            title="Custom"
            icon={<Package className="h-3 w-3" />}
            tools={grouped.custom}
            expandedTool={expandedTool}
            setExpandedTool={setExpandedTool}
          />
        )}
        {filtered.length === 0 && (
          <div className="text-center py-20 text-muted-foreground text-sm">
            {tools.length === 0 ? 'Loading tools...' : 'No tools match your search'}
          </div>
        )}
      </div>
    </div>
  )
}

function ToolGroup({
  title,
  icon,
  tools,
  expandedTool,
  setExpandedTool,
}: {
  title: string
  icon: React.ReactNode
  tools: ToolInfo[]
  expandedTool: string | null
  setExpandedTool: (id: string | null) => void
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3 px-1">
        <div className="flex h-5 w-5 items-center justify-center rounded bg-surface-2 border border-border text-muted-foreground">
          {icon}
        </div>
        <h2 className="text-[10px] uppercase tracking-[0.08em] font-semibold text-muted-foreground">{title}</h2>
        <Badge variant="muted" className="h-4 px-1.5 normal-case tracking-normal">{tools.length}</Badge>
        {/* Enabled/disabled mini bar */}
        {(() => {
          const enabled = tools.filter(t => t.enabled !== false).length
          const disabled = tools.length - enabled
          if (tools.length === 0) return null
          return (
            <div className="flex items-center gap-1.5 ml-2">
              <div className="flex h-2 w-20 rounded-full overflow-hidden bg-surface-2 border border-border">
                {enabled > 0 && (
                  <div
                    className="h-full bg-primary/70 transition-all"
                    style={{ width: `${(enabled / tools.length) * 100}%` }}
                  />
                )}
                {disabled > 0 && (
                  <div
                    className="h-full bg-dim-foreground/20 transition-all"
                    style={{ width: `${(disabled / tools.length) * 100}%` }}
                  />
                )}
              </div>
              <span className="text-[9px] text-dim-foreground mono tabular">
                {enabled}<span className="opacity-50">/{tools.length}</span>
              </span>
            </div>
          )
        })()}
      </div>
      <div className="space-y-1.5">
        {tools.map((tool, i) => {
          const isExpanded = expandedTool === tool.name
          return (
            <div
              key={tool.name}
              className={cn(
                'rounded-lg border bg-surface-1/40 cursor-pointer transition-all duration-200 fade-in',
                isExpanded
                  ? 'border-primary/30 bg-surface-1 shadow-sm'
                  : 'border-border hover:bg-surface-1 hover:border-border-strong',
                !tool.enabled && 'opacity-50'
              )}
              onClick={() => setExpandedTool(isExpanded ? null : tool.name)}
              style={{ animationDelay: `${Math.min(i * 15, 200)}ms` }}
            >
              <div className="p-3.5">
                <div className="flex items-start gap-3">
                  {isExpanded
                    ? <ChevronDown className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                    : <ChevronRight className="h-3.5 w-3.5 mt-0.5 text-dim-foreground shrink-0" />
                  }
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn('mono font-semibold text-[13px]', !tool.enabled && 'line-through text-muted-foreground')}>{tool.name}</span>
                      {!tool.enabled && <Badge variant="muted">disabled</Badge>}
                    </div>
                    <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">{tool.description}</p>
                  </div>
                </div>
                {isExpanded && tool.schema && (
                  <div className="mt-4 ml-6 pt-3 border-t border-border">
                    <div className="text-[9px] uppercase tracking-[0.08em] font-semibold text-dim-foreground mb-1.5">Input schema</div>
                    <pre className="text-[11px] mono bg-surface-0 border border-border p-3 rounded-md overflow-x-auto max-h-72 leading-relaxed">
                      {JSON.stringify(tool.schema, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
