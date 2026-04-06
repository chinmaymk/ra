import type { ModelCallContext } from "@chinmaymk/ra"

const TOKEN_BUDGET = parseInt(process.env.RA_TOKEN_BUDGET || "800000", 10)

export default async function tokenBudget(ctx: ModelCallContext): Promise<void> {
  const { usage } = ctx.loop
  const total = usage.inputTokens + usage.outputTokens + (usage.thinkingTokens ?? 0)

  if (total > TOKEN_BUDGET) {
    process.stderr.write(
      `\x1b[31m[oh-my-ra] token-budget: ${total} tokens used (limit: ${TOKEN_BUDGET}). Stopping.\x1b[0m\n`
    )
    ctx.stop(`Token budget exceeded: ${total} / ${TOKEN_BUDGET}`)
  } else if (total > TOKEN_BUDGET * 0.9) {
    process.stderr.write(
      `\x1b[33m[oh-my-ra] token-budget: ${total} / ${TOKEN_BUDGET} tokens (${Math.round((total / TOKEN_BUDGET) * 100)}%) — approaching limit\x1b[0m\n`
    )
  }
}
