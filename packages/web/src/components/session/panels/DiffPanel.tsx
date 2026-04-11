import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Maximize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SessionStatus } from '@/lib/types'
import { Dialog, DialogFullscreenContent } from '@/components/ui/dialog'
import { buildFileTree, parseDiffFiles, sumStats, type DiffFileEntry } from './diff-utils'
import { DiffRows, scrollToDiffLine } from './DiffRows'
import { ExplorerSearch, FileExplorer } from './FileExplorer'

const MAX_DIFF_IN_MESSAGE = 60_000

interface DiffResponse {
  cwd: string
  text: string
  truncated?: boolean
  gitError?: string
}

function buildFeedbackMessage(comment: string, res: DiffResponse): string {
  const header = '[Diff review — user feedback]\n\n' + comment.trim() + '\n\n---\n'
  if (res.gitError) {
    return `${header}Could not read git diff in \`${res.cwd}\`:\n${res.gitError}\n`
  }
  let diffBlock = res.text
  let note = ''
  if (diffBlock.length > MAX_DIFF_IN_MESSAGE) {
    diffBlock = diffBlock.slice(0, MAX_DIFF_IN_MESSAGE)
    note = '\n\n_(diff truncated in this message for size; refresh the Diff tab for the full view.)_\n'
  }
  return `${header}Workspace: \`${res.cwd}\`${note}\n\n\`\`\`diff\n${diffBlock}\n\`\`\`\n`
}

/** Fetches `git diff` JSON for a session and tracks loading/error state. */
function useDiff(sessionId: string) {
  const [data, setData] = useState<DiffResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/sessions/${sessionId}/panels/diff`, {
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? res.statusText)
      }
      setData(await res.json() as DiffResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load diff')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => { refresh() }, [refresh])

  return { data, error, loading, refresh }
}

function DiffChrome({
  cwd,
  loading,
  truncated,
  stats,
  fileCount,
  onRefresh,
  fullscreenTrigger,
}: {
  cwd: string
  loading: boolean
  truncated?: boolean
  stats: { additions: number; deletions: number }
  fileCount: number
  onRefresh: () => void
  fullscreenTrigger?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/80 bg-surface-1/50 px-3 py-2.5">
      <div className="min-w-0 flex-1 basis-[min(100%,12rem)]">
        <p className="truncate font-mono text-[10px] text-dim-foreground" title={cwd}>
          {cwd}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {fileCount > 0 && (
            <span className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
              {fileCount} file{fileCount !== 1 ? 's' : ''}
            </span>
          )}
          {(stats.additions > 0 || stats.deletions > 0) && (
            <>
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] font-medium text-emerald-300 light:text-emerald-800">
                +{stats.additions}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/15 px-2 py-0.5 font-mono text-[10px] font-medium text-rose-300 light:text-rose-800">
                −{stats.deletions}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {fullscreenTrigger}
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="rounded-lg border border-border bg-surface-0 px-3 py-1.5 text-[11px] font-medium text-foreground shadow-sm transition-colors hover:bg-surface-2 disabled:opacity-45"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      {truncated && (
        <p className="w-full text-[10px] text-warning">
          Output truncated server-side — reduce change size or use git stash/commit to review smaller chunks.
        </p>
      )}
    </div>
  )
}

function FeedbackBlock({
  busy,
  comment,
  setComment,
  canSend,
  sending,
  onSend,
  compact,
}: {
  busy: boolean
  comment: string
  setComment: (v: string) => void
  canSend: boolean
  sending: boolean
  onSend: () => void
  compact: boolean
}) {
  return (
    <div
      className={cn(
        'space-y-2 border-t border-border/80 bg-surface-0/40',
        compact ? 'p-3' : 'p-5 md:px-8',
      )}
    >
      <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-dim-foreground">
        Feedback for the agent
      </label>
      <textarea
        value={comment}
        onChange={e => setComment(e.target.value)}
        placeholder={busy ? 'Wait for the agent to finish…' : 'Notes on specific files or hunks…'}
        disabled={busy}
        rows={compact ? 3 : 4}
        className="w-full resize-y rounded-xl border border-border bg-surface-1 px-3 py-2.5 text-[13px] text-foreground placeholder:text-dim-foreground shadow-inner outline-none transition-shadow focus:ring-2 focus:ring-primary/35 disabled:opacity-50"
      />
      <button
        type="button"
        onClick={onSend}
        disabled={!canSend}
        className="w-full rounded-xl bg-primary py-2.5 text-[13px] font-semibold text-primary-foreground shadow-md transition-opacity hover:opacity-92 disabled:pointer-events-none disabled:opacity-35"
      >
        {sending ? 'Sending…' : 'Send feedback to agent'}
      </button>
      {busy && (
        <p className="text-center text-[11px] text-dim-foreground">Disabled while the agent is running.</p>
      )}
    </div>
  )
}

interface DiffPanelProps {
  sessionId: string
  cwd: string
  status: SessionStatus
  onSendFeedback: (message: string) => Promise<void>
}

/**
 * Wrapped in `memo` because SessionSidebar re-renders on every SSE tick
 * (session info identity changes). With stable props (sessionId/cwd/status
 * /onSendFeedback) the whole diff-viewer subtree stays inert during streaming.
 */
export const DiffPanel = memo(DiffPanelImpl)

function DiffPanelImpl({ sessionId, cwd, status, onSendFeedback }: DiffPanelProps) {
  const { data, error: loadError, loading, refresh } = useDiff(sessionId)
  const [comment, setComment] = useState('')
  const [sending, setSending] = useState(false)
  const [fullscreenOpen, setFullscreenOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [activePath, setActivePath] = useState<string | null>(null)

  // Only one scroll container is visible at a time (inline OR fullscreen dialog).
  // `selectFile` scrolls whichever ref is currently mounted.
  const compactScrollRef = useRef<HTMLDivElement>(null)
  const fullScrollRef = useRef<HTMLDivElement>(null)

  const files = useMemo(() => (data?.text ? parseDiffFiles(data.text) : []), [data?.text])
  const tree = useMemo(() => buildFileTree(files), [files])
  const stats = useMemo(() => sumStats(files), [files])

  useEffect(() => {
    if (files.length === 0) {
      setActivePath(null)
      return
    }
    setActivePath(prev => (prev && files.some(f => f.path === prev) ? prev : files[0]!.path))
  }, [files])

  const selectFile = useCallback((f: DiffFileEntry) => {
    setActivePath(f.path)
    const root = fullscreenOpen ? fullScrollRef.current : compactScrollRef.current
    scrollToDiffLine(root, f.startLineIndex)
  }, [fullscreenOpen])

  const busy = status === 'running'
  const canSend = !busy && comment.trim().length > 0 && !sending

  const handleSend = async () => {
    if (!data || !canSend) return
    setSending(true)
    try {
      await onSendFeedback(buildFeedbackMessage(comment, data))
      setComment('')
    } finally {
      setSending(false)
    }
  }

  const expandBtn = (
    <button
      type="button"
      onClick={() => setFullscreenOpen(true)}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong bg-surface-2 px-2.5 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-surface-3"
      title="Open fullscreen"
    >
      <Maximize2 className="h-3.5 w-3.5 opacity-80" />
      Full screen
    </button>
  )

  const errorMessage = loadError ?? data?.gitError ?? null
  const hasDiff = Boolean(data?.text)
  const hasFiles = hasDiff && files.length > 0
  const isEmpty = !hasDiff && !errorMessage && !loading

  const explorer = (compact: boolean) => (
    <>
      <div className={cn('shrink-0 border-b border-border/40', compact ? 'p-2' : 'p-3')}>
        <ExplorerSearch value={filter} onChange={setFilter} compact={compact} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <FileExplorer
          tree={tree}
          files={files}
          filter={filter}
          activePath={activePath}
          onSelectFile={selectFile}
          compact={compact}
        />
      </div>
    </>
  )

  const diffRows = (compact: boolean) =>
    data?.text && (
      <DiffRows text={data.text} files={files} compact={compact} activePath={activePath} />
    )

  const feedback = (compact: boolean) => (
    <FeedbackBlock
      busy={busy}
      comment={comment}
      setComment={setComment}
      canSend={canSend}
      sending={sending}
      onSend={handleSend}
      compact={compact}
    />
  )

  return (
    <>
      <div className="flex h-full min-h-[220px] flex-col overflow-hidden rounded-xl border border-border bg-linear-to-b from-surface-1/40 to-surface-0/30 shadow-sm">
        <DiffChrome
          cwd={cwd}
          loading={loading}
          truncated={data?.truncated}
          stats={stats}
          fileCount={files.length}
          onRefresh={refresh}
          fullscreenTrigger={expandBtn}
        />

        {errorMessage && (
          <p className={cn('px-3 py-2 text-[12px]', loadError ? 'text-destructive' : 'text-warning')}>
            {errorMessage}
          </p>
        )}

        {hasFiles ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-b border-border/50 md:flex-row">
            <aside className="flex max-h-[40%] shrink-0 flex-col border-b border-border/60 bg-surface-1/30 md:max-h-none md:w-[min(42%,11rem)] md:border-b-0 md:border-r">
              {explorer(true)}
            </aside>
            <div ref={compactScrollRef} className="min-h-0 min-w-0 flex-1 overflow-auto">
              <div className="min-w-0 pb-2">{diffRows(true)}</div>
            </div>
          </div>
        ) : (
          <div ref={compactScrollRef} className="min-h-0 flex-1 overflow-auto">
            {isEmpty && (
              <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
                <div className="rounded-2xl border border-border bg-surface-1/50 px-4 py-3 font-mono text-[11px] text-muted-foreground">
                  Working tree clean
                </div>
                <p className="max-w-56 text-[11px] text-dim-foreground">No unstaged changes in this workspace.</p>
              </div>
            )}
            {hasDiff && <div className="p-3">{diffRows(true)}</div>}
          </div>
        )}

        {feedback(true)}
      </div>

      <Dialog open={fullscreenOpen} onOpenChange={setFullscreenOpen}>
        <DialogFullscreenContent
          className="bg-background"
          onCloseAutoFocus={e => e.preventDefault()}
        >
          <div className="flex min-h-0 flex-1 flex-col pt-14">
            <FullscreenHeader
              cwd={cwd}
              loading={loading}
              truncated={data?.truncated}
              stats={stats}
              fileCount={files.length}
              onRefresh={refresh}
            />

            <div className="flex min-h-0 flex-1 overflow-hidden bg-muted/25">
              {errorMessage && !hasDiff && (
                <div className="p-8 text-sm text-destructive">{errorMessage}</div>
              )}
              {hasFiles && (
                <>
                  <aside className="flex w-[min(100%,18rem)] shrink-0 flex-col border-r border-border bg-surface-1/40 md:w-72">
                    {explorer(false)}
                  </aside>
                  <div ref={fullScrollRef} className="min-h-0 min-w-0 flex-1 overflow-auto">
                    <FullscreenDiffCard>{diffRows(false)}</FullscreenDiffCard>
                  </div>
                </>
              )}
              {hasDiff && !hasFiles && (
                <div ref={fullScrollRef} className="flex-1 overflow-auto">
                  <FullscreenDiffCard>{diffRows(false)}</FullscreenDiffCard>
                </div>
              )}
              {isEmpty && !errorMessage && (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 p-16 text-muted-foreground">
                  <p className="text-sm font-medium">No changes to show</p>
                  <p className="text-xs text-dim-foreground">Refresh after the agent edits files.</p>
                </div>
              )}
            </div>

            {feedback(false)}
          </div>
        </DialogFullscreenContent>
      </Dialog>
    </>
  )
}

function FullscreenHeader({
  cwd, loading, truncated, stats, fileCount, onRefresh,
}: {
  cwd: string
  loading: boolean
  truncated?: boolean
  stats: { additions: number; deletions: number }
  fileCount: number
  onRefresh: () => void
}) {
  return (
    <div className="shrink-0 border-b border-border bg-surface-1/95 px-5 pb-4 pt-2 backdrop-blur-md md:px-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Workspace diff</h2>
          <p className="mt-1 max-w-[min(100vw-3rem,48rem)] truncate font-mono text-xs text-dim-foreground" title={cwd}>
            {cwd}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {fileCount > 0 && (
              <span className="rounded-lg bg-surface-2 px-3 py-1 font-mono text-xs text-muted-foreground">
                {fileCount} file{fileCount !== 1 ? 's' : ''}
              </span>
            )}
            {(stats.additions > 0 || stats.deletions > 0) && (
              <>
                <span className="rounded-lg bg-emerald-500/15 px-3 py-1 font-mono text-xs font-semibold text-emerald-300 light:text-emerald-800">
                  +{stats.additions} additions
                </span>
                <span className="rounded-lg bg-rose-500/15 px-3 py-1 font-mono text-xs font-semibold text-rose-300 light:text-rose-800">
                  −{stats.deletions} deletions
                </span>
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="mr-10 rounded-xl border border-border bg-surface-0 px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-surface-2 disabled:opacity-45 md:mr-12"
        >
          {loading ? 'Refreshing…' : 'Refresh diff'}
        </button>
      </div>
      {truncated && (
        <p className="mt-3 text-xs text-warning">This diff was truncated on the server.</p>
      )}
    </div>
  )
}

function FullscreenDiffCard({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-[100vw] px-2 py-4 md:px-6 md:py-6">
      <div className="overflow-hidden rounded-xl border border-border-strong bg-surface-0/80 shadow-xl light:bg-card">
        {children}
      </div>
    </div>
  )
}
