// Pure ANSI TUI utilities — no external dependencies

export const c = {
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
  process.stdout.write(`  ${c.bold}${c.cyanBright}ra${c.reset}  ${c.dim}${tagline(sessionId)}${c.reset}\n`)
  process.stdout.write(`  ${c.dim}${model}  ·  ${sessionId}${c.reset}\n`)
  process.stdout.write(`  ${c.dim}/clear  /attach  /skill  /resume${c.reset}\n\n`)
}

export function printResumeHeader(sessionId: string, messageCount: number): void {
  process.stdout.write(`  ${c.dim}↩ ${sessionId}  ·  ${messageCount} messages${c.reset}\n\n`)
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
let spinnerTimer: ReturnType<typeof setInterval> | null = null
let spinnerFrame = 0

export function startSpinner(): void {
  if (spinnerTimer) return
  spinnerFrame = 0
  const tick = () => {
    process.stdout.write(`\r${c.dim}${SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length]}${c.reset}`)
    spinnerFrame++
  }
  tick()
  spinnerTimer = setInterval(tick, 80)
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
    // Clear spinner/current line then 2-space indent for model response
    process.stdout.write(`\r\x1b[K  `)
  }
}

export function closeAssistantBox(): void {
  process.stdout.write('\n\n')
}

export function printToolCall(name: string): void {
  process.stdout.write(`  ${c.yellow}◆ ${name}${c.dim} …${c.reset}`)
}

export function printToolResult(name: string, ms: number): void {
  process.stdout.write(`\r  ${c.greenBright}✔ ${name}${c.dim} (${ms}ms)${c.reset}\n`)
}

export function printStatus(msg: string): void {
  process.stdout.write(`${c.dim}${msg}${c.reset}\n`)
}

export function printCommandResponse(msg: string): void {
  process.stdout.write(`  ${c.dim}${msg}${c.reset}\n`)
}

export function printError(msg: string): void {
  process.stdout.write(`${c.red}Error: ${msg}${c.reset}\n`)
}

// Styled prompt for readline — ANSI OK here, cursor math only breaks on very long wrapped lines
export const PROMPT = `\x1b[96m›\x1b[0m `

export function printThinkingStart(): void {
  process.stdout.write(`  ${c.dim}╌╌ thinking ╌╌${c.reset}\n  ${c.dim}`)
}

export function printThinkingEnd(): void {
  process.stdout.write(`${c.reset}\n  ${c.dim}╌╌╌╌╌╌╌╌╌╌╌╌╌╌${c.reset}\n`)
}
