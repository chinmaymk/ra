// Pure ANSI TUI utilities — no external dependencies
import wrapAnsi from 'wrap-ansi'

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
  return TAGLINES[hash % TAGLINES.length]!
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
  const wasRunning = !!spinnerTimer
  if (spinnerTimer) {
    clearInterval(spinnerTimer)
    spinnerTimer = null
  }
  if (silent) {
    if (wasRunning) process.stdout.write('\r\x1b[K')
  } else {
    // Clear spinner/current line then indent prefix for model response
    process.stdout.write(`\r\x1b[K${RESPONSE_PREFIX}`)
  }
}

export function closeAssistantBox(): void {
  process.stdout.write('\n\n')
}

/** Prefix written at the start of each response line (2 visible chars). */
export const RESPONSE_PREFIX = `  `
/** Visible column width of RESPONSE_PREFIX. */
export const RESPONSE_PREFIX_LEN = 2

/** Streaming line-buffer that wraps completed logical lines with wrap-ansi.
 *
 * Text is accumulated until a `\n` is received; each complete line is then
 * word-wrapped at `contentWidth` (hard-breaking any word that exceeds the
 * limit) and re-prefixed with RESPONSE_PREFIX on every visual sub-line.
 *
 * The in-progress (last, incomplete) line is held in the buffer and only
 * output when `end()` is called or the next `\n` arrives. */
export class StreamBuffer {
  private buf = ''

  constructor(private readonly contentWidth: number) {}

  write(text: string): string {
    this.buf += text
    const parts = this.buf.split('\n')
    this.buf = parts.pop() ?? ''   // keep last incomplete line
    if (parts.length === 0) return ''

    // Each complete line → wrap → re-prefix continuation sub-lines
    const formatted = parts.map(l => this._wrapLine(l))
    // Join with newline+prefix (next line starts with prefix already on screen
    // from the previous continuation, so we just need \n + prefix between lines)
    return formatted.join('\n' + RESPONSE_PREFIX) + '\n' + RESPONSE_PREFIX
  }

  /** Flush the buffered incomplete line — call once when streaming ends. */
  end(): string {
    const out = this._wrapLine(this.buf)
    this.buf = ''
    return out
  }

  private _wrapLine(line: string): string {
    if (!line) return ''
    const wrapped = wrapAnsi(line, this.contentWidth, { hard: true, trim: false })
    // trim: false preserves leading whitespace (code indents) but leaves trailing
    // spaces at word-break points — remove those.
    return wrapped.split('\n').map(l => l.trimEnd()).join('\n' + RESPONSE_PREFIX)
  }
}

export function printToolCall(name: string, args: string): void {
  const cols = process.stdout.columns || 80
  // Collapse JSON args to a single line and trim outer braces/whitespace
  let flat: string
  try {
    flat = JSON.stringify(JSON.parse(args))
      .replace(/^\{|\}$/g, '')   // strip outer braces
      .replace(/^"|"$/g, '')     // strip outer quotes for scalar values
  } catch {
    flat = args.replace(/\s+/g, ' ').trim()
  }
  // Budget: indent(2) + '◆ '(2) + name + ' '(1) + '…'(1) + reset codes — keep it simple
  const prefix = `  ◆ ${name} `
  const maxFlat = cols - prefix.length - 1  // -1 for the ellipsis if truncated
  const truncated = flat.length > maxFlat ? flat.slice(0, maxFlat) + '…' : flat
  process.stdout.write(`  ${ansi.yellow}◆ ${name}${ansi.reset} ${ansi.dim}${truncated}${ansi.reset}`)
}

export function printToolResult(name: string, ms: number): void {
  process.stdout.write(`\r  ${ansi.greenBright}✔ ${name}${ansi.dim} (${ms}ms)${ansi.reset}\n`)
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
  streamBuf: StreamBuffer | null
  toolStartTimes: Map<string, number>
}

/** Create a new TUI streaming state for a single agent loop run. */
export function createStreamState(): TuiStreamState {
  return { boxOpened: false, thinkingOpened: false, streamBuf: null, toolStartTimes: new Map() }
}

/** Handle a stream chunk for TUI display. */
export function handleStreamChunk(state: TuiStreamState, chunkType: string, delta?: string): void {
  if (chunkType === 'thinking') {
    if (!state.thinkingOpened) {
      stopSpinner(true)
      printThinkingStart()
      state.thinkingOpened = true
    }
    if (delta) process.stdout.write(delta)
  } else if (chunkType === 'text') {
    if (state.thinkingOpened) {
      printThinkingEnd()
      state.thinkingOpened = false
    }
    if (!state.boxOpened) {
      stopSpinner()
      state.boxOpened = true
      const contentWidth = (process.stdout.columns || 80) - RESPONSE_PREFIX_LEN
      state.streamBuf = new StreamBuffer(contentWidth)
    }
    if (delta && state.streamBuf) process.stdout.write(state.streamBuf.write(delta))
  }
}

/** Flush TUI state at end of loop run (success or error). */
export function flushStreamState(state: TuiStreamState): void {
  if (state.thinkingOpened) printThinkingEnd()
  stopSpinner(true)
  const out = state.streamBuf?.end()
  if (out) process.stdout.write(out)
  if (state.boxOpened) closeAssistantBox()
  else process.stdout.write('\n\n')
}

export function printThinkingStart(): void {
  process.stdout.write(`  ${ansi.dim}╌╌ thinking ╌╌${ansi.reset}\n  ${ansi.dim}`)
}

export function printThinkingEnd(): void {
  process.stdout.write(`${ansi.reset}\n  ${ansi.dim}╌╌╌╌╌╌╌╌╌╌╌╌╌╌${ansi.reset}\n`)
}
