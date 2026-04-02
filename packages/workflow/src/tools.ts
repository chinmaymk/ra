import type { ITool, IMessage } from '@chinmaymk/ra'
import type { RevisionRequest } from './types'

export const REVISION_MARKER = '__WORKFLOW_REVISION__'

/** Create a request_revision tool that agents use to send feedback to prior steps. */
export function createRevisionTool(validTargets: string[]): ITool {
  const targetList = validTargets.join(', ')

  return {
    name: 'request_revision',
    description: `Request a revision from a prior workflow step. The target step will re-run with your feedback. Valid targets: ${targetList}`,
    inputSchema: {
      type: 'object',
      properties: {
        step: {
          type: 'string',
          description: `The name of the step to revise. Must be one of: ${targetList}`,
        },
        feedback: {
          type: 'string',
          description: 'Detailed feedback explaining what needs to change and why.',
        },
      },
      required: ['step', 'feedback'],
    },
    async execute(input: unknown) {
      const { step, feedback } = input as { step: string; feedback: string }

      if (!validTargets.includes(step)) {
        return JSON.stringify({
          error: `Invalid revision target "${step}". Valid targets: ${targetList}`,
        })
      }

      return JSON.stringify({
        marker: REVISION_MARKER,
        step,
        feedback,
        message: `Revision requested for step "${step}". It will re-run with your feedback.`,
      })
    },
  }
}

/** Extract revision requests from agent messages after a loop completes. */
export function extractRevisionRequests(messages: IMessage[]): RevisionRequest[] {
  const requests: RevisionRequest[] = []

  for (const msg of messages) {
    if (msg.role !== 'tool') continue

    const text = typeof msg.content === 'string'
      ? msg.content
      : msg.content.filter((p): p is { type: 'text'; text: string } => p.type === 'text').map(p => p.text).join('')

    if (!text.includes(REVISION_MARKER)) continue

    try {
      const parsed = JSON.parse(text) as { marker?: string; step?: string; feedback?: string }
      if (parsed.marker === REVISION_MARKER && parsed.step && parsed.feedback) {
        requests.push({ targetStep: parsed.step, feedback: parsed.feedback })
      }
    } catch {
      // Not valid JSON — skip
    }
  }

  return requests
}
