import type { LoopContext } from "@chinmaymk/ra"

const REVIEW_INTERVAL = parseInt(process.env.RA_REVIEW_INTERVAL || "15", 10)

const REVIEW_REMINDER = `<self_review_checkpoint>
You've been working for a while. Pause and check:
1. Are you still on track with the original request? Re-read it if needed.
2. Have you verified your recent changes work? (run tests, type-check)
3. Check your checklist — are there completed items you haven't marked done, or new items to add?
4. Have you introduced any regressions? Run the test suite if you haven't recently.
5. Are you going in circles? If the same approach has failed twice, step back and try a different strategy.
</self_review_checkpoint>`

export default async function selfReview(ctx: LoopContext): Promise<void> {
  if (ctx.iteration < REVIEW_INTERVAL) return
  if (ctx.iteration % REVIEW_INTERVAL !== 0) return

  // Inject a system reminder into the conversation
  ctx.messages.push({
    role: "user",
    content: REVIEW_REMINDER,
  })
}
