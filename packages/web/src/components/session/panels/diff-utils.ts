import hljs from 'highlight.js/lib/common'

// ─── Types ──────────────────────────────────────────────────────────────

export type DiffLineKind = 'add' | 'rem' | 'hunk' | 'meta' | 'ctx'

export interface DiffFileEntry {
  path: string
  startLineIndex: number
  additions: number
  deletions: number
}

export interface TreeNode {
  name: string
  fullPath: string
  children: TreeNode[]
  file?: DiffFileEntry
}

// ─── Classification & parsing ───────────────────────────────────────────

const META_PREFIXES = [
  'diff --git', 'index ', 'similarity ', 'rename ', 'new file ',
  'deleted file ', 'old mode ', 'new mode ', 'Binary files ',
]

export function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('\\')) return 'meta'
  if (line.startsWith('@@')) return 'hunk'
  if (META_PREFIXES.some(p => line.startsWith(p))) return 'meta'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'rem'
  return 'ctx'
}

/** Parse `git diff` output into per-file sections (line indices are 0-based into split lines). */
export function parseDiffFiles(text: string): DiffFileEntry[] {
  const lines = text.split('\n')
  const files: DiffFileEntry[] = []
  let i = 0
  while (i < lines.length) {
    const head = lines[i]
    if (head === undefined) break
    const m = head.match(/^diff --git a\/(.+?) b\/(.+)$/)
    if (!m) { i++; continue }
    const path = (m[2] ?? m[1] ?? '').trim()
    if (!path) { i++; continue }
    const startLineIndex = i
    let additions = 0
    let deletions = 0
    i++
    while (i < lines.length && !lines[i]!.startsWith('diff --git ')) {
      const L = lines[i]!
      if (L.startsWith('+') && !L.startsWith('+++')) additions++
      else if (L.startsWith('-') && !L.startsWith('---')) deletions++
      i++
    }
    files.push({ path, startLineIndex, additions, deletions })
  }
  return files
}

export function sumStats(files: DiffFileEntry[]): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const f of files) {
    additions += f.additions
    deletions += f.deletions
  }
  return { additions, deletions }
}

/** Line range (inclusive) of a file's section within the split diff text. */
export function fileSectionRange(
  files: DiffFileEntry[],
  fileIndex: number,
  totalLines: number,
): { from: number; to: number } {
  const start = files[fileIndex]?.startLineIndex ?? 0
  const next = files[fileIndex + 1]?.startLineIndex ?? totalLines
  return { from: start, to: Math.max(start, next - 1) }
}

// ─── File tree ──────────────────────────────────────────────────────────

export function buildFileTree(files: DiffFileEntry[]): TreeNode {
  const root: TreeNode = { name: '', fullPath: '', children: [] }
  for (const f of files) {
    const parts = f.path.split('/').filter(Boolean)
    if (parts.length === 0) continue
    let node = root
    let acc = ''
    for (let p = 0; p < parts.length; p++) {
      const seg = parts[p]!
      acc = acc ? `${acc}/${seg}` : seg
      const isLeaf = p === parts.length - 1
      let child = node.children.find(c => c.name === seg)
      if (!child) {
        child = { name: seg, fullPath: acc, children: [], file: isLeaf ? f : undefined }
        node.children.push(child)
      } else if (isLeaf) {
        child.file = f
      }
      node = child
    }
  }
  sortTree(root)
  return root
}

function sortTree(node: TreeNode): void {
  node.children.sort((a, b) => {
    const aDir = a.children.length > 0
    const bDir = b.children.length > 0
    if (aDir !== bDir) return aDir ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
  for (const c of node.children) sortTree(c)
}

/**
 * Paths of directory nodes that should start expanded: everything when the
 * filter is empty, or only directories on the path to a matching file.
 */
export function collectExpandedDirs(root: TreeNode, filterLower: string): Set<string> {
  const out = new Set<string>()
  const unfiltered = filterLower === ''
  const walk = (n: TreeNode): boolean => {
    let match = false
    for (const c of n.children) {
      const selfMatch = unfiltered
        ? c.children.length > 0
        : c.file !== undefined && c.fullPath.toLowerCase().includes(filterLower)
      const subMatch = walk(c)
      if (selfMatch || subMatch) {
        if (c.children.length > 0) out.add(c.fullPath)
        match = true
      }
    }
    return match
  }
  walk(root)
  return out
}

// ─── Syntax highlighting ────────────────────────────────────────────────

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', pyi: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin', kts: 'kotlin',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  sql: 'sql',
  json: 'json',
  yaml: 'yaml', yml: 'yaml',
  xml: 'xml', html: 'xml', htm: 'xml', svg: 'xml', vue: 'xml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini',
  lua: 'lua',
  r: 'r',
  pl: 'perl', pm: 'perl',
  graphql: 'graphql', gql: 'graphql',
}

/** Map a file path to a highlight.js language alias, or 'plaintext'. */
export function pickLanguage(path: string): string {
  const base = (path.split('/').pop() ?? '').toLowerCase()
  if (base === 'makefile' || base === 'gnumakefile') return 'makefile'
  if (base === 'dockerfile') return 'bash'
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : ''
  const lang = LANGUAGE_BY_EXT[ext]
  return lang && hljs.getLanguage(lang) ? lang : 'plaintext'
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!))
}

/**
 * Split highlight.js output into lines while preserving spans that cross
 * newlines (close open spans at EOL, reopen them on the next line).
 */
function splitHighlightedLines(html: string): string[] {
  const out: string[] = []
  const stack: string[] = []
  let current = ''
  let i = 0
  while (i < html.length) {
    const ch = html[i]!
    if (ch === '<') {
      const end = html.indexOf('>', i)
      if (end === -1) { current += html.slice(i); break }
      const tag = html.slice(i, end + 1)
      current += tag
      if (tag.startsWith('</')) stack.pop()
      else if (!tag.endsWith('/>') && !tag.startsWith('<!')) stack.push(tag)
      i = end + 1
    } else if (ch === '\n') {
      out.push(current + '</span>'.repeat(stack.length))
      current = stack.join('')
      i++
    } else {
      current += ch
      i++
    }
  }
  out.push(current)
  return out
}

/**
 * Highlight the code portion of a single file section as one logical block
 * (so multi-line strings/comments tokenize correctly), then distribute the
 * resulting HTML back to the original line indices. Non-code lines (hunk
 * markers, metadata) are left as null so callers can render them plain.
 */
export function highlightFileSection(
  lines: string[],
  kinds: DiffLineKind[],
  from: number,
  to: number,
  language: string,
): Array<string | null> {
  const result: Array<string | null> = new Array(to - from + 1).fill(null)
  const codeOffsets: number[] = []
  const codeContent: string[] = []
  for (let i = from; i <= to; i++) {
    const k = kinds[i]
    if (k === 'add' || k === 'rem' || k === 'ctx') {
      codeOffsets.push(i - from)
      // Strip the leading +/-/space marker so the tokenizer sees pure source.
      const raw = lines[i] ?? ''
      codeContent.push(raw.length > 0 ? raw.slice(1) : '')
    }
  }
  if (codeContent.length === 0) return result

  let highlighted: string
  try {
    highlighted = hljs.highlight(codeContent.join('\n'), { language, ignoreIllegals: true }).value
  } catch {
    highlighted = escapeHtml(codeContent.join('\n'))
  }
  const perLine = splitHighlightedLines(highlighted)
  for (let j = 0; j < codeOffsets.length; j++) {
    result[codeOffsets[j]!] = perLine[j] ?? ''
  }
  return result
}
