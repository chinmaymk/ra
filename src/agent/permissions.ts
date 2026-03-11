import type { PermissionsConfig, PermissionRule, PermissionFieldRule } from '../config/types'
import type { ToolExecutionContext, Middleware } from './types'

/**
 * Evaluate a single field value against a field rule.
 * Returns { allowed: true } or { allowed: false, reason: string }.
 */
function evaluateFieldRule(
  toolName: string,
  fieldName: string,
  value: string,
  rule: PermissionFieldRule,
): { allowed: true } | { allowed: false; reason: string } {
  // Deny takes priority — if any deny regex matches, block immediately
  if (rule.deny) {
    for (const pattern of rule.deny) {
      if (new RegExp(pattern).test(value)) {
        return {
          allowed: false,
          reason: `Permission denied: '${toolName}' field '${fieldName}' matches deny rule /${pattern}/`,
        }
      }
    }
  }

  // If allow list exists, at least one must match
  if (rule.allow && rule.allow.length > 0) {
    const matched = rule.allow.some(pattern => new RegExp(pattern).test(value))
    if (!matched) {
      return {
        allowed: false,
        reason: `Permission denied: '${toolName}' field '${fieldName}' did not match any allow rule`,
      }
    }
  }

  return { allowed: true }
}

/**
 * Normalize a permission rule entry. In config, users write:
 *
 *   - tool: execute_bash
 *     command:
 *       allow: ["^git "]
 *       deny: ["--force"]
 *
 * The `tool` key is the tool name, every other key is a field name → PermissionFieldRule.
 */
function getFieldRules(rule: PermissionRule): Map<string, PermissionFieldRule> {
  const fields = new Map<string, PermissionFieldRule>()
  for (const [key, value] of Object.entries(rule)) {
    if (key === 'tool') continue
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      fields.set(key, value as PermissionFieldRule)
    }
  }
  return fields
}

/**
 * Create a beforeToolExecution middleware that enforces permission rules.
 *
 * Evaluation order per tool call:
 * 1. If `no_rules` is true → allow everything
 * 2. Find all rules matching this tool name
 * 3. For each rule, check each field rule against the parsed tool input
 * 4. Deny takes priority: if any deny regex matches → deny
 * 5. If allow list exists and nothing matches → deny
 * 6. If no rules match this tool → fall through to `default_action`
 */
export function createPermissionsMiddleware(config: PermissionsConfig): Middleware<ToolExecutionContext> {
  // Short-circuit: no_rules means allow everything
  if (config.no_rules) {
    return async () => {}
  }

  const rules = config.rules ?? []
  if (rules.length === 0) {
    return async () => {}
  }

  const defaultAction = config.default_action ?? 'allow'

  // Pre-index rules by tool name for fast lookup
  const rulesByTool = new Map<string, PermissionRule[]>()
  for (const rule of rules) {
    const existing = rulesByTool.get(rule.tool)
    if (existing) {
      existing.push(rule)
    } else {
      rulesByTool.set(rule.tool, [rule])
    }
  }

  return async (ctx: ToolExecutionContext) => {
    const { toolCall } = ctx
    const toolRules = rulesByTool.get(toolCall.name)

    // No rules for this tool — use default action
    if (!toolRules || toolRules.length === 0) {
      if (defaultAction === 'deny') {
        ctx.deny(`Permission denied: no rules configured for tool '${toolCall.name}' and default_action is 'deny'`)
      }
      return
    }

    // Parse tool input
    let input: Record<string, unknown>
    try {
      input = JSON.parse(toolCall.arguments || '{}')
    } catch {
      input = {}
    }

    // Evaluate each rule for this tool
    for (const rule of toolRules) {
      const fieldRules = getFieldRules(rule)
      for (const [fieldName, fieldRule] of fieldRules) {
        const fieldValue = input[fieldName]
        if (fieldValue === undefined || fieldValue === null) continue
        const valueStr = typeof fieldValue === 'string' ? fieldValue : JSON.stringify(fieldValue)
        const result = evaluateFieldRule(toolCall.name, fieldName, valueStr, fieldRule)
        if (!result.allowed) {
          ctx.deny(result.reason)
          return
        }
      }
    }
  }
}
