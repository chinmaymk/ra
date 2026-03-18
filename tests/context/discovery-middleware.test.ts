import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { createDiscoveryMiddleware } from '../../src/context/discovery'
import type { ToolResultContext } from '../../src/agent/types'
import type { IMessage } from '../../src/providers/types'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { NoopLogger } from '../../src/observability/logger'

const logger = new NoopLogger()

function makeCtx(messages: IMessage[], filePath: string): ToolResultContext {
  const controller = new AbortController()
  const toolCall = { id: 'tc1', name: 'ReadFile', arguments: JSON.stringify({ file_path: filePath }) }
  return {
    stop: () => controller.abort(), signal: controller.signal, logger,
    toolCall,
    result: { toolCallId: 'tc1', content: 'file content', isError: false },
    loop: { stop: () => controller.abort(), signal: controller.signal, logger, messages, iteration: 1, maxIterations: 10, sessionId: 'test', usage: { inputTokens: 0, outputTokens: 0 }, lastUsage: undefined },
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
    const msgs: IMessage[] = [{ role: 'user', content: 'hi' }]
    await mw(makeCtx(msgs, join(subDir, 'helpers.ts')))
    expect(msgs.find(m => typeof m.content === 'string' && m.content.includes('Utils rules'))).toBeTruthy()
  })

  it('skips files already in initialPaths', async () => {
    const p = join(tmp, 'CLAUDE.md')
    writeFileSync(p, '# Root')
    const mw = createDiscoveryMiddleware(['CLAUDE.md'], tmp, new Set([p]))
    const msgs: IMessage[] = [{ role: 'user', content: 'hi' }]
    await mw(makeCtx(msgs, join(tmp, 'index.ts')))
    expect(countContext(msgs)).toBe(0)
  })

  it('does not duplicate on repeated calls', async () => {
    writeFileSync(join(subDir, 'CLAUDE.md'), '# Utils')
    const mw = createDiscoveryMiddleware(['CLAUDE.md'], tmp, new Set())
    const msgs: IMessage[] = [{ role: 'user', content: 'hi' }]
    await mw(makeCtx(msgs, join(subDir, 'a.ts')))
    expect(countContext(msgs)).toBe(1)

    await mw(makeCtx(msgs, join(subDir, 'b.ts')))
    expect(countContext(msgs)).toBe(1)
  })

  it('does nothing for tool calls without file paths', async () => {
    const mw = createDiscoveryMiddleware(['CLAUDE.md'], tmp, new Set())
    const msgs: IMessage[] = [{ role: 'user', content: 'hello' }]
    const controller = new AbortController()
    await mw({
      stop: () => controller.abort(), signal: controller.signal, logger,
      toolCall: { id: 'tc1', name: 'Bash', arguments: JSON.stringify({ command: 'echo hi' }) },
      result: { toolCallId: 'tc1', content: 'hi', isError: false },
      loop: { stop: () => controller.abort(), signal: controller.signal, logger, messages: msgs, iteration: 1, maxIterations: 10, sessionId: 'test', usage: { inputTokens: 0, outputTokens: 0 }, lastUsage: undefined },
    })
    expect(msgs).toHaveLength(1)
  })

  it('discovers context outside git root', async () => {
    const ext = join(tmpdir(), `ra-ext-${Date.now()}`)
    mkdirSync(ext, { recursive: true })
    writeFileSync(join(ext, 'CLAUDE.md'), '# External')
    const mw = createDiscoveryMiddleware(['CLAUDE.md'], tmp, new Set())
    const msgs: IMessage[] = [{ role: 'user', content: 'hi' }]
    await mw(makeCtx(msgs, join(ext, 'foo.ts')))
    expect(msgs.find(m => typeof m.content === 'string' && m.content.includes('External'))).toBeTruthy()
    rmSync(ext, { recursive: true, force: true })
  })

  it('inserts after existing context-file messages', async () => {
    writeFileSync(join(subDir, 'CLAUDE.md'), '# Sub rules')
    const mw = createDiscoveryMiddleware(['CLAUDE.md'], tmp, new Set())
    const msgs: IMessage[] = [
      { role: 'user', content: '<context-file path="CLAUDE.md">\n# Root\n</context-file>' },
      { role: 'user', content: 'read a file' },
    ]
    await mw(makeCtx(msgs, join(subDir, 'x.ts')))
    const idx = msgs.findIndex(m => typeof m.content === 'string' && m.content.includes('Sub rules'))
    expect(idx).toBe(1)
  })
})
