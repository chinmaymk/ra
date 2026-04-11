import { join, dirname, isAbsolute } from 'path'
import yaml from 'js-yaml'
import { parse as parseToml } from 'smol-toml'
import { resolvePath, looksLikePath, homeDir, configHandle } from '../utils/paths'
import { interpolateEnvVars, coerceTypes } from '../utils/config-helpers'
import { defaultConfig } from './defaults'
import { CONFIG_FILES } from '../registry/helpers'
import { NoopLogger } from '@chinmaymk/ra'
import type { Logger } from '@chinmaymk/ra'
import type { RaConfig, LoadConfigOptions, ToolsConfig, ToolSettings } from './types'

export { defaultConfig } from './defaults'
export type { RaConfig, LoadConfigOptions, McpServerEntry, RaMcpServerConfig, PermissionsConfig, PermissionRule, PermissionFieldRule, ToolsConfig, ToolSettings, AppConfig, AgentConfig, CronJob } from './types'

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

// Keys that belong under `agent` when found at the top level (legacy flat config)
const AGENT_KEYS = new Set([
  'provider', 'model', 'thinking', 'systemPrompt',
  'maxIterations', 'maxRetries', 'toolTimeout', 'maxConcurrency',
  'tools', 'skillDirs', 'permissions',
  'middleware', 'context', 'compaction', 'memory', 'hotReload',
])

// Keys that belong under `app` when found at the top level (legacy flat config)
const APP_KEYS = new Set([
  'interface', 'dataDir', 'http', 'inspector', 'storage',
  'mcpServers', 'mcpLazySchemas', 'raMcpServer', 'providers',
  'logsEnabled', 'logLevel', 'tracesEnabled',
])

/** Move a value from `src[srcKey]` to `dst[dstKey]` if dst doesn't already have it. */
function migrateKey(src: Record<string, unknown>, srcKey: string, dst: Record<string, unknown>, dstKey: string, check: (v: unknown) => boolean = () => true): void {
  if (src[srcKey] !== undefined && check(src[srcKey]) && dst[dstKey] === undefined) {
    dst[dstKey] = src[srcKey]
    delete src[srcKey]
  }
}

/**
 * Normalize MCP config from legacy shapes into the canonical layout:
 *   `app.mcpServers`, `app.mcpLazySchemas`, `app.raMcpServer`
 *
 * Legacy paths handled:
 *   - `app.mcp.{client|servers}` → `app.mcpServers`
 *   - `app.mcp.server`           → `app.raMcpServer`
 *   - `app.mcp.lazySchemas`      → `app.mcpLazySchemas`
 *   - `app.mcpServer`            → `app.raMcpServer`
 *   - `agent.mcp.{servers|client}`→ `app.mcpServers`
 *   - `agent.mcp.lazySchemas`    → `app.mcpLazySchemas`
 */
function normalizeMcpConfig(raw: Record<string, unknown>): void {
  if (!isPlainObject(raw.app)) raw.app = {}
  const app = raw.app as Record<string, unknown>

  // Legacy: app.mcp: { client|servers, server, lazySchemas }
  if (isPlainObject(app.mcp)) {
    const mcp = app.mcp as Record<string, unknown>
    if (app.mcpServers === undefined) app.mcpServers = mcp.client ?? mcp.servers
    migrateKey(mcp, 'lazySchemas', app, 'mcpLazySchemas')
    migrateKey(mcp, 'server', app, 'raMcpServer', isPlainObject)
    delete app.mcp
  }

  // Legacy: app.mcpServer → app.raMcpServer
  migrateKey(app, 'mcpServer', app, 'raMcpServer', isPlainObject)

  // Legacy: agent.mcp.{servers|client} → app.mcpServers
  const agent = raw.agent as Record<string, unknown> | undefined
  if (isPlainObject(agent) && isPlainObject(agent.mcp)) {
    const agentMcp = agent.mcp as Record<string, unknown>
    if (app.mcpServers === undefined) app.mcpServers = agentMcp.servers ?? agentMcp.client
    migrateKey(agentMcp, 'lazySchemas', app, 'mcpLazySchemas')
    delete agent.mcp
  }
}

/** Migrate misplaced keys from `app` to `agent` (backward compat). */
function normalizeAppToAgentKeys(raw: Record<string, unknown>): void {
  if (!isPlainObject(raw.app)) return
  const app = raw.app as Record<string, unknown>
  if (!isPlainObject(raw.agent)) raw.agent = {}
  const agent = raw.agent as Record<string, unknown>

  migrateKey(app, 'skillDirs', agent, 'skillDirs')
  if (isPlainObject(app.permissions)) migrateKey(app, 'permissions', agent, 'permissions')
  delete app.skills // dead key
}

/**
 * Migrate legacy flat config keys into their `app`/`agent` sections.
 * Before the app/agent split, all keys lived at the top level.
 * This shim lets old configs (e.g. `provider: anthropic`) keep working.
 */
function normalizeFlatConfig(raw: Record<string, unknown>): void {
  for (const key of Object.keys(raw)) {
    if (AGENT_KEYS.has(key)) {
      if (!isPlainObject(raw.agent)) raw.agent = {}
      const agent = raw.agent as Record<string, unknown>
      if (!(key in agent)) {
        agent[key] = raw[key]
      } else if (isPlainObject(raw[key]) && isPlainObject(agent[key])) {
        agent[key] = deepMerge(raw[key] as Record<string, unknown>, agent[key] as Record<string, unknown>)
      }
      delete raw[key]
    } else if (APP_KEYS.has(key)) {
      if (!isPlainObject(raw.app)) raw.app = {}
      const app = raw.app as Record<string, unknown>
      if (!(key in app)) {
        app[key] = raw[key]
      } else if (isPlainObject(raw[key]) && isPlainObject(app[key])) {
        app[key] = deepMerge(raw[key] as Record<string, unknown>, app[key] as Record<string, unknown>)
      }
      delete raw[key]
    }
  }
}

/**
 * Normalize the `tools` config section. Supports three shapes:
 *   1. `builtinTools: true/false` (legacy boolean flag)
 *   2. Flat YAML: `tools: { builtin: true, Read: { rootDir: "." }, WebFetch: { enabled: false } }`
 *   3. Canonical: `tools: { builtin: true, overrides: { ... } }`
 * Converts everything into the canonical `{ builtin, overrides }` form.
 *
 * Handles both flat config (legacy) and nested agent.tools config.
 */
function normalizeToolsConfig(raw: Record<string, unknown>): void {
  // Check for nested agent.tools first
  const agent = raw.agent as Record<string, unknown> | undefined
  if (isPlainObject(agent)) {
    normalizeToolsSection(agent)
  }

  // Also handle flat layout (legacy / intermediate merge state)
  normalizeToolsSection(raw)
}

function normalizeToolsSection(obj: Record<string, unknown>): void {
  // Legacy: builtinTools boolean → tools.builtin
  if ('builtinTools' in obj) {
    if (!('tools' in obj)) {
      obj.tools = { builtin: !!obj.builtinTools, overrides: {} }
    }
    delete obj.builtinTools
  }

  if (!isPlainObject(obj.tools)) return
  const t = obj.tools
  // Already canonical form
  if (isPlainObject(t.overrides)) return

  // Flat form: extract builtin, treat other keys as per-tool overrides
  const builtin = t.builtin !== undefined ? !!t.builtin : true
  const maxResponseSize = typeof t.maxResponseSize === 'number' ? t.maxResponseSize : undefined
  const custom = Array.isArray(t.custom) ? t.custom as string[] : []
  const overrides: Record<string, ToolSettings> = {}
  for (const [key, val] of Object.entries(t)) {
    if (key === 'builtin' || key === 'overrides' || key === 'maxResponseSize' || key === 'custom') continue
    if (val === false) overrides[key] = { enabled: false }
    else if (isPlainObject(val)) overrides[key] = val as ToolSettings
  }
  obj.tools = { builtin, overrides, custom, ...(maxResponseSize !== undefined && { maxResponseSize }) }
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

/** Extract array fields from a recipe config (they'd be lost by deepMerge). */
function extractRecipeArrays(config: Record<string, unknown>): RecipeArrays {
  const result: RecipeArrays = { skillDirs: [], middleware: {}, customTools: [] }
  const agent = (config.agent ?? config) as Record<string, unknown>
  if (Array.isArray(agent.skillDirs)) result.skillDirs = agent.skillDirs as string[]
  if (isPlainObject(agent.middleware)) {
    for (const [hook, entries] of Object.entries(agent.middleware as Record<string, unknown>)) {
      if (Array.isArray(entries)) result.middleware[hook] = entries as string[]
    }
  }
  if (isPlainObject(agent.tools)) {
    const tools = agent.tools as Record<string, unknown>
    if (Array.isArray(tools.custom)) result.customTools = tools.custom as string[]
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

  const normalizeLayer = (layer: Record<string, unknown>) => {
    normalizeFlatConfig(layer)
    normalizeMcpConfig(layer)
    normalizeAppToAgentKeys(layer)
    normalizeToolsConfig(layer)
  }
  for (const layer of [fileConfig, cliArgs]) normalizeLayer(layer)

  // Coerce after normalization so schema paths match (e.g. "50" → 50)
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
    // Check before normalizeLayer which may create an empty `app` object
    if (recipeConfig.app !== undefined) {
      throw new Error(`Recipe "${recipeName}" contains an "app" stanza. Recipes may only define "agent" configuration.`)
    }

    normalizeLayer(recipeConfig)

    // normalizeMcpConfig may create an empty `app` object — remove it
    if (isPlainObject(recipeConfig.app) && Object.keys(recipeConfig.app as Record<string, unknown>).length === 0) {
      delete recipeConfig.app
    }

    // Pre-resolve recipe paths against its directory
    const recipeAgent = (recipeConfig.agent ?? recipeConfig) as Record<string, unknown>
    preResolveRecipePaths(recipeAgent, resolved.recipeDir)

    // Save array fields before deepMerge destroys them
    recipeArrays = extractRecipeArrays(recipeConfig)

    // Wrap in agent key if the recipe was a flat config
    recipeLayer = isPlainObject(recipeConfig.agent) ? recipeConfig : { agent: recipeConfig }

    // Strip recipe key from file config
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
  'cli', 'repl', 'http', 'mcp', 'mcp-stdio', 'inspector', 'cron', 'web',
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
  if (Array.isArray(config.app.mcpServers)) {
    for (let i = 0; i < config.app.mcpServers.length; i++) {
      const entry = config.app.mcpServers[i]
      if (!entry) continue
      if (!entry.name) errors.push(`app.mcpServers[${i}].name is required`)
      if (!entry.transport) errors.push(`app.mcpServers[${i}].transport is required ("stdio" or "sse")`)
      if (entry.transport === 'stdio' && !entry.command) errors.push(`app.mcpServers[${i}].command is required for stdio transport`)
      if (entry.transport === 'sse' && !entry.url) errors.push(`app.mcpServers[${i}].url is required for sse transport`)
    }
  }

  if (errors.length > 0) {
    throw new ConfigError(`Invalid configuration:\n  ${errors.join('\n  ')}`)
  }
}
