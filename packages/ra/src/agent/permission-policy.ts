import type { ITool } from '../providers/types'
import type { Middleware, ToolExecutionContext } from './types'
import type { ToolRegistry } from './tool-registry'

/**
 * Permission tiers, ordered from least to most permissive.
 * Inspired by claw-code's tiered permission model.
 *
 *   read_only        — Can only read files, search, etc.
 *   workspace_write   — Can read + write files within the project.
 *   full_access       — Can do anything (bash, network, etc.)
 *   prompt            — Always ask the user before executing.
 */
export type PermissionTier = 'read_only' | 'workspace_write' | 'full_access' | 'prompt'

const TIER_ORDER: Record<PermissionTier, number> = {
  read_only: 0,
  workspace_write: 1,
  full_access: 2,
  prompt: -1, // special: always prompt
}

export interface PermissionDecision {
  allowed: boolean
  reason?: string
}

/**
 * Callback invoked when a tool requires escalation beyond the active tier.
 * Return true to allow, false to deny. Async to support interactive prompting.
 */
export type PermissionPrompter = (request: {
  toolName: string
  input: string
  activeTier: PermissionTier
  requiredTier: PermissionTier
}) => Promise<PermissionDecision>

export interface PermissionPolicyConfig {
  /** The active permission tier for this session. Default: 'workspace_write'. */
  activeTier: PermissionTier
  /** Map of tool name → minimum required tier. Tools not listed default to `defaultToolTier`. */
  toolRequirements?: Record<string, PermissionTier>
  /** Default tier required for tools not in `toolRequirements`. Default: 'full_access'. */
  defaultToolTier?: PermissionTier
  /** Optional callback for interactive escalation. Without it, escalation is denied. */
  prompter?: PermissionPrompter
  /** Optional tool registry. When provided, tool-declared `permissionTier` values are used as fallback before `defaultToolTier`. */
  tools?: ToolRegistry
}

export class PermissionPolicy {
  private activeTier: PermissionTier
  private toolRequirements: Map<string, PermissionTier>
  private defaultToolTier: PermissionTier
  private prompter?: PermissionPrompter
  private tools?: ToolRegistry

  constructor(config: PermissionPolicyConfig) {
    this.activeTier = config.activeTier
    this.toolRequirements = new Map(Object.entries(config.toolRequirements ?? {}))
    this.defaultToolTier = config.defaultToolTier ?? 'full_access'
    this.prompter = config.prompter
    this.tools = config.tools
  }

  /** Get the minimum permission tier required for a tool.
   *  Priority: explicit toolRequirements > tool.permissionTier > defaultToolTier */
  requiredTierFor(toolName: string): PermissionTier {
    const explicit = this.toolRequirements.get(toolName)
    if (explicit) return explicit

    // Check the tool's own declared tier
    const tool = this.tools?.get(toolName)
    if (tool?.permissionTier) return tool.permissionTier

    return this.defaultToolTier
  }

  /** Check if the active tier meets or exceeds the required tier. */
  private meetsRequirement(required: PermissionTier): boolean {
    if (this.activeTier === 'prompt') return false // always escalate
    const activeLevel = TIER_ORDER[this.activeTier]
    const requiredLevel = TIER_ORDER[required]
    return activeLevel >= requiredLevel
  }

  /** Authorize a tool call. Returns a decision with optional reason. */
  async authorize(toolName: string, input: string): Promise<PermissionDecision> {
    const required = this.requiredTierFor(toolName)

    if (this.meetsRequirement(required)) {
      return { allowed: true }
    }

    // Escalation needed — try prompter
    if (this.prompter) {
      return this.prompter({
        toolName,
        input,
        activeTier: this.activeTier,
        requiredTier: required,
      })
    }

    return {
      allowed: false,
      reason: `Tool '${toolName}' requires '${required}' permission; current tier is '${this.activeTier}'`,
    }
  }
}

/**
 * Create a beforeToolExecution middleware that enforces permission tiers.
 * Tools that exceed the active tier are denied (or escalated via prompter).
 */
export function createPermissionPolicyMiddleware(policy: PermissionPolicy): Middleware<ToolExecutionContext> {
  return async (ctx: ToolExecutionContext) => {
    const decision = await policy.authorize(ctx.toolCall.name, ctx.toolCall.arguments)
    if (!decision.allowed) {
      ctx.deny(decision.reason ?? `Permission denied for tool '${ctx.toolCall.name}'`)
      ctx.logger.info('tool denied by permission policy', { tool: ctx.toolCall.name, reason: decision.reason })
    }
  }
}
