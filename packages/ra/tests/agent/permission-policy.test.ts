import { describe, it, expect } from 'bun:test'
import { PermissionPolicy, createPermissionPolicyMiddleware, ToolRegistry } from '@chinmaymk/ra'
import type { ToolExecutionContext } from '@chinmaymk/ra'
import { NoopLogger } from '@chinmaymk/ra'

function makeToolExecCtx(toolName: string): ToolExecutionContext & { denied: string | null } {
  const ctx = {
    toolCall: { id: 'tc1', name: toolName, arguments: '{}' },
    loop: {
      messages: [], iteration: 1, maxIterations: 10, sessionId: 'test',
      usage: { inputTokens: 0, outputTokens: 0 }, lastUsage: undefined, resumed: false,
      stop: () => {}, signal: new AbortController().signal, logger: new NoopLogger(),
    },
    stop: () => {}, signal: new AbortController().signal, logger: new NoopLogger(),
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

describe('PermissionPolicy', () => {
  it('allows tools when active tier meets declared requirement', () => {
    const tools = makeRegistry({ name: 'bash', tier: 'full_access' })
    const policy = new PermissionPolicy({ activeTier: 'full_access', tools })
    expect(policy.authorize('bash').allowed).toBe(true)
  })

  it('allows lower-tier tools from higher active tier', () => {
    const tools = makeRegistry({ name: 'read_file', tier: 'read_only' })
    const policy = new PermissionPolicy({ activeTier: 'workspace_write', tools })
    expect(policy.authorize('read_file').allowed).toBe(true)
  })

  it('denies tools when active tier is below required', () => {
    const tools = makeRegistry({ name: 'bash', tier: 'full_access' })
    const policy = new PermissionPolicy({ activeTier: 'read_only', tools })
    const decision = policy.authorize('bash')
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain('full_access')
    expect(decision.reason).toContain('read_only')
  })

  it('denies workspace_write tools from read_only session', () => {
    const tools = makeRegistry({ name: 'write_file', tier: 'workspace_write' })
    const policy = new PermissionPolicy({ activeTier: 'read_only', tools })
    expect(policy.authorize('write_file').allowed).toBe(false)
  })

  it('uses defaultToolTier for tools without declared tier', () => {
    const tools = makeRegistry({ name: 'custom' })
    const policy = new PermissionPolicy({ activeTier: 'workspace_write', defaultToolTier: 'full_access', tools })
    expect(policy.authorize('custom').allowed).toBe(false)
  })

  it('defaults to full_access when tool has no tier and no defaultToolTier', () => {
    const tools = makeRegistry({ name: 'custom' })
    const policy = new PermissionPolicy({ activeTier: 'workspace_write', tools })
    expect(policy.authorize('custom').allowed).toBe(false)
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

  it('falls back to defaultToolTier for tools without declared tier', () => {
    const tools = makeRegistry({ name: 'custom' })
    const policy = new PermissionPolicy({ activeTier: 'read_only', defaultToolTier: 'workspace_write', tools })
    expect(policy.requiredTierFor('custom')).toBe('workspace_write')
  })

  it('falls back to full_access for unknown tools without registry', () => {
    const policy = new PermissionPolicy({ activeTier: 'read_only' })
    expect(policy.requiredTierFor('nonexistent')).toBe('full_access')
  })
})

describe('createPermissionPolicyMiddleware', () => {
  it('allows tool when tier is sufficient', async () => {
    const tools = makeRegistry({ name: 'read_file', tier: 'read_only' })
    const policy = new PermissionPolicy({ activeTier: 'full_access', tools })
    const ctx = makeToolExecCtx('read_file')
    await createPermissionPolicyMiddleware(policy)(ctx)
    expect(ctx.denied).toBeNull()
  })

  it('denies tool when tier is insufficient', async () => {
    const tools = makeRegistry({ name: 'bash', tier: 'full_access' })
    const policy = new PermissionPolicy({ activeTier: 'read_only', tools })
    const ctx = makeToolExecCtx('bash')
    await createPermissionPolicyMiddleware(policy)(ctx)
    expect(ctx.denied).toContain('full_access')
  })
})
