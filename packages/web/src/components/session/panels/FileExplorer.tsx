import { memo, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, File, FileCode, Folder, FolderOpen, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { collectExpandedDirs, type DiffFileEntry, type TreeNode } from './diff-utils'

interface FileExplorerProps {
  tree: TreeNode
  files: DiffFileEntry[]
  filter: string
  activePath: string | null
  onSelectFile: (f: DiffFileEntry) => void
  compact: boolean
}

/**
 * Tree/flat view of files touched by the current diff. When `filter` is
 * set, switches to a flat list of matching paths; otherwise renders the
 * directory tree with toggle-able folders.
 */
export const FileExplorer = memo(FileExplorerImpl)

function FileExplorerImpl({
  tree, files, filter, activePath, onSelectFile, compact,
}: FileExplorerProps) {
  const filterLower = filter.trim().toLowerCase()
  const expandedDefaults = useMemo(
    () => collectExpandedDirs(tree, filterLower),
    [tree, filterLower],
  )

  const [expanded, setExpanded] = useState<Set<string>>(expandedDefaults)

  // Re-sync expansion when the filter or file set changes.
  useEffect(() => setExpanded(new Set(expandedDefaults)), [expandedDefaults])

  const toggle = (path: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })
  }

  // Filtered flat view.
  if (filterLower !== '') {
    const matches = files.filter(f => f.path.toLowerCase().includes(filterLower))
    if (matches.length === 0) {
      return <p className="px-2 py-4 text-center text-[0.875rem] text-dim-foreground">No files match filter</p>
    }
    return (
      <div className="space-y-0.5">
        {matches.map(f => (
          <FlatFileRow
            key={f.path}
            file={f}
            active={activePath === f.path}
            compact={compact}
            onSelect={onSelectFile}
          />
        ))}
      </div>
    )
  }

  // Tree view.
  return (
    <div className="min-w-0 space-y-0.5">
      {tree.children.map(node => (
        <TreeNodeView
          key={node.fullPath || node.name}
          node={node}
          depth={0}
          compact={compact}
          expanded={expanded}
          activePath={activePath}
          onToggle={toggle}
          onSelectFile={onSelectFile}
        />
      ))}
    </div>
  )
}

function TreeNodeView({
  node, depth, compact, expanded, activePath, onToggle, onSelectFile,
}: {
  node: TreeNode
  depth: number
  compact: boolean
  expanded: Set<string>
  activePath: string | null
  onToggle: (path: string) => void
  onSelectFile: (f: DiffFileEntry) => void
}) {
  const isDir = node.children.length > 0
  const pad = compact ? Math.min(depth * 6, 18) : Math.min(depth * 8, 24)

  if (isDir) {
    const open = expanded.has(node.fullPath)
    return (
      <div className="min-w-0">
        <button
          type="button"
          onClick={() => onToggle(node.fullPath)}
          className={cn(
            'flex w-full items-center gap-1 rounded-lg py-1 text-left transition-colors hover:bg-surface-2/80',
            compact ? 'px-1.5 text-[0.8125rem]' : 'px-2 text-[0.875rem]',
          )}
          style={{ paddingLeft: pad + 4 }}
        >
          {open
            ? <ChevronDown className="h-3 w-3 shrink-0 text-dim-foreground" />
            : <ChevronRight className="h-3 w-3 shrink-0 text-dim-foreground" />}
          {open
            ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-400/90 light:text-amber-600" />
            : <Folder className="h-3.5 w-3.5 shrink-0 text-amber-400/70 light:text-amber-600" />}
          <span className="truncate font-medium text-muted-foreground">{node.name}</span>
        </button>
        {open && (
          <div className="min-w-0">
            {node.children.map(c => (
              <TreeNodeView
                key={c.fullPath}
                node={c}
                depth={depth + 1}
                compact={compact}
                expanded={expanded}
                activePath={activePath}
                onToggle={onToggle}
                onSelectFile={onSelectFile}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  if (!node.file) return null
  return (
    <TreeFileRow
      name={node.name}
      file={node.file}
      active={activePath === node.file.path}
      compact={compact}
      indent={pad + (compact ? 18 : 22)}
      onSelect={onSelectFile}
    />
  )
}

function TreeFileRow({
  name, file, active, compact, indent, onSelect,
}: {
  name: string
  file: DiffFileEntry
  active: boolean
  compact: boolean
  indent: number
  onSelect: (f: DiffFileEntry) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(file)}
      className={cn(
        'flex w-full min-w-0 items-center gap-1.5 rounded-lg py-1.5 text-left transition-colors',
        compact ? 'px-1.5 text-[0.8125rem]' : 'px-2 text-[0.875rem]',
        active ? 'bg-primary/18 text-foreground' : 'hover:bg-surface-2/80 text-muted-foreground',
      )}
      style={{ paddingLeft: indent }}
    >
      <FileCode className="h-3.5 w-3.5 shrink-0 text-primary/80" />
      <span className="min-w-0 flex-1 truncate font-mono text-foreground">{name}</span>
      <DiffCount additions={file.additions} deletions={file.deletions} />
    </button>
  )
}

function FlatFileRow({
  file, active, compact, onSelect,
}: {
  file: DiffFileEntry
  active: boolean
  compact: boolean
  onSelect: (f: DiffFileEntry) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(file)}
      className={cn(
        'flex w-full min-w-0 items-center gap-2 rounded-lg py-1.5 text-left font-mono transition-colors',
        compact ? 'px-2 text-[0.8125rem]' : 'px-2 text-[0.875rem]',
        active ? 'bg-primary/18' : 'hover:bg-surface-2/80',
      )}
    >
      <File className="h-3.5 w-3.5 shrink-0 text-dim-foreground" />
      <span className="min-w-0 flex-1 truncate">{file.path}</span>
      <DiffCount additions={file.additions} deletions={file.deletions} />
    </button>
  )
}

function DiffCount({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <>
      <span className="shrink-0 tabular-nums text-emerald-400 light:text-emerald-700">+{additions}</span>
      <span className="shrink-0 tabular-nums text-rose-400 light:text-rose-700">−{deletions}</span>
    </>
  )
}

export function ExplorerSearch({
  value, onChange, compact,
}: {
  value: string
  onChange: (v: string) => void
  compact: boolean
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-dim-foreground" />
      <input
        type="search"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Filter files…"
        className={cn(
          'w-full rounded-lg border border-border bg-surface-0 py-2 pl-8 pr-2 font-sans text-foreground placeholder:text-dim-foreground outline-none focus:ring-2 focus:ring-primary/30',
          compact ? 'text-[0.8125rem]' : 'text-[0.9375rem]',
        )}
        autoComplete="off"
        aria-label="Filter changed files"
      />
    </div>
  )
}
