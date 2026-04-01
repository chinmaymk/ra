import { describe, it, expect } from 'bun:test'
import { PermissionPolicy, createPermissionPolicyMiddleware, ToolRegistry } from '@chinmaymk/ra'
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

  it('reads permissionTier from tool definitions when registry provided', () => {
    const tools = new ToolRegistry()
    tools.register({ name: 'read_file', description: '', inputSchema: {}, execute: async () => 'ok', permissionTier: 'read_only' })
    tools.register({ name: 'bash', description: '', inputSchema: {}, execute: async () => 'ok', permissionTier: 'full_access' })
    tools.register({ name: 'write_file', description: '', inputSchema: {}, execute: async () => 'ok', permissionTier: 'workspace_write' })

    const policy = new PermissionPolicy({
      activeTier: 'workspace_write',
      tools,
    })
    expect(policy.requiredTierFor('read_file')).toBe('read_only')
    expect(policy.requiredTierFor('bash')).toBe('full_access')
    expect(policy.requiredTierFor('write_file')).toBe('workspace_write')
  })

  it('explicit toolRequirements override tool-declared permissionTier', () => {
    const tools = new ToolRegistry()
    tools.register({ name: 'bash', description: '', inputSchema: {}, execute: async () => 'ok', permissionTier: 'full_access' })

    const policy = new PermissionPolicy({
      activeTier: 'workspace_write',
      toolRequirements: { bash: 'workspace_write' }, // override: allow bash at workspace_write
      tools,
    })
    expect(policy.requiredTierFor('bash')).toBe('workspace_write')
  })

  it('falls back to defaultToolTier when tool has no permissionTier', () => {
    const tools = new ToolRegistry()
    tools.register({ name: 'custom_tool', description: '', inputSchema: {}, execute: async () => 'ok' }) // no permissionTier

    const policy = new PermissionPolicy({
      activeTier: 'read_only',
      defaultToolTier: 'workspace_write',
      tools,
    })
    expect(policy.requiredTierFor('custom_tool')).toBe('workspace_write')
  })

  it('auto-denies tools whose declared tier exceeds active tier', async () => {
    const tools = new ToolRegistry()
    tools.register({ name: 'bash', description: '', inputSchema: {}, execute: async () => 'ok', permissionTier: 'full_access' })

    const policy = new PermissionPolicy({ activeTier: 'read_only', tools })
    const decision = await policy.authorize('bash', '{}')
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain('full_access')
  })

  it('auto-allows tools whose declared tier is within active tier', async () => {
    const tools = new ToolRegistry()
    tools.register({ name: 'read_file', description: '', inputSchema: {}, execute: async () => 'ok', permissionTier: 'read_only' })

    const policy = new PermissionPolicy({ activeTier: 'workspace_write', tools })
    const decision = await policy.authorize('read_file', '{}')
    expect(decision.allowed).toBe(true)
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
