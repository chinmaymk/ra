import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { createDiscoveryMiddleware } from '../../src/context/discovery'
import type { ModelCallContext } from '../../src/agent/types'
import type { IMessage } from '../../src/providers/types'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

function makeCtx(messages: IMessage[]): ModelCallContext {
  const controller = new AbortController()
  return {
    stop: () => controller.abort(), signal: controller.signal,
    request: { model: 'test', messages },
    loop: { stop: () => controller.abort(), signal: controller.signal, messages, iteration: 1, maxIterations: 10, sessionId: 'test', usage: { inputTokens: 0, outputTokens: 0 }, lastUsage: undefined },
  }
}

function toolMsg(filePath: string): IMessage[] {
  return [
    { role: 'assistant', content: '', toolCalls: [{ id: 'tc1', name: 'ReadFile', arguments: JSON.stringify({ file_path: filePath }) }] },
    { role: 'tool', content: 'file content', toolCallId: 'tc1' },
  ]
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
    const ctx = makeCtx([{ role: 'user', content: 'hi' }, ...toolMsg(join(subDir, 'helpers.ts'))])
    await mw(ctx)
    expect(ctx.request.messages.find(m => typeof m.content === 'string' && m.content.includes('Utils rules'))).toBeTruthy()
  })

  it('discovers context from absolute paths in tool results', async () => {
    writeFileSync(join(subDir, '.cursorrules'), 'use semicolons')
    const mw = createDiscoveryMiddleware(['.cursorrules'], tmp, new Set())
    const ctx = makeCtx([
      { role: 'user', content: 'list' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'tc1', name: 'Bash', arguments: '{"command":"ls"}' }] },
      { role: 'tool', content: `${join(subDir, 'index.ts')}\n${join(subDir, 'utils.ts')}`, toolCallId: 'tc1' },
    ])
    await mw(ctx)
    expect(ctx.request.messages.find(m => typeof m.content === 'string' && m.content.includes('use semicolons'))).toBeTruthy()
  })

  it('skips files already in initialPaths', async () => {
    const p = join(tmp, 'CLAUDE.md')
    writeFileSync(p, '# Root')
    const mw = createDiscoveryMiddleware(['CLAUDE.md'], tmp, new Set([p]))
    const ctx = makeCtx([{ role: 'user', content: 'hi' }, ...toolMsg(join(tmp, 'index.ts'))])
    await mw(ctx)
    expect(countContext(ctx.request.messages)).toBe(0)
  })

  it('does not duplicate on repeated calls', async () => {
    writeFileSync(join(subDir, 'CLAUDE.md'), '# Utils')
    const mw = createDiscoveryMiddleware(['CLAUDE.md'], tmp, new Set())
    const ctx1 = makeCtx([{ role: 'user', content: 'hi' }, ...toolMsg(join(subDir, 'a.ts'))])
    await mw(ctx1)
    expect(countContext(ctx1.request.messages)).toBe(1)

    const ctx2 = makeCtx([...ctx1.request.messages, { role: 'user', content: 'more' }])
    await mw(ctx2)
    expect(countContext(ctx2.request.messages)).toBe(1)
  })

  it('does nothing without tool file paths', async () => {
    const mw = createDiscoveryMiddleware(['CLAUDE.md'], tmp, new Set())
    const ctx = makeCtx([{ role: 'user', content: 'hello' }])
    await mw(ctx)
    expect(ctx.request.messages).toHaveLength(1)
  })

  it('discovers context outside git root', async () => {
    const ext = join(tmpdir(), `ra-ext-${Date.now()}`)
    mkdirSync(ext, { recursive: true })
    writeFileSync(join(ext, 'CLAUDE.md'), '# External')
    const mw = createDiscoveryMiddleware(['CLAUDE.md'], tmp, new Set())
    const ctx = makeCtx([{ role: 'user', content: 'hi' }, ...toolMsg(join(ext, 'foo.ts'))])
    await mw(ctx)
    expect(ctx.request.messages.find(m => typeof m.content === 'string' && m.content.includes('External'))).toBeTruthy()
    rmSync(ext, { recursive: true, force: true })
  })

  it('inserts after existing context-file messages', async () => {
    writeFileSync(join(subDir, 'CLAUDE.md'), '# Sub rules')
    const mw = createDiscoveryMiddleware(['CLAUDE.md'], tmp, new Set())
    const ctx = makeCtx([
      { role: 'user', content: '<context-file path="CLAUDE.md">\n# Root\n</context-file>' },
      { role: 'user', content: 'read a file' },
      ...toolMsg(join(subDir, 'x.ts')),
    ])
    await mw(ctx)
    const idx = ctx.request.messages.findIndex(m => typeof m.content === 'string' && m.content.includes('Sub rules'))
    expect(idx).toBe(1)
  })
})
