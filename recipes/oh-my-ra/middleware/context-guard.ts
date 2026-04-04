import type { ModelCallContext } from "@chinmaymk/ra"

const CONTEXT_WARN_THRESHOLD = 0.7
const CONTEXT_CRITICAL_THRESHOLD = 0.85

function estimateTokens(messages: { content: unknown }[]): number {
  let chars = 0
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      chars += msg.content.length
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        const b = block as { text?: string; content?: string }
        if (b.text) chars += b.text.length
        if (b.content) chars += b.content.length
      }
    }
  }
  return Math.ceil(chars / 4)
}

const CONTEXT_WINDOWS: Record<string, number> = {
  "claude-opus-4-6": 200000,
  "claude-sonnet-4-6": 200000,
  "claude-haiku-4-5": 200000,
  "gpt-4o": 128000,
  "gpt-4o-mini": 128000,
  "o3-mini": 128000,
}

let hasWarnedAt70 = false
let hasWarnedAt85 = false

export default async function contextGuard(
  ctx: ModelCallContext
): Promise<void> {
  const messages = ctx.request.messages
  const estimatedTokens = estimateTokens(messages)

  // Try to determine context window from model name in request
  const modelHint = (ctx.request as { model?: string }).model ?? ""
  let contextWindow = 200000
  for (const [key, value] of Object.entries(CONTEXT_WINDOWS)) {
    if (modelHint.includes(key)) {
      contextWindow = value
      break
    }
  }

  const usage = estimatedTokens / contextWindow

  if (usage >= CONTEXT_CRITICAL_THRESHOLD && !hasWarnedAt85) {
    hasWarnedAt85 = true
    ctx.request.messages.push({
      role: "user",
      content: `<system-reminder>\n## Context Window Alert (${Math.round(usage * 100)}% used)\n\nYour context window is nearly full (~${estimatedTokens} tokens of ~${contextWindow}).\n\n**Immediate actions:**\n1. Delegate large file reads to Agent subagents to protect your context\n2. Be concise in your responses — every token counts\n3. Avoid reading large files directly — ask agents to summarize\n4. If compaction hasn't triggered yet, it will soon — make sure critical state is saved to scratchpad\n</system-reminder>`,
    })

    process.stderr.write(
      `\x1b[33m[oh-my-ra] context-guard: ${Math.round(usage * 100)}% context used — critical threshold reached\x1b[0m\n`
    )
  } else if (usage >= CONTEXT_WARN_THRESHOLD && !hasWarnedAt70) {
    hasWarnedAt70 = true
    ctx.request.messages.push({
      role: "user",
      content: `<system-reminder>\n## Context Window Warning (${Math.round(usage * 100)}% used)\n\nYou're using ~${Math.round(usage * 100)}% of the context window (~${estimatedTokens} tokens).\n\n**Recommendations:**\n- Prefer delegating file reads to Agent subagents\n- Save important state to scratchpad (it survives compaction)\n- Keep responses concise\n</system-reminder>`,
    })

    process.stderr.write(
      `\x1b[2m[oh-my-ra] context-guard: ${Math.round(usage * 100)}% context used — warning threshold reached\x1b[0m\n`
    )
  }
}
