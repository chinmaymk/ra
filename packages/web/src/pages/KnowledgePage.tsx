import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { api } from '@/lib/api'
import type { KnowledgeBase, KnowledgeDocument } from '@/lib/types'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  ArrowLeft, Search, Plus, Trash2, BookOpen, FileText, Upload, Database,
  ChevronRight, ChevronDown, Pencil, MoreHorizontal, AlertCircle,
  Loader2, Check, X, Brain, HardDrive,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface KnowledgePageProps {
  onBack: () => void
}

// ─── Helpers ───────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}

const MIME_LABELS: Record<string, { label: string; color: string }> = {
  'text/plain': { label: 'TXT', color: 'text-blue-400' },
  'text/markdown': { label: 'MD', color: 'text-purple-400' },
  'application/pdf': { label: 'PDF', color: 'text-red-400' },
  'text/csv': { label: 'CSV', color: 'text-green-400' },
  'application/json': { label: 'JSON', color: 'text-amber-400' },
  'text/html': { label: 'HTML', color: 'text-orange-400' },
}

const EMBEDDING_MODELS = [
  { value: 'text-embedding-3-small', label: 'text-embedding-3-small', provider: 'OpenAI' },
  { value: 'text-embedding-3-large', label: 'text-embedding-3-large', provider: 'OpenAI' },
  { value: 'text-embedding-ada-002', label: 'text-embedding-ada-002', provider: 'OpenAI' },
  { value: 'voyage-3', label: 'voyage-3', provider: 'Voyage' },
  { value: 'voyage-code-3', label: 'voyage-code-3', provider: 'Voyage' },
]

// ─── Main Component ────────────────────────────────────────

export function KnowledgePage({ onBack }: KnowledgePageProps) {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  // Create form state
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newEmbedding, setNewEmbedding] = useState(EMBEDDING_MODELS[0].value)

  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')

  // Delete confirmation
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const refresh = useCallback(() => {
    api.knowledge.list()
      .then(setKnowledgeBases)
      .catch(() => setKnowledgeBases([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return
    try {
      await api.knowledge.create(newName.trim(), newDescription.trim(), newEmbedding)
      setNewName('')
      setNewDescription('')
      setNewEmbedding(EMBEDDING_MODELS[0].value)
      setCreating(false)
      refresh()
    } catch (err) {
      console.error('Failed to create knowledge base:', err)
    }
  }, [newName, newDescription, newEmbedding, refresh])

  const handleDelete = useCallback(async (id: string) => {
    try {
      await api.knowledge.delete(id)
      setConfirmDeleteId(null)
      if (expandedId === id) setExpandedId(null)
      refresh()
    } catch (err) {
      console.error('Failed to delete knowledge base:', err)
    }
  }, [expandedId, refresh])

  const handleSaveEdit = useCallback(async () => {
    if (!editingId || !editName.trim()) return
    try {
      await api.knowledge.update(editingId, {
        name: editName.trim(),
        description: editDescription.trim(),
      })
      setEditingId(null)
      refresh()
    } catch (err) {
      console.error('Failed to update knowledge base:', err)
    }
  }, [editingId, editName, editDescription, refresh])

  const filtered = useMemo(() =>
    knowledgeBases.filter(kb =>
      kb.name.toLowerCase().includes(search.toLowerCase()) ||
      kb.description.toLowerCase().includes(search.toLowerCase())
    ),
    [knowledgeBases, search]
  )

  const totalDocs = knowledgeBases.reduce((sum, kb) => sum + kb.documentCount, 0)
  const totalTokens = knowledgeBases.reduce((sum, kb) => sum + kb.totalTokens, 0)

  return (
    <div className="flex flex-col h-full">
      {/* ─── Header ─────────────────────────────────── */}
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
              <h1 className="text-2xl font-semibold tracking-tight gradient-text">Knowledge</h1>
              <p className="text-xs text-muted-foreground mt-1">
                <span className="tabular text-foreground">{knowledgeBases.length}</span> base{knowledgeBases.length !== 1 ? 's' : ''}
                <span className="opacity-30 mx-1.5">·</span>
                <span className="tabular text-foreground">{totalDocs}</span> document{totalDocs !== 1 ? 's' : ''}
                <span className="opacity-30 mx-1.5">·</span>
                <span className="tabular text-foreground">{formatTokens(totalTokens)}</span> tokens
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-dim-foreground" />
              <Input
                placeholder="Search knowledge bases..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
            <button
              onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 h-9 px-3 rounded-md gradient-primary text-primary-foreground text-[11px] font-medium shadow-sm hover:opacity-90 transition-opacity"
            >
              <Plus className="h-3 w-3" />
              New knowledge base
            </button>
          </div>
        </div>
      </div>

      {/* ─── Content ────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-4xl mx-auto space-y-7">

          {/* ─── Create form ──────────────── */}
          {creating && (
            <div className="rounded-xl border border-primary/30 bg-surface-1 p-5 fade-in shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30 text-primary">
                  <Database className="h-3.5 w-3.5" />
                </div>
                <span className="text-[12px] font-semibold text-foreground">Create knowledge base</span>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] uppercase tracking-[0.06em] font-semibold text-muted-foreground mb-1.5 block">Name</label>
                  <Input
                    placeholder="e.g. API documentation, Codebase reference..."
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="h-9 text-[12px]"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-[0.06em] font-semibold text-muted-foreground mb-1.5 block">Description</label>
                  <textarea
                    placeholder="What kind of knowledge does this base contain?"
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    className="w-full min-h-[72px] bg-surface-0 border border-border rounded-md p-3 text-[12px] leading-relaxed resize-y focus:outline-none focus:ring-1 focus:ring-primary/50 text-foreground placeholder:text-dim-foreground"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-[0.06em] font-semibold text-muted-foreground mb-1.5 block">Embedding model</label>
                  <div className="flex flex-wrap gap-1.5">
                    {EMBEDDING_MODELS.map(model => (
                      <button
                        key={model.value}
                        onClick={() => setNewEmbedding(model.value)}
                        className={cn(
                          'flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[10px] font-medium border transition-colors',
                          newEmbedding === model.value
                            ? 'border-primary/40 bg-primary/10 text-primary'
                            : 'border-border bg-surface-0 text-muted-foreground hover:text-foreground hover:border-border-strong'
                        )}
                      >
                        <Brain className="h-3 w-3" />
                        <span className="mono">{model.label}</span>
                        <span className="text-[9px] text-dim-foreground">{model.provider}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 justify-end pt-1">
                  <button
                    onClick={() => { setCreating(false); setNewName(''); setNewDescription('') }}
                    className="h-7 px-3 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={!newName.trim()}
                    className="h-7 px-3 rounded-md gradient-primary text-primary-foreground text-[11px] font-medium shadow-sm hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    Create
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ─── Knowledge base list ──────────────── */}
          {filtered.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3 px-1">
                <div className="flex h-5 w-5 items-center justify-center rounded bg-surface-2 border border-border text-muted-foreground">
                  <BookOpen className="h-3 w-3" />
                </div>
                <h2 className="text-[10px] uppercase tracking-[0.08em] font-semibold text-muted-foreground">Knowledge bases</h2>
                <Badge variant="muted" className="h-4 px-1.5 normal-case tracking-normal">{filtered.length}</Badge>
              </div>
              <div className="space-y-2">
                {filtered.map((kb, i) => (
                  <KnowledgeBaseCard
                    key={kb.id}
                    kb={kb}
                    index={i}
                    isExpanded={expandedId === kb.id}
                    isEditing={editingId === kb.id}
                    isConfirmingDelete={confirmDeleteId === kb.id}
                    editName={editName}
                    editDescription={editDescription}
                    onToggleExpand={() => setExpandedId(expandedId === kb.id ? null : kb.id)}
                    onStartEdit={() => {
                      setEditingId(kb.id)
                      setEditName(kb.name)
                      setEditDescription(kb.description)
                    }}
                    onCancelEdit={() => setEditingId(null)}
                    onSaveEdit={handleSaveEdit}
                    onSetEditName={setEditName}
                    onSetEditDescription={setEditDescription}
                    onConfirmDelete={() => setConfirmDeleteId(kb.id)}
                    onCancelDelete={() => setConfirmDeleteId(null)}
                    onDelete={() => handleDelete(kb.id)}
                    onRefresh={refresh}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ─── Loading state ──────────────── */}
          {loading && (
            <div className="text-center py-20 fade-in">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Loading knowledge bases...</p>
            </div>
          )}

          {/* ─── Empty state ──────────────── */}
          {!loading && knowledgeBases.length === 0 && !creating && (
            <div className="text-center py-20 fade-in">
              <div className="flex justify-center mb-4">
                <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 flex items-center justify-center">
                  <BookOpen className="h-6 w-6 text-primary/60" />
                </div>
              </div>
              <p className="text-sm font-medium text-foreground mb-1">No knowledge bases yet</p>
              <p className="text-[11px] text-muted-foreground mb-5 max-w-sm mx-auto leading-relaxed">
                Create a knowledge base to give your agents access to custom documents via RAG retrieval. Upload text, markdown, PDFs, and more.
              </p>
              <button
                onClick={() => setCreating(true)}
                className="inline-flex items-center gap-1.5 h-8 px-4 rounded-md gradient-primary text-primary-foreground text-[11px] font-medium shadow-sm hover:opacity-90 transition-opacity"
              >
                <Plus className="h-3 w-3" />
                Create your first knowledge base
              </button>
            </div>
          )}

          {/* ─── No search results ──────────────── */}
          {!loading && filtered.length === 0 && knowledgeBases.length > 0 && search && (
            <div className="text-center py-20 text-muted-foreground text-sm">
              No knowledge bases match your search
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Knowledge Base Card ───────────────────────────────────

function KnowledgeBaseCard({
  kb,
  index,
  isExpanded,
  isEditing,
  isConfirmingDelete,
  editName,
  editDescription,
  onToggleExpand,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onSetEditName,
  onSetEditDescription,
  onConfirmDelete,
  onCancelDelete,
  onDelete,
  onRefresh,
}: {
  kb: KnowledgeBase
  index: number
  isExpanded: boolean
  isEditing: boolean
  isConfirmingDelete: boolean
  editName: string
  editDescription: string
  onToggleExpand: () => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  onSetEditName: (v: string) => void
  onSetEditDescription: (v: string) => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
  onDelete: () => void
  onRefresh: () => void
}) {
  return (
    <div
      className={cn(
        'rounded-xl border transition-all duration-200 fade-in',
        isExpanded
          ? 'border-primary/30 bg-surface-1 shadow-sm'
          : 'border-border bg-surface-1/40 hover:bg-surface-1 hover:border-border-strong'
      )}
      style={{ animationDelay: `${Math.min(index * 25, 200)}ms` }}
    >
      <div className="p-4">
        {/* ─── Card header (always visible) ─── */}
        <div className="flex items-start gap-3 cursor-pointer" onClick={onToggleExpand}>
          <div className={cn(
            'h-9 w-9 rounded-lg flex items-center justify-center shrink-0 border mt-0.5',
            isExpanded
              ? 'bg-gradient-to-br from-primary/20 to-primary/5 border-primary/30 text-primary'
              : 'bg-surface-2 border-border text-muted-foreground'
          )}>
            <BookOpen className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold text-[13px] truncate">{kb.name}</span>
              {isExpanded
                ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                : <ChevronRight className="h-3.5 w-3.5 text-dim-foreground shrink-0" />
              }
            </div>
            {kb.description && (
              <p className="text-[11px] text-muted-foreground line-clamp-1 leading-relaxed mb-2">
                {kb.description}
              </p>
            )}
            <div className="flex items-center gap-3 text-[10px] text-dim-foreground">
              <span className="flex items-center gap-1">
                <FileText className="h-3 w-3" />
                <span className="tabular">{kb.documentCount}</span> doc{kb.documentCount !== 1 ? 's' : ''}
              </span>
              <span className="flex items-center gap-1">
                <HardDrive className="h-3 w-3" />
                <span className="tabular">{formatTokens(kb.totalTokens)}</span> tokens
              </span>
              <span className="flex items-center gap-1">
                <Brain className="h-3 w-3" />
                <span className="mono">{kb.embedding}</span>
              </span>
              <span className="ml-auto">{timeAgo(kb.updatedAt)}</span>
            </div>
          </div>
        </div>

        {/* ─── Expanded panel ─── */}
        {isExpanded && (
          <div className="mt-4 pt-4 border-t border-border">
            {isEditing ? (
              /* ─── Edit mode ─── */
              <div className="space-y-3 ml-12">
                <div>
                  <label className="text-[10px] uppercase tracking-[0.06em] font-semibold text-muted-foreground mb-1.5 block">Name</label>
                  <Input
                    value={editName}
                    onChange={(e) => onSetEditName(e.target.value)}
                    className="h-8 text-[12px]"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-[0.06em] font-semibold text-muted-foreground mb-1.5 block">Description</label>
                  <textarea
                    value={editDescription}
                    onChange={(e) => onSetEditDescription(e.target.value)}
                    className="w-full min-h-[60px] bg-surface-0 border border-border rounded-md p-3 text-[12px] leading-relaxed resize-y focus:outline-none focus:ring-1 focus:ring-primary/50 text-foreground"
                  />
                </div>
                <div className="flex items-center gap-2 justify-end">
                  <button
                    onClick={onCancelEdit}
                    className="h-7 px-3 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={onSaveEdit}
                    disabled={!editName.trim()}
                    className="h-7 px-3 rounded-md gradient-primary text-primary-foreground text-[11px] font-medium shadow-sm hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    Save changes
                  </button>
                </div>
              </div>
            ) : (
              /* ─── Document list + actions ─── */
              <div className="ml-12 space-y-4">
                {/* Documents section */}
                <DocumentList knowledgeBaseId={kb.id} onRefresh={onRefresh} />

                {/* Action bar */}
                <div className="flex items-center gap-1.5 pt-3 border-t border-border">
                  <button
                    onClick={onStartEdit}
                    className="flex items-center gap-1.5 h-6 px-2 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
                  >
                    <Pencil className="h-3 w-3" />
                    Edit
                  </button>

                  {isConfirmingDelete ? (
                    <div className="flex items-center gap-1.5 ml-auto">
                      <span className="text-[10px] text-red-400">Delete this knowledge base?</span>
                      <button
                        onClick={onDelete}
                        className="flex items-center gap-1 h-6 px-2 rounded text-[10px] font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors"
                      >
                        <Check className="h-3 w-3" />
                        Confirm
                      </button>
                      <button
                        onClick={onCancelDelete}
                        className="flex items-center gap-1 h-6 px-2 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
                      >
                        <X className="h-3 w-3" />
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={onConfirmDelete}
                      className="flex items-center gap-1.5 h-6 px-2 rounded text-[10px] text-red-400 hover:bg-red-500/10 transition-colors ml-auto"
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Document List ─────────────────────────────────────────

function DocumentList({
  knowledgeBaseId,
  onRefresh,
}: {
  knowledgeBaseId: string
  onRefresh: () => void
}) {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadDocuments = useCallback(() => {
    api.knowledge.documents(knowledgeBaseId)
      .then(setDocuments)
      .catch(() => setDocuments([]))
      .finally(() => setLoading(false))
  }, [knowledgeBaseId])

  useEffect(() => { loadDocuments() }, [loadDocuments])

  const handleUpload = useCallback(async (files: FileList | File[]) => {
    setUploading(true)
    setError(null)
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData()
        formData.append('file', file)
        await api.knowledge.upload(knowledgeBaseId, formData)
      }
      loadDocuments()
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }, [knowledgeBaseId, loadDocuments, onRefresh])

  const handleDeleteDocument = useCallback(async (docId: string) => {
    try {
      await api.knowledge.deleteDocument(knowledgeBaseId, docId)
      loadDocuments()
      onRefresh()
    } catch (err) {
      console.error('Failed to delete document:', err)
    }
  }, [knowledgeBaseId, loadDocuments, onRefresh])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files)
    }
  }, [handleUpload])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
  }, [])

  const statusColors: Record<string, string> = {
    ready: 'bg-emerald-400',
    processing: 'bg-amber-400 animate-pulse',
    error: 'bg-red-400',
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground py-3">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading documents...
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Upload dropzone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          'relative rounded-lg border-2 border-dashed p-4 text-center cursor-pointer transition-all',
          dragOver
            ? 'border-primary/50 bg-primary/5'
            : 'border-border hover:border-border-strong hover:bg-surface-0/50'
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".txt,.md,.pdf,.csv,.json,.html,.htm,.xml,.yaml,.yml,.rst,.tex,.py,.js,.ts,.go,.rs,.java,.c,.cpp,.h,.rb,.php,.sh"
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              handleUpload(e.target.files)
              e.target.value = ''
            }
          }}
        />
        {uploading ? (
          <div className="flex items-center justify-center gap-2 text-[11px] text-primary">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Uploading...
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5">
            <Upload className={cn(
              'h-4 w-4 transition-colors',
              dragOver ? 'text-primary' : 'text-dim-foreground'
            )} />
            <p className="text-[11px] text-muted-foreground">
              <span className="text-foreground font-medium">Click to upload</span> or drag & drop
            </p>
            <p className="text-[9px] text-dim-foreground">
              TXT, Markdown, PDF, CSV, JSON, HTML, code files
            </p>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-[11px] text-red-400 bg-red-500/10 rounded-md px-3 py-2">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto hover:text-red-300">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Document list */}
      {documents.length > 0 && (
        <div className="space-y-1">
          <div className="text-[9px] uppercase tracking-[0.08em] font-semibold text-dim-foreground mb-2 px-1">
            Documents ({documents.length})
          </div>
          {documents.map(doc => {
            const mimeInfo = MIME_LABELS[doc.mimeType] ?? { label: doc.mimeType.split('/').pop()?.toUpperCase() ?? '?', color: 'text-muted-foreground' }
            return (
              <div
                key={doc.id}
                className="group flex items-center gap-3 px-3 py-2 rounded-md hover:bg-surface-0 transition-colors"
              >
                <div className={cn('h-2 w-2 rounded-full shrink-0', statusColors[doc.status] ?? 'bg-muted')} />
                <FileText className="h-3.5 w-3.5 text-dim-foreground shrink-0" />
                <span className="text-[12px] font-medium truncate flex-1">{doc.filename}</span>
                <Badge variant="muted" className={cn('h-4 px-1.5 text-[9px] mono', mimeInfo.color)}>
                  {mimeInfo.label}
                </Badge>
                <span className="text-[10px] text-dim-foreground tabular w-16 text-right">
                  {formatTokens(doc.tokenCount)}
                </span>
                <span className="text-[10px] text-dim-foreground w-14 text-right">
                  {timeAgo(doc.createdAt)}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteDocument(doc.id) }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/10 text-dim-foreground hover:text-red-400 transition-all"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {documents.length === 0 && !loading && (
        <p className="text-[11px] text-dim-foreground text-center py-2">
          No documents yet — upload files to build this knowledge base
        </p>
      )}
    </div>
  )
}
