import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { api } from '@/lib/api'
import type { KnowledgeBase, KnowledgeDocument } from '@/lib/types'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  ArrowLeft, Search, Plus, Trash2, BookOpen, FileText, Upload, Database,
  ChevronRight, ChevronDown, Pencil, AlertCircle,
  Loader2, Check, X, Brain, HardDrive,
} from 'lucide-react'
import { cn, formatTokens, timeAgo } from '@/lib/utils'

interface KnowledgePageProps {
  onBack: () => void
}

// ─── Constants ─────────────────────────────────────────────

const MIME_LABELS: Record<string, { label: string; color: string }> = {
  'text/plain':       { label: 'TXT',  color: 'text-blue-400' },
  'text/markdown':    { label: 'MD',   color: 'text-purple-400' },
  'application/pdf':  { label: 'PDF',  color: 'text-red-400' },
  'text/csv':         { label: 'CSV',  color: 'text-green-400' },
  'application/json': { label: 'JSON', color: 'text-amber-400' },
  'text/html':        { label: 'HTML', color: 'text-orange-400' },
}

const EMBEDDING_MODELS = [
  { value: 'text-embedding-3-small',  label: 'text-embedding-3-small',  provider: 'OpenAI' },
  { value: 'text-embedding-3-large',  label: 'text-embedding-3-large',  provider: 'OpenAI' },
  { value: 'text-embedding-ada-002',  label: 'text-embedding-ada-002',  provider: 'OpenAI' },
  { value: 'voyage-3',                label: 'voyage-3',                provider: 'Voyage' },
  { value: 'voyage-code-3',           label: 'voyage-code-3',           provider: 'Voyage' },
] as const

const DEFAULT_EMBEDDING = EMBEDDING_MODELS[0].value

const UPLOAD_ACCEPT =
  '.txt,.md,.pdf,.csv,.json,.html,.htm,.xml,.yaml,.yml,.rst,.tex,.py,.js,.ts,.go,.rs,.java,.c,.cpp,.h,.rb,.php,.sh'

const DOC_STATUS_COLORS: Record<KnowledgeDocument['status'], string> = {
  ready:      'bg-emerald-400',
  processing: 'bg-amber-400 animate-pulse',
  error:      'bg-red-400',
}

// ─── Main component ────────────────────────────────────────

export function KnowledgePage({ onBack }: KnowledgePageProps) {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const refresh = useCallback(() => {
    api.knowledge.list()
      .then(setKnowledgeBases)
      .catch(() => setKnowledgeBases([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return knowledgeBases
    return knowledgeBases.filter(kb =>
      kb.name.toLowerCase().includes(q) || kb.description.toLowerCase().includes(q),
    )
  }, [knowledgeBases, search])

  const totalDocs = useMemo(() => knowledgeBases.reduce((sum, kb) => sum + kb.documentCount, 0), [knowledgeBases])
  const totalTokens = useMemo(() => knowledgeBases.reduce((sum, kb) => sum + kb.totalTokens, 0), [knowledgeBases])

  const toggleExpand = (id: string) => setExpandedId(prev => prev === id ? null : id)
  const afterDelete = (id: string) => {
    if (expandedId === id) setExpandedId(null)
    refresh()
  }

  const showEmpty = !loading && knowledgeBases.length === 0 && !creating
  const showNoMatches = !loading && filtered.length === 0 && knowledgeBases.length > 0 && search !== ''

  return (
    <div className="flex flex-col h-full">
      <Header
        count={knowledgeBases.length}
        totalDocs={totalDocs}
        totalTokens={totalTokens}
        search={search}
        onSearchChange={setSearch}
        onBack={onBack}
        onCreate={() => setCreating(true)}
      />

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-4xl mx-auto space-y-7">
          {creating && (
            <CreateKnowledgeBaseForm
              onCancel={() => setCreating(false)}
              onCreated={() => { setCreating(false); refresh() }}
            />
          )}

          {filtered.length > 0 && (
            <KnowledgeBaseList
              bases={filtered}
              expandedId={expandedId}
              onToggleExpand={toggleExpand}
              onRefresh={refresh}
              onDeleted={afterDelete}
            />
          )}

          {loading && <LoadingIndicator />}
          {showEmpty && <EmptyState onCreate={() => setCreating(true)} />}
          {showNoMatches && (
            <div className="text-center py-20 text-muted-foreground text-sm">
              No knowledge bases match your search
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Header ───────────────────────────────────────────────

function Header({
  count, totalDocs, totalTokens, search, onSearchChange, onBack, onCreate,
}: {
  count: number
  totalDocs: number
  totalTokens: number
  search: string
  onSearchChange: (v: string) => void
  onBack: () => void
  onCreate: () => void
}) {
  return (
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
              <Tabular>{count}</Tabular> base{count !== 1 ? 's' : ''}
              <Dot />
              <Tabular>{totalDocs}</Tabular> document{totalDocs !== 1 ? 's' : ''}
              <Dot />
              <Tabular>{formatTokens(totalTokens)}</Tabular> tokens
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-dim-foreground" />
            <Input
              placeholder="Search knowledge bases..."
              value={search}
              onChange={e => onSearchChange(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <button
            onClick={onCreate}
            className="flex items-center gap-1.5 h-9 px-3 rounded-md gradient-primary text-primary-foreground text-[11px] font-medium shadow-sm hover:opacity-90 transition-opacity"
          >
            <Plus className="h-3 w-3" />
            New knowledge base
          </button>
        </div>
      </div>
    </div>
  )
}

const Tabular = ({ children }: { children: React.ReactNode }) => (
  <span className="tabular text-foreground">{children}</span>
)

const Dot = () => <span className="opacity-30 mx-1.5">·</span>

// ─── Create form ──────────────────────────────────────────

function CreateKnowledgeBaseForm({
  onCancel, onCreated,
}: {
  onCancel: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [embedding, setEmbedding] = useState<string>(DEFAULT_EMBEDDING)

  const canSubmit = name.trim().length > 0

  const submit = async () => {
    if (!canSubmit) return
    try {
      await api.knowledge.create(name.trim(), description.trim(), embedding)
      onCreated()
    } catch (err) {
      console.error('Failed to create knowledge base:', err)
    }
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-surface-1 p-5 fade-in shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30 text-primary">
          <Database className="h-3.5 w-3.5" />
        </div>
        <span className="text-[12px] font-semibold text-foreground">Create knowledge base</span>
      </div>
      <div className="space-y-3">
        <Field label="Name">
          <Input
            placeholder="e.g. API documentation, Codebase reference..."
            value={name}
            onChange={e => setName(e.target.value)}
            className="h-9 text-[12px]"
            autoFocus
          />
        </Field>
        <Field label="Description">
          <textarea
            placeholder="What kind of knowledge does this base contain?"
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="w-full min-h-[72px] bg-surface-0 border border-border rounded-md p-3 text-[12px] leading-relaxed resize-y focus:outline-none focus:ring-1 focus:ring-primary/50 text-foreground placeholder:text-dim-foreground"
          />
        </Field>
        <Field label="Embedding model">
          <div className="flex flex-wrap gap-1.5">
            {EMBEDDING_MODELS.map(model => (
              <button
                key={model.value}
                onClick={() => setEmbedding(model.value)}
                className={cn(
                  'flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[10px] font-medium border transition-colors',
                  embedding === model.value
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border bg-surface-0 text-muted-foreground hover:text-foreground hover:border-border-strong',
                )}
              >
                <Brain className="h-3 w-3" />
                <span className="mono">{model.label}</span>
                <span className="text-[9px] text-dim-foreground">{model.provider}</span>
              </button>
            ))}
          </div>
        </Field>
        <div className="flex items-center gap-2 justify-end pt-1">
          <button onClick={onCancel} className={TEXT_BUTTON}>Cancel</button>
          <button onClick={submit} disabled={!canSubmit} className={PRIMARY_BUTTON}>
            Create
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-[0.06em] font-semibold text-muted-foreground mb-1.5 block">
        {label}
      </label>
      {children}
    </div>
  )
}

const TEXT_BUTTON = 'h-7 px-3 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors'
const PRIMARY_BUTTON = 'h-7 px-3 rounded-md gradient-primary text-primary-foreground text-[11px] font-medium shadow-sm hover:opacity-90 transition-opacity disabled:opacity-50'

// ─── Knowledge base list + card ──────────────────────────

function KnowledgeBaseList({
  bases, expandedId, onToggleExpand, onRefresh, onDeleted,
}: {
  bases: KnowledgeBase[]
  expandedId: string | null
  onToggleExpand: (id: string) => void
  onRefresh: () => void
  onDeleted: (id: string) => void
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3 px-1">
        <div className="flex h-5 w-5 items-center justify-center rounded bg-surface-2 border border-border text-muted-foreground">
          <BookOpen className="h-3 w-3" />
        </div>
        <h2 className="text-[10px] uppercase tracking-[0.08em] font-semibold text-muted-foreground">Knowledge bases</h2>
        <Badge variant="muted" className="h-4 px-1.5 normal-case tracking-normal">{bases.length}</Badge>
      </div>
      <div className="space-y-2">
        {bases.map((kb, i) => (
          <KnowledgeBaseCard
            key={kb.id}
            kb={kb}
            index={i}
            isExpanded={expandedId === kb.id}
            onToggleExpand={() => onToggleExpand(kb.id)}
            onRefresh={onRefresh}
            onDeleted={() => onDeleted(kb.id)}
          />
        ))}
      </div>
    </div>
  )
}

function KnowledgeBaseCard({
  kb, index, isExpanded, onToggleExpand, onRefresh, onDeleted,
}: {
  kb: KnowledgeBase
  index: number
  isExpanded: boolean
  onToggleExpand: () => void
  onRefresh: () => void
  onDeleted: () => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // Close inline editors whenever the card collapses so reopening is always
  // a clean view.
  useEffect(() => {
    if (!isExpanded) {
      setIsEditing(false)
      setConfirmingDelete(false)
    }
  }, [isExpanded])

  const handleDelete = async () => {
    try {
      await api.knowledge.delete(kb.id)
      onDeleted()
    } catch (err) {
      console.error('Failed to delete knowledge base:', err)
    }
  }

  return (
    <div
      className={cn(
        'rounded-xl border transition-all duration-200 fade-in',
        isExpanded
          ? 'border-primary/30 bg-surface-1 shadow-sm'
          : 'border-border bg-surface-1/40 hover:bg-surface-1 hover:border-border-strong',
      )}
      style={{ animationDelay: `${Math.min(index * 25, 200)}ms` }}
    >
      <div className="p-4">
        <CardHeader kb={kb} isExpanded={isExpanded} onToggleExpand={onToggleExpand} />

        {isExpanded && (
          <div className="mt-4 pt-4 border-t border-border">
            {isEditing ? (
              <EditKnowledgeBaseForm
                kb={kb}
                onCancel={() => setIsEditing(false)}
                onSaved={() => { setIsEditing(false); onRefresh() }}
              />
            ) : (
              <div className="ml-12 space-y-4">
                <DocumentList knowledgeBaseId={kb.id} onRefresh={onRefresh} />
                <CardActions
                  confirmingDelete={confirmingDelete}
                  onStartEdit={() => setIsEditing(true)}
                  onConfirmDelete={() => setConfirmingDelete(true)}
                  onCancelDelete={() => setConfirmingDelete(false)}
                  onDelete={handleDelete}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function CardHeader({
  kb, isExpanded, onToggleExpand,
}: {
  kb: KnowledgeBase
  isExpanded: boolean
  onToggleExpand: () => void
}) {
  return (
    <div className="flex items-start gap-3 cursor-pointer" onClick={onToggleExpand}>
      <div
        className={cn(
          'h-9 w-9 rounded-lg flex items-center justify-center shrink-0 border mt-0.5',
          isExpanded
            ? 'bg-gradient-to-br from-primary/20 to-primary/5 border-primary/30 text-primary'
            : 'bg-surface-2 border-border text-muted-foreground',
        )}
      >
        <BookOpen className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold text-[13px] truncate">{kb.name}</span>
          {isExpanded
            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            : <ChevronRight className="h-3.5 w-3.5 text-dim-foreground shrink-0" />}
        </div>
        {kb.description && (
          <p className="text-[11px] text-muted-foreground line-clamp-1 leading-relaxed mb-2">
            {kb.description}
          </p>
        )}
        <div className="flex items-center gap-3 text-[10px] text-dim-foreground">
          <IconStat icon={FileText} value={kb.documentCount} suffix={` doc${kb.documentCount !== 1 ? 's' : ''}`} />
          <IconStat icon={HardDrive} value={formatTokens(kb.totalTokens)} suffix=" tokens" />
          <span className="flex items-center gap-1">
            <Brain className="h-3 w-3" />
            <span className="mono">{kb.embedding}</span>
          </span>
          <span className="ml-auto">{timeAgo(kb.updatedAt)}</span>
        </div>
      </div>
    </div>
  )
}

function IconStat({
  icon: Icon, value, suffix,
}: {
  icon: React.ComponentType<{ className?: string }>
  value: number | string
  suffix: string
}) {
  return (
    <span className="flex items-center gap-1">
      <Icon className="h-3 w-3" />
      <span className="tabular">{value}</span>
      {suffix}
    </span>
  )
}

function EditKnowledgeBaseForm({
  kb, onCancel, onSaved,
}: {
  kb: KnowledgeBase
  onCancel: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(kb.name)
  const [description, setDescription] = useState(kb.description)
  const canSubmit = name.trim().length > 0

  const save = async () => {
    if (!canSubmit) return
    try {
      await api.knowledge.update(kb.id, { name: name.trim(), description: description.trim() })
      onSaved()
    } catch (err) {
      console.error('Failed to update knowledge base:', err)
    }
  }

  return (
    <div className="space-y-3 ml-12">
      <Field label="Name">
        <Input value={name} onChange={e => setName(e.target.value)} className="h-8 text-[12px]" autoFocus />
      </Field>
      <Field label="Description">
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          className="w-full min-h-[60px] bg-surface-0 border border-border rounded-md p-3 text-[12px] leading-relaxed resize-y focus:outline-none focus:ring-1 focus:ring-primary/50 text-foreground"
        />
      </Field>
      <div className="flex items-center gap-2 justify-end">
        <button onClick={onCancel} className={TEXT_BUTTON}>Cancel</button>
        <button onClick={save} disabled={!canSubmit} className={PRIMARY_BUTTON}>
          Save changes
        </button>
      </div>
    </div>
  )
}

function CardActions({
  confirmingDelete, onStartEdit, onConfirmDelete, onCancelDelete, onDelete,
}: {
  confirmingDelete: boolean
  onStartEdit: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-center gap-1.5 pt-3 border-t border-border">
      <button
        onClick={onStartEdit}
        className="flex items-center gap-1.5 h-6 px-2 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
      >
        <Pencil className="h-3 w-3" />
        Edit
      </button>
      {confirmingDelete ? (
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
  )
}

// ─── Document list ────────────────────────────────────────

function DocumentList({
  knowledgeBaseId, onRefresh,
}: {
  knowledgeBaseId: string
  onRefresh: () => void
}) {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      <UploadDropzone uploading={uploading} onUpload={handleUpload} />
      {error && <UploadError message={error} onDismiss={() => setError(null)} />}

      {documents.length > 0 ? (
        <div className="space-y-1">
          <div className="text-[9px] uppercase tracking-[0.08em] font-semibold text-dim-foreground mb-2 px-1">
            Documents ({documents.length})
          </div>
          {documents.map(doc => (
            <DocumentRow key={doc.id} doc={doc} onDelete={() => handleDeleteDocument(doc.id)} />
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-dim-foreground text-center py-2">
          No documents yet — upload files to build this knowledge base
        </p>
      )}
    </div>
  )
}

function UploadDropzone({
  uploading, onUpload,
}: {
  uploading: boolean
  onUpload: (files: FileList | File[]) => void
}) {
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div
      onDrop={e => {
        e.preventDefault()
        setDragOver(false)
        if (e.dataTransfer.files.length > 0) onUpload(e.dataTransfer.files)
      }}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={e => { e.preventDefault(); setDragOver(false) }}
      onClick={() => inputRef.current?.click()}
      className={cn(
        'relative rounded-lg border-2 border-dashed p-4 text-center cursor-pointer transition-all',
        dragOver
          ? 'border-primary/50 bg-primary/5'
          : 'border-border hover:border-border-strong hover:bg-surface-0/50',
      )}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={UPLOAD_ACCEPT}
        className="hidden"
        onChange={e => {
          if (e.target.files && e.target.files.length > 0) {
            onUpload(e.target.files)
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
          <Upload className={cn('h-4 w-4 transition-colors', dragOver ? 'text-primary' : 'text-dim-foreground')} />
          <p className="text-[11px] text-muted-foreground">
            <span className="text-foreground font-medium">Click to upload</span> or drag & drop
          </p>
          <p className="text-[9px] text-dim-foreground">
            TXT, Markdown, PDF, CSV, JSON, HTML, code files
          </p>
        </div>
      )}
    </div>
  )
}

function UploadError({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-red-400 bg-red-500/10 rounded-md px-3 py-2">
      <AlertCircle className="h-3 w-3 shrink-0" />
      {message}
      <button onClick={onDismiss} className="ml-auto hover:text-red-300">
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

function DocumentRow({ doc, onDelete }: { doc: KnowledgeDocument; onDelete: () => void }) {
  const mimeInfo = MIME_LABELS[doc.mimeType] ?? {
    label: doc.mimeType.split('/').pop()?.toUpperCase() ?? '?',
    color: 'text-muted-foreground',
  }
  return (
    <div className="group flex items-center gap-3 px-3 py-2 rounded-md hover:bg-surface-0 transition-colors">
      <div className={cn('h-2 w-2 rounded-full shrink-0', DOC_STATUS_COLORS[doc.status] ?? 'bg-muted')} />
      <FileText className="h-3.5 w-3.5 text-dim-foreground shrink-0" />
      <span className="text-[12px] font-medium truncate flex-1">{doc.filename}</span>
      <Badge variant="muted" className={cn('h-4 px-1.5 text-[9px] mono', mimeInfo.color)}>
        {mimeInfo.label}
      </Badge>
      <span className="text-[10px] text-dim-foreground tabular w-16 text-right">{formatTokens(doc.tokenCount)}</span>
      <span className="text-[10px] text-dim-foreground w-14 text-right">{timeAgo(doc.createdAt)}</span>
      <button
        onClick={e => { e.stopPropagation(); onDelete() }}
        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/10 text-dim-foreground hover:text-red-400 transition-all"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  )
}

// ─── Status/empty helpers ─────────────────────────────────

function LoadingIndicator() {
  return (
    <div className="text-center py-20 fade-in">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mx-auto mb-3" />
      <p className="text-sm text-muted-foreground">Loading knowledge bases...</p>
    </div>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
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
        onClick={onCreate}
        className="inline-flex items-center gap-1.5 h-8 px-4 rounded-md gradient-primary text-primary-foreground text-[11px] font-medium shadow-sm hover:opacity-90 transition-opacity"
      >
        <Plus className="h-3 w-3" />
        Create your first knowledge base
      </button>
    </div>
  )
}
