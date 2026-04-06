// Pure ANSI TUI utilities — no external dependencies

export const ansi = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  cyan: '\x1b[36m',
  cyanBright: '\x1b[96m',
  green: '\x1b[32m',
  greenBright: '\x1b[92m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  white: '\x1b[97m',
  blue: '\x1b[34m',
} as const

const TAGLINES = [
  'probably faster than googling it',
  'no judgment, only answers',
  'your thoughts, but executable',
  'thinking so you don\'t have to',
  'the cursor was blinking anyway',
  'caffeine not included',
  'slightly smarter than a rubber duck',
  'context window: open',
  'ready to overcomplicate simple things',
  'zero opinions on your tab width',
  'parsing your vague requests since today',
  'will not commit to production (unless you ask)',
  'not a replacement for sleep',
  'reads the docs so you don\'t have to',
  'hallucinations: mostly under control',
  'for when Stack Overflow is too slow',
  'making the obvious less obvious since now',
  'your second brain, first draft',
  'strong opinions, weakly held, immediately revised',
  'yes, it can also write your commit messages',
  'technically not a senior engineer',
  'open to feedback, resistant to blame',
  'will explain the joke if needed',
]

function tagline(sessionId: string): string {
  // deterministic per session so it doesn't flicker on resume
  let hash = 0
  for (let i = 0; i < sessionId.length; i++) hash = (hash * 31 + sessionId.charCodeAt(i)) >>> 0
  return TAGLINES[hash % TAGLINES.length] ?? ''
}

export function printHeader(model: string, sessionId: string): void {
  process.stdout.write('\n')
  process.stdout.write(`  ${ansi.bold}${ansi.cyanBright}ra${ansi.reset}  ${ansi.dim}${tagline(sessionId)}${ansi.reset}\n`)
  process.stdout.write(`  ${ansi.dim}${model}  ·  ${sessionId}${ansi.reset}\n`)
  process.stdout.write(`  ${ansi.dim}/clear  /attach  /skill  /resume${ansi.reset}\n\n`)
}

export function printResumeHeader(sessionId: string, messageCount: number): void {
  process.stdout.write(`  ${ansi.dim}↩ ${sessionId}  ·  ${messageCount} messages${ansi.reset}\n\n`)
}

// ---------------------------------------------------------------------------
// Spinner — static "…" indicator (no animation, no flicker)
// ---------------------------------------------------------------------------

let spinnerActive = false

export function startSpinner(): void {
  if (spinnerActive) return
  spinnerActive = true
  process.stdout.write(`  ${ansi.dim}…${ansi.reset}`)
}

export function stopSpinner(silent = false): void {
  if (spinnerActive) {
    spinnerActive = false
    process.stdout.write('\r\x1b[K')
  }
  if (!silent) process.stdout.write(RESPONSE_PREFIX)
}

export function closeAssistantBox(): void {
  process.stdout.write('\n\n')
}

/** Prefix written at the start of each response line (2 visible chars). */
export const RESPONSE_PREFIX = `  `
/** Visible column width of RESPONSE_PREFIX. */
export const RESPONSE_PREFIX_LEN = 2

// ANSI-specific off codes (don't reset ALL styles, just the specific one)
const ansiOff = { bold: '\x1b[22m', fg: '\x1b[39m' } as const

/** Stream writer with optional incremental markdown rendering.
 *  Plain mode: replaces newlines with newline + indent prefix.
 *  Markdown mode: detects code fences, headings, bold, and inline code
 *  character-by-character for flicker-free streaming display. */
export class StreamBuffer {
  private markdown: boolean
  // Markdown state
  private inCodeBlock = false
  private inHeading = false
  private inBold = false
  private inInlineCode = false
  private atLineStart = true
  private lineStartBuf = ''
  private skipLine = false   // skip to next \n (fence line)
  private pendingStar = false // buffered single * waiting for **

  constructor(private readonly contentWidth: number, markdown = false) {
    this.markdown = markdown
  }

  write(text: string): string {
    if (!this.markdown) return text.replaceAll('\n', '\n' + RESPONSE_PREFIX)
    let out = ''
    for (const ch of text) out += this.processChar(ch)
    return out
  }

  end(): string {
    let out = ''
    if (this.lineStartBuf) {
      const buf = this.lineStartBuf
      this.lineStartBuf = ''
      if (this.inCodeBlock) {
        out += buf ? `${ansi.dim}│${ansi.reset} ${buf}` : `${ansi.dim}│${ansi.reset}`
      } else {
        this.atLineStart = false
        for (const c of buf) out += this.processChar(c)
      }
    }
    if (this.pendingStar) { out += '*'; this.pendingStar = false }
    if (this.inHeading) { out += ansiOff.bold; this.inHeading = false }
    if (this.inBold) { out += ansiOff.bold; this.inBold = false }
    if (this.inInlineCode) { out += ansiOff.fg; this.inInlineCode = false }
    return out
  }

  private processChar(ch: string): string {
    // Skipping rest of a fence line (```javascript...)
    if (this.skipLine) {
      if (ch === '\n') {
        this.skipLine = false
        this.atLineStart = true
        this.lineStartBuf = ''
        return '\n' + RESPONSE_PREFIX
      }
      return ''
    }

    // Buffering at line start to detect code fences and headings
    if (this.atLineStart) {
      if (ch === '\n') {
        const out = this.flushBuf() + '\n' + RESPONSE_PREFIX
        this.lineStartBuf = ''
        return out
      }
      this.lineStartBuf += ch

      // Code fence? (3+ backticks at line start)
      if (this.lineStartBuf.length >= 3 && this.lineStartBuf.startsWith('```')) {
        this.inCodeBlock = !this.inCodeBlock
        this.skipLine = true
        this.atLineStart = false
        this.lineStartBuf = ''
        return ''
      }
      // Might still be a fence (all backticks, < 3)
      if (this.lineStartBuf.length < 3 && /^`+$/.test(this.lineStartBuf)) return ''

      // Heading? (# followed by space)
      if (/^#{1,3} /.test(this.lineStartBuf)) {
        this.atLineStart = false
        this.inHeading = true
        const afterHash = this.lineStartBuf.replace(/^#{1,3} /, '')
        this.lineStartBuf = ''
        return `${ansi.bold}${afterHash}`
      }
      // Might still be a heading (all # so far, < 4 chars)
      if (this.lineStartBuf.length < 4 && /^#{1,3}$/.test(this.lineStartBuf)) return ''

      // Not a special line — flush buffer through inline formatting
      this.atLineStart = false
      const buf = this.lineStartBuf
      this.lineStartBuf = ''
      if (this.inCodeBlock) return buf ? `${ansi.dim}│${ansi.reset} ${buf}` : `${ansi.dim}│${ansi.reset}`
      let out = ''
      for (const c of buf) out += this.processChar(c)
      return out
    }

    // Newline — reset line state
    if (ch === '\n') {
      let out = ''
      if (this.pendingStar) { out += '*'; this.pendingStar = false }
      if (this.inHeading) { out += ansiOff.bold; this.inHeading = false }
      out += '\n' + RESPONSE_PREFIX
      this.atLineStart = true
      this.lineStartBuf = ''
      return out
    }

    // Inside code block — no inline formatting
    if (this.inCodeBlock) return ch

    // Inline code toggle
    if (ch === '`') {
      if (this.pendingStar) { this.pendingStar = false; return '*`' }
      this.inInlineCode = !this.inInlineCode
      return this.inInlineCode ? ansi.cyan : ansiOff.fg
    }

    // Bold toggle (**)
    if (ch === '*' && !this.inInlineCode) {
      if (this.pendingStar) {
        this.pendingStar = false
        this.inBold = !this.inBold
        return this.inBold ? ansi.bold : ansiOff.bold
      }
      this.pendingStar = true
      return ''
    }
    if (this.pendingStar) {
      this.pendingStar = false
      return '*' + ch
    }

    return ch
  }

  /** Flush the line-start buffer with appropriate styling. */
  private flushBuf(): string {
    if (!this.lineStartBuf) {
      return this.inCodeBlock ? `${ansi.dim}│${ansi.reset}` : ''
    }
    if (this.inCodeBlock) {
      return `${ansi.dim}│${ansi.reset} ${this.lineStartBuf}`
    }
    return this.lineStartBuf
  }
}

/** Max lines to show per side of an Edit diff preview. */
const EDIT_DIFF_MAX_LINES = 4

/** Try to parse JSON args, returning undefined on failure. */
function parseArgs(args: string): Record<string, unknown> | undefined {
  try { return JSON.parse(args) } catch { return undefined }
}

/** Truncate a string to fit within `max` visible chars, adding … if needed. */
function truncLine(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

/** Format the ◆ header line for a tool call. */
function toolHeader(name: string, detail: string): string {
  return `  ${ansi.yellow}◆ ${name}${ansi.reset} ${ansi.dim}${detail}${ansi.reset}\n`
}

/** Format the ✔/✗ result line that replaces the ◆ header. */
function toolResultHeader(name: string, detail: string, resultDetail: string, isError = false): string {
  const suffix = detail ? `${detail} ${ansi.dim}— ${resultDetail}` : resultDetail
  const icon = isError ? `${ansi.red}✗` : `${ansi.greenBright}✔`
  return `  ${icon} ${name}${ansi.reset} ${ansi.dim}${suffix}${ansi.reset}`
}

// ---------------------------------------------------------------------------
// Edit diff formatting
// ---------------------------------------------------------------------------

function formatEditDiffLines(parsed: Record<string, unknown>, cols: number): string[] {
  const { old_string, new_string } = parsed as { old_string?: string; new_string?: string }
  if (old_string == null || new_string == null) return []

  const indent = '    '
  const usable = cols - indent.length - 2 // -2 for "- " / "+ " prefix
  const lines: string[] = []

  const oldLines = old_string.split('\n')
  const newLines = new_string.split('\n')
  const oldTrunc = oldLines.length > EDIT_DIFF_MAX_LINES
  const newTrunc = newLines.length > EDIT_DIFF_MAX_LINES
  const oldShow = oldTrunc ? oldLines.slice(0, EDIT_DIFF_MAX_LINES) : oldLines
  const newShow = newTrunc ? newLines.slice(0, EDIT_DIFF_MAX_LINES) : newLines

  for (const l of oldShow) lines.push(`${indent}${ansi.red}- ${truncLine(l, usable)}${ansi.reset}`)
  if (oldTrunc) lines.push(`${indent}${ansi.dim}… ${oldLines.length - EDIT_DIFF_MAX_LINES} more lines${ansi.reset}`)

  for (const l of newShow) lines.push(`${indent}${ansi.green}+ ${truncLine(l, usable)}${ansi.reset}`)
  if (newTrunc) lines.push(`${indent}${ansi.dim}… ${newLines.length - EDIT_DIFF_MAX_LINES} more lines${ansi.reset}`)

  return lines
}

// ---------------------------------------------------------------------------
// Tool detail extractors — return the short detail string for each tool type
// ---------------------------------------------------------------------------

/** Tool-specific detail extractors. Return empty string to fall through to default. */
const toolDetailExtractors: Record<string, (p: Record<string, unknown>, cols: number) => string> = {
  Read(p) {
    const parts = [p.path as string]
    if (p.offset) parts.push(`offset=${p.offset}`)
    if (p.limit) parts.push(`limit=${p.limit}`)
    return parts.join(' ')
  },
  Write(p) { return p.path as string },
  AppendFile(p) { return p.path as string },
  DeleteFile(p) { return p.path as string },
  MoveFile(p) { return `${p.source} → ${p.destination}` },
  CopyFile(p) { return `${p.source} → ${p.destination}` },
  LS(p) { return `${p.path}${p.recursive ? ' (recursive)' : ''}` },
  Glob(p) { return `${p.pattern}${p.path ? ` in ${p.path}` : ''}` },
  Grep(p) {
    const parts = [`"${p.pattern}"`]
    if (p.path) parts.push(`in ${p.path}`)
    if (p.include) parts.push(`${p.include}`)
    return parts.join(' ')
  },
  Bash(p, cols) {
    const cmd = String(p.command ?? '')
    const firstLine = cmd.split('\n')[0] ?? ''
    const maxLen = cols - 8 // "  ◆ Bash " prefix
    return truncLine(firstLine, maxLen)
  },
  WebFetch(p) {
    const method = (p.method as string) ?? 'GET'
    return `${method} ${p.url}`
  },
  Agent(p) {
    const tasks = p.tasks as Array<unknown> | undefined
    return `${tasks?.length ?? '?'} task(s)`
  },
}

// ---------------------------------------------------------------------------
// Active tool tracking for in-place ◆ → ✔ updates
// ---------------------------------------------------------------------------

interface ActiveToolEntry {
  id: string
  name: string
  detail: string
  lineCount: number
}

// ---------------------------------------------------------------------------
// printToolCall — show ◆ and register for in-place update
// ---------------------------------------------------------------------------

export function printToolCall(state: TuiStreamState, id: string, name: string, args: string): void {
  const cols = process.stdout.columns || 80
  const parsed = parseArgs(args)

  // Edit: header + diff lines
  if (name === 'Edit' && parsed) {
    const path = (parsed.path as string) ?? ''
    const diffLines = formatEditDiffLines(parsed, cols)
    if (diffLines.length > 0) {
      process.stdout.write(toolHeader('Edit', path))
      for (const line of diffLines) process.stdout.write(line + '\n')
      state.activeTools.push({ id, name: 'Edit', detail: path, lineCount: 1 + diffLines.length })
      return
    }
  }

  // Extract detail string
  let detail = ''
  if (parsed) {
    const extractor = toolDetailExtractors[name]
    if (extractor) detail = extractor(parsed, cols)
  }
  if (!detail) {
    // Default: collapse JSON args to a single line
    try {
      detail = JSON.stringify(JSON.parse(args))
        .replace(/^\{|\}$/g, '')
        .replace(/^"|"$/g, '')
    } catch {
      detail = args.replace(/\s+/g, ' ').trim()
    }
    const prefix = `  ◆ ${name} `
    const maxFlat = cols - prefix.length - 1
    detail = detail.length > maxFlat ? detail.slice(0, maxFlat) + '…' : detail
  }

  process.stdout.write(toolHeader(name, detail))
  state.activeTools.push({ id, name, detail, lineCount: 1 })
}

// ---------------------------------------------------------------------------
// Summarize tool result content
// ---------------------------------------------------------------------------

/** Summarize tool result content for display. */
function summarizeResult(name: string, content: string): string {
  switch (name) {
    case 'Read': {
      const lines = content.split('\n')
      const count = lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
      return `${count} lines`
    }
    case 'Grep': {
      if (content.startsWith('No matches')) return 'no matches'
      const lines = content.split('\n').filter(l => l.length > 0)
      return `${lines.length} match${lines.length === 1 ? '' : 'es'}`
    }
    case 'Glob': {
      if (content.startsWith('No files')) return 'no files'
      const lines = content.split('\n').filter(l => l.length > 0)
      return `${lines.length} file${lines.length === 1 ? '' : 's'}`
    }
    case 'LS': {
      const lines = content.split('\n').filter(l => l.length > 0)
      return `${lines.length} entr${lines.length === 1 ? 'y' : 'ies'}`
    }
    case 'Bash':
    case 'PowerShell': {
      const exitMatch = content.match(/<exit_code>(\d+)<\/exit_code>/)
      const code = exitMatch ? exitMatch[1] : '?'
      const stdoutMatch = content.match(/<stdout>([\s\S]*?)<\/stdout>/)
      const stdout = stdoutMatch?.[1]?.trim() ?? ''
      const lines = stdout ? stdout.split('\n').length : 0
      return code === '0'
        ? `exit 0${lines ? `, ${lines} line${lines === 1 ? '' : 's'}` : ''}`
        : `exit ${code}`
    }
    case 'WebFetch': {
      try {
        const r = JSON.parse(content) as { status?: number }
        return `${r.status ?? '?'}`
      } catch { return '' }
    }
    default:
      return ''
  }
}

// ---------------------------------------------------------------------------
// printToolResult — overwrite ◆ line in-place (TTY) or append (non-TTY)
// ---------------------------------------------------------------------------

export function printToolResult(state: TuiStreamState, id: string, name: string, ms: number, content?: string, isError = false): void {
  const summary = content ? summarizeResult(name, content) : ''
  const resultDetail = summary ? `${summary}, ${ms}ms` : `${ms}ms`

  const idx = state.activeTools.findIndex(t => t.id === id)
  const tool = idx !== -1 ? state.activeTools[idx] : undefined
  const detail = tool?.detail ?? ''

  // Non-TTY or untracked tool: append a separate ✔/✗ line (no cursor movement)
  if (!process.stdout.isTTY || !tool) {
    process.stdout.write(toolResultHeader(name, detail, resultDetail, isError) + '\n')
    if (idx !== -1) state.activeTools.splice(idx, 1)
    return
  }

  // Calculate how many lines above the cursor the tool's header line is.
  // Each tool after this one contributes its lineCount.
  let linesUp = tool.lineCount
  for (let i = idx + 1; i < state.activeTools.length; i++) {
    linesUp += state.activeTools[i]!.lineCount
  }

  // Move up → overwrite header → move back down
  process.stdout.write(`\x1b[${linesUp}A\r\x1b[K`)
  process.stdout.write(toolResultHeader(tool.name, tool.detail, resultDetail, isError))
  process.stdout.write(`\x1b[${linesUp}B\r`)

  // Remove completed tool from tracking
  state.activeTools.splice(idx, 1)
}

// ---------------------------------------------------------------------------
// Status / error output
// ---------------------------------------------------------------------------

export function printStatus(msg: string): void {
  process.stdout.write(`${ansi.dim}${msg}${ansi.reset}\n`)
}

export function printCommandResponse(msg: string): void {
  process.stdout.write(`  ${ansi.dim}${msg}${ansi.reset}\n`)
}

export function printError(msg: string): void {
  process.stdout.write(`  ${ansi.red}✗ ${msg}${ansi.reset}\n`)
}

export function printInterrupt(msg: string): void {
  process.stdout.write(`\n${ansi.yellow}${msg}${ansi.reset}\n`)
}

// Styled prompt for readline — ANSI OK here, cursor math only breaks on very long wrapped lines
export const PROMPT = `\x1b[96m›\x1b[0m `

// ---------------------------------------------------------------------------
// TUI streaming state
// ---------------------------------------------------------------------------

/** TUI streaming state — tracks thinking/text display and stream buffer. */
export interface TuiStreamState {
  boxOpened: boolean
  thinkingOpened: boolean
  thinkingCollapsed: boolean
  /** Number of \n characters written to stdout during thinking (including header). */
  thinkingLines: number
  thinkingStartTime: number
  streamBuf: StreamBuffer | null
  thinkingBuf: StreamBuffer | null
  toolStartTimes: Map<string, number>
  /** Tool names shown during streaming (before execution starts). */
  pendingToolNames: string[]
  /** Active tool entries for in-place ◆ → ✔ updates. */
  activeTools: ActiveToolEntry[]
}

/** Create a new TUI streaming state for a single agent loop run. */
export function createStreamState(): TuiStreamState {
  return {
    boxOpened: false, thinkingOpened: false, thinkingCollapsed: false,
    thinkingLines: 0, thinkingStartTime: 0,
    streamBuf: null, thinkingBuf: null, toolStartTimes: new Map(),
    pendingToolNames: [],
    activeTools: [],
  }
}

function countNewlines(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) if (s[i] === '\n') n++
  return n
}

/** Handle a stream chunk for TUI display. */
export function handleStreamChunk(state: TuiStreamState, chunkType: string, delta?: string, toolName?: string): void {
  if (chunkType === 'thinking') {
    if (state.thinkingCollapsed) return
    if (!state.thinkingOpened) {
      stopSpinner(true)
      process.stdout.write(`  ${ansi.dim}╌╌ thinking ╌╌${ansi.reset}\n  ${ansi.dim}`)
      state.thinkingOpened = true
      state.thinkingStartTime = Date.now()
      state.thinkingLines = 1 // printThinkingStart writes 1 \n
      const contentWidth = (process.stdout.columns || 80) - RESPONSE_PREFIX_LEN
      state.thinkingBuf = new StreamBuffer(contentWidth)
    }
    if (delta && state.thinkingBuf) {
      const output = state.thinkingBuf.write(delta)
      if (output) {
        process.stdout.write(output)
        state.thinkingLines += countNewlines(output)
      }
    }
  } else if (chunkType === 'text') {
    if (state.thinkingOpened) collapseThinking(state)
    if (!state.boxOpened) {
      stopSpinner()
      // Add visual separation after a tools section
      if (state.activeTools.length > 0) {
        process.stdout.write('\n')
        state.activeTools = []
      }
      state.boxOpened = true
      const contentWidth = (process.stdout.columns || 80) - RESPONSE_PREFIX_LEN
      state.streamBuf = new StreamBuffer(contentWidth, true)
    }
    if (delta && state.streamBuf) process.stdout.write(state.streamBuf.write(delta))
  } else if (chunkType === 'tool_call_start' && toolName) {
    // Show tool names immediately so users see activity during arg streaming
    if (state.thinkingOpened) collapseThinking(state)
    if (state.boxOpened) {
      const out = state.streamBuf?.end(); if (out) process.stdout.write(out)
      process.stdout.write('\n')
      state.boxOpened = false
      state.streamBuf = null
    }
    stopSpinner(true)
    state.pendingToolNames.push(toolName)
    process.stdout.write(`  ${ansi.yellow}◆ ${toolName}${ansi.reset}\n`)
  }
}

/** Reposition cursor to overwrite pending tool preview lines.
 *  Called once before tool execution begins — cursor moves up so
 *  printToolCall naturally overwrites each preview line. */
export function clearPendingTools(state: TuiStreamState): void {
  if (state.pendingToolNames.length > 0) {
    // Move cursor up to the first pending line (no erase — execution will overwrite)
    process.stdout.write(`\x1b[${state.pendingToolNames.length}A\r`)
    state.pendingToolNames = []
  }
}

/** Collapse the thinking block into a single summary line. */
export function collapseThinking(state: TuiStreamState): void {
  if (!state.thinkingOpened || state.thinkingCollapsed) return
  state.thinkingBuf = null

  // Move cursor back to the header line and clear everything below
  if (state.thinkingLines > 0) {
    process.stdout.write(`\r\x1b[${state.thinkingLines}A\x1b[J`)
  } else {
    process.stdout.write(`\r\x1b[J`)
  }

  const elapsed = ((Date.now() - state.thinkingStartTime) / 1000).toFixed(1)
  process.stdout.write(`  ${ansi.dim}╌╌ thinking (${elapsed}s) ╌╌${ansi.reset}\n`)

  state.thinkingCollapsed = true
  state.thinkingOpened = false
}

/** Flush TUI state at end of loop run (success or error). */
export function flushStreamState(state: TuiStreamState): void {
  if (state.thinkingOpened) collapseThinking(state)
  clearPendingTools(state)
  stopSpinner(true)
  const out = state.streamBuf?.end()
  if (out) process.stdout.write(out)
  if (state.boxOpened) closeAssistantBox()
  else process.stdout.write('\n')
  state.activeTools = []
}
