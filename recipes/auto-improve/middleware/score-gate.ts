import type { LoopContext } from "@chinmaymk/ra"

/**
 * Injects benchmark configuration and past results into the conversation
 * at loop start so the agent has full context before its first model call.
 */
export default async function scoreGate(ctx: LoopContext): Promise<void> {
  const cmd = process.env.BENCH_CMD
  const pattern = process.env.BENCH_METRIC_PATTERN
  const direction = process.env.BENCH_DIRECTION || "higher"
  const target = process.env.BENCH_TARGET || "packages/ra/src"

  if (!cmd || !pattern) {
    ctx.logger.info("score-gate:missing-config", {
      BENCH_CMD: cmd ?? "NOT SET",
      BENCH_METRIC_PATTERN: pattern ?? "NOT SET",
    })
    ctx.stop("Missing required BENCH_CMD or BENCH_METRIC_PATTERN environment variables")
    return
  }

  const parts = [
    "## Auto-Improve Configuration",
    "",
    `- **Benchmark command**: \`${cmd}\``,
    `- **Metric pattern**: \`${pattern}\``,
    `- **Direction**: ${direction} is better`,
    `- **Target files**: ${target}`,
  ]

  // Inject past results if results.tsv exists
  try {
    const { readFileSync } = await import("node:fs")
    const results = readFileSync("results.tsv", "utf-8").trim()
    if (results) {
      const lines = results.split("\n")
      // Show last 20 results to keep context manageable
      const recent = lines.length > 21
        ? [lines[0], "...", ...lines.slice(-20)]
        : lines
      parts.push("", "## Past Results", "```", ...recent, "```")
    }
  } catch {
    // No results.tsv yet — first run
  }

  ctx.messages.push({
    role: "user",
    content: `<system-reminder>\n${parts.join("\n")}\n</system-reminder>`,
  })

  ctx.logger.info("score-gate:injected", { direction, target })
}
