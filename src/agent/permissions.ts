import type { PermissionsConfig, PermissionFieldRule } from '../config/types'
import type { ToolExecutionContext, Middleware } from './types'

/** Check a field value against deny/allow regex lists. Returns a denial reason or undefined. */
function checkField(tool: string, field: string, value: string, rule: PermissionFieldRule): string | undefined {
  for (const pattern of rule.deny ?? []) {
    if (new RegExp(pattern).test(value)) return `Permission denied: '${tool}' field '${field}' matches deny rule /${pattern}/`
  }
  if (rule.allow?.length && !rule.allow.some(p => new RegExp(p).test(value))) {
    return `Permission denied: '${tool}' field '${field}' did not match any allow rule`
  }
}

/** Create a beforeToolExecution middleware that enforces permission rules. */
export function createPermissionsMiddleware(config: PermissionsConfig): Middleware<ToolExecutionContext> {
  if (config.no_rules_rules || !config.rules?.length) return async () => {}

  const defaultAction = config.default_action ?? 'allow'

  // Index rules by tool name
  const rulesByTool = new Map<string, typeof config.rules>()
  for (const rule of config.rules) {
    const list = rulesByTool.get(rule.tool)
    if (list) list.push(rule)
    else rulesByTool.set(rule.tool, [rule])
  }

  return async (ctx) => {
    const { name, arguments: args } = ctx.toolCall
    const toolRules = rulesByTool.get(name)

    if (!toolRules) {
      if (defaultAction === 'deny') ctx.deny(`Permission denied: no rules configured for tool '${name}' and default_action is 'deny'`)
      return
    }

    let input: Record<string, unknown>
    try { input = JSON.parse(args || '{}') } catch { input = {} }

    for (const rule of toolRules) {
      for (const [key, fieldRule] of Object.entries(rule)) {
        if (key === 'tool' || !fieldRule || typeof fieldRule !== 'object' || Array.isArray(fieldRule)) continue
        const val = input[key]
        if (val == null) continue
        const reason = checkField(name, key, typeof val === 'string' ? val : JSON.stringify(val), fieldRule as PermissionFieldRule)
        if (reason) { ctx.deny(reason); return }
      }
    }
  }
}
