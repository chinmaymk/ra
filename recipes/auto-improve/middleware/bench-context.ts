import type { LoopContext } from "@chinmaymk/ra"
import { readFileSync, existsSync, statSync } from "node:fs"

interface BenchSpec {
  config?: string
  score?: { direction?: string }
}

/** Minimal YAML-like extraction — enough for bench.yaml fields. */
function parseSpec(raw: string): BenchSpec {
  const configMatch = raw.match(/^config:\s*(.+)$/m)
  const directionMatch = raw.match(/direction:\s*(\w+)/m)
  return {
    config: configMatch?.[1]?.trim(),
    score: { direction: directionMatch?.[1]?.trim() },
  }
}

function dirExists(path: string): boolean {
  try { return statSync(path).isDirectory() } catch { return false }
}

/**
 * Injects bench.yaml spec, target config, journal history, anti-patterns,
 * and checkpoint state into the conversation at loop start.
 */
export default async function benchContext(ctx: LoopContext): Promise<void> {
  const parts: string[] = []

  if (!existsSync("bench.yaml")) {
    ctx.logger.info("bench-context:no-spec", { path: "bench.yaml" })
    return
  }

  const spec = readFileSync("bench.yaml", "utf-8").trim()
  const parsed = parseSpec(spec)
  const lowerIsBetter = parsed.score?.direction === "lower"

  parts.push("## Benchmark Spec (bench.yaml)", "```yaml", spec, "```")

  // Inject target config
  if (parsed.config && existsSync(parsed.config)) {
    const config = readFileSync(parsed.config, "utf-8").trim()
    parts.push("", "## Target Config", "```yaml", config, "```")
  }

  // Inject journal history with direction-aware best score
  if (existsSync("journal.jsonl")) {
    const raw = readFileSync("journal.jsonl", "utf-8").trim()
    if (raw) {
      const lines = raw.split("\n")

      let best = lowerIsBetter ? Infinity : -Infinity
      for (const line of lines) {
        try {
          const entry = JSON.parse(line)
          if (typeof entry.score !== "number" || entry.score === 0) continue
          if (lowerIsBetter ? entry.score < best : entry.score > best) {
            best = entry.score
          }
        } catch { /* skip malformed */ }
      }

      const bestStr = best === Infinity || best === -Infinity ? "N/A" : String(best)
      parts.push("", `## Progress: ${lines.length} iterations, best score: ${bestStr}`)

      const recent = lines.length > 15
        ? ["...", ...lines.slice(-15)]
        : lines
      parts.push("", "## Recent Journal", "```jsonl", ...recent, "```")
    }
  }

  // Anti-patterns — long-term memory across compaction
  if (existsSync("anti-patterns.md")) {
    const content = readFileSync("anti-patterns.md", "utf-8").trim()
    if (content) {
      parts.push("", "## Anti-Patterns (DO NOT repeat these)", content)
    }
  }

  // Working state — survives compaction
  if (existsSync("state.md")) {
    const state = readFileSync("state.md", "utf-8").trim()
    if (state) {
      parts.push("", "## Current State (state.md)", state)
    }
  }

  // Checkpoint status
  if (dirExists("best")) {
    parts.push("", "## Checkpoint", "`best/` directory exists with the current best config/code. Restore from here if needed.")
  }

  ctx.messages.push({
    role: "user",
    content: `<system-reminder>\n${parts.join("\n")}\n</system-reminder>`,
  })

  ctx.logger.info("bench-context:injected", {
    hasJournal: existsSync("journal.jsonl"),
    hasAntiPatterns: existsSync("anti-patterns.md"),
    hasCheckpoint: dirExists("best"),
    direction: parsed.score?.direction ?? "higher",
  })
}
