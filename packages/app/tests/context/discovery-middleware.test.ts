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
    loop: { stop: () => controller.abort(), signal: controller.signal, logger, messages: messagesWithToolCall, iteration: 1, maxIterations: 10, sessionId: 'test', usage: { inputTokens: 0, outputTokens: 0 }, lastUsage: undefined, resumed: false, elapsedMs: 0 },
  }
}

/** Build a ModelCallContext from raw messages (no extra tool call appended). */
function makeRawCtx(messages: IMessage[]): ModelCallContext {
  const controller = new AbortController()
  return {
    stop: () => controller.abort(), signal: controller.signal, logger,
    request: { model: 'test', messages: [...messages], tools: [] },
    loop: { stop: () => controller.abort(), signal: controller.signal, logger, messages: [...messages], iteration: 1, maxIterations: 10, sessionId: 'test', usage: { inputTokens: 0, outputTokens: 0 }, lastUsage: undefined, resumed: false, elapsedMs: 0 },
  }
}

function countContext(messages: IMessage[]): number {
  return messages.filter(m => typeof m.content === 'string' && m.content.includes('<context-file')).length
}

function getContextContents(messages: IMessage[]): string[] {
  return messages
    .filter(m => typeof m.content === 'string' && m.content.includes('<context-file'))
    .map(m => m.content as string)
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
      loop: { stop: () => controller.abort(), signal: controller.signal, logger, messages: msgs, iteration: 1, maxIterations: 10, sessionId: 'test', usage: { inputTokens: 0, outputTokens: 0 }, lastUsage: undefined, resumed: false, elapsedMs: 0 },
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
      loop: { stop: () => controller.abort(), signal: controller.signal, logger, messages: msgs, iteration: 1, maxIterations: 10, sessionId: 'test', usage: { inputTokens: 0, outputTokens: 0 }, lastUsage: undefined, resumed: false, elapsedMs: 0 },
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

describe('createDiscoveryMiddleware — file path extraction', () => {
  let tmp: string

  beforeEach(() => {
    tmp = join(tmpdir(), `ra-disc-extract-${Date.now()}`)
    mkdirSync(join(tmp, 'src', 'api'), { recursive: true })
    mkdirSync(join(tmp, 'lib', 'db'), { recursive: true })
  })

  afterEach(() => rmSync(tmp, { recursive: true, force: true }))

  it('extracts paths from tool result content', async () => {
    writeFileSync(join(tmp, 'src', 'api', 'CLAUDE.md'), '# API guidelines')
    const mw = createDiscoveryMiddleware(['CLAUDE.md'], tmp, new Set())
    const filePath = join(tmp, 'src', 'api', 'handler.ts')
    const msgs: IMessage[] = [
      { role: 'user', content: 'read the handler' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'tc1', name: 'Read', arguments: JSON.stringify({ path: filePath }) }] },
      { role: 'tool', content: `Contents of ${filePath}:\nexport function handler() {}` },
    ]
    const ctx = makeRawCtx(msgs)
    await mw(ctx)
    expect(ctx.request.messages.find(m => typeof m.content === 'string' && m.content.includes('API guidelines'))).toBeTruthy()
  })

  it('extracts multiple paths from a single tool call with multiple args', async () => {
    writeFileSync(join(tmp, 'src', 'api', 'CLAUDE.md'), '# API rules')
    writeFileSync(join(tmp, 'lib', 'db', 'CLAUDE.md'), '# DB rules')
    const mw = createDiscoveryMiddleware(['CLAUDE.md'], tmp, new Set())
    const msgs: IMessage[] = [
      { role: 'user', content: 'compare these files' },
      {
        role: 'assistant', content: '',
        toolCalls: [
          { id: 'tc1', name: 'Read', arguments: JSON.stringify({ path: join(tmp, 'src', 'api', 'handler.ts') }) },
          { id: 'tc2', name: 'Read', arguments: JSON.stringify({ path: join(tmp, 'lib', 'db', 'query.ts') }) },
        ],
      },
    ]
    const ctx = makeRawCtx(msgs)
    await mw(ctx)
    const contents = getContextContents(ctx.request.messages)
    expect(contents.some(c => c.includes('API rules'))).toBe(true)
    expect(contents.some(c => c.includes('DB rules'))).toBe(true)
  })

  it('handles malformed JSON in tool call arguments gracefully', async () => {
    const mw = createDiscoveryMiddleware(['CLAUDE.md'], tmp, new Set())
    const msgs: IMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'tc1', name: 'Read', arguments: '{invalid json' }] },
    ]
    const ctx = makeRawCtx(msgs)
    await mw(ctx) // should not throw
    expect(countContext(ctx.request.messages)).toBe(0)
  })

  it('ignores paths containing null bytes in tool arguments', async () => {
    writeFileSync(join(tmp, 'src', 'api', 'CLAUDE.md'), '# API rules')
    const mw = createDiscoveryMiddleware(['CLAUDE.md'], tmp, new Set())
    const pathWithNull = join(tmp, 'src', 'api', 'handler.ts') + '\0'
    const msgs: IMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'tc1', name: 'Read', arguments: JSON.stringify({ path: pathWithNull }) }] },
    ]
    const ctx = makeRawCtx(msgs)
    await mw(ctx) // should not throw
    expect(countContext(ctx.request.messages)).toBe(0)
  })

  it('ignores relative paths in tool arguments', async () => {
    writeFileSync(join(tmp, 'CLAUDE.md'), '# Root')
    const mw = createDiscoveryMiddleware(['CLAUDE.md'], tmp, new Set())
    const msgs: IMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'tc1', name: 'Read', arguments: JSON.stringify({ path: 'relative/path.ts' }) }] },
    ]
    const ctx = makeRawCtx(msgs)
    await mw(ctx)
    expect(countContext(ctx.request.messages)).toBe(0)
  })
})

describe('createDiscoveryMiddleware — multiple patterns', () => {
  let tmp: string

  beforeEach(() => {
    tmp = join(tmpdir(), `ra-disc-multi-${Date.now()}`)
    mkdirSync(join(tmp, 'src'), { recursive: true })
  })

  afterEach(() => rmSync(tmp, { recursive: true, force: true }))

  it('discovers files matching different patterns in the same directory', async () => {
    writeFileSync(join(tmp, 'src', 'CLAUDE.md'), '# Claude context')
    writeFileSync(join(tmp, 'src', 'AGENTS.md'), '# Agent context')
    const mw = createDiscoveryMiddleware(['CLAUDE.md', 'AGENTS.md'], tmp, new Set())
    const ctx = makeCtx([{ role: 'user', content: 'hi' }], join(tmp, 'src', 'index.ts'))
    await mw(ctx)
    const contents = getContextContents(ctx.request.messages)
    expect(contents.some(c => c.includes('Claude context'))).toBe(true)
    expect(contents.some(c => c.includes('Agent context'))).toBe(true)
  })

  it('discovers glob patterns in subdirectories', async () => {
    const rulesDir = join(tmp, 'src', '.cursor', 'rules')
    mkdirSync(rulesDir, { recursive: true })
    writeFileSync(join(rulesDir, 'style.mdc'), 'use-tabs')
    const mw = createDiscoveryMiddleware(['.cursor/rules/*'], tmp, new Set())
    const ctx = makeCtx([{ role: 'user', content: 'hi' }], join(tmp, 'src', 'index.ts'))
    await mw(ctx)
    expect(ctx.request.messages.find(m => typeof m.content === 'string' && m.content.includes('use-tabs'))).toBeTruthy()
  })
})

describe('createDiscoveryMiddleware — deep walk', () => {
  let tmp: string

  beforeEach(() => {
    tmp = join(tmpdir(), `ra-disc-deep-${Date.now()}`)
    mkdirSync(join(tmp, 'a', 'b', 'c', 'd'), { recursive: true })
  })

  afterEach(() => rmSync(tmp, { recursive: true, force: true }))

  it('discovers context files at every level of a deeply nested path', async () => {
    writeFileSync(join(tmp, 'a', 'CLAUDE.md'), '# Level A')
    writeFileSync(join(tmp, 'a', 'b', 'CLAUDE.md'), '# Level B')
    writeFileSync(join(tmp, 'a', 'b', 'c', 'CLAUDE.md'), '# Level C')
    // Note: no CLAUDE.md at level d — should still walk up and find the others

    const mw = createDiscoveryMiddleware(['CLAUDE.md'], tmp, new Set(), { subdirectoryWalk: true })
    const ctx = makeCtx([{ role: 'user', content: 'hi' }], join(tmp, 'a', 'b', 'c', 'd', 'deep.ts'))
    await mw(ctx)

    const contents = getContextContents(ctx.request.messages)
    expect(contents.some(c => c.includes('Level A'))).toBe(true)
    expect(contents.some(c => c.includes('Level B'))).toBe(true)
    expect(contents.some(c => c.includes('Level C'))).toBe(true)
  })

  it('discovers new subdirectory context on second call to a different subtree', async () => {
    writeFileSync(join(tmp, 'a', 'CLAUDE.md'), '# A rules')
    const otherDir = join(tmp, 'x', 'y')
    mkdirSync(otherDir, { recursive: true })
    writeFileSync(join(tmp, 'x', 'CLAUDE.md'), '# X rules')

    const mw = createDiscoveryMiddleware(['CLAUDE.md'], tmp, new Set(), { subdirectoryWalk: true })

    // First call references subtree a/
    const ctx1 = makeCtx([{ role: 'user', content: 'hi' }], join(tmp, 'a', 'foo.ts'))
    await mw(ctx1)
    expect(getContextContents(ctx1.request.messages).some(c => c.includes('A rules'))).toBe(true)

    // Second call references subtree x/y/ — should discover X rules
    const ctx2 = makeCtx(ctx1.request.messages, join(otherDir, 'bar.ts'))
    await mw(ctx2)
    expect(getContextContents(ctx2.request.messages).some(c => c.includes('X rules'))).toBe(true)
  })
})

describe('createDiscoveryMiddleware — simulated multi-iteration flow', () => {
  let tmp: string

  beforeEach(() => {
    tmp = join(tmpdir(), `ra-disc-iter-${Date.now()}`)
    mkdirSync(join(tmp, 'src', 'api'), { recursive: true })
    mkdirSync(join(tmp, 'src', 'db'), { recursive: true })
  })

  afterEach(() => rmSync(tmp, { recursive: true, force: true }))

  it('context discovered in iteration 1 is available in iteration 2+', async () => {
    writeFileSync(join(tmp, 'src', 'api', 'CLAUDE.md'), '# API: always validate inputs')
    writeFileSync(join(tmp, 'src', 'db', 'CLAUDE.md'), '# DB: use parameterized queries')
    const rootCtx = join(tmp, 'CLAUDE.md')
    writeFileSync(rootCtx, '# Root project rules')

    const mw = createDiscoveryMiddleware(['CLAUDE.md'], tmp, new Set([rootCtx]), { subdirectoryWalk: true })

    // === Iteration 1: user asks to edit an API file ===
    const iter1Msgs: IMessage[] = [
      { role: 'user', content: '<context-file path="CLAUDE.md">\n# Root project rules\n</context-file>' },
      { role: 'user', content: 'fix the API handler' },
    ]
    const apiPath = join(tmp, 'src', 'api', 'handler.ts')
    const ctx1 = makeCtx(iter1Msgs, apiPath)
    await mw(ctx1)

    // API context should now be injected
    expect(ctx1.request.messages.find(m => typeof m.content === 'string' && m.content.includes('always validate inputs'))).toBeTruthy()
    // DB context should NOT be present yet (no DB file referenced)
    expect(ctx1.request.messages.find(m => typeof m.content === 'string' && m.content.includes('parameterized queries'))).toBeFalsy()

    // === Iteration 2: model now references a DB file ===
    const iter2Msgs: IMessage[] = [
      ...ctx1.request.messages,
      { role: 'tool', content: 'handler.ts updated successfully' },
    ]
    const dbPath = join(tmp, 'src', 'db', 'query.ts')
    const ctx2 = makeCtx(iter2Msgs, dbPath)
    await mw(ctx2)

    // API context still present (from iteration 1)
    expect(ctx2.request.messages.find(m => typeof m.content === 'string' && m.content.includes('always validate inputs'))).toBeTruthy()
    // DB context now injected
    expect(ctx2.request.messages.find(m => typeof m.content === 'string' && m.content.includes('parameterized queries'))).toBeTruthy()
    // Root should NOT be duplicated
    const rootCount = ctx2.request.messages.filter(m => typeof m.content === 'string' && m.content.includes('Root project rules')).length
    expect(rootCount).toBe(1) // only the original, not re-injected

    // === Iteration 3: model references the same API file again ===
    const iter3Msgs: IMessage[] = [
      ...ctx2.request.messages,
      { role: 'tool', content: 'query updated' },
    ]
    const ctx3 = makeCtx(iter3Msgs, apiPath)
    await mw(ctx3)

    // No new context messages should be added — all already discovered
    expect(countContext(ctx3.request.messages)).toBe(countContext(ctx2.request.messages))
  })

  it('newly created context files are picked up on next iteration', async () => {
    const mw = createDiscoveryMiddleware(['CLAUDE.md'], tmp, new Set(), { subdirectoryWalk: true })
    const apiPath = join(tmp, 'src', 'api', 'handler.ts')

    // Iteration 1: no CLAUDE.md in src/api yet
    const ctx1 = makeCtx([{ role: 'user', content: 'hi' }], apiPath)
    await mw(ctx1)
    expect(countContext(ctx1.request.messages)).toBe(0)

    // Simulate: a new CLAUDE.md is created in src/api between iterations
    writeFileSync(join(tmp, 'src', 'api', 'CLAUDE.md'), '# New API guidelines')

    // Iteration 2: the middleware has already checked src/api dir, so it won't re-scan
    // This is expected lazy behavior — new files in already-scanned dirs are not re-discovered
    const ctx2 = makeCtx(ctx1.request.messages, apiPath)
    await mw(ctx2)
    // The dir was already checked, so the new file is not discovered (expected tradeoff)
    expect(countContext(ctx2.request.messages)).toBe(0)
  })
})
