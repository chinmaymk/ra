import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { discoverContextFiles, createDiscoveryMiddleware, findGitRoot } from '../../src/context/discovery'
import { buildContextMessages } from '../../src/context/inject'
import { NoopLogger } from '@chinmaymk/ra'
import type { ModelCallContext, IMessage } from '@chinmaymk/ra'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const logger = new NoopLogger()

/**
 * Integration tests for the full context discovery pipeline.
 *
 * These mirror what bootstrap.ts does: initial discovery at startup,
 * then dynamic middleware discovery across multiple agent loop iterations.
 * Unlike unit tests that test the middleware in isolation, these tests
 * exercise the complete flow with a real git repo and filesystem.
 */
describe('context discovery integration', () => {
  let projectDir: string

  beforeEach(() => {
    projectDir = join(tmpdir(), `ra-ctx-int-${Date.now()}`)
    mkdirSync(projectDir, { recursive: true })
    // Initialize a real git repo so findGitRoot works
    Bun.spawnSync(['git', 'init'], { cwd: projectDir })
  })

  afterEach(() => rmSync(projectDir, { recursive: true, force: true }))

  /** Simulate what bootstrap does: discover initial files, build messages, create middleware */
  async function setupPipeline(patterns: string[], opts?: { subdirectoryWalk?: boolean }) {
    const contextFiles = await discoverContextFiles({ cwd: projectDir, patterns })
    const contextMessages = buildContextMessages(contextFiles)
    const root = (await findGitRoot(projectDir)) ?? projectDir
    const mw = createDiscoveryMiddleware(
      patterns, root, new Set(contextFiles.map(f => f.path)),
      { subdirectoryWalk: opts?.subdirectoryWalk ?? true },
    )
    return { contextMessages, mw, root }
  }

  /** Build a ModelCallContext for the middleware */
  function buildCtx(messages: IMessage[]): ModelCallContext {
    const controller = new AbortController()
    return {
      stop: () => controller.abort(), signal: controller.signal, logger,
      request: { model: 'test', messages: [...messages], tools: [] },
      loop: { stop: () => controller.abort(), signal: controller.signal, logger, messages: [...messages], iteration: 1, maxIterations: 10, sessionId: 'test', usage: { inputTokens: 0, outputTokens: 0 }, lastUsage: undefined, resumed: false, elapsedMs: 0 },
    }
  }

  it('initial discovery finds root CLAUDE.md, middleware finds subdirectory ones', async () => {
    // Project structure:
    // CLAUDE.md (root)
    // src/CLAUDE.md
    // src/api/CLAUDE.md
    // src/api/handler.ts
    writeFileSync(join(projectDir, 'CLAUDE.md'), '# Root rules: use TypeScript')
    mkdirSync(join(projectDir, 'src', 'api'), { recursive: true })
    writeFileSync(join(projectDir, 'src', 'CLAUDE.md'), '# Src rules: no default exports')
    writeFileSync(join(projectDir, 'src', 'api', 'CLAUDE.md'), '# API rules: validate all inputs')
    writeFileSync(join(projectDir, 'src', 'api', 'handler.ts'), 'export function handle() {}')

    const { contextMessages, mw } = await setupPipeline(['CLAUDE.md'])

    // Initial discovery should find root CLAUDE.md (cwd is projectDir)
    expect(contextMessages).toHaveLength(1)
    expect(contextMessages[0]!.content).toContain('Root rules: use TypeScript')

    // Simulate iteration 1: model reads src/api/handler.ts
    const iter1Messages: IMessage[] = [
      ...contextMessages,
      { role: 'user', content: 'fix the API handler' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'tc1', name: 'Read', arguments: JSON.stringify({ path: join(projectDir, 'src', 'api', 'handler.ts') }) }] },
    ]
    const ctx1 = buildCtx(iter1Messages)
    await mw(ctx1)

    // Middleware should discover src/CLAUDE.md and src/api/CLAUDE.md
    const allContent = ctx1.request.messages.map(m => m.content).join('\n')
    expect(allContent).toContain('Src rules: no default exports')
    expect(allContent).toContain('API rules: validate all inputs')
    // Root should appear exactly once (from initial context), not re-injected by middleware
    const rootCount = ctx1.request.messages.filter(m =>
      typeof m.content === 'string' && m.content.includes('Root rules') && m.content.includes('<context-file'),
    ).length
    expect(rootCount).toBe(1)
  })

  it('context from different subtrees is accumulated across iterations', async () => {
    // Project structure:
    // src/api/CLAUDE.md
    // src/db/CLAUDE.md
    // tests/CLAUDE.md
    mkdirSync(join(projectDir, 'src', 'api'), { recursive: true })
    mkdirSync(join(projectDir, 'src', 'db'), { recursive: true })
    mkdirSync(join(projectDir, 'tests'), { recursive: true })
    writeFileSync(join(projectDir, 'src', 'api', 'CLAUDE.md'), '# API: REST conventions')
    writeFileSync(join(projectDir, 'src', 'db', 'CLAUDE.md'), '# DB: use parameterized queries')
    writeFileSync(join(projectDir, 'tests', 'CLAUDE.md'), '# Tests: one assert per test')

    const { contextMessages, mw } = await setupPipeline(['CLAUDE.md'])
    expect(contextMessages).toHaveLength(0) // no root CLAUDE.md

    // Iteration 1: model touches API
    const msgs1: IMessage[] = [
      { role: 'user', content: 'update the API' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'tc1', name: 'Read', arguments: JSON.stringify({ path: join(projectDir, 'src', 'api', 'route.ts') }) }] },
    ]
    const ctx1 = buildCtx(msgs1)
    await mw(ctx1)
    expect(ctx1.request.messages.some(m => typeof m.content === 'string' && m.content.includes('REST conventions'))).toBe(true)
    expect(ctx1.request.messages.some(m => typeof m.content === 'string' && m.content.includes('parameterized queries'))).toBe(false)

    // Iteration 2: model touches DB
    const msgs2: IMessage[] = [
      ...ctx1.request.messages,
      { role: 'tool', content: 'route.ts contents...' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'tc2', name: 'Read', arguments: JSON.stringify({ path: join(projectDir, 'src', 'db', 'connection.ts') }) }] },
    ]
    const ctx2 = buildCtx(msgs2)
    await mw(ctx2)
    expect(ctx2.request.messages.some(m => typeof m.content === 'string' && m.content.includes('parameterized queries'))).toBe(true)
    // API context still present from iteration 1
    expect(ctx2.request.messages.some(m => typeof m.content === 'string' && m.content.includes('REST conventions'))).toBe(true)

    // Iteration 3: model touches tests
    const msgs3: IMessage[] = [
      ...ctx2.request.messages,
      { role: 'tool', content: 'connection.ts contents...' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'tc3', name: 'Read', arguments: JSON.stringify({ path: join(projectDir, 'tests', 'api.test.ts') }) }] },
    ]
    const ctx3 = buildCtx(msgs3)
    await mw(ctx3)
    expect(ctx3.request.messages.some(m => typeof m.content === 'string' && m.content.includes('one assert per test'))).toBe(true)
    // All three contexts present
    expect(ctx3.request.messages.some(m => typeof m.content === 'string' && m.content.includes('REST conventions'))).toBe(true)
    expect(ctx3.request.messages.some(m => typeof m.content === 'string' && m.content.includes('parameterized queries'))).toBe(true)
  })

  it('multiple patterns (CLAUDE.md + AGENTS.md) are all discovered', async () => {
    mkdirSync(join(projectDir, 'src'), { recursive: true })
    writeFileSync(join(projectDir, 'CLAUDE.md'), '# Project rules')
    writeFileSync(join(projectDir, 'src', 'AGENTS.md'), '# Agent instructions for src')

    const { contextMessages, mw } = await setupPipeline(['CLAUDE.md', 'AGENTS.md'])

    // Root CLAUDE.md found at startup
    expect(contextMessages).toHaveLength(1)
    expect(contextMessages[0]!.content).toContain('Project rules')

    // Middleware discovers src/AGENTS.md when a file in src/ is referenced
    const msgs: IMessage[] = [
      ...contextMessages,
      { role: 'user', content: 'help' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'tc1', name: 'Read', arguments: JSON.stringify({ path: join(projectDir, 'src', 'index.ts') }) }] },
    ]
    const ctx = buildCtx(msgs)
    await mw(ctx)
    expect(ctx.request.messages.some(m => typeof m.content === 'string' && m.content.includes('Agent instructions for src'))).toBe(true)
  })

  it('subdirectoryWalk=false only discovers immediate directory context', async () => {
    mkdirSync(join(projectDir, 'src', 'api'), { recursive: true })
    writeFileSync(join(projectDir, 'src', 'CLAUDE.md'), '# Src rules')
    writeFileSync(join(projectDir, 'src', 'api', 'CLAUDE.md'), '# API rules')

    const { contextMessages, mw } = await setupPipeline(['CLAUDE.md'], { subdirectoryWalk: false })
    expect(contextMessages).toHaveLength(0)

    // Reference a file in src/api/ — should only discover src/api/CLAUDE.md, not src/CLAUDE.md
    const msgs: IMessage[] = [
      { role: 'user', content: 'fix it' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'tc1', name: 'Read', arguments: JSON.stringify({ path: join(projectDir, 'src', 'api', 'handler.ts') }) }] },
    ]
    const ctx = buildCtx(msgs)
    await mw(ctx)
    expect(ctx.request.messages.some(m => typeof m.content === 'string' && m.content.includes('API rules'))).toBe(true)
    expect(ctx.request.messages.some(m => typeof m.content === 'string' && m.content.includes('Src rules'))).toBe(false)
  })

  it('context messages are inserted after existing context-file blocks', async () => {
    mkdirSync(join(projectDir, 'src'), { recursive: true })
    writeFileSync(join(projectDir, 'CLAUDE.md'), '# Root')
    writeFileSync(join(projectDir, 'src', 'CLAUDE.md'), '# Src context')

    const { contextMessages, mw } = await setupPipeline(['CLAUDE.md'])
    expect(contextMessages).toHaveLength(1)

    // Build messages with initial context at position 0, user message at position 1
    const msgs: IMessage[] = [
      ...contextMessages, // position 0: <context-file> with Root
      { role: 'user', content: 'help with src' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'tc1', name: 'Read', arguments: JSON.stringify({ path: join(projectDir, 'src', 'foo.ts') }) }] },
    ]
    const ctx = buildCtx(msgs)
    await mw(ctx)

    // New context should be inserted right after existing context-file messages
    const srcIdx = ctx.request.messages.findIndex(m => typeof m.content === 'string' && m.content.includes('Src context'))
    const rootIdx = ctx.request.messages.findIndex(m => typeof m.content === 'string' && m.content.includes('Root'))
    expect(srcIdx).toBe(rootIdx + 1)
  })

  it('handles file paths mentioned in user text (not just tool calls)', async () => {
    mkdirSync(join(projectDir, 'lib'), { recursive: true })
    writeFileSync(join(projectDir, 'lib', 'CLAUDE.md'), '# Lib conventions')

    const { mw } = await setupPipeline(['CLAUDE.md'])

    // User mentions a file path in their message text
    const filePath = join(projectDir, 'lib', 'utils.ts')
    const msgs: IMessage[] = [
      { role: 'user', content: `Please look at ${filePath} and fix the bug` },
    ]
    const ctx = buildCtx(msgs)
    await mw(ctx)
    expect(ctx.request.messages.some(m => typeof m.content === 'string' && m.content.includes('Lib conventions'))).toBe(true)
  })

  it('no duplicate injection when same file is referenced multiple times', async () => {
    mkdirSync(join(projectDir, 'src'), { recursive: true })
    writeFileSync(join(projectDir, 'src', 'CLAUDE.md'), '# Src rules')

    const { mw } = await setupPipeline(['CLAUDE.md'])

    // Multiple tool calls reference files in the same directory
    const msgs: IMessage[] = [
      { role: 'user', content: 'update files' },
      { role: 'assistant', content: '', toolCalls: [
        { id: 'tc1', name: 'Read', arguments: JSON.stringify({ path: join(projectDir, 'src', 'a.ts') }) },
        { id: 'tc2', name: 'Read', arguments: JSON.stringify({ path: join(projectDir, 'src', 'b.ts') }) },
        { id: 'tc3', name: 'Read', arguments: JSON.stringify({ path: join(projectDir, 'src', 'c.ts') }) },
      ]},
    ]
    const ctx = buildCtx(msgs)
    await mw(ctx)

    const contextCount = ctx.request.messages.filter(m =>
      typeof m.content === 'string' && m.content.includes('Src rules'),
    ).length
    expect(contextCount).toBe(1) // exactly one injection, not three
  })
})
