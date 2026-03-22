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
  process.stdout.write(`\r\x1b[K  ${ansi.greenBright}✔ ${name}${ansi.dim} (${ms}ms)${ansi.reset}\n`)
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
  else process.stdout.write('\n\n')
}

