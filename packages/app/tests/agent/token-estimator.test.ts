import { describe, it, expect } from 'bun:test'
import { estimateTokens } from '@chinmaymk/ra'
import type { IMessage, ITool } from '@chinmaymk/ra'

describe('estimateTokens', () => {
  describe('messages', () => {
    it('estimates string content as strlen/4', () => {
      const messages: IMessage[] = [
        { role: 'user', content: 'abcd' },
      ]
      expect(estimateTokens(messages)).toBe(1)
    })

    it('estimates multi-part content via JSON serialization', () => {
      const messages: IMessage[] = [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      ]
      const result = estimateTokens(messages)
      expect(result).toBeGreaterThan(0)
    })

    it('includes toolCalls in estimation', () => {
      const withoutTools: IMessage[] = [
        { role: 'assistant', content: 'hi' },
      ]
      const withTools: IMessage[] = [
        { role: 'assistant', content: 'hi', toolCalls: [{ id: 'tc1', name: 'Read', arguments: '{"path":"/foo/bar"}' }] },
      ]
      expect(estimateTokens(withTools)).toBeGreaterThan(estimateTokens(withoutTools))
    })

    it('sums across multiple messages', () => {
      const messages: IMessage[] = [
        { role: 'user', content: 'abcd' },
        { role: 'assistant', content: 'abcd' },
      ]
      expect(estimateTokens(messages)).toBe(2)
    })

    it('rounds up partial tokens', () => {
      const messages: IMessage[] = [
        { role: 'user', content: 'ab' },
      ]
      expect(estimateTokens(messages)).toBe(1)
    })

    it('returns 0 for empty messages', () => {
      expect(estimateTokens([] as IMessage[])).toBe(0)
    })
  })

  describe('string', () => {
    it('estimates string as chars/4 rounded up', () => {
      expect(estimateTokens('abcd')).toBe(1)
      expect(estimateTokens('ab')).toBe(1)
      expect(estimateTokens('abcde')).toBe(2)
    })

    it('returns 0 for empty string', () => {
      expect(estimateTokens('')).toBe(0)
    })
  })

  describe('tools', () => {
    it('estimates tokens from tool name, description, and schema', () => {
      const tools: ITool[] = [
        {
          name: 'Read',
          description: 'Read a file from disk',
          inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
          execute: async () => '',
        },
      ]
      const result = estimateTokens(tools)
      expect(result).toBeGreaterThan(0)
    })

    it('sums across multiple tools', () => {
      const one: ITool[] = [
        { name: 'A', description: 'desc', inputSchema: { type: 'object' }, execute: async () => '' },
      ]
      const two: ITool[] = [
        { name: 'A', description: 'desc', inputSchema: { type: 'object' }, execute: async () => '' },
        { name: 'B', description: 'another desc', inputSchema: { type: 'object', properties: { x: { type: 'number' } } }, execute: async () => '' },
      ]
      expect(estimateTokens(two)).toBeGreaterThan(estimateTokens(one))
    })

    it('returns 0 for empty array', () => {
      expect(estimateTokens([] as ITool[])).toBe(0)
    })
  })
})
