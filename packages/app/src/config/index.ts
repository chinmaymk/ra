import { join, dirname, isAbsolute } from 'path'
import yaml from 'js-yaml'
import { parse as parseToml } from 'smol-toml'
import { resolvePath, looksLikePath, homeDir, configHandle } from '../utils/paths'
import { interpolateEnvVars, coerceTypes } from '../utils/config-helpers'
import { defaultConfig } from './defaults'
import { CONFIG_FILES } from '../registry/helpers'
import { NoopLogger } from '@chinmaymk/ra'
import type { Logger } from '@chinmaymk/ra'
import type { RaConfig, LoadConfigOptions } from './types'

export { defaultConfig } from './defaults'
export { toolOption, allToolOptions } from './types'
export type {
  RaConfig, LoadConfigOptions, McpServerEntry, McpConfig, RaMcpServerConfig,
  PermissionsConfig, PermissionRule, PermissionFieldRule,
  ToolsConfig, ToolSettings, AppConfig, AgentConfig, CronJob,
} from './types'

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    result[key] = isPlainObject(source[key]) && isPlainObject(target[key])
      ? deepMerge(target[key], source[key])
      : source[key]
  }
  return result
}

async function loadConfigFile(cwd: string, configPath?: string): Promise<{ config: Partial<RaConfig>; filePath?: string }> {
  if (configPath) {
    const full = isAbsolute(configPath) ? configPath : join(cwd, configPath)
    if (await Bun.file(full).exists()) return { config: await parseFile(full), filePath: full }
    return { config: {} }
  }
  let dir = cwd
  while (true) {
    for (const name of CONFIG_FILES) {
      const full = join(dir, name)
      if (await Bun.file(full).exists()) return { config: await parseFile(full), filePath: full }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return { config: {} }
}

/** Error thrown when a config file has issues (parse errors, invalid values). */
export class ConfigError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message)
    this.name = 'ConfigError'
    if (options?.cause) this.cause = options.cause
  }
}

async function parseFile(path: string): Promise<Partial<RaConfig>> {
  let content: string
  try {
    content = await Bun.file(path).text()
  } catch (err) {
    throw new ConfigError(`Cannot read config file: ${path}`, { cause: err })
  }
  if (!content.trim()) {
    throw new ConfigError(`Config file is empty: ${path}`)
  }
  try {
    if (path.endsWith('.json')) return JSON.parse(content) as Partial<RaConfig>
    if (path.endsWith('.yaml') || path.endsWith('.yml')) return yaml.load(content) as Partial<RaConfig>
    if (path.endsWith('.toml')) return parseToml(content) as Partial<RaConfig>
  } catch (err) {
    const format = path.endsWith('.json') ? 'JSON' : path.endsWith('.toml') ? 'TOML' : 'YAML'
    const detail = err instanceof Error ? err.message : String(err)
    throw new ConfigError(`Invalid ${format} in config file ${path}:\n  ${detail}`, { cause: err })
  }
  return {}
}

/**
 * Detect config shapes from older ra releases and throw a clear migration
 * error. We no longer silently migrate — the number of paths made the loader
 * confusing and the canonical shape is now simple enough that users should
 * just use it directly.
 */
function rejectLegacyShapes(raw: Record<string, unknown>): void {
  const errors: string[] = []

  // Top-level flat keys (before the app/agent split)
  for (const key of ['provider', 'model', 'systemPrompt', 'maxIterations', 'thinking', 'tools', 'skillDirs', 'permissions', 'middleware', 'context', 'compaction', 'memory', 'mcpServers', 'interface', 'http', 'storage', 'providers', 'logsEnabled']) {
    if (key in raw) {
      errors.push(`Top-level "${key}" is no longer supported — move it under "app:" or "agent:" (e.g. agent.${key}).`)
      break // one is enough to illustrate the point
    }
  }

  const app = raw.app
  if (isPlainObject(app)) {
    // Legacy MCP at the app level
    if ('mcpServers' in app) errors.push('"app.mcpServers" is now "app.mcp.servers".')
    if ('mcpLazySchemas' in app) errors.push('"app.mcpLazySchemas" is now "app.mcp.lazySchemas".')
    if ('raMcpServer' in app) errors.push('"app.raMcpServer" is now "app.mcp.server".')
    if ('mcpServer' in app) errors.push('"app.mcpServer" is now "app.mcp.server".')
    if (isPlainObject(app.mcp) && ('client' in app.mcp || 'lazySchemas' in app.mcp)) {
      // Only flag the old `client` key; `lazySchemas` and `server` under `app.mcp` ARE the canonical shape
      if ('client' in app.mcp) errors.push('"app.mcp.client" is now "app.mcp.servers".')
    }
    if ('skillDirs' in app) errors.push('"app.skillDirs" belongs under "agent.skillDirs".')
    if ('permissions' in app) errors.push('"app.permissions" belongs under "agent.permissions".')
  }

  const agent = raw.agent
  if (isPlainObject(agent)) {
    if ('builtinTools' in agent) errors.push('"agent.builtinTools" is now "agent.tools.builtin".')
    if ('hotReload' in agent) errors.push('"agent.hotReload" is now "app.hotReload".')
    if (isPlainObject(agent.tools)) {
      const tools = agent.tools
      if ('overrides' in tools) {
        errors.push(
          '"agent.tools.overrides" has been flattened — per-tool settings now sit directly under "agent.tools", e.g.\n' +
          '      agent:\n' +
          '        tools:\n' +
          '          builtin: true\n' +
          '          Read: { rootDir: "./src" }\n' +
          '          WebFetch: { enabled: false }'
        )
      }
    }
    if (isPlainObject(agent.mcp)) errors.push('"agent.mcp" is now "app.mcp".')
    if (isPlainObject(agent.permissions)) {
      const p = agent.permissions
      if ('no_rules_rules' in p) errors.push('"agent.permissions.no_rules_rules" is now "agent.permissions.disabled".')
      if ('default_action' in p) errors.push('"agent.permissions.default_action" is now "agent.permissions.defaultAction".')
    }
  }

  // Legacy cron: cron[].agent: string | Partial<AgentConfig>
  if (Array.isArray(raw.cron)) {
    for (let i = 0; i < raw.cron.length; i++) {
      const job = raw.cron[i]
      if (isPlainObject(job) && 'agent' in job) {
        errors.push(`"cron[${i}].agent" is now "cron[${i}].recipe" (string path) or "cron[${i}].overrides" (inline Partial<AgentConfig>).`)
        break
      }
    }
  }

  if (errors.length > 0) {
    throw new ConfigError(
      'Your config uses keys from an older ra release. Update to the current shape:\n  ' +
      errors.join('\n  '),
    )
  }
}

// ── Recipe resolution helpers ───────────────────────────────────────

/** Check if a string looks like a local path (not an owner/repo name). */
function looksLikeLocalPath(value: string): boolean {
  return /^(\.\.?[/\\]|[/\\]|~[/\\]|[A-Za-z]:[/\\])/.test(value)
}

/** Resolve a recipe config file from an installed name or local path. */
async function resolveRecipe(nameOrPath: string, cwd: string): Promise<{ configPath: string; recipeDir: string } | null> {
  if (looksLikeLocalPath(nameOrPath)) {
    const resolved = resolvePath(nameOrPath, cwd)
    for (const name of CONFIG_FILES) {
      const full = join(resolved, name)
      if (await Bun.file(full).exists()) return { configPath: full, recipeDir: resolved }
    }
    return null
  }
  const { resolveRecipePath } = await import('../recipes/registry')
  const configPath = await resolveRecipePath(nameOrPath)
  return configPath ? { configPath, recipeDir: dirname(configPath) } : null
}

/** Pre-resolve a recipe's relative paths against its directory so they survive merging. */
function preResolveRecipePaths(agent: Record<string, unknown>, recipeDir: string): void {
  if (Array.isArray(agent.skillDirs)) {
    agent.skillDirs = (agent.skillDirs as string[]).map(d => resolvePath(d, recipeDir))
  }
  if (typeof agent.systemPrompt === 'string' && looksLikePath(agent.systemPrompt, ['.txt', '.md'])) {
    agent.systemPrompt = resolvePath(agent.systemPrompt, recipeDir)
  }
  if (isPlainObject(agent.middleware)) {
    const mw = agent.middleware as Record<string, unknown>
    for (const [hook, entries] of Object.entries(mw)) {
      if (Array.isArray(entries)) {
        mw[hook] = (entries as string[]).map(e => looksLikePath(e) ? resolvePath(e, recipeDir) : e)
      }
    }
  }
  // Pre-resolve custom tool file paths
  if (isPlainObject(agent.tools)) {
    const tools = agent.tools as Record<string, unknown>
    if (Array.isArray(tools.custom)) {
      tools.custom = (tools.custom as string[]).map(e => looksLikePath(e) ? resolvePath(e, recipeDir) : e)
    }
  }
}

/** Saved recipe arrays to prepend after all merges complete. */
interface RecipeArrays {
  skillDirs: string[]
  middleware: Record<string, string[]>
  customTools: string[]
}

/**
 * Extract array fields from a recipe config so they can be prepended after
 * the deep-merge. We also delete them from the recipe layer to avoid double
 * inclusion (deepMerge would otherwise carry them through, and then
 * prependRecipeArrays would add them a second time).
 */
function extractRecipeArrays(config: Record<string, unknown>): RecipeArrays {
  const result: RecipeArrays = { skillDirs: [], middleware: {}, customTools: [] }
  const agent = (config.agent ?? {}) as Record<string, unknown>
  if (Array.isArray(agent.skillDirs)) {
    result.skillDirs = agent.skillDirs as string[]
    delete agent.skillDirs
  }
  if (isPlainObject(agent.middleware)) {
    const mw = agent.middleware as Record<string, unknown>
    for (const [hook, entries] of Object.entries(mw)) {
      if (Array.isArray(entries)) {
        result.middleware[hook] = entries as string[]
        delete mw[hook]
      }
    }
  }
  if (isPlainObject(agent.tools)) {
    const tools = agent.tools as Record<string, unknown>
    if (Array.isArray(tools.custom)) {
      result.customTools = tools.custom as string[]
      delete tools.custom
    }
  }
  return result
}

/** Prepend recipe arrays to the final merged config. */
function prependRecipeArrays(config: RaConfig, arrays: RecipeArrays): void {
  if (arrays.skillDirs.length > 0) {
    config.agent.skillDirs = [...arrays.skillDirs, ...config.agent.skillDirs]
  }
  for (const [hook, entries] of Object.entries(arrays.middleware)) {
    const existing = config.agent.middleware[hook] ?? []
    config.agent.middleware[hook] = [...entries, ...existing]
  }
  if (arrays.customTools.length > 0) {
    const existing = config.agent.tools.custom ?? []
    config.agent.tools.custom = [...arrays.customTools, ...existing]
  }
}

// ── Main config loader ──────────────────────────────────────────────

export interface LoadConfigResult {
  config: RaConfig
  /** Absolute path to the config file that was loaded, if any. */
  filePath: string | undefined
  /** Absolute path to the system prompt file, if systemPrompt was loaded from a file. */
  systemPromptPath: string | undefined
}

/** Load config, returning just the RaConfig (backward-compatible). */
export async function loadConfig(options: LoadConfigOptions = {}, logger?: Logger): Promise<RaConfig> {
  return (await loadConfigWithPath(options, logger)).config
}

/** Load config, returning both the resolved config and the file path it was loaded from. */
export async function loadConfigWithPath(options: LoadConfigOptions = {}, logger?: Logger): Promise<LoadConfigResult> {
  const log = logger ?? new NoopLogger()
  const cwd = options.cwd ?? process.cwd()
  const env = (options.env ?? process.env) as Record<string, string | undefined>

  const { config: rawFileConfig, filePath: configFilePath } = await loadConfigFile(cwd, options.configPath)
  const configDir = configFilePath ? dirname(configFilePath) : cwd

  if (configFilePath) {
    log.info('config file loaded', { path: configFilePath })
  } else {
    log.debug('no config file found', { cwd, searchedFiles: CONFIG_FILES })
  }

  const rawDefaults = JSON.parse(JSON.stringify(defaultConfig))
  const fileConfig = interpolateEnvVars(rawFileConfig, env) as Record<string, unknown>
  const cliArgs = (options.cliArgs ?? {}) as Record<string, unknown>

  // Reject legacy shapes with clear migration errors (before merge/coerce)
  rejectLegacyShapes(fileConfig)
  rejectLegacyShapes(cliArgs)

  // Coerce interpolated strings against the default schema (e.g. "50" → 50)
  const coercedFileConfig = coerceTypes(fileConfig, rawDefaults) as Record<string, unknown>

  // ── Recipe resolution ────────────────────────────────────────────
  // Recipe source: --recipe flag takes priority, then agent.recipe in config file
  const recipeName = options.recipeName
    ?? (isPlainObject(coercedFileConfig.agent) ? (coercedFileConfig.agent as Record<string, unknown>).recipe as string | undefined : undefined)

  let recipeArrays: RecipeArrays | undefined
  let recipeLayer: Record<string, unknown> | undefined
  if (recipeName) {
    const resolved = await resolveRecipe(recipeName, cwd)
    if (!resolved) {
      throw new Error(`Recipe not found: "${recipeName}". Install it with: ra recipe install <source>`)
    }
    const recipeRaw = await parseFile(resolved.configPath)
    const recipeConfig = interpolateEnvVars(recipeRaw, env) as Record<string, unknown>

    // Recipes must only define agent configuration — reject app stanza
    if (recipeConfig.app !== undefined) {
      throw new Error(`Recipe "${recipeName}" contains an "app" stanza. Recipes may only define "agent" configuration.`)
    }

    rejectLegacyShapes(recipeConfig)

    // Pre-resolve recipe paths against its directory
    const recipeAgent = (recipeConfig.agent ?? {}) as Record<string, unknown>
    preResolveRecipePaths(recipeAgent, resolved.recipeDir)

    // Save array fields before deepMerge destroys them
    recipeArrays = extractRecipeArrays(recipeConfig)

    recipeLayer = recipeConfig

    // Strip recipe key from file config so it doesn't leak into final output
    if (isPlainObject(coercedFileConfig.agent)) {
      delete (coercedFileConfig.agent as Record<string, unknown>).recipe
    }

    log.info('recipe loaded', { recipe: recipeName, path: resolved.configPath })
  }

  // defaults < recipe < file < CLI
  const defaults = interpolateEnvVars(rawDefaults, env) as Record<string, unknown>
  const layers = recipeLayer
    ? [recipeLayer, coercedFileConfig, cliArgs]
    : [coercedFileConfig, cliArgs]
  const merged = layers.reduce((acc, layer) => deepMerge(acc, layer), defaults)

  const config = merged as unknown as RaConfig
  config.app.configDir = configDir

  // Resolve dataDir: empty default → centralized ~/.ra/<handle>/, explicit → relative to configDir
  if (config.app.dataDir === '') {
    config.app.dataDir = join(homeDir(), '.ra', configHandle(configDir))
  } else {
    config.app.dataDir = resolvePath(config.app.dataDir, configDir)
  }

  // Prepend recipe arrays (they were lost during deepMerge)
  if (recipeArrays) prependRecipeArrays(config, recipeArrays)

  // Strip recipe from final config (it's a loading-time directive)
  delete config.agent.recipe

  // Only try loading systemPrompt as a file if it looks like a path
  let systemPromptPath: string | undefined
  if (config.agent.systemPrompt && looksLikePath(config.agent.systemPrompt, ['.txt', '.md'])) {
    const resolved = resolvePath(config.agent.systemPrompt, configDir)
    const f = Bun.file(resolved)
    if (await f.exists()) {
      systemPromptPath = resolved
      config.agent.systemPrompt = await f.text()
      log.debug('system prompt loaded from file', { path: resolved })
    }
  }

  validateConfig(config)

  log.debug('config resolved', { provider: config.agent.provider, model: config.agent.model, interface: config.app.interface })
  return { config, filePath: configFilePath, systemPromptPath }
}

const VALID_PROVIDERS = new Set<string>([
  'anthropic', 'openai', 'openai-completions', 'google', 'ollama', 'bedrock', 'azure', 'codex', 'anthropic-agents-sdk',
])

const VALID_INTERFACES = new Set<string>([
  'cli', 'repl', 'http', 'mcp', 'mcp-stdio', 'inspector', 'cron',
])

function validateConfig(config: RaConfig): void {
  const errors: string[] = []

  // Provider
  if (!config.agent.provider) {
    errors.push('agent.provider is required (e.g. "anthropic", "openai", "google")')
  } else if (!VALID_PROVIDERS.has(config.agent.provider)) {
    errors.push(`agent.provider "${config.agent.provider}" is not a valid provider. Valid options: ${[...VALID_PROVIDERS].join(', ')}`)
  }

  // Model
  if (!config.agent.model) {
    errors.push('agent.model is required (e.g. "claude-sonnet-4-6", "gpt-4o")')
  }

  // Interface
  if (config.app.interface && !VALID_INTERFACES.has(config.app.interface)) {
    errors.push(`app.interface "${config.app.interface}" is not valid. Valid options: ${[...VALID_INTERFACES].join(', ')}`)
  }

  // Numeric ranges
  if (typeof config.agent.maxIterations === 'number' && config.agent.maxIterations < 0) {
    errors.push('agent.maxIterations must be 0 (unlimited) or a positive number')
  }
  if (typeof config.agent.maxRetries === 'number' && config.agent.maxRetries < 0) {
    errors.push('agent.maxRetries must be 0 or a positive number')
  }
  if (typeof config.agent.toolTimeout === 'number' && config.agent.toolTimeout < 0) {
    errors.push('agent.toolTimeout must be 0 (unlimited) or a positive number of milliseconds')
  }

  // Compaction threshold
  const threshold = config.agent.compaction?.threshold
  if (typeof threshold === 'number' && (threshold <= 0 || threshold > 1)) {
    errors.push('agent.compaction.threshold must be between 0 and 1 (e.g. 0.9 = 90% of context window)')
  }

  // HTTP port
  if (typeof config.app.http?.port === 'number' && (config.app.http.port < 0 || config.app.http.port > 65535)) {
    errors.push('app.http.port must be between 0 and 65535')
  }

  // MCP servers
  if (Array.isArray(config.app.mcp?.servers)) {
    for (let i = 0; i < config.app.mcp.servers.length; i++) {
      const entry = config.app.mcp.servers[i]
      if (!entry) continue
      if (!entry.name) errors.push(`app.mcp.servers[${i}].name is required`)
      if (!entry.transport) errors.push(`app.mcp.servers[${i}].transport is required ("stdio" or "sse")`)
      if (entry.transport === 'stdio' && !entry.command) errors.push(`app.mcp.servers[${i}].command is required for stdio transport`)
      if (entry.transport === 'sse' && !entry.url) errors.push(`app.mcp.servers[${i}].url is required for sse transport`)
    }
  }

  if (errors.length > 0) {
    throw new ConfigError(`Invalid configuration:\n  ${errors.join('\n  ')}`)
  }
}
