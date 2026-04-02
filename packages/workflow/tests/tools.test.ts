import { describe, it, expect } from 'bun:test'
import { createRevisionTool, extractRevisionRequests, REVISION_MARKER } from '@chinmaymk/ra-workflow'
import type { IMessage } from '@chinmaymk/ra'

describe('createRevisionTool', () => {
  const tool = createRevisionTool(['backend', 'frontend'])

  it('has correct name and schema', () => {
    expect(tool.name).toBe('request_revision')
    expect(tool.description).toContain('backend')
    expect(tool.description).toContain('frontend')
  })

  it('returns revision marker for valid target', async () => {
    const result = await tool.execute({ step: 'backend', feedback: 'fix the auth' })
    const parsed = JSON.parse(result as string)
    expect(parsed.marker).toBe(REVISION_MARKER)
    expect(parsed.step).toBe('backend')
    expect(parsed.feedback).toBe('fix the auth')
  })

  it('returns error for invalid target', async () => {
    const result = await tool.execute({ step: 'nonexistent', feedback: 'nope' })
    const parsed = JSON.parse(result as string)
    expect(parsed.error).toContain('Invalid revision target')
  })
})

describe('extractRevisionRequests', () => {
  it('extracts revision from tool messages', () => {
    const messages: IMessage[] = [
      { role: 'user', content: 'do something' },
      { role: 'assistant', content: 'ok', toolCalls: [{ id: 'tc1', name: 'request_revision', arguments: '{}' }] },
      {
        role: 'tool',
        toolCallId: 'tc1',
        content: JSON.stringify({
          marker: REVISION_MARKER,
          step: 'backend',
          feedback: 'fix the auth endpoint',
        }),
      },
    ]
    const requests = extractRevisionRequests(messages)
    expect(requests).toHaveLength(1)
    expect(requests[0]!.targetStep).toBe('backend')
    expect(requests[0]!.feedback).toBe('fix the auth endpoint')
  })

  it('extracts multiple revisions', () => {
    const messages: IMessage[] = [
      {
        role: 'tool',
        toolCallId: 'tc1',
        content: JSON.stringify({ marker: REVISION_MARKER, step: 'backend', feedback: 'fix auth' }),
      },
      {
        role: 'tool',
        toolCallId: 'tc2',
        content: JSON.stringify({ marker: REVISION_MARKER, step: 'frontend', feedback: 'fix UI' }),
      },
    ]
    const requests = extractRevisionRequests(messages)
    expect(requests).toHaveLength(2)
    expect(requests[0]!.targetStep).toBe('backend')
    expect(requests[1]!.targetStep).toBe('frontend')
  })

  it('ignores non-revision tool messages', () => {
    const messages: IMessage[] = [
      { role: 'tool', toolCallId: 'tc1', content: 'just a regular result' },
      { role: 'assistant', content: 'hello' },
    ]
    expect(extractRevisionRequests(messages)).toHaveLength(0)
  })

  it('handles ContentPart[] content', () => {
    const messages: IMessage[] = [
      {
        role: 'tool',
        toolCallId: 'tc1',
        content: [
          {
            type: 'text',
            text: JSON.stringify({ marker: REVISION_MARKER, step: 'design', feedback: 'rethink' }),
          },
        ],
      },
    ]
    const requests = extractRevisionRequests(messages)
    expect(requests).toHaveLength(1)
    expect(requests[0]!.targetStep).toBe('design')
  })
})
