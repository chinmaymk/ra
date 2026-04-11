import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import type { ConfigSummary, ProviderInfo } from '@/lib/types'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Save, Loader2, CheckCircle2, Settings, Cpu, Shield, FileJson, Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ConfigPageProps {
  onBack: () => void
}

export function ConfigPage({ onBack }: ConfigPageProps) {
  const [config, setConfig] = useState<ConfigSummary | null>(null)
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rawCopied, setRawCopied] = useState(false)

  useEffect(() => {
    Promise.all([api.config.get(), api.providers.list()])
      .then(([c, p]) => {
        setConfig(c)
        setProviders(p)
      })
      .catch(err => setError(err.message))
  }, [])

  const update = <K extends keyof ConfigSummary>(key: K, value: ConfigSummary[K]) => {
    setConfig(prev => prev ? { ...prev, [key]: value } : prev)
    setDirty(true)
    setSaved(false)
  }

  const save = async () => {
    if (!config) return
    setSaving(true)
    setError(null)
    try {
      const updated = await api.config.update({
        provider: config.provider,
        model: config.model,
        thinking: config.thinking,
        systemPrompt: config.systemPrompt,
        maxIterations: config.maxIterations,
        toolTimeout: config.toolTimeout,
        parallelToolCalls: config.parallelToolCalls,
      })
      setConfig(updated)
      setDirty(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3 text-muted-foreground text-sm">
          {error
            ? <span className="text-destructive">{error}</span>
            : <>
                <div className="h-8 w-8 rounded-full border-2 border-border border-t-primary animate-spin" />
                <span>Loading configuration...</span>
              </>
          }
        </div>
      </div>
    )
  }

  const availableModels = providers.find(p => p.name === config.provider)?.models ?? []

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-8 pt-7 pb-5 border-b border-border bg-gradient-to-b from-surface-1/40 to-transparent">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <button
              onClick={onBack}
              className="flex items-center justify-center h-7 w-7 mt-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight gradient-text">Configuration</h1>
              <p className="text-xs text-muted-foreground mt-1">
                In-memory settings for the running ra instance. Affects all new agent runs.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {dirty && <Badge variant="warning">Unsaved changes</Badge>}
            <button
              onClick={save}
              disabled={!dirty || saving}
              className={cn(
                'flex items-center gap-1.5 h-8 px-3 rounded-md text-[11px] font-medium transition-all',
                !dirty || saving
                  ? 'bg-surface-2 text-dim-foreground cursor-not-allowed'
                  : saved
                    ? 'bg-success text-background shadow-sm'
                    : 'gradient-primary text-primary-foreground shadow-sm hover:opacity-90'
              )}
            >
              {saving
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : saved
                  ? <CheckCircle2 className="h-3 w-3" />
                  : <Save className="h-3 w-3" />
              }
              {saving ? 'Saving' : saved ? 'Saved' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <Tabs defaultValue="general" className="h-full flex flex-col">
          <div className="border-b border-border px-8 pt-3">
            <TabsList>
              <TabsTrigger value="general"><Settings className="h-3 w-3 mr-1.5" />General</TabsTrigger>
              <TabsTrigger value="provider"><Cpu className="h-3 w-3 mr-1.5" />Model</TabsTrigger>
              <TabsTrigger value="limits"><Shield className="h-3 w-3 mr-1.5" />Limits</TabsTrigger>
              <TabsTrigger value="raw"><FileJson className="h-3 w-3 mr-1.5" />Raw</TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 overflow-y-auto px-8 py-6">
            <TabsContent value="general" className="space-y-5 mt-0 max-w-3xl">
              <Section
                title="System prompt"
                description="The initial instructions given to the model. This shapes the agent's personality and constraints."
              >
                <Textarea
                  rows={10}
                  value={config.systemPrompt}
                  onChange={(e) => update('systemPrompt', e.target.value)}
                  placeholder="You are a helpful AI assistant."
                  className="mono text-xs leading-relaxed"
                />
                <div className="text-[10px] text-dim-foreground mt-1.5 mono">
                  {config.systemPrompt.length} chars
                </div>
              </Section>

              <Section
                title="Execution"
                description="How the agent loop runs."
              >
                <ToggleRow
                  label="Parallel tool calls"
                  description="Execute tool calls from a single response concurrently"
                  checked={config.parallelToolCalls}
                  onChange={(v) => update('parallelToolCalls', v)}
                />
              </Section>
            </TabsContent>

            <TabsContent value="provider" className="space-y-5 mt-0 max-w-3xl">
              <Section
                title="Model selection"
                description="Choose which provider and model to use for new agent runs."
              >
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Provider</Label>
                    <Select value={config.provider} onValueChange={(v) => update('provider', v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {providers.map(p => (
                          <SelectItem key={p.name} value={p.name}>
                            <div className="flex items-center gap-2">
                              {p.name}
                              {!p.hasCredentials && (
                                <span className="text-[9px] text-warning bg-warning/10 px-1 rounded">no creds</span>
                              )}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Model</Label>
                    <Select value={config.model} onValueChange={(v) => update('model', v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {availableModels.map(m => (
                          <SelectItem key={m.name} value={m.name}>{m.name}</SelectItem>
                        ))}
                        {!availableModels.some(m => m.name === config.model) && (
                          <SelectItem value={config.model}>{config.model} (current)</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </Section>

              <Section
                title="Reasoning"
                description="Extended thinking budget. Higher levels give the model more reasoning tokens but cost more."
              >
                <div className="space-y-1.5">
                  <Label>Thinking mode</Label>
                  <Select value={config.thinking ?? 'off'} onValueChange={(v) => update('thinking', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="off">Off — no extended thinking</SelectItem>
                      <SelectItem value="low">Low — light reasoning</SelectItem>
                      <SelectItem value="medium">Medium — balanced</SelectItem>
                      <SelectItem value="high">High — deep reasoning</SelectItem>
                      <SelectItem value="adaptive">Adaptive — model decides</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </Section>
            </TabsContent>

            <TabsContent value="limits" className="space-y-5 mt-0 max-w-3xl">
              <Section
                title="Loop limits"
                description="Safety boundaries to prevent runaway agents. Use 0 for unlimited."
              >
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Max iterations</Label>
                    <Input
                      type="number"
                      value={config.maxIterations}
                      onChange={(e) => update('maxIterations', parseInt(e.target.value) || 0)}
                      placeholder="0 = unlimited"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Tool timeout (ms)</Label>
                    <Input
                      type="number"
                      value={config.toolTimeout}
                      onChange={(e) => update('toolTimeout', parseInt(e.target.value) || 0)}
                      placeholder="120000"
                    />
                  </div>
                </div>
              </Section>
            </TabsContent>

            <TabsContent value="raw" className="mt-0 max-w-4xl">
              <div className="rounded-xl border border-border bg-surface-1/40 p-5">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">Raw configuration</h3>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">The full sanitized config object. Read-only — secrets are masked.</p>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(JSON.stringify(config.raw, null, 2))
                      setRawCopied(true)
                      setTimeout(() => setRawCopied(false), 1500)
                    }}
                    className="flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
                  >
                    {rawCopied
                      ? <><Check className="h-3 w-3 text-emerald-500" /><span className="text-emerald-500">Copied</span></>
                      : <><Copy className="h-3 w-3" />Copy</>
                    }
                  </button>
                </div>
                <pre className="mono text-[11px] bg-surface-0 border border-border p-4 rounded-lg overflow-x-auto max-h-[600px] leading-relaxed">
                  {JSON.stringify(config.raw, null, 2)}
                </pre>
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface-1/40 p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{description}</p>}
      </div>
      {children}
    </div>
  )
}

function ToggleRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1">
        <Label className="text-[12px] text-foreground font-medium">{label}</Label>
        <p className="text-[10px] text-muted-foreground mt-0.5">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}
