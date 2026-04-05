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

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SPINNER_TICK_MS = 80
let spinnerTimer: ReturnType<typeof setInterval> | null = null
let spinnerFrame = 0

export function startSpinner(): void {
  if (spinnerTimer) return
  spinnerFrame = 0
  const tick = () => {
    process.stdout.write(`\r${ansi.dim}${SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length]}${ansi.reset}`)
    spinnerFrame++
  }
  tick()
  spinnerTimer = setInterval(tick, SPINNER_TICK_MS)
}

export function stopSpinner(silent = false): void {
  if (spinnerTimer) {
    clearInterval(spinnerTimer)
    spinnerTimer = null
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

/** Pass-through stream writer that outputs text immediately for responsive
 * token display. Newlines are re-prefixed with RESPONSE_PREFIX so each new
 * line retains the proper indent. No buffering — tokens appear as they arrive. */
export class StreamBuffer {
  constructor(private readonly contentWidth: number) {}

  /** Write text immediately, replacing newlines with newline + indent prefix. */
  write(text: string): string {
    return text.replaceAll('\n', '\n' + RESPONSE_PREFIX)
  }

  /** No-op — all content was already written during streaming. */
  end(): string {
    return ''
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

function formatEditCall(parsed: Record<string, unknown>, cols: number): string {
  const { path, old_string, new_string } = parsed as { path?: string; old_string?: string; new_string?: string }
  if (!path || old_string == null || new_string == null) return ''

  const indent = '    '
  const usable = cols - indent.length - 2 // -2 for "- " / "+ " prefix
  const lines: string[] = []

  lines.push(`  ${ansi.yellow}◆ Edit${ansi.reset} ${ansi.dim}${path}${ansi.reset}`)

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

  return lines.join('\n') + '\n'
}

/** Tool-specific call formatters. Return empty string to fall through to default. */
const toolCallFormatters: Record<string, (p: Record<string, unknown>, cols: number) => string> = {
  Edit: formatEditCall,
  Read(p) {
    const detail = [p.path as string]
    if (p.offset) detail.push(`offset=${p.offset}`)
    if (p.limit) detail.push(`limit=${p.limit}`)
    return toolHeader('Read', detail.join(' '))
  },
  Write(p) { return toolHeader('Write', p.path as string) },
  AppendFile(p) { return toolHeader('AppendFile', p.path as string) },
  DeleteFile(p) { return toolHeader('DeleteFile', p.path as string) },
  MoveFile(p) { return toolHeader('MoveFile', `${p.source} → ${p.destination}`) },
  CopyFile(p) { return toolHeader('CopyFile', `${p.source} → ${p.destination}`) },
  LS(p) { return toolHeader('LS', `${p.path}${p.recursive ? ' (recursive)' : ''}`) },
  Glob(p) { return toolHeader('Glob', `${p.pattern}${p.path ? ` in ${p.path}` : ''}`) },
  Grep(p) {
    const parts = [`"${p.pattern}"`]
    if (p.path) parts.push(`in ${p.path}`)
    if (p.include) parts.push(`${p.include}`)
    return toolHeader('Grep', parts.join(' '))
  },
  Bash(p, cols) {
    const cmd = String(p.command ?? '')
    const firstLine = cmd.split('\n')[0] ?? ''
    const maxLen = cols - 8 // "  ◆ Bash " prefix
    return toolHeader('Bash', truncLine(firstLine, maxLen))
  },
  WebFetch(p) {
    const method = (p.method as string) ?? 'GET'
    return toolHeader('WebFetch', `${method} ${p.url}`)
  },
  Agent(p) {
    const tasks = p.tasks as Array<unknown> | undefined
    return toolHeader('Agent', `${tasks?.length ?? '?'} task(s)`)
  },
}

export function printToolCall(name: string, args: string): void {
  const cols = process.stdout.columns || 80
  const parsed = parseArgs(args)

  if (parsed) {
    const formatter = toolCallFormatters[name]
    if (formatter) {
      const out = formatter(parsed, cols)
      if (out) { process.stdout.write(out); return }
    }
  }

  // Default: collapse JSON args to a single line
  let flat: string
  try {
    flat = JSON.stringify(JSON.parse(args))
      .replace(/^\{|\}$/g, '')   // strip outer braces
      .replace(/^"|"$/g, '')     // strip outer quotes for scalar values
  } catch {
    flat = args.replace(/\s+/g, ' ').trim()
  }
  const prefix = `  ◆ ${name} `
  const maxFlat = cols - prefix.length - 1
  const truncated = flat.length > maxFlat ? flat.slice(0, maxFlat) + '…' : flat
  process.stdout.write(`  ${ansi.yellow}◆ ${name}${ansi.reset} ${ansi.dim}${truncated}${ansi.reset}\n`)
}

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

export function printToolResult(name: string, ms: number, content?: string): void {
  const summary = content ? summarizeResult(name, content) : ''
  const detail = summary ? `${summary}, ${ms}ms` : `${ms}ms`
  process.stdout.write(`  ${ansi.greenBright}✔ ${name}${ansi.dim} ${detail}${ansi.reset}\n`)
}

export function printStatus(msg: string): void {
  process.stdout.write(`${ansi.dim}${msg}${ansi.reset}\n`)
}

export function printCommandResponse(msg: string): void {
  process.stdout.write(`  ${ansi.dim}${msg}${ansi.reset}\n`)
}

export function printError(msg: string): void {
  process.stdout.write(`${ansi.red}Error: ${msg}${ansi.reset}\n`)
}

export function printInterrupt(msg: string): void {
  process.stdout.write(`\n${ansi.yellow}${msg}${ansi.reset}\n`)
}

// Styled prompt for readline — ANSI OK here, cursor math only breaks on very long wrapped lines
export const PROMPT = `\x1b[96m›\x1b[0m `

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
}

/** Create a new TUI streaming state for a single agent loop run. */
export function createStreamState(): TuiStreamState {
  return {
    boxOpened: false, thinkingOpened: false, thinkingCollapsed: false,
    thinkingLines: 0, thinkingStartTime: 0,
    streamBuf: null, thinkingBuf: null, toolStartTimes: new Map(),
    pendingToolNames: [],
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
      state.boxOpened = true
      const contentWidth = (process.stdout.columns || 80) - RESPONSE_PREFIX_LEN
      state.streamBuf = new StreamBuffer(contentWidth)
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
 *  printToolCall/printToolResult naturally overwrite each preview line. */
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
}

