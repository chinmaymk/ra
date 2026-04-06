import type { LoopContext } from "@chinmaymk/ra"

const MAX_REPEATED_ERRORS = 3
const recentErrors: string[] = []

function extractErrors(messages: { role: string; content: unknown; isError?: boolean }[]): string[] {
  const errors: string[] = []
  for (const msg of messages) {
    if (msg.role !== "tool") continue
    const content = msg.content

    // Tool results that are marked as errors
    if (msg.isError) {
      const text = typeof content === "string" ? content : ""
      const snippet = text.slice(0, 100).trim()
      if (snippet) errors.push(snippet)
      continue
    }

    // Tool results containing error-like patterns
    if (typeof content === "string" && content.length < 500) {
      const match = content.match(
        /(?:error|Error|ERROR|exception|Exception|EXCEPTION|fail|FAIL)[:.\s](.{10,80})/
      )
      if (match) errors.push(match[1]!.trim())
    }
  }
  return errors
}

function normalize(error: string): string {
  return error
    .replace(/\d+/g, "N") // Normalize numbers
    .replace(/['"][^'"]{0,50}['"]/g, "S") // Normalize strings
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim()
    .slice(0, 80)
}

export default async function loopGuard(ctx: LoopContext): Promise<void> {
  const errors = extractErrors(ctx.messages.slice(-6))

  for (const error of errors) {
    const normalized = normalize(error)
    recentErrors.push(normalized)
  }

  // Keep only last 10
  while (recentErrors.length > 10) recentErrors.shift()

  // Count repeated patterns
  const counts = new Map<string, number>()
  for (const e of recentErrors) {
    counts.set(e, (counts.get(e) ?? 0) + 1)
  }

  for (const [pattern, count] of counts) {
    if (count >= MAX_REPEATED_ERRORS) {
      // Clear to avoid re-triggering
      recentErrors.length = 0

      ctx.messages.push({
        role: "user",
        content: `<system-reminder>\n## Loop Detection\n\nThe same error has occurred ${count} times:\n\`\`\`\n${pattern}\n\`\`\`\n\n**You are going in circles.** Your current approach is not working. Activate \`/stuck\` to break out of this loop.\n\nDo NOT retry the same approach. Either:\n1. Use /stuck to systematically reframe the problem\n2. Try a fundamentally different approach\n3. Ask the user for help with full context of what you've tried\n</system-reminder>`,
      })

      process.stderr.write(
        `\x1b[31m[oh-my-ra] loop-guard: detected repeated error (${count}x) — injecting /stuck suggestion\x1b[0m\n`
      )
      return
    }
  }
}
