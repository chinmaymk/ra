import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { createDiscoveryMiddleware } from '../../src/context/discovery-middleware'
import type { ModelCallContext } from '../../src/agent/types'
import type { IMessage } from '../../src/providers/types'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

function makeCtx(messages: IMessage[]): ModelCallContext {
  const controller = new AbortController()
  return {
    stop: () => controller.abort(),
    signal: controller.signal,
    request: {
      model: 'test',
      messages,
    },
    loop: {
      stop: () => controller.abort(),
      signal: controller.signal,
      messages,
      iteration: 1,
      maxIterations: 10,
      sessionId: 'test',
      usage: { inputTokens: 0, outputTokens: 0 },
      lastUsage: undefined,
    },
  }
}

describe('createDiscoveryMiddleware', () => {
  let tmp: string
  let subDir: string

  beforeEach(() => {
    tmp = join(tmpdir(), `ra-disc-mw-${Date.now()}`)
    mkdirSync(tmp, { recursive: true })
    subDir = join(tmp, 'src', 'utils')
    mkdirSync(subDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('discovers context files from tool call arguments with file paths', async () => {
    writeFileSync(join(subDir, 'CLAUDE.md'), '# Utils rules')
    const mw = createDiscoveryMiddleware({
      patterns: ['CLAUDE.md'],
      gitRoot: tmp,
      initialPaths: new Set(),
    })

    const messages: IMessage[] = [
      { role: 'user', content: 'read the utils file' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tc1', name: 'ReadFile', arguments: JSON.stringify({ file_path: join(subDir, 'helpers.ts') }) }],
      },
      { role: 'tool', content: 'export function helper() {}', toolCallId: 'tc1' },
    ]
    const ctx = makeCtx(messages)
    await mw(ctx)

    // Should have injected a context-file message
    const injected = ctx.request.messages.find(m =>
      typeof m.content === 'string' && m.content.includes('<context-file') && m.content.includes('Utils rules')
    )
    expect(injected).toBeTruthy()
  })

  it('discovers context files from absolute paths in tool results', async () => {
    writeFileSync(join(subDir, '.cursorrules'), 'use semicolons')
    const mw = createDiscoveryMiddleware({
      patterns: ['.cursorrules'],
      gitRoot: tmp,
      initialPaths: new Set(),
    })

    const messages: IMessage[] = [
      { role: 'user', content: 'list the files' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tc1', name: 'Bash', arguments: JSON.stringify({ command: 'ls' }) }],
      },
      { role: 'tool', content: `${join(subDir, 'index.ts')}\n${join(subDir, 'utils.ts')}`, toolCallId: 'tc1' },
    ]
    const ctx = makeCtx(messages)
    await mw(ctx)

    const injected = ctx.request.messages.find(m =>
      typeof m.content === 'string' && m.content.includes('use semicolons')
    )
    expect(injected).toBeTruthy()
  })

  it('skips directories already covered by initial bootstrap context', async () => {
    const contextPath = join(tmp, 'CLAUDE.md')
    writeFileSync(contextPath, '# Root rules')
    const mw = createDiscoveryMiddleware({
      patterns: ['CLAUDE.md'],
      gitRoot: tmp,
      initialPaths: new Set([contextPath]),
    })

    const messages: IMessage[] = [
      { role: 'user', content: 'read a file' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tc1', name: 'ReadFile', arguments: JSON.stringify({ file_path: join(tmp, 'index.ts') }) }],
      },
      { role: 'tool', content: 'console.log("hi")', toolCallId: 'tc1' },
    ]
    const ctx = makeCtx(messages)
    await mw(ctx)

    // Should NOT inject since the root CLAUDE.md was already in initialPaths
    const contextMsgs = ctx.request.messages.filter(m =>
      typeof m.content === 'string' && m.content.includes('<context-file')
    )
    expect(contextMsgs).toHaveLength(0)
  })

  it('does not re-inject on subsequent calls for the same directory', async () => {
    writeFileSync(join(subDir, 'CLAUDE.md'), '# Utils')
    const mw = createDiscoveryMiddleware({
      patterns: ['CLAUDE.md'],
      gitRoot: tmp,
      initialPaths: new Set(),
    })

    const messages: IMessage[] = [
      { role: 'user', content: 'read file' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tc1', name: 'ReadFile', arguments: JSON.stringify({ file_path: join(subDir, 'a.ts') }) }],
      },
      { role: 'tool', content: 'content', toolCallId: 'tc1' },
    ]

    // First call discovers the file
    const ctx1 = makeCtx([...messages])
    await mw(ctx1)
    const count1 = ctx1.request.messages.filter(m =>
      typeof m.content === 'string' && m.content.includes('<context-file')
    ).length
    expect(count1).toBe(1)

    // Second call with same messages — should not duplicate
    const ctx2 = makeCtx([...ctx1.request.messages, { role: 'user', content: 'do more' }])
    await mw(ctx2)
    const count2 = ctx2.request.messages.filter(m =>
      typeof m.content === 'string' && m.content.includes('<context-file')
    ).length
    expect(count2).toBe(1)
  })

  it('does nothing when no tool interactions reference files', async () => {
    writeFileSync(join(subDir, 'CLAUDE.md'), '# Rules')
    const mw = createDiscoveryMiddleware({
      patterns: ['CLAUDE.md'],
      gitRoot: tmp,
      initialPaths: new Set(),
    })

    const messages: IMessage[] = [
      { role: 'user', content: 'hello' },
    ]
    const ctx = makeCtx(messages)
    await mw(ctx)

    expect(ctx.request.messages).toHaveLength(1)
    expect(ctx.request.messages[0]!.content).toBe('hello')
  })

  it('discovers context files outside the git root', async () => {
    const outsideDir = join(tmpdir(), `ra-outside-${Date.now()}`)
    mkdirSync(outsideDir, { recursive: true })
    writeFileSync(join(outsideDir, 'CLAUDE.md'), '# External rules')

    const mw = createDiscoveryMiddleware({
      patterns: ['CLAUDE.md'],
      gitRoot: tmp,
      initialPaths: new Set(),
    })

    const messages: IMessage[] = [
      { role: 'user', content: 'check file' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tc1', name: 'ReadFile', arguments: JSON.stringify({ file_path: join(outsideDir, 'foo.ts') }) }],
      },
      { role: 'tool', content: 'content', toolCallId: 'tc1' },
    ]
    const ctx = makeCtx(messages)
    await mw(ctx)

    const injected = ctx.request.messages.find(m =>
      typeof m.content === 'string' && m.content.includes('External rules')
    )
    expect(injected).toBeTruthy()
    rmSync(outsideDir, { recursive: true, force: true })
  })

  it('inserts new context after existing context-file messages', async () => {
    writeFileSync(join(subDir, 'CLAUDE.md'), '# Sub rules')
    const mw = createDiscoveryMiddleware({
      patterns: ['CLAUDE.md'],
      gitRoot: tmp,
      initialPaths: new Set(),
    })

    const messages: IMessage[] = [
      { role: 'user', content: '<context-file path="CLAUDE.md">\n# Root\n</context-file>' },
      { role: 'user', content: 'read a file' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tc1', name: 'ReadFile', arguments: JSON.stringify({ file_path: join(subDir, 'x.ts') }) }],
      },
      { role: 'tool', content: 'x', toolCallId: 'tc1' },
    ]
    const ctx = makeCtx(messages)
    await mw(ctx)

    // New context should be inserted after the existing context message (index 0),
    // so at index 1, before the user prompt
    const idx = ctx.request.messages.findIndex(m =>
      typeof m.content === 'string' && m.content.includes('Sub rules')
    )
    expect(idx).toBe(1)
  })
})
