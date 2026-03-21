import type { ModelCallContext } from "@chinmaymk/ra"

const TOKEN_BUDGET = parseInt(process.env.RA_TOKEN_BUDGET || "800000", 10)
let totalTokens = 0

export default async function tokenBudget(ctx: ModelCallContext): Promise<void> {
  const msgs = ctx.loop.messages
  const lastMessage = msgs[msgs.length - 1]
  if (lastMessage && typeof lastMessage.content === "string") {
    totalTokens += Math.ceil(lastMessage.content.length / 4)
  }

  if (totalTokens > TOKEN_BUDGET) {
    console.error(
      `\n[token-budget] Budget exceeded: ~${totalTokens} tokens used (limit: ${TOKEN_BUDGET}). Stopping.`
    )
    ctx.stop()
  }
}
