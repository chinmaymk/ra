import { describe, it, expect } from 'bun:test'
import { buildMessagePrefix, buildThreadMessages } from '../../src/interfaces/messages'
import type { IMessage } from '@chinmaymk/ra'

describe('buildMessagePrefix', () => {
  it('returns empty array when no options given', () => {
    expect(buildMessagePrefix({})).toEqual([])
  })

  it('includes system prompt as system message', () => {
    const result = buildMessagePrefix({ systemPrompt: 'be helpful' })
    expect(result).toEqual([{ role: 'system', content: 'be helpful' }])
  })

  it('includes skills XML as user message', () => {
    const skillIndex = new Map([
      ['greet', { metadata: { name: 'greet', description: 'Say hello' }, dir: '/tmp' }],
    ])
    const result = buildMessagePrefix({ skillIndex })
    expect(result.length).toBe(1)
    expect(result[0]?.role).toBe('user')
    expect(result[0]?.content).toContain('greet')
  })

  it('includes context messages', () => {
    const contextMessages: IMessage[] = [{ role: 'user', content: 'context' }]
    const result = buildMessagePrefix({ contextMessages })
    expect(result).toEqual([{ role: 'user', content: 'context' }])
  })

  it('orders: system prompt → skills → context', () => {
    const skillIndex = new Map([
      ['s', { metadata: { name: 's', description: 'd' }, dir: '/tmp' }],
    ])
    const contextMessages: IMessage[] = [{ role: 'user', content: 'ctx' }]
    const result = buildMessagePrefix({ systemPrompt: 'sys', skillIndex, contextMessages })
    expect(result.length).toBe(3)
    expect(result[0]?.role).toBe('system')
    expect(result[1]?.role).toBe('user')
    expect(result[1]?.content).toContain('<available_skills>')
    expect(result[2]?.content).toBe('ctx')
  })
})

describe('buildThreadMessages', () => {
  it('new session: builds prefix with priorCount=0', () => {
    const { messages, priorCount } = buildThreadMessages({
      storedMessages: [],
      systemPrompt: 'be helpful',
    })
    expect(priorCount).toBe(0)
    expect(messages.length).toBe(1)
    expect(messages[0]).toEqual({ role: 'system', content: 'be helpful' })
  })

  it('new session: includes full prefix (system + skills + context)', () => {
    const skillIndex = new Map([
      ['s', { metadata: { name: 's', description: 'd' }, dir: '/tmp' }],
    ])
    const { messages, priorCount } = buildThreadMessages({
      storedMessages: [],
      systemPrompt: 'sys',
      skillIndex,
      contextMessages: [{ role: 'user', content: 'ctx' }],
    })
    expect(priorCount).toBe(0)
    expect(messages.length).toBe(3)
    expect(messages[0]?.role).toBe('system')
    expect(messages[2]?.content).toBe('ctx')
  })

  it('existing session: copies stored messages with correct priorCount', () => {
    const stored: IMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ]
    const { messages, priorCount } = buildThreadMessages({
      storedMessages: stored,
      systemPrompt: 'sys',
    })
    expect(priorCount).toBe(3)
    expect(messages.length).toBe(3)
    expect(messages).toEqual(stored)
  })

  it('existing session: does not re-inject prefix', () => {
    const stored: IMessage[] = [
      { role: 'system', content: 'original prompt' },
      { role: 'user', content: 'hello' },
    ]
    const { messages } = buildThreadMessages({
      storedMessages: stored,
      systemPrompt: 'different prompt',
    })
    // Should use stored messages, not rebuild prefix
    expect(messages.filter(m => m.role === 'system').length).toBe(1)
    expect(messages[0]?.content).toBe('original prompt')
  })

  it('existing session: returns a copy (does not mutate stored array)', () => {
    const stored: IMessage[] = [{ role: 'user', content: 'hi' }]
    const { messages } = buildThreadMessages({ storedMessages: stored })
    messages.push({ role: 'assistant', content: 'hello' })
    expect(stored.length).toBe(1)
  })

  it('callers can append user messages to the returned array', () => {
    const { messages } = buildThreadMessages({
      storedMessages: [],
      systemPrompt: 'sys',
    })
    messages.push({ role: 'user', content: 'hello' })
    expect(messages.length).toBe(2)
    expect(messages[1]?.content).toBe('hello')
  })
})
