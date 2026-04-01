import type { Middleware, ToolExecutionContext } from './types'
import type { ToolRegistry } from './tool-registry'

/**
 * Permission tiers, ordered from least to most permissive.
 * Acts as a coarse session-wide gate that runs *before* ra's existing
 * field-level allow/deny regex rules. The tier answers "is this class
 * of tool allowed at all?" while field-level rules answer "is this
 * specific invocation allowed?"
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

export interface PermissionDecision {
  allowed: boolean
  reason?: string
}

/**
 * Callback invoked when a tool requires a higher tier than the session allows.
 * Async to support interactive prompting (e.g. "bash needs full_access, allow? [y/N]").
 * This is the key addition over ra's existing regex rules — ra can deny but never ask.
 */
export type PermissionPrompter = (request: {
  toolName: string
  input: string
  activeTier: PermissionTier
  requiredTier: PermissionTier
}) => Promise<PermissionDecision>

export interface PermissionPolicyConfig {
  /** Session-wide permission ceiling. Tools requiring a higher tier are blocked or escalated. */
  activeTier: PermissionTier
  /** Optional tool registry. When provided, reads `tool.permissionTier` to determine each tool's required tier. */
  tools?: ToolRegistry
  /** Fallback tier for tools without a declared `permissionTier`. Default: 'full_access'. */
  defaultToolTier?: PermissionTier
  /** Optional callback for interactive escalation when a tool exceeds the active tier. Without it, over-tier tools are denied. */
  prompter?: PermissionPrompter
}

export class PermissionPolicy {
  private activeTier: PermissionTier
  private tools?: ToolRegistry
  private defaultToolTier: PermissionTier
  private prompter?: PermissionPrompter

  constructor(config: PermissionPolicyConfig) {
    this.activeTier = config.activeTier
    this.tools = config.tools
    this.defaultToolTier = config.defaultToolTier ?? 'full_access'
    this.prompter = config.prompter
  }

  /** Determine a tool's required tier from its declaration, falling back to defaultToolTier. */
  requiredTierFor(toolName: string): PermissionTier {
    const tool = this.tools?.get(toolName)
    if (tool?.permissionTier) return tool.permissionTier
    return this.defaultToolTier
  }

  /** Check if the active tier meets or exceeds the required tier. */
  private meetsRequirement(required: PermissionTier): boolean {
    return TIER_LEVEL[this.activeTier] >= TIER_LEVEL[required]
  }

  /** Authorize a tool call against the session tier. Returns a decision. */
  async authorize(toolName: string, input: string): Promise<PermissionDecision> {
    const required = this.requiredTierFor(toolName)

    if (this.meetsRequirement(required)) {
      return { allowed: true }
    }

    // Escalation needed — try prompter if available
    if (this.prompter) {
      return this.prompter({ toolName, input, activeTier: this.activeTier, requiredTier: required })
    }

    return {
      allowed: false,
      reason: `Tool '${toolName}' requires '${required}' permission; session tier is '${this.activeTier}'`,
    }
  }
}

/**
 * Create a beforeToolExecution middleware that enforces the session-wide permission tier.
 * Designed to run *before* ra's existing field-level permissions middleware — the tier is
 * a quick pre-filter, and field-level rules provide fine-grained control within allowed tiers.
 */
export function createPermissionPolicyMiddleware(policy: PermissionPolicy): Middleware<ToolExecutionContext> {
  return async (ctx: ToolExecutionContext) => {
    const decision = await policy.authorize(ctx.toolCall.name, ctx.toolCall.arguments)
    if (!decision.allowed) {
      ctx.deny(decision.reason ?? `Permission denied for tool '${ctx.toolCall.name}'`)
      ctx.logger.info('tool denied by permission tier', { tool: ctx.toolCall.name, reason: decision.reason })
    }
  }
}
