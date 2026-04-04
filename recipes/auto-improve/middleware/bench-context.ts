import type { LoopContext } from "@chinmaymk/ra"
import { readFileSync, existsSync } from "node:fs"

/**
 * Loads bench.yaml config and injects it along with past journal entries
 * into the conversation at loop start.
 */
export default async function benchContext(ctx: LoopContext): Promise<void> {
  if (!existsSync("bench.yaml")) {
    ctx.logger.info("bench-context:no-spec", { path: "bench.yaml" })
    // Don't stop — let the agent prompt the user to create one
    return
  }

  const spec = readFileSync("bench.yaml", "utf-8")
  const parts = [
    "## Benchmark Spec (bench.yaml)",
    "```yaml",
    spec.trim(),
    "```",
  ]

  // Inject recent journal entries if they exist
  if (existsSync("journal.jsonl")) {
    const raw = readFileSync("journal.jsonl", "utf-8").trim()
    if (raw) {
      const lines = raw.split("\n")
      const recent = lines.length > 20
        ? ["...", ...lines.slice(-20)]
        : lines

      // Parse last entry to show current best
      try {
        const last = JSON.parse(lines[lines.length - 1])
        const best = Math.max(
          ...lines.map(l => { try { return JSON.parse(l).score } catch { return 0 } })
        )
        parts.push("", `## Progress: ${lines.length} iterations, best score: ${best}`)
      } catch {
        // Malformed last line — just show the raw entries
      }

      parts.push("", "## Recent Journal Entries", "```jsonl", ...recent, "```")
    }
  }

  ctx.messages.push({
    role: "user",
    content: `<system-reminder>\n${parts.join("\n")}\n</system-reminder>`,
  })

  ctx.logger.info("bench-context:injected", { journalExists: existsSync("journal.jsonl") })
}
