import type { LoopContext } from "@chinmaymk/ra"

export default async function sessionSummary(ctx: LoopContext): Promise<void> {
  const { iteration, usage, messages } = ctx

  // Only log on loop completion (this is registered on afterLoopComplete)
  const totalTokens = usage.inputTokens + usage.outputTokens + (usage.thinkingTokens ?? 0)

  const toolCalls = messages.filter(
    (m) =>
      m.role === "assistant" &&
      Array.isArray(m.content) &&
      m.content.some(
        (b: { type: string }) => b.type === "tool_use" || b.type === "tool_call"
      )
  ).length

  const toolResults = messages.filter((m) => m.role === "tool").length
  const errors = messages.filter(
    (m) =>
      m.role === "tool" &&
      Array.isArray(m.content) &&
      m.content.some((b: { isError?: boolean }) => b.isError)
  ).length

  const summary = [
    `\x1b[2m╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌\x1b[0m`,
    `\x1b[2m[oh-my-ra] session complete\x1b[0m`,
    `\x1b[2m  iterations:  ${iteration}\x1b[0m`,
    `\x1b[2m  tokens:      ${totalTokens.toLocaleString()} (in=${usage.inputTokens.toLocaleString()} out=${usage.outputTokens.toLocaleString()}${usage.thinkingTokens ? ` think=${usage.thinkingTokens.toLocaleString()}` : ""})\x1b[0m`,
    `\x1b[2m  tool calls:  ${toolCalls} (${errors} errors)\x1b[0m`,
    `\x1b[2m  messages:    ${messages.length}\x1b[0m`,
    `\x1b[2m╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌\x1b[0m`,
  ].join("\n")

  process.stderr.write(summary + "\n")

  ctx.logger.info("session_complete", {
    iterations: iteration,
    tokens: {
      total: totalTokens,
      input: usage.inputTokens,
      output: usage.outputTokens,
      thinking: usage.thinkingTokens ?? 0,
    },
    toolCalls,
    toolResults,
    errors,
    messages: messages.length,
  })
}
