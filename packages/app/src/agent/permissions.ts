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

/**
 * Create a standalone permission check function for use outside the middleware chain.
 * Used by the anthropic-agents-sdk provider to check permissions in MCP handlers.
 */
export function checkToolPermissionFromConfig(config: PermissionsConfig): (toolName: string, toolInput: Record<string, unknown>) => Promise<string | undefined> {
  if (config.no_rules_rules || !config.rules?.length) return async () => undefined

  const defaultAction = config.default_action ?? 'allow'
  const rulesByTool = buildRulesIndex(config.rules)

  return async (toolName: string, toolInput: Record<string, unknown>) => {
    const toolRules = rulesByTool.get(toolName)
    if (!toolRules) {
      return defaultAction === 'deny'
        ? `Permission denied: no rules configured for tool '${toolName}' and default_action is 'deny'`
        : undefined
    }
    for (const rule of toolRules) {
      for (const [key, compiledRule] of rule.fields) {
        const val = toolInput[key]
        if (val == null) continue
        const reason = checkField(toolName, key, typeof val === 'string' ? val : JSON.stringify(val), compiledRule)
        if (reason) return reason
      }
    }
    return undefined
  }
}

/** Index rules by tool name and pre-compile field regexes. */
function buildRulesIndex(rules: { tool: string; [field: string]: unknown }[]) {
  const rulesByTool = new Map<string, Array<{ tool: string; fields: Map<string, CompiledFieldRule> }>>()
  for (const rule of rules) {
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
  return rulesByTool
}

/** Create a beforeToolExecution middleware that enforces permission rules. */
export function createPermissionsMiddleware(config: PermissionsConfig): Middleware<ToolExecutionContext> {
  if (config.no_rules_rules || !config.rules?.length) return async () => {}

  const defaultAction = config.default_action ?? 'allow'
  const rulesByTool = buildRulesIndex(config.rules)

  return async (ctx) => {
    const { name, arguments: args } = ctx.toolCall
    const toolRules = rulesByTool.get(name)

    if (!toolRules) {
      if (defaultAction === 'deny') {
        ctx.logger.info('tool denied by default action', { tool: name })
        ctx.deny(`Permission denied: no rules configured for tool '${name}' and default_action is 'deny'`)
      }
      return
    }

    let input: Record<string, unknown>
    try { input = JSON.parse(args || '{}') } catch { input = {} }

    for (const rule of toolRules) {
      for (const [key, compiledRule] of rule.fields) {
        const val = input[key]
        if (val == null) continue
        const reason = checkField(name, key, typeof val === 'string' ? val : JSON.stringify(val), compiledRule)
        if (reason) {
          ctx.logger.info('tool denied by permission rule', { tool: name, field: key, reason })
          ctx.deny(reason)
          return
        }
      }
    }
  }
}
