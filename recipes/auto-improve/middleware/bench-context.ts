import type { LoopContext } from "@chinmaymk/ra"
import { readFileSync, existsSync } from "node:fs"

/**
 * Injects bench.yaml spec, target config summary, and recent journal
 * entries into the conversation at loop start so the orchestrator has
 * full context before its first model call.
 */
export default async function benchContext(ctx: LoopContext): Promise<void> {
  const parts: string[] = []

  // Inject bench spec
  if (existsSync("bench.yaml")) {
    const spec = readFileSync("bench.yaml", "utf-8").trim()
    parts.push("## Benchmark Spec (bench.yaml)", "```yaml", spec, "```")

    // Parse config path and inject target config summary
    const configMatch = spec.match(/^config:\s*(.+)$/m)
    if (configMatch) {
      const configPath = configMatch[1].trim()
      if (existsSync(configPath)) {
        const config = readFileSync(configPath, "utf-8").trim()
        parts.push("", "## Target Config", "```yaml", config, "```")
      }
    }
  } else {
    ctx.logger.info("bench-context:no-spec", { path: "bench.yaml" })
    // Don't stop — let the agent prompt the user to create one
    return
  }

  // Inject journal history
  if (existsSync("journal.jsonl")) {
    const raw = readFileSync("journal.jsonl", "utf-8").trim()
    if (raw) {
      const lines = raw.split("\n")

      // Compute current best score
      let best = 0
      for (const line of lines) {
        try {
          const entry = JSON.parse(line)
          if (typeof entry.score === "number" && entry.score > best) best = entry.score
        } catch { /* skip malformed lines */ }
      }

      parts.push(
        "",
        `## Progress: ${lines.length} iterations, best score: ${best}`,
      )

      // Show last 15 entries to keep context manageable
      const recent = lines.length > 15
        ? ["...", ...lines.slice(-15)]
        : lines
      parts.push("", "## Recent Journal", "```jsonl", ...recent, "```")
    }
  }

  if (parts.length > 0) {
    ctx.messages.push({
      role: "user",
      content: `<system-reminder>\n${parts.join("\n")}\n</system-reminder>`,
    })
    ctx.logger.info("bench-context:injected", {
      hasSpec: true,
      hasJournal: existsSync("journal.jsonl"),
    })
  }
}
