import { describe, it, expect } from 'bun:test'
import { PermissionPolicy, createPermissionPolicyMiddleware } from '@chinmaymk/ra'
import type { PermissionTier, ToolExecutionContext } from '@chinmaymk/ra'
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

describe('PermissionPolicy', () => {
  it('allows tools when active tier meets requirement', async () => {
    const policy = new PermissionPolicy({
      activeTier: 'full_access',
      toolRequirements: { bash: 'full_access', read_file: 'read_only' },
    })
    const decision = await policy.authorize('bash', '{}')
    expect(decision.allowed).toBe(true)
  })

  it('allows lower-tier tools from higher active tier', async () => {
    const policy = new PermissionPolicy({
      activeTier: 'workspace_write',
      toolRequirements: { read_file: 'read_only' },
    })
    const decision = await policy.authorize('read_file', '{}')
    expect(decision.allowed).toBe(true)
  })

  it('denies when active tier is insufficient', async () => {
    const policy = new PermissionPolicy({
      activeTier: 'read_only',
      toolRequirements: { bash: 'full_access' },
    })
    const decision = await policy.authorize('bash', '{}')
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain('full_access')
    expect(decision.reason).toContain('read_only')
  })

  it('denies workspace_write tools from read_only tier', async () => {
    const policy = new PermissionPolicy({
      activeTier: 'read_only',
      toolRequirements: { write_file: 'workspace_write' },
    })
    const decision = await policy.authorize('write_file', '{}')
    expect(decision.allowed).toBe(false)
  })

  it('uses defaultToolTier for tools not in requirements', async () => {
    const policy = new PermissionPolicy({
      activeTier: 'workspace_write',
      defaultToolTier: 'full_access',
    })
    const decision = await policy.authorize('unknown_tool', '{}')
    expect(decision.allowed).toBe(false)
  })

  it('prompt tier always escalates', async () => {
    const policy = new PermissionPolicy({
      activeTier: 'prompt',
      toolRequirements: { read_file: 'read_only' },
    })
    const decision = await policy.authorize('read_file', '{}')
    expect(decision.allowed).toBe(false)
  })

  it('invokes prompter for escalation', async () => {
    const policy = new PermissionPolicy({
      activeTier: 'read_only',
      toolRequirements: { bash: 'full_access' },
      prompter: async ({ toolName, activeTier, requiredTier }) => {
        expect(toolName).toBe('bash')
        expect(activeTier).toBe('read_only')
        expect(requiredTier).toBe('full_access')
        return { allowed: true }
      },
    })
    const decision = await policy.authorize('bash', '{}')
    expect(decision.allowed).toBe(true)
  })

  it('respects prompter denial', async () => {
    const policy = new PermissionPolicy({
      activeTier: 'read_only',
      toolRequirements: { bash: 'full_access' },
      prompter: async () => ({ allowed: false, reason: 'user said no' }),
    })
    const decision = await policy.authorize('bash', '{}')
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('user said no')
  })

  it('requiredTierFor returns correct tier', () => {
    const policy = new PermissionPolicy({
      activeTier: 'read_only',
      toolRequirements: { bash: 'full_access', read_file: 'read_only' },
      defaultToolTier: 'workspace_write',
    })
    expect(policy.requiredTierFor('bash')).toBe('full_access')
    expect(policy.requiredTierFor('read_file')).toBe('read_only')
    expect(policy.requiredTierFor('unknown')).toBe('workspace_write')
  })
})

describe('createPermissionPolicyMiddleware', () => {
  it('allows tool when tier is sufficient', async () => {
    const policy = new PermissionPolicy({
      activeTier: 'full_access',
      toolRequirements: { bash: 'full_access' },
    })
    const middleware = createPermissionPolicyMiddleware(policy)
    const ctx = makeToolExecCtx('bash')
    await middleware(ctx)
    expect(ctx.denied).toBeNull()
  })

  it('denies tool when tier is insufficient', async () => {
    const policy = new PermissionPolicy({
      activeTier: 'read_only',
      toolRequirements: { bash: 'full_access' },
    })
    const middleware = createPermissionPolicyMiddleware(policy)
    const ctx = makeToolExecCtx('bash')
    await middleware(ctx)
    expect(ctx.denied).not.toBeNull()
    expect(ctx.denied).toContain('full_access')
  })
})
