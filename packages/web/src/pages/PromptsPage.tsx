import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  ArrowLeft, Search, Bookmark, Plus, Copy, Trash2, Check, Pencil, Star,
  ChevronRight, ChevronDown, Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface PromptsPageProps {
  onBack: () => void
}

interface PromptTemplate {
  id: string
  name: string
  content: string
  createdAt: string
  starred: boolean
}

const STORAGE_KEY = 'ra-prompt-templates'

function loadTemplates(): PromptTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveTemplates(templates: PromptTemplate[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates))
}

export function PromptsPage({ onBack }: PromptsPageProps) {
  const [systemPrompt, setSystemPrompt] = useState('')
  const [editingSystem, setEditingSystem] = useState(false)
  const [systemDraft, setSystemDraft] = useState('')
  const [templates, setTemplates] = useState<PromptTemplate[]>(loadTemplates)
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newContent, setNewContent] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editContent, setEditContent] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    api.config.get().then(c => setSystemPrompt(c.systemPrompt)).catch(() => {})
  }, [])

  const persist = useCallback((next: PromptTemplate[]) => {
    setTemplates(next)
    saveTemplates(next)
  }, [])

  const handleSaveSystem = useCallback(async () => {
    try {
      await api.config.update({ systemPrompt: systemDraft })
      setSystemPrompt(systemDraft)
      setEditingSystem(false)
    } catch {
      // ignore
    }
  }, [systemDraft])

  const handleAdd = useCallback(() => {
    if (!newName.trim() || !newContent.trim()) return
    const template: PromptTemplate = {
      id: crypto.randomUUID(),
      name: newName.trim(),
      content: newContent.trim(),
      createdAt: new Date().toISOString(),
      starred: false,
    }
    persist([template, ...templates])
    setNewName('')
    setNewContent('')
    setAdding(false)
  }, [newName, newContent, templates, persist])

  const handleDelete = useCallback((id: string) => {
    persist(templates.filter(t => t.id !== id))
  }, [templates, persist])

  const handleToggleStar = useCallback((id: string) => {
    persist(templates.map(t => t.id === id ? { ...t, starred: !t.starred } : t))
  }, [templates, persist])

  const handleCopy = useCallback((id: string, content: string) => {
    navigator.clipboard.writeText(content)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }, [])

  const handleApplyAsSystem = useCallback(async (content: string) => {
    try {
      await api.config.update({ systemPrompt: content })
      setSystemPrompt(content)
    } catch {
      // ignore
    }
  }, [])

  const handleSaveEdit = useCallback(() => {
    if (!editingId || !editName.trim() || !editContent.trim()) return
    persist(templates.map(t =>
      t.id === editingId ? { ...t, name: editName.trim(), content: editContent.trim() } : t
    ))
    setEditingId(null)
  }, [editingId, editName, editContent, templates, persist])

  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverId(id)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    if (!dragId || dragId === targetId) {
      setDragId(null)
      setDragOverId(null)
      return
    }
    const source = templates.find(t => t.id === dragId)
    const target = templates.find(t => t.id === targetId)
    if (!source || !target) return
    // Only allow reorder within same starred group
    if (source.starred !== target.starred) {
      setDragId(null)
      setDragOverId(null)
      return
    }
    const next = [...templates]
    const fromIdx = next.findIndex(t => t.id === dragId)
    const toIdx = next.findIndex(t => t.id === targetId)
    next.splice(fromIdx, 1)
    next.splice(toIdx, 0, source)
    persist(next)
    setDragId(null)
    setDragOverId(null)
  }, [dragId, templates, persist])

  const handleDragEnd = useCallback(() => {
    setDragId(null)
    setDragOverId(null)
  }, [])

  // Sort: starred first, preserve user order within each group
  const sorted = [
    ...templates.filter(t => t.starred),
    ...templates.filter(t => !t.starred),
  ]

  const starred = templates.filter(t => t.starred)
  const filtered = sorted.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.content.toLowerCase().includes(search.toLowerCase())
  )

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
              <h1 className="text-2xl font-semibold tracking-tight gradient-text">Prompts</h1>
              <p className="text-xs text-muted-foreground mt-1">
                <span className="tabular text-foreground">{templates.length}</span> template{templates.length !== 1 ? 's' : ''}
                {starred.length > 0 && (
                  <>
                    <span className="opacity-30 mx-1.5">·</span>
                    <span className="tabular text-foreground">{starred.length}</span> starred
                  </>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-dim-foreground" />
              <Input
                placeholder="Search prompts..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1.5 h-9 px-3 rounded-md gradient-primary text-primary-foreground text-[11px] font-medium shadow-sm hover:opacity-90 transition-opacity"
            >
              <Plus className="h-3 w-3" />
              New template
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-4xl mx-auto space-y-7">

          {/* ─── Active system prompt ─────────────────── */}
          <div>
            <div className="flex items-center gap-2 mb-3 px-1">
              <div className="flex h-5 w-5 items-center justify-center rounded bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30 text-primary">
                <Sparkles className="h-3 w-3" />
              </div>
              <h2 className="text-[10px] uppercase tracking-[0.08em] font-semibold text-muted-foreground">Active system prompt</h2>
            </div>
            <div className="rounded-xl border border-primary/20 bg-surface-1/40 p-5 fade-in">
              {editingSystem ? (
                <div className="space-y-3">
                  <textarea
                    value={systemDraft}
                    onChange={(e) => setSystemDraft(e.target.value)}
                    className="w-full min-h-[120px] bg-surface-0 border border-border rounded-md p-3 text-[12px] mono leading-relaxed resize-y focus:outline-none focus:ring-1 focus:ring-primary/50 text-foreground"
                    autoFocus
                  />
                  <div className="flex items-center gap-2 justify-end">
                    <button
                      onClick={() => setEditingSystem(false)}
                      className="h-7 px-3 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveSystem}
                      className="h-7 px-3 rounded-md gradient-primary text-primary-foreground text-[11px] font-medium shadow-sm hover:opacity-90 transition-opacity"
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <div className="group">
                  <pre className="text-[12px] mono text-foreground/90 whitespace-pre-wrap leading-relaxed">
                    {systemPrompt || 'No system prompt configured'}
                  </pre>
                  <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-border opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => { setSystemDraft(systemPrompt); setEditingSystem(true) }}
                      className="flex items-center gap-1.5 h-6 px-2 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
                    >
                      <Pencil className="h-3 w-3" />
                      Edit
                    </button>
                    <button
                      onClick={() => handleCopy('system', systemPrompt)}
                      className="flex items-center gap-1.5 h-6 px-2 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
                    >
                      {copiedId === 'system' ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                      {copiedId === 'system' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ─── New template form ─────────────────── */}
          {adding && (
            <div className="rounded-xl border border-primary/30 bg-surface-1 p-5 fade-in shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <Plus className="h-3.5 w-3.5 text-primary" />
                <span className="text-[11px] font-semibold text-foreground">New prompt template</span>
              </div>
              <div className="space-y-3">
                <Input
                  placeholder="Template name..."
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="h-8 text-[12px]"
                  autoFocus
                />
                <textarea
                  placeholder="Prompt content..."
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  className="w-full min-h-[100px] bg-surface-0 border border-border rounded-md p-3 text-[12px] mono leading-relaxed resize-y focus:outline-none focus:ring-1 focus:ring-primary/50 text-foreground placeholder:text-dim-foreground"
                />
                <div className="flex items-center gap-2 justify-end">
                  <button
                    onClick={() => { setAdding(false); setNewName(''); setNewContent('') }}
                    className="h-7 px-3 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAdd}
                    disabled={!newName.trim() || !newContent.trim()}
                    className="h-7 px-3 rounded-md gradient-primary text-primary-foreground text-[11px] font-medium shadow-sm hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    Save template
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ─── Templates ─────────────────── */}
          {filtered.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3 px-1">
                <div className="flex h-5 w-5 items-center justify-center rounded bg-surface-2 border border-border text-muted-foreground">
                  <Bookmark className="h-3 w-3" />
                </div>
                <h2 className="text-[10px] uppercase tracking-[0.08em] font-semibold text-muted-foreground">Templates</h2>
                <Badge variant="muted" className="h-4 px-1.5 normal-case tracking-normal">{filtered.length}</Badge>
              </div>
              <div className="space-y-1.5">
                {filtered.map((template, i) => {
                  const isExpanded = expandedId === template.id
                  const isEditing = editingId === template.id
                  return (
                    <div
                      key={template.id}
                      draggable={!isEditing}
                      onDragStart={(e) => handleDragStart(e, template.id)}
                      onDragOver={(e) => handleDragOver(e, template.id)}
                      onDrop={(e) => handleDrop(e, template.id)}
                      onDragEnd={handleDragEnd}
                      className={cn(
                        'rounded-lg border bg-surface-1/40 transition-all duration-200 fade-in',
                        isExpanded
                          ? 'border-primary/30 bg-surface-1 shadow-sm'
                          : 'border-border hover:bg-surface-1 hover:border-border-strong',
                        dragId === template.id && 'opacity-40',
                        dragOverId === template.id && dragId !== template.id && 'border-primary/50 bg-primary/5'
                      )}
                      style={{ animationDelay: `${Math.min(i * 15, 200)}ms` }}
                    >
                      <div className="p-3.5">
                        <div
                          className="flex items-start gap-3 cursor-pointer"
                          onClick={() => setExpandedId(isExpanded ? null : template.id)}
                        >
                          {isExpanded
                            ? <ChevronDown className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                            : <ChevronRight className="h-3.5 w-3.5 mt-0.5 text-dim-foreground shrink-0" />
                          }
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-semibold text-[13px]">{template.name}</span>
                              {template.starred && (
                                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                              )}
                            </div>
                            <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed mono">
                              {template.content}
                            </p>
                          </div>
                          <span className="text-[10px] text-dim-foreground shrink-0 tabular mt-0.5">
                            {new Date(template.createdAt).toLocaleDateString()}
                          </span>
                        </div>

                        {isExpanded && (
                          <div className="mt-4 ml-6 pt-3 border-t border-border">
                            {isEditing ? (
                              <div className="space-y-3">
                                <Input
                                  value={editName}
                                  onChange={(e) => setEditName(e.target.value)}
                                  className="h-8 text-[12px]"
                                  autoFocus
                                />
                                <textarea
                                  value={editContent}
                                  onChange={(e) => setEditContent(e.target.value)}
                                  className="w-full min-h-[100px] bg-surface-0 border border-border rounded-md p-3 text-[12px] mono leading-relaxed resize-y focus:outline-none focus:ring-1 focus:ring-primary/50 text-foreground"
                                />
                                <div className="flex items-center gap-2 justify-end">
                                  <button
                                    onClick={() => setEditingId(null)}
                                    className="h-7 px-3 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={handleSaveEdit}
                                    className="h-7 px-3 rounded-md gradient-primary text-primary-foreground text-[11px] font-medium shadow-sm hover:opacity-90 transition-opacity"
                                  >
                                    Save
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <pre className="text-[11px] mono bg-surface-0 border border-border p-3 rounded-md whitespace-pre-wrap max-h-72 overflow-y-auto leading-relaxed">
                                  {template.content}
                                </pre>
                                <div className="flex items-center gap-1.5 mt-3">
                                  <button
                                    onClick={() => handleApplyAsSystem(template.content)}
                                    className="flex items-center gap-1.5 h-6 px-2 rounded text-[10px] font-medium text-primary hover:bg-primary/10 transition-colors"
                                  >
                                    <Sparkles className="h-3 w-3" />
                                    Apply as system prompt
                                  </button>
                                  <button
                                    onClick={() => handleCopy(template.id, template.content)}
                                    className="flex items-center gap-1.5 h-6 px-2 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
                                  >
                                    {copiedId === template.id ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                                    {copiedId === template.id ? 'Copied' : 'Copy'}
                                  </button>
                                  <button
                                    onClick={() => { setEditingId(template.id); setEditName(template.name); setEditContent(template.content) }}
                                    className="flex items-center gap-1.5 h-6 px-2 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
                                  >
                                    <Pencil className="h-3 w-3" />
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => handleToggleStar(template.id)}
                                    className="flex items-center gap-1.5 h-6 px-2 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
                                  >
                                    <Star className={cn('h-3 w-3', template.starred && 'fill-amber-400 text-amber-400')} />
                                    {template.starred ? 'Unstar' : 'Star'}
                                  </button>
                                  <button
                                    onClick={() => handleDelete(template.id)}
                                    className="flex items-center gap-1.5 h-6 px-2 rounded text-[10px] text-red-400 hover:bg-red-500/10 transition-colors ml-auto"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                    Delete
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Empty state */}
          {templates.length === 0 && !adding && (
            <div className="text-center py-20 fade-in">
              <div className="flex justify-center mb-4">
                <div className="h-12 w-12 rounded-xl bg-surface-2 border border-border flex items-center justify-center">
                  <Bookmark className="h-5 w-5 text-dim-foreground" />
                </div>
              </div>
              <p className="text-sm text-muted-foreground mb-1">No prompt templates yet</p>
              <p className="text-[11px] text-dim-foreground mb-4">Save reusable prompts to quickly apply them as system prompts</p>
              <button
                onClick={() => setAdding(true)}
                className="inline-flex items-center gap-1.5 h-8 px-4 rounded-md gradient-primary text-primary-foreground text-[11px] font-medium shadow-sm hover:opacity-90 transition-opacity"
              >
                <Plus className="h-3 w-3" />
                Create your first template
              </button>
            </div>
          )}

          {filtered.length === 0 && templates.length > 0 && search && (
            <div className="text-center py-20 text-muted-foreground text-sm">
              No templates match your search
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
