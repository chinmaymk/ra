import type { Middleware, ToolExecutionContext } from './types'
import type { ToolRegistry } from './tool-registry'

/**
 * Permission tiers, ordered from least to most permissive.
 * Set once at session start — the agent runs autonomously within
 * the configured ceiling. No interactive prompts, no escalation.
 *
 * Acts as a coarse pre-filter before ra's field-level allow/deny
 * regex rules. Tiers answer "is this class of tool allowed at all?"
 * while field rules answer "is this specific invocation allowed?"
 *
 *   read_only        — Read, search, glob only.
 *   workspace_write  — Read + write/edit files within the project.
 *   full_access      — Anything, including bash, network, etc.
 */
export type PermissionTier = 'read_only' | 'workspace_write' | 'full_access'

const TIER_LEVEL: Record<PermissionTier, number> = {
  read_only: 0,
  workspace_write: 1,
  full_access: 2,
}

export interface PermissionPolicyConfig {
  /** Session-wide permission ceiling. Tools requiring a higher tier are denied. */
  activeTier: PermissionTier
  /** Optional tool registry. When provided, reads `tool.permissionTier` to determine each tool's required tier. */
  tools?: ToolRegistry
  /** Fallback tier for tools without a declared `permissionTier`. Default: 'full_access'. */
  defaultToolTier?: PermissionTier
}

export class PermissionPolicy {
  private activeTier: PermissionTier
  private tools?: ToolRegistry
  private defaultToolTier: PermissionTier

  constructor(config: PermissionPolicyConfig) {
    this.activeTier = config.activeTier
    this.tools = config.tools
    this.defaultToolTier = config.defaultToolTier ?? 'full_access'
  }

  /** Determine a tool's required tier from its declaration, falling back to defaultToolTier. */
  requiredTierFor(toolName: string): PermissionTier {
    const tool = this.tools?.get(toolName)
    if (tool?.permissionTier) return tool.permissionTier
    return this.defaultToolTier
  }

  /** Authorize a tool call against the session tier. */
  authorize(toolName: string): { allowed: boolean; reason?: string } {
    const required = this.requiredTierFor(toolName)
    if (TIER_LEVEL[this.activeTier] >= TIER_LEVEL[required]) {
      return { allowed: true }
    }
    return {
      allowed: false,
      reason: `Tool '${toolName}' requires '${required}' permission; session tier is '${this.activeTier}'`,
    }
  }
}

/**
 * Create a beforeToolExecution middleware that enforces the session-wide permission tier.
 * Runs before ra's field-level permissions middleware — fast, synchronous pre-filter.
 */
export function createPermissionPolicyMiddleware(policy: PermissionPolicy): Middleware<ToolExecutionContext> {
  return async (ctx: ToolExecutionContext) => {
    const decision = policy.authorize(ctx.toolCall.name)
    if (!decision.allowed) {
      ctx.deny(decision.reason ?? `Permission denied for tool '${ctx.toolCall.name}'`)
      ctx.logger.info('tool denied by permission tier', { tool: ctx.toolCall.name, reason: decision.reason })
    }
  }
}
