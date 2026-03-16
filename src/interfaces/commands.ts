import { errorMessage } from '../utils/errors'
import { resolve } from 'path'
import type { SkillCommand } from './parse-args'
import type { IMessage } from '../providers/types'
import type { MemoryStore } from '../memory'
import type { RaConfig } from '../config/types'
import type { MiddlewareConfig } from '../agent/types'
import type { PermissionFieldRule } from '../config/types'
import type { Skill } from '../skills/types'
import { VALID_HOOKS } from '../middleware/loader'
import { extractContextFilePath } from '../context'

/** Run --exec <script> */
export async function runExecScript(scriptPath: string): Promise<void> {
  const mod = await import(resolve(scriptPath))
  if (typeof mod.default === 'function') {
    const result = await mod.default()
    if (result !== undefined) {
      console.log(typeof result === 'string' ? result : JSON.stringify(result))
    }
  }
}

/** Handle `ra skill install|remove|list` subcommands. Exits the process. */
export async function runSkillCommand(cmd: SkillCommand): Promise<void> {
  const { installSkill, removeSkill, listInstalledSkills, defaultSkillInstallDir } = await import('../skills/registry')
  const { action, args } = cmd

  switch (action) {
    case 'install': {
      if (args.length === 0) {
        console.error('Usage: ra skill install <source>')
        process.exit(1)
      }
      for (const source of args) {
        try {
          const installed = await installSkill(source)
          console.log(`Installed skills: ${installed.join(', ')} → ${defaultSkillInstallDir()}`)
        } catch (err) {
          console.error(`Failed to install "${source}": ${errorMessage(err)}`)
          process.exit(1)
        }
      }
      process.exit(0)
    }
    case 'remove': {
      if (args.length === 0) {
        console.error('Usage: ra skill remove <name>')
        process.exit(1)
      }
      for (const name of args) {
        try {
          await removeSkill(name)
          console.log(`Removed skill: ${name}`)
        } catch (err) {
          console.error(`Failed to remove "${name}": ${errorMessage(err)}`)
          process.exit(1)
        }
      }
      process.exit(0)
    }
    case 'list': {
      const skills = await listInstalledSkills()
      if (skills.length === 0) {
        console.log(`No skills installed in ${defaultSkillInstallDir()}`)
      } else {
        for (const s of skills) {
          const src = s.source
            ? ` (${s.source.registry}${s.source.package ? ': ' + s.source.package : ''}${s.source.repo ? ': ' + s.source.repo : ''}${s.source.version ? '@' + s.source.version : ''})`
            : ''
          console.log(`  ${s.name}${src}`)
        }
      }
      process.exit(0)
    }
  }
}

/** Handle --show-context */
export function showContext(contextMessages: IMessage[]): void {
  if (contextMessages.length === 0) {
    console.log('No context files discovered.')
  } else {
    for (const msg of contextMessages) {
      console.log(typeof msg.content === 'string' ? msg.content : '')
      console.log()
    }
  }
}

/** Handle --list-memories, --memories, --forget */
export function runMemoryCommand(
  memoryStore: MemoryStore | undefined,
  opts: { list?: boolean; search?: string; forget?: string },
): void {
  if (!memoryStore) {
    console.log('Memory is not enabled. Use --memory or set memory.enabled in config.')
    return
  }

  if (opts.forget !== undefined) {
    if (!opts.forget) {
      console.log('Usage: ra --forget "search query"')
    } else {
      const deleted = memoryStore.forget(opts.forget, 1000)
      console.log(deleted > 0 ? `Forgot ${deleted} memory(s).` : 'No matching memories found.')
    }
    return
  }

  const query = opts.search || ''
  const memories = query ? memoryStore.search(query, 100) : memoryStore.list(100)
  if (memories.length === 0) {
    console.log(query ? 'No matching memories found.' : 'No memories stored.')
  } else {
    const total = memoryStore.count()
    console.log(query
      ? `${memories.length} matching memories (${total} total):\n`
      : `${memories.length} memories (${total} total):\n`)
    for (const m of memories) {
      console.log(`  [${m.id}] [${m.tags || 'general'}] ${m.content}`)
    }
  }
}

/** Info gathered by lightweight dry-run bootstrap (no provider, MCP, sessions, or observability). */
export interface DryRunInfo {
  config: RaConfig
  toolNames: string[]
  middleware: Partial<MiddlewareConfig>
  skillMap: Map<string, Skill>
  contextMessages: IMessage[]
}

/** Lightweight bootstrap for --dry-run-config. Skips provider, MCP, sessions, memory, and observability. */
export async function bootstrapDryRun(config: RaConfig): Promise<DryRunInfo> {
  const { discoverContextFiles, buildContextMessages } = await import('../context')
  const { loadMiddleware } = await import('../middleware/loader')
  const { loadSkills } = await import('../skills/loader')
  const { loadBuiltinSkills } = await import('../skills/builtin')
  const { ToolRegistry } = await import('../agent/tool-registry')
  const { registerBuiltinTools } = await import('../tools')
  const { resolvePath } = await import('../utils/paths')

  const contextFiles = config.context.enabled
    ? await discoverContextFiles({ cwd: process.cwd(), patterns: config.context.patterns })
    : []
  const contextMessages = buildContextMessages(contextFiles)

  const middleware = await loadMiddleware(config, config.configDir)

  const tools = new ToolRegistry()
  if (config.builtinTools) registerBuiltinTools(tools)
  const toolNames = tools.all().map(t => t.name)

  const resolvedSkillDirs = config.skillDirs.map(d => resolvePath(d, config.configDir))
  const skillMap = await loadSkills(resolvedSkillDirs)
  const builtinSkills = loadBuiltinSkills(config.builtinSkills)
  for (const [name, skill] of builtinSkills) {
    if (!skillMap.has(name)) skillMap.set(name, skill)
  }

  return { config, toolNames, middleware, skillMap, contextMessages }
}

/** Handle --dry-run-config */
export function showDryRunConfig(info: DryRunInfo): void {
  const { config, toolNames, middleware, skillMap, contextMessages } = info
  const lines: string[] = []

  const section = (title: string) => { lines.push(''); lines.push(`── ${title} ${'─'.repeat(Math.max(0, 56 - title.length))}`) }
  const field = (label: string, value: unknown) => {
    if (value === undefined || value === null || value === '') return
    lines.push(`  ${label.padEnd(28)} ${String(value)}`)
  }

  lines.push('ra — resolved configuration')

  // ── Core ──
  section('Core')
  field('provider', config.provider)
  field('model', config.model)
  field('interface', config.interface)
  field('maxIterations', config.maxIterations)
  field('toolTimeout', `${config.toolTimeout}ms`)
  field('builtinTools', config.builtinTools)
  field('maxConcurrency', config.maxConcurrency)
  field('thinking', config.thinking ?? 'off')
  if (config.systemPrompt) {
    const preview = config.systemPrompt.length > 80
      ? config.systemPrompt.slice(0, 77) + '...'
      : config.systemPrompt
    field('systemPrompt', preview)
  }

  // ── Paths ──
  section('Paths')
  field('configDir', config.configDir)
  field('dataDir', config.dataDir)

  // ── Context ──
  section('Context')
  field('context.enabled', config.context.enabled)
  if (config.context.patterns.length > 0) {
    field('context.patterns', config.context.patterns.join(', '))
  }
  if (config.context.resolvers?.length) {
    for (const r of config.context.resolvers) {
      field(`  resolver: ${r.name}`, r.enabled ? 'enabled' : 'disabled')
    }
  }
  if (contextMessages.length > 0) {
    lines.push('')
    lines.push('  Discovered context files:')
    for (const msg of contextMessages) {
      const path = extractContextFilePath(msg)
      if (path) lines.push(`    - ${path}`)
    }
  } else {
    lines.push('  No context files discovered.')
  }

  // ── Middleware ──
  section('Middleware')
  const configMw = config.middleware ?? {}
  let hasMiddleware = false
  for (const hook of VALID_HOOKS) {
    const loaded = middleware[hook]
    const sources = configMw[hook]
    if (loaded?.length || sources?.length) {
      const parts = [`${loaded?.length ?? 0} hook(s)`]
      if (sources?.length) parts.push(`from: ${sources.join(', ')}`)
      field(hook, parts.join(' '))
      hasMiddleware = true
    }
  }
  if (!hasMiddleware) lines.push('  No middleware configured.')

  // ── Tools ──
  section('Tools')
  if (toolNames.length > 0) {
    field('total', toolNames.length)
    if (config.mcp.client?.length) {
      lines.push('  (MCP tools not shown in dry-run)')
    }
    let line = '  '
    for (const name of toolNames) {
      if (line.length + name.length + 2 > 80 && line.length > 2) {
        lines.push(line)
        line = '  '
      }
      line += (line.length > 2 ? ', ' : '') + name
    }
    if (line.length > 2) lines.push(line)
  } else {
    lines.push('  No tools registered.')
  }

  // ── Skills ──
  section('Skills')
  if (config.skills.length > 0) {
    field('active skills', config.skills.join(', '))
  }
  if (config.skillDirs.length > 0) {
    field('skillDirs', config.skillDirs.join(', '))
  }
  if (skillMap.size > 0) {
    lines.push('')
    lines.push('  Available skills:')
    for (const [name, skill] of skillMap) {
      const desc = skill.metadata?.description
      lines.push(`    - ${name}${desc ? `: ${desc}` : ''}`)
    }
  } else {
    lines.push('  No skills loaded.')
  }

  // ── Compaction ──
  section('Compaction')
  field('enabled', config.compaction.enabled)
  if (config.compaction.enabled) {
    field('threshold', config.compaction.threshold)
    field('model', config.compaction.model ?? 'provider default')
    if (config.compaction.maxTokens) field('maxTokens', config.compaction.maxTokens)
    if (config.compaction.contextWindow) field('contextWindow', config.compaction.contextWindow)
  }

  // ── Memory ──
  section('Memory')
  field('enabled', config.memory.enabled)
  if (config.memory.enabled) {
    field('maxMemories', config.memory.maxMemories)
    field('ttlDays', config.memory.ttlDays)
    field('injectLimit', config.memory.injectLimit)
  }

  // ── Storage ──
  section('Storage')
  field('format', config.storage.format)
  field('maxSessions', config.storage.maxSessions)
  field('ttlDays', config.storage.ttlDays)

  // ── MCP ──
  section('MCP')
  field('lazySchemas', config.mcp.lazySchemas)
  if (config.mcp.client?.length) {
    lines.push('')
    lines.push('  Client connections:')
    for (const c of config.mcp.client) {
      field(`  ${c.name}`, `${c.transport}${c.command ? ` → ${c.command} ${(c.args ?? []).join(' ')}` : ''}${c.url ? ` → ${c.url}` : ''}`)
    }
  }
  if (config.mcp.server?.enabled) {
    lines.push('')
    lines.push('  Server:')
    field('  port', config.mcp.server.port)
    field('  tool.name', config.mcp.server.tool.name)
  }

  // ── HTTP ──
  section('HTTP')
  field('port', config.http.port)
  field('token', config.http.token ? '***' : 'none')

  // ── Permissions ──
  section('Permissions')
  field('default_action', config.permissions.default_action ?? 'allow')
  field('no_rules_rules', config.permissions.no_rules_rules ?? false)
  if (config.permissions.rules?.length) {
    lines.push('')
    lines.push('  Rules:')
    for (const rule of config.permissions.rules) {
      lines.push(`    - tool: ${rule.tool}`)
      for (const [key, val] of Object.entries(rule)) {
        if (key === 'tool') continue
        const fieldRule = val as PermissionFieldRule
        if (fieldRule?.allow) lines.push(`      ${key}.allow: ${JSON.stringify(fieldRule.allow)}`)
        if (fieldRule?.deny) lines.push(`      ${key}.deny: ${JSON.stringify(fieldRule.deny)}`)
      }
    }
  }

  // ── Observability ──
  section('Observability')
  field('logsEnabled', config.logsEnabled)
  field('logLevel', config.logLevel)
  field('tracesEnabled', config.tracesEnabled)

  console.log(lines.join('\n'))
}
