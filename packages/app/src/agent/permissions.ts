import type { PermissionsConfig, PermissionFieldRule } from '../config/types'
import type { ToolExecutionContext, Middleware } from '@chinmaymk/ra'

/** Pre-compiled field rule with RegExp objects instead of raw pattern strings. */
interface CompiledFieldRule {
  deny: { re: RegExp; pattern: string }[]
  allow: { re: RegExp }[]
}

/** Compile a field rule's pattern strings into RegExp objects once at startup. */
function compileFieldRule(rule: PermissionFieldRule): CompiledFieldRule {
  return {
    deny: (rule.deny ?? []).map(p => ({ re: new RegExp(p), pattern: p })),
    allow: (rule.allow ?? []).map(p => ({ re: new RegExp(p) })),
  }
}

/** Check a field value against pre-compiled deny/allow regex lists. Returns a denial reason or undefined. */
function checkField(tool: string, field: string, value: string, rule: CompiledFieldRule): string | undefined {
  for (const { re, pattern } of rule.deny) {
    if (re.test(value)) return `Permission denied: '${tool}' field '${field}' matches deny rule /${pattern}/`
  }
  if (rule.allow.length && !rule.allow.some(({ re }) => re.test(value))) {
    return `Permission denied: '${tool}' field '${field}' did not match any allow rule`
  }
}

/** Create a beforeToolExecution middleware that enforces permission rules. */
export function createPermissionsMiddleware(config: PermissionsConfig): Middleware<ToolExecutionContext> {
  if (config.no_rules_rules || !config.rules?.length) return async () => {}

  const defaultAction = config.default_action ?? 'allow'

  // Index rules by tool name and pre-compile field regexes
  const rulesByTool = new Map<string, Array<{ tool: string; fields: Map<string, CompiledFieldRule> }>>()
  for (const rule of config.rules) {
    const fields = new Map<string, CompiledFieldRule>()
    for (const [key, fieldRule] of Object.entries(rule)) {
      if (key === 'tool' || !fieldRule || typeof fieldRule !== 'object' || Array.isArray(fieldRule)) continue
      fields.set(key, compileFieldRule(fieldRule as PermissionFieldRule))
    }
    const entry = { tool: rule.tool, fields }
    const list = rulesByTool.get(rule.tool)
    if (list) list.push(entry)
    else rulesByTool.set(rule.tool, [entry])
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
      for (const [key, compiledRule] of rule.fields) {
        const val = input[key]
        if (val == null) continue
        const reason = checkField(name, key, typeof val === 'string' ? val : JSON.stringify(val), compiledRule)
        if (reason) { ctx.deny(reason); return }
      }
    }
  }
}
