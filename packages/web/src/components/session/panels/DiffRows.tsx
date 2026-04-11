import { memo, useMemo } from 'react'
import { FileCode } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  classifyDiffLine,
  highlightFileSection,
  pickLanguage,
  type DiffFileEntry,
  type DiffLineKind,
} from './diff-utils'

/**
 * Renders `git diff` text as a scrollable row stream with syntax highlighting,
 * sticky per-file headers, hunk markers, and old/new line numbers down the side.
 *
 * Internally we transform the raw diff into a flat list of `VisibleRow` entries
 * so that the render pass is a straight `rows.map(...)` without any per-line
 * parsing, and each row carries the exact state it needs (kind, line numbers,
 * pre-highlighted HTML).
 */

// ─── DOM helpers ────────────────────────────────────────────────────────

function diffLineDomId(lineIndex: number): string {
  return `diff-line-${lineIndex}`
}

/**
 * Jump a specific diff line to the top of its scroll container.
 *
 * We use instant scroll (not smooth) on purpose: rows use `content-visibility:
 * auto`, which means intermediate offscreen rows only resolve their real
 * layout as they pass through the viewport. A smooth scroll animation ends up
 * rendering that reflow frame-by-frame, which looks trippy. An instant jump
 * bypasses the intermediate frames so the destination file lands at the top
 * in one step.
 */
export function scrollToDiffLine(scrollRoot: HTMLElement | null, lineIndex: number): void {
  if (!scrollRoot) return
  const el = scrollRoot.querySelector<HTMLElement>(`#${CSS.escape(diffLineDomId(lineIndex))}`)
  if (!el) return
  // Compute offset relative to the scroll container so we scroll the
  // container itself, not the whole page.
  const top = el.offsetTop - scrollRoot.offsetTop
  scrollRoot.scrollTo({ top, behavior: 'instant' as ScrollBehavior })
}

// ─── Row model ──────────────────────────────────────────────────────────

type VisibleRow =
  | { kind: 'file'; lineIndex: number; file: DiffFileEntry; language: string }
  | { kind: 'hunk'; lineIndex: number; oldStart: number; newStart: number; context: string }
  | {
      kind: 'add' | 'rem' | 'ctx'
      lineIndex: number
      oldLine: number | null
      newLine: number | null
      html: string | null
      raw: string
    }

type FileBodyRow = Exclude<VisibleRow, { kind: 'file' }>

interface FileGroup {
  header: Extract<VisibleRow, { kind: 'file' }>
  body: FileBodyRow[]
}

/** Parse a hunk header line like `@@ -84,5 +84,8 @@ export const foo = {` */
function parseHunkHeader(line: string): { oldStart: number; newStart: number; context: string } | null {
  const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/)
  if (!m) return null
  return {
    oldStart: parseInt(m[1]!, 10),
    newStart: parseInt(m[2]!, 10),
    context: (m[3] ?? '').trim(),
  }
}

function buildVisibleRows(
  lines: string[],
  kinds: DiffLineKind[],
  files: DiffFileEntry[],
  highlightedHtml: Array<string | null>,
): VisibleRow[] {
  const rows: VisibleRow[] = []
  if (files.length === 0) return rows

  // O(1) lookup of "is this line the start of a new file section?"
  const fileAt = new Map<number, number>()
  for (let f = 0; f < files.length; f++) fileAt.set(files[f]!.startLineIndex, f)

  let oldLine = 0
  let newLine = 0

  for (let i = 0; i < lines.length; i++) {
    const fileIdx = fileAt.get(i)
    if (fileIdx !== undefined) {
      const file = files[fileIdx]!
      rows.push({ kind: 'file', lineIndex: i, file, language: pickLanguage(file.path) })
      oldLine = 0
      newLine = 0
      continue
    }

    const k = kinds[i]
    const line = lines[i] ?? ''
    if (k === 'meta') continue

    if (k === 'hunk') {
      const parsed = parseHunkHeader(line)
      if (!parsed) continue
      oldLine = parsed.oldStart
      newLine = parsed.newStart
      rows.push({ kind: 'hunk', lineIndex: i, ...parsed })
      continue
    }

    const html = highlightedHtml[i] ?? null
    if (k === 'add') {
      rows.push({ kind: 'add', lineIndex: i, oldLine: null, newLine, html, raw: line })
      newLine++
    } else if (k === 'rem') {
      rows.push({ kind: 'rem', lineIndex: i, oldLine, newLine: null, html, raw: line })
      oldLine++
    } else {
      rows.push({ kind: 'ctx', lineIndex: i, oldLine, newLine, html, raw: line })
      oldLine++
      newLine++
    }
  }
  return rows
}

function useFileGroups(text: string, files: DiffFileEntry[]): FileGroup[] {
  return useMemo(() => {
    const lines = text.split('\n')
    const kinds = lines.map(classifyDiffLine)
    const highlightedHtml: Array<string | null> = new Array(lines.length).fill(null)

    // Highlight each file section as one logical code block so multi-line
    // strings/comments tokenize correctly, then distribute the HTML back to
    // the original line indices.
    for (let f = 0; f < files.length; f++) {
      const sectionStart = files[f]!.startLineIndex
      const sectionEnd = (files[f + 1]?.startLineIndex ?? lines.length) - 1
      // Skip the header/meta block so highlighting starts at the first hunk.
      let codeFrom = sectionStart
      while (codeFrom <= sectionEnd && kinds[codeFrom] === 'meta') codeFrom++
      if (codeFrom > sectionEnd) continue

      const chunk = highlightFileSection(lines, kinds, codeFrom, sectionEnd, pickLanguage(files[f]!.path))
      for (let k = 0; k < chunk.length; k++) {
        highlightedHtml[codeFrom + k] = chunk[k] ?? null
      }
    }

    // Group the flat row stream by file so each file body becomes its own
    // horizontal scroll container. Rows before the first file header (should
    // be none for valid `git diff` output) are dropped.
    const flat = buildVisibleRows(lines, kinds, files, highlightedHtml)
    const groups: FileGroup[] = []
    for (const row of flat) {
      if (row.kind === 'file') {
        groups.push({ header: row, body: [] })
      } else {
        groups[groups.length - 1]?.body.push(row)
      }
    }
    return groups
  }, [text, files])
}

// ─── Component ──────────────────────────────────────────────────────────

interface DiffRowsProps {
  text: string
  files: DiffFileEntry[]
  compact: boolean
  activePath?: string | null
}

/**
 * Memoized on (text, files, compact, activePath). `useVisibleRows` only
 * recomputes rows when text/files change, and React.memo keeps this whole
 * subtree inert when the parent re-renders without those changing (common
 * during SSE streaming).
 */
export const DiffRows = memo(DiffRowsImpl)

function DiffRowsImpl({ text, files, compact, activePath }: DiffRowsProps) {
  const groups = useFileGroups(text, files)
  const gutterW = compact ? '2.25rem' : '2.75rem'
  const numText = compact ? 'text-[10px]' : 'text-[11px]'
  const codeText = compact ? 'text-[11px] leading-[1.55]' : 'text-[12.5px] leading-[1.65]'

  return (
    <div className="diff-rows font-mono antialiased selection:bg-primary/25">
      {groups.map(group => (
        <FileGroupView
          key={`g-${group.header.lineIndex}`}
          group={group}
          compact={compact}
          active={activePath === group.header.file.path}
          gutterW={gutterW}
          numText={numText}
          codeText={codeText}
        />
      ))}
    </div>
  )
}

/**
 * One file's rows: a sticky header plus a single horizontally-scrolling body.
 *
 * The header lives outside the horizontal scroll container so it stays pinned
 * horizontally while the code rows slide under it. Its `sticky top-0` still
 * works because the parent `DiffPanel` scroll container is the nearest
 * vertical-scrolling ancestor — and since sticky is scoped to `FileGroupView`
 * itself, each group's header stops cleanly when the next group reaches the
 * top, producing the stacked-panel effect you want as you scroll through many
 * files.
 *
 * Memoized because there are lots of these and most won't change between
 * re-renders. `active` is the only per-group prop that flips when the user
 * clicks a file in the explorer.
 */
const FileGroupView = memo(FileGroupViewImpl)

function FileGroupViewImpl({
  group, compact, active, gutterW, numText, codeText,
}: {
  group: FileGroup
  compact: boolean
  active: boolean
  gutterW: string
  numText: string
  codeText: string
}) {
  return (
    <div className="file-group">
      <FileHeaderRow row={group.header} compact={compact} active={active} />
      <div className="overflow-x-auto">
        {/* w-max shrinks the inner block to the widest row; min-w-full keeps
            short files flush with the viewport so hover backgrounds span the
            full width. Every body row inherits this width, so horizontally
            scrolling one row scrolls them all together. */}
        <div className="w-max min-w-full">
          {group.body.map(row =>
            row.kind === 'hunk' ? (
              <HunkRow key={`h-${row.lineIndex}`} row={row} compact={compact} />
            ) : (
              <CodeRow
                key={`c-${row.lineIndex}`}
                row={row}
                gutterW={gutterW}
                numText={numText}
                codeText={codeText}
                compact={compact}
              />
            ),
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Row components ─────────────────────────────────────────────────────

type FileRow = Extract<VisibleRow, { kind: 'file' }>
type HunkMarkerRow = Extract<VisibleRow, { kind: 'hunk' }>
type CodeRowData = Extract<VisibleRow, { kind: 'add' | 'rem' | 'ctx' }>

/**
 * Hint to the browser that offscreen rows can skip layout/paint until scrolled
 * into view. Critical for large diffs — without this, the browser pays to style
 * and paint every row regardless of viewport. We pair it with an intrinsic-size
 * hint so the scrollbar thumb reflects total content.
 */
const CV_AUTO: React.CSSProperties = {
  contentVisibility: 'auto',
  containIntrinsicSize: '0 1.6em',
} as React.CSSProperties

const FileHeaderRow = memo(FileHeaderRowImpl)
const HunkRow = memo(HunkRowImpl)
const CodeRow = memo(CodeRowImpl)

function FileHeaderRowImpl({ row, compact, active }: { row: FileRow; compact: boolean; active: boolean }) {
  return (
    <div
      id={diffLineDomId(row.lineIndex)}
      className={cn(
        'sticky top-0 z-10 flex items-center gap-2 border-y border-border/80 bg-surface-2/95 px-3 py-2 backdrop-blur-md scroll-mt-3',
        compact ? 'text-[11px]' : 'text-[12px]',
        active && 'ring-1 ring-inset ring-primary/45',
      )}
    >
      <FileCode className="h-3.5 w-3.5 shrink-0 text-primary" />
      <span className="min-w-0 truncate font-medium text-foreground" title={row.file.path}>
        {row.file.path}
      </span>
      {row.language !== 'plaintext' && (
        <span className="shrink-0 rounded-md bg-surface-0 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-dim-foreground">
          {row.language}
        </span>
      )}
      <div className="flex-1" />
      <span className="shrink-0 tabular-nums text-emerald-400 light:text-emerald-700">+{row.file.additions}</span>
      <span className="shrink-0 tabular-nums text-rose-400 light:text-rose-700">−{row.file.deletions}</span>
    </div>
  )
}

function HunkRowImpl({ row, compact }: { row: HunkMarkerRow; compact: boolean }) {
  return (
    <div
      id={diffLineDomId(row.lineIndex)}
      className={cn(
        'flex items-center gap-3 border-y border-border/35 bg-purple/[0.06] px-3 scroll-mt-3',
        compact ? 'py-0.5 text-[10px]' : 'py-1 text-[11px]',
      )}
    >
      <span className="shrink-0 tabular-nums text-purple/80">
        @@ −{row.oldStart} +{row.newStart} @@
      </span>
      {row.context && (
        <span className="min-w-0 truncate text-dim-foreground">{row.context}</span>
      )}
    </div>
  )
}

const CODE_BG: Record<CodeRowData['kind'], string> = {
  add: 'bg-emerald-500/[0.07] light:bg-emerald-600/[0.08]',
  rem: 'bg-rose-500/[0.07] light:bg-rose-600/[0.08]',
  ctx: 'bg-transparent',
}

const CODE_MARKER_COLOR: Record<CodeRowData['kind'], string> = {
  add: 'text-emerald-400 light:text-emerald-700',
  rem: 'text-rose-400 light:text-rose-700',
  ctx: 'text-dim-foreground/40',
}

const CODE_MARKER: Record<CodeRowData['kind'], string> = {
  add: '+',
  rem: '−',
  ctx: ' ',
}

function CodeRowImpl({
  row, gutterW, numText, codeText, compact,
}: {
  row: CodeRowData
  gutterW: string
  numText: string
  codeText: string
  compact: boolean
}) {
  return (
    <div
      id={diffLineDomId(row.lineIndex)}
      className={cn('group flex scroll-mt-3', CODE_BG[row.kind])}
      style={CV_AUTO}
    >
      <LineNumber value={row.oldLine} width={gutterW} className={numText} />
      <LineNumber value={row.newLine} width={gutterW} className={numText} />
      {/* No per-row overflow: the whole row grows to its natural width and the
          file-level `overflow-x-auto` wrapper handles scrolling for every row
          in the file as one unit. */}
      <div
        className={cn(
          'flex whitespace-pre py-px text-foreground',
          codeText,
          compact ? 'px-2' : 'px-3',
        )}
      >
        <span className={cn('shrink-0 select-none pr-2 font-semibold', CODE_MARKER_COLOR[row.kind])}>
          {CODE_MARKER[row.kind]}
        </span>
        {row.html !== null ? (
          <code
            className="hljs block bg-transparent p-0"
            dangerouslySetInnerHTML={{ __html: row.html.length === 0 ? ' ' : row.html }}
          />
        ) : (
          <code className="block bg-transparent p-0">{row.raw.slice(1) || ' '}</code>
        )}
      </div>
    </div>
  )
}

function LineNumber({ value, width, className }: { value: number | null; width: string; className: string }) {
  return (
    <div
      className={cn(
        'shrink-0 select-none border-r border-border/40 py-px pr-1.5 pl-1 text-right tabular-nums text-dim-foreground/70',
        className,
      )}
      style={{ width, minWidth: width }}
    >
      {value ?? ''}
    </div>
  )
}
