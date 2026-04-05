import type { LoopContext } from "@chinmaymk/ra"

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return `${n}`
}

export default async function progressTracker(
  ctx: LoopContext
): Promise<void> {
  const { iteration, usage } = ctx

  const input = formatTokens(usage.inputTokens)
  const output = formatTokens(usage.outputTokens)
  const thinking = usage.thinkingTokens
    ? ` thinking=${formatTokens(usage.thinkingTokens)}`
    : ""
  const cache =
    usage.cacheReadTokens || usage.cacheCreationTokens
      ? ` cache_read=${formatTokens(usage.cacheReadTokens ?? 0)} cache_write=${formatTokens(usage.cacheCreationTokens ?? 0)}`
      : ""

  const toolCalls = ctx.messages.filter(
    (m) =>
      m.role === "assistant" &&
      Array.isArray((m as { toolCalls?: unknown[] }).toolCalls) &&
      ((m as { toolCalls?: unknown[] }).toolCalls?.length ?? 0) > 0
  ).length

  ctx.logger.info("iteration_complete", {
    iteration,
    tokens: { input: usage.inputTokens, output: usage.outputTokens },
    toolCalls,
  })

  process.stderr.write(
    `\x1b[2m[oh-my-ra] iteration=${iteration} in=${input} out=${output}${thinking}${cache} tools=${toolCalls}\x1b[0m\n`
  )
}
