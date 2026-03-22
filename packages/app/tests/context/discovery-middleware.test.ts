import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { createDiscoveryMiddleware } from '../../src/context/discovery'
import { NoopLogger } from '@chinmaymk/ra'
import type { ModelCallContext, IMessage } from '@chinmaymk/ra'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const logger = new NoopLogger()

/** Build a ModelCallContext whose messages include an assistant message with a tool call referencing `filePath`. */
function makeCtx(messages: IMessage[], filePath: string): ModelCallContext {
  const controller = new AbortController()
  // Add an assistant message with a tool call that references the file path
  const messagesWithToolCall: IMessage[] = [
    ...messages,
    { role: 'assistant', content: '', toolCalls: [{ id: 'tc1', name: 'ReadFile', arguments: JSON.stringify({ file_path: filePath }) }] },
  ]
  return {
    stop: () => controller.abort(), signal: controller.signal, logger,
    request: { model: 'test', messages: messagesWithToolCall, tools: [] },
    loop: { stop: () => controller.abort(), signal: controller.signal, logger, messages: messagesWithToolCall, iteration: 1, maxIterations: 10, sessionId: 'test', usage: { inputTokens: 0, outputTokens: 0 }, lastUsage: undefined },
  }
}

function countContext(messages: IMessage[]): number {
  return messages.filter(m => typeof m.content === 'string' && m.content.includes('<context-file')).length
}

describe('createDiscoveryMiddleware', () => {
  let tmp: string
  let subDir: string

  beforeEach(() => {
    tmp = join(tmpdir(), `ra-disc-mw-${Date.now()}`)
    subDir = join(tmp, 'src', 'utils')
    mkdirSync(subDir, { recursive: true })
  })

  afterEach(() => rmSync(tmp, { recursive: true, force: true }))

  it('discovers context from tool call file paths', async () => {
    writeFileSync(join(subDir, 'CLAUDE.md'), '# Utils rules')
    const mw = createDiscoveryMiddleware(['CLAUDE.md'], tmp, new Set())
    const ctx = makeCtx([{ role: 'user', content: 'hi' }], join(subDir, 'helpers.ts'))
    await mw(ctx)
    expect(ctx.request.messages.find(m => typeof m.content === 'string' && m.content.includes('Utils rules'))).toBeTruthy()
  })

  it('skips files already in initialPaths', async () => {
    const p = join(tmp, 'CLAUDE.md')
    writeFileSync(p, '# Root')
    const mw = createDiscoveryMiddleware(['CLAUDE.md'], tmp, new Set([p]))
    const ctx = makeCtx([{ role: 'user', content: 'hi' }], join(tmp, 'index.ts'))
    await mw(ctx)
    expect(countContext(ctx.request.messages)).toBe(0)
  })

  it('does not duplicate on repeated calls', async () => {
    writeFileSync(join(subDir, 'CLAUDE.md'), '# Utils')
    const mw = createDiscoveryMiddleware(['CLAUDE.md'], tmp, new Set())
    const ctx1 = makeCtx([{ role: 'user', content: 'hi' }], join(subDir, 'a.ts'))
    await mw(ctx1)
    expect(countContext(ctx1.request.messages)).toBe(1)

    const ctx2 = makeCtx(ctx1.request.messages, join(subDir, 'b.ts'))
    await mw(ctx2)
    expect(countContext(ctx2.request.messages)).toBe(1)
  })

  it('does nothing for messages without file paths', async () => {
    const mw = createDiscoveryMiddleware(['CLAUDE.md'], tmp, new Set())
    const controller = new AbortController()
    const msgs: IMessage[] = [{ role: 'user', content: 'hello' }]
    await mw({
      stop: () => controller.abort(), signal: controller.signal, logger,
      request: { model: 'test', messages: msgs, tools: [] },
      loop: { stop: () => controller.abort(), signal: controller.signal, logger, messages: msgs, iteration: 1, maxIterations: 10, sessionId: 'test', usage: { inputTokens: 0, outputTokens: 0 }, lastUsage: undefined },
    })
    expect(msgs).toHaveLength(1)
  })

  it('discovers context outside git root', async () => {
    const ext = join(tmpdir(), `ra-ext-${Date.now()}`)
    mkdirSync(ext, { recursive: true })
    writeFileSync(join(ext, 'CLAUDE.md'), '# External')
    const mw = createDiscoveryMiddleware(['CLAUDE.md'], tmp, new Set())
    const ctx = makeCtx([{ role: 'user', content: 'hi' }], join(ext, 'foo.ts'))
    await mw(ctx)
    expect(ctx.request.messages.find(m => typeof m.content === 'string' && m.content.includes('External'))).toBeTruthy()
    rmSync(ext, { recursive: true, force: true })
  })

  it('walks up from file dir to root when subdirectoryWalk is enabled', async () => {
    const intermediate = join(tmp, 'src')
    mkdirSync(intermediate, { recursive: true })
    writeFileSync(join(intermediate, 'CLAUDE.md'), '# Src rules')
    writeFileSync(join(subDir, 'CLAUDE.md'), '# Utils rules')

    const mw = createDiscoveryMiddleware(['CLAUDE.md'], tmp, new Set(), { subdirectoryWalk: true })
    const ctx = makeCtx([{ role: 'user', content: 'hi' }], join(subDir, 'helpers.ts'))
    await mw(ctx)

    expect(ctx.request.messages.find(m => typeof m.content === 'string' && m.content.includes('Src rules'))).toBeTruthy()
    expect(ctx.request.messages.find(m => typeof m.content === 'string' && m.content.includes('Utils rules'))).toBeTruthy()
  })

  it('only checks immediate dir when subdirectoryWalk is disabled', async () => {
    const intermediate = join(tmp, 'src')
    mkdirSync(intermediate, { recursive: true })
    writeFileSync(join(intermediate, 'CLAUDE.md'), '# Src rules')
    writeFileSync(join(subDir, 'CLAUDE.md'), '# Utils rules')

    const mw = createDiscoveryMiddleware(['CLAUDE.md'], tmp, new Set(), { subdirectoryWalk: false })
    const ctx = makeCtx([{ role: 'user', content: 'hi' }], join(subDir, 'helpers.ts'))
    await mw(ctx)

    expect(ctx.request.messages.find(m => typeof m.content === 'string' && m.content.includes('Utils rules'))).toBeTruthy()
    expect(ctx.request.messages.find(m => typeof m.content === 'string' && m.content.includes('Src rules'))).toBeFalsy()
  })

  it('does not duplicate root context files already in initialPaths during walk', async () => {
    const rootCtx = join(tmp, 'CLAUDE.md')
    writeFileSync(rootCtx, '# Root')
    writeFileSync(join(subDir, 'CLAUDE.md'), '# Utils')

    const mw = createDiscoveryMiddleware(['CLAUDE.md'], tmp, new Set([rootCtx]), { subdirectoryWalk: true })
    const ctx = makeCtx([{ role: 'user', content: 'hi' }], join(subDir, 'helpers.ts'))
    await mw(ctx)

    expect(ctx.request.messages.filter(m => typeof m.content === 'string' && m.content.includes('Root'))).toHaveLength(0)
    expect(ctx.request.messages.find(m => typeof m.content === 'string' && m.content.includes('Utils'))).toBeTruthy()
  })

  it('discovers context from file paths in user messages', async () => {
    writeFileSync(join(subDir, 'CLAUDE.md'), '# Utils rules')
    const mw = createDiscoveryMiddleware(['CLAUDE.md'], tmp, new Set())
    const controller = new AbortController()
    const filePath = join(subDir, 'helpers.ts')
    const msgs: IMessage[] = [{ role: 'user', content: `Please edit ${filePath}` }]
    await mw({
      stop: () => controller.abort(), signal: controller.signal, logger,
      request: { model: 'test', messages: msgs, tools: [] },
      loop: { stop: () => controller.abort(), signal: controller.signal, logger, messages: msgs, iteration: 1, maxIterations: 10, sessionId: 'test', usage: { inputTokens: 0, outputTokens: 0 }, lastUsage: undefined },
    })
    expect(msgs.find(m => typeof m.content === 'string' && m.content.includes('Utils rules'))).toBeTruthy()
  })

  it('inserts after existing context-file messages', async () => {
    writeFileSync(join(subDir, 'CLAUDE.md'), '# Sub rules')
    const mw = createDiscoveryMiddleware(['CLAUDE.md'], tmp, new Set())
    const msgs: IMessage[] = [
      { role: 'user', content: '<context-file path="CLAUDE.md">\n# Root\n</context-file>' },
      { role: 'user', content: 'read a file' },
    ]
    const ctx = makeCtx(msgs, join(subDir, 'x.ts'))
    await mw(ctx)
    const idx = ctx.request.messages.findIndex(m => typeof m.content === 'string' && m.content.includes('Sub rules'))
    expect(idx).toBe(1)
  })
})
