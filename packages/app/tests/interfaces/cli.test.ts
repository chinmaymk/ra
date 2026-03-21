import { describe, it, expect } from 'bun:test'
import { runCli } from '../../src/interfaces/cli'
import { ToolRegistry } from '@chinmaymk/ra'
import type { IProvider } from '@chinmaymk/ra'

import { tmpdir } from '../tmpdir'
import { mockProvider } from '../fixtures'

describe('runCli', () => {
  it('runs and collects output', async () => {
    const chunks: string[] = []
    await runCli({
      prompt: 'hello',
      model: 'test',
      provider: mockProvider('world'),
      tools: new ToolRegistry(),
      onChunk: (text) => chunks.push(text),
    })
    expect(chunks.join('')).toBe('world')
  })

  it('includes systemPrompt as system message', async () => {
    const messages: any[] = []
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error() },
      async *stream(req) {
        messages.push(...req.messages)
        yield { type: 'text', delta: 'ok' }
        yield { type: 'done' }
      },
    }
    await runCli({
      prompt: 'test',
      model: 'x',
      provider,
      tools: new ToolRegistry(),
      systemPrompt: 'You are helpful',
    })
    expect(messages.find(m => m.role === 'system')?.content).toBe('You are helpful')
  })

  it('includes available skills XML when skillMap is provided', async () => {
    const messages: any[] = []
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error() },
      async *stream(req) {
        messages.push(...req.messages)
        yield { type: 'text', delta: 'ok' }
        yield { type: 'done' }
      },
    }
    const skillEntry = { metadata: { name: 'test-skill', description: 'A test skill' }, dir: '/tmp' }
    const skillIndex = new Map([['test-skill', skillEntry]])

    await runCli({
      prompt: 'go',
      model: 'x',
      provider,
      tools: new ToolRegistry(),
      skillIndex,
    })

    // Should have available skills XML as a user message
    expect(messages.some((m: any) => m.role === 'user' && m.content.includes('<available_skills>') && m.content.includes('test-skill'))).toBe(true)
    // Last message should be the user prompt
    const lastUser = messages.filter((m: any) => m.role === 'user').pop()
    expect(lastUser?.content).toBe('go')
  })

  it('attaches files as content parts', async () => {
    const { mkdirSync, writeFileSync, rmSync } = await import('fs')
    const dir = tmpdir('ra-cli-test')
    mkdirSync(dir, { recursive: true })
    writeFileSync(`${dir}/test.txt`, 'file content')

    let capturedMessages: any[] = []
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error() },
      async *stream(req) {
        capturedMessages = req.messages
        yield { type: 'text', delta: 'ok' }
        yield { type: 'done' }
      },
    }

    try {
      await runCli({
        prompt: 'analyze this',
        model: 'x',
        provider,
        tools: new ToolRegistry(),
        files: [`${dir}/test.txt`],
      })

      // User message should have multipart content (text + file)
      const userMsg = capturedMessages.find((m: any) => m.role === 'user')
      expect(Array.isArray(userMsg?.content)).toBe(true)
      expect(userMsg.content).toHaveLength(2)
      expect(userMsg.content[0].type).toBe('text')
      expect(userMsg.content[0].text).toBe('analyze this')
      expect(userMsg.content[1].type).toBe('text')
      expect(userMsg.content[1].text).toBe('file content')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('sends single prompt as string content when no files', async () => {
    let capturedMessages: any[] = []
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error() },
      async *stream(req) {
        capturedMessages = req.messages
        yield { type: 'text', delta: 'ok' }
        yield { type: 'done' }
      },
    }

    await runCli({
      prompt: 'hello world',
      model: 'x',
      provider,
      tools: new ToolRegistry(),
    })

    const userMsg = capturedMessages.find((m: any) => m.role === 'user')
    expect(typeof userMsg?.content).toBe('string')
    expect(userMsg.content).toBe('hello world')
  })

  it('only streams text chunks to onChunk callback', async () => {
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error() },
      async *stream() {
        yield { type: 'thinking' as const, delta: 'hmm' }
        yield { type: 'text' as const, delta: 'hello' }
        yield { type: 'done' as const }
      },
    }
    const chunks: string[] = []
    await runCli({
      prompt: 'test',
      model: 'x',
      provider,
      tools: new ToolRegistry(),
      onChunk: (text) => chunks.push(text),
    })

    expect(chunks).toEqual(['hello'])
  })
})
