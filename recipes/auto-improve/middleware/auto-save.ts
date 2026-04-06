import type { LoopContext } from "@chinmaymk/ra"
import { existsSync, readFileSync, writeFileSync } from "node:fs"

/**
 * Auto-saves progress after each loop iteration.
 * Writes a lightweight progress marker so that if the process crashes,
 * the next run knows the last completed iteration and can resume cleanly.
 */
export default async function autoSave(ctx: LoopContext): Promise<void> {
  const progress = {
    iteration: ctx.iteration,
    timestamp: new Date().toISOString(),
    messageCount: ctx.messages.length,
    inputTokens: ctx.usage.inputTokens,
    outputTokens: ctx.usage.outputTokens,
  }

  writeFileSync("progress.json", JSON.stringify(progress, null, 2))
  ctx.logger.info("auto-save:written", { iteration: ctx.iteration })
}
