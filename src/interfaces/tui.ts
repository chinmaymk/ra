// Pure ANSI TUI utilities — no external dependencies

export const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  gray: '\x1b[90m',
} as const

export function printHeader(model: string, sessionId: string): void {
  process.stdout.write(`\n${c.bold}${c.cyan}ra${c.reset}  ${c.dim}${model} · ${sessionId}${c.reset}\n`)
  process.stdout.write(`${c.dim}/clear  /attach <path>  /skill <name>  /resume <id>${c.reset}\n\n`)
}

export function openAssistantBox(): void {
  process.stdout.write(`\n${c.dim}─────${c.reset}\n`)
}

export function closeAssistantBox(): void {
  process.stdout.write(`\n${c.dim}─────${c.reset}\n\n`)
}

export function printToolCall(name: string): void {
  process.stdout.write(`\n${c.yellow}⚙ ${name}${c.reset}\n`)
}

export function printToolResult(name: string, ms: number): void {
  process.stdout.write(`${c.green}✓ ${name}${c.dim} (${ms}ms)${c.reset}\n`)
}

export function printStatus(msg: string): void {
  process.stdout.write(`${c.dim}${msg}${c.reset}\n`)
}

// Styled prompt for readline — ANSI OK here, cursor math only breaks on very long wrapped lines
export const PROMPT = `\x1b[1myou\x1b[0m \x1b[36m›\x1b[0m `
