import { describe, it, expect } from 'bun:test'
import { PermissionPolicy, createPermissionPolicyMiddleware, ToolRegistry } from '@chinmaymk/ra'
import type { ToolExecutionContext } from '@chinmaymk/ra'
import { NoopLogger } from '@chinmaymk/ra'

function makeToolExecCtx(toolName: string, args = '{}'): ToolExecutionContext & { denied: string | null } {
  const ctx = {
    toolCall: { id: 'tc1', name: toolName, arguments: args },
    loop: {
      messages: [],
      iteration: 1,
      maxIterations: 10,
      sessionId: 'test',
      usage: { inputTokens: 0, outputTokens: 0 },
      lastUsage: undefined,
      resumed: false,
      stop: () => {},
      signal: new AbortController().signal,
      logger: new NoopLogger(),
    },
    stop: () => {},
    signal: new AbortController().signal,
    logger: new NoopLogger(),
    denied: null as string | null,
    deny: (reason: string) => { ctx.denied = reason },
  }
  return ctx
}

function makeRegistry(...tools: Array<{ name: string; tier?: 'read_only' | 'workspace_write' | 'full_access' }>): ToolRegistry {
  const reg = new ToolRegistry()
  for (const t of tools) {
    reg.register({ name: t.name, description: '', inputSchema: {}, execute: async () => 'ok', permissionTier: t.tier })
  }
  return reg
}

describe('PermissionPolicy — tier as coarse pre-filter', () => {
  it('allows tools when active tier meets tool-declared requirement', async () => {
    const tools = makeRegistry({ name: 'bash', tier: 'full_access' })
    const policy = new PermissionPolicy({ activeTier: 'full_access', tools })
    expect((await policy.authorize('bash', '{}')).allowed).toBe(true)
  })

  it('allows lower-tier tools from higher active tier', async () => {
    const tools = makeRegistry({ name: 'read_file', tier: 'read_only' })
    const policy = new PermissionPolicy({ activeTier: 'workspace_write', tools })
    expect((await policy.authorize('read_file', '{}')).allowed).toBe(true)
  })

  it('denies tools when active tier is below required', async () => {
    const tools = makeRegistry({ name: 'bash', tier: 'full_access' })
    const policy = new PermissionPolicy({ activeTier: 'read_only', tools })
    const decision = await policy.authorize('bash', '{}')
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain('full_access')
    expect(decision.reason).toContain('read_only')
  })

  it('denies workspace_write tools from read_only session', async () => {
    const tools = makeRegistry({ name: 'write_file', tier: 'workspace_write' })
    const policy = new PermissionPolicy({ activeTier: 'read_only', tools })
    expect((await policy.authorize('write_file', '{}')).allowed).toBe(false)
  })

  it('uses defaultToolTier for tools without declared tier', async () => {
    const tools = makeRegistry({ name: 'custom' }) // no tier declared
    const policy = new PermissionPolicy({ activeTier: 'workspace_write', defaultToolTier: 'full_access', tools })
    expect((await policy.authorize('custom', '{}')).allowed).toBe(false)
  })

  it('defaults to full_access when no tier and no defaultToolTier', async () => {
    const tools = makeRegistry({ name: 'custom' })
    const policy = new PermissionPolicy({ activeTier: 'workspace_write', tools })
    // defaultToolTier is 'full_access', so workspace_write < full_access → denied
    expect((await policy.authorize('custom', '{}')).allowed).toBe(false)
  })
})

describe('PermissionPolicy — requiredTierFor', () => {
  it('reads tier from tool declaration', () => {
    const tools = makeRegistry(
      { name: 'read_file', tier: 'read_only' },
      { name: 'bash', tier: 'full_access' },
      { name: 'write_file', tier: 'workspace_write' },
    )
    const policy = new PermissionPolicy({ activeTier: 'read_only', tools })
    expect(policy.requiredTierFor('read_file')).toBe('read_only')
    expect(policy.requiredTierFor('bash')).toBe('full_access')
    expect(policy.requiredTierFor('write_file')).toBe('workspace_write')
  })

  it('falls back to defaultToolTier when tool has no declared tier', () => {
    const tools = makeRegistry({ name: 'custom' })
    const policy = new PermissionPolicy({ activeTier: 'read_only', defaultToolTier: 'workspace_write', tools })
    expect(policy.requiredTierFor('custom')).toBe('workspace_write')
  })

  it('falls back to defaultToolTier for unknown tools', () => {
    const policy = new PermissionPolicy({ activeTier: 'read_only', defaultToolTier: 'workspace_write' })
    expect(policy.requiredTierFor('nonexistent')).toBe('workspace_write')
  })
})

describe('PermissionPolicy — interactive escalation', () => {
  it('invokes prompter when tool exceeds active tier', async () => {
    const tools = makeRegistry({ name: 'bash', tier: 'full_access' })
    const policy = new PermissionPolicy({
      activeTier: 'read_only',
      tools,
      prompter: async ({ toolName, activeTier, requiredTier }) => {
        expect(toolName).toBe('bash')
        expect(activeTier).toBe('read_only')
        expect(requiredTier).toBe('full_access')
        return { allowed: true }
      },
    })
    expect((await policy.authorize('bash', '{}')).allowed).toBe(true)
  })

  it('respects prompter denial', async () => {
    const tools = makeRegistry({ name: 'bash', tier: 'full_access' })
    const policy = new PermissionPolicy({
      activeTier: 'read_only',
      tools,
      prompter: async () => ({ allowed: false, reason: 'user said no' }),
    })
    const decision = await policy.authorize('bash', '{}')
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('user said no')
  })

  it('does not invoke prompter when tool is within tier', async () => {
    let prompterCalled = false
    const tools = makeRegistry({ name: 'read_file', tier: 'read_only' })
    const policy = new PermissionPolicy({
      activeTier: 'workspace_write',
      tools,
      prompter: async () => { prompterCalled = true; return { allowed: true } },
    })
    await policy.authorize('read_file', '{}')
    expect(prompterCalled).toBe(false)
  })
})

describe('createPermissionPolicyMiddleware', () => {
  it('allows tool when tier is sufficient', async () => {
    const tools = makeRegistry({ name: 'read_file', tier: 'read_only' })
    const policy = new PermissionPolicy({ activeTier: 'full_access', tools })
    const middleware = createPermissionPolicyMiddleware(policy)
    const ctx = makeToolExecCtx('read_file')
    await middleware(ctx)
    expect(ctx.denied).toBeNull()
  })

  it('denies tool when tier is insufficient', async () => {
    const tools = makeRegistry({ name: 'bash', tier: 'full_access' })
    const policy = new PermissionPolicy({ activeTier: 'read_only', tools })
    const middleware = createPermissionPolicyMiddleware(policy)
    const ctx = makeToolExecCtx('bash')
    await middleware(ctx)
    expect(ctx.denied).not.toBeNull()
    expect(ctx.denied).toContain('full_access')
  })

  it('composes with field-level rules (tier runs first, field rules after)', async () => {
    // Tier allows bash at workspace_write, but field-level rules would further restrict
    const tools = makeRegistry({ name: 'bash', tier: 'workspace_write' })
    const policy = new PermissionPolicy({ activeTier: 'workspace_write', tools })
    const middleware = createPermissionPolicyMiddleware(policy)
    const ctx = makeToolExecCtx('bash', '{"command":"echo hello"}')
    await middleware(ctx)
    // Tier passes — field-level rules (not tested here) would run next in the middleware chain
    expect(ctx.denied).toBeNull()
  })
})
