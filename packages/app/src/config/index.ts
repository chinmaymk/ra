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
export type { RaConfig, LoadConfigOptions, McpServerEntry, McpServerConfig, PermissionsConfig, PermissionRule, PermissionFieldRule, ToolsConfig, ToolSettings, AppConfig, AgentConfig, CronJob } from './types'

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target }
  for (const key of Object.keys(source)) {
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

async function parseFile(path: string): Promise<Partial<RaConfig>> {
  const content = await Bun.file(path).text()
  if (path.endsWith('.json')) return JSON.parse(content) as Partial<RaConfig>
  if (path.endsWith('.yaml') || path.endsWith('.yml')) return yaml.load(content) as Partial<RaConfig>
  if (path.endsWith('.toml')) return parseToml(content) as Partial<RaConfig>
  return {}
}

// Keys that belong under `agent` when found at the top level (legacy flat config)
const AGENT_KEYS = new Set([
  'provider', 'model', 'thinking', 'systemPrompt',
  'maxIterations', 'maxRetries', 'toolTimeout', 'maxConcurrency',
  'tools', 'skillDirs', 'mcp', 'permissions',
  'middleware', 'context', 'compaction', 'memory',
])

// Keys that belong under `app` when found at the top level (legacy flat config)
const APP_KEYS = new Set([
  'interface', 'dataDir', 'http', 'inspector', 'storage',
  'mcpServer', 'providers',
  'logsEnabled', 'logLevel', 'tracesEnabled',
])

/**
 * Normalize MCP config from legacy shapes into the new split layout.
 * Handles:
 *   - `app.mcp: { client, server, lazySchemas }` → split to `agent.mcp.servers` + `app.mcpServer`
 *   - `app.mcp.client` → `agent.mcp.servers` (rename client→servers)
 *   - `agent.mcp.client` → `agent.mcp.servers` (rename only)
 */
function normalizeMcpConfig(raw: Record<string, unknown>): void {
  const app = raw.app as Record<string, unknown> | undefined
  if (isPlainObject(app) && isPlainObject(app.mcp)) {
    const mcp = app.mcp as Record<string, unknown>
    // Move client (→servers) + lazySchemas to agent.mcp
    if (!isPlainObject(raw.agent)) raw.agent = {}
    const agent = raw.agent as Record<string, unknown>
    if (!isPlainObject(agent.mcp)) agent.mcp = {}
    const agentMcp = agent.mcp as Record<string, unknown>
    if (mcp.client !== undefined && agentMcp.servers === undefined) {
      agentMcp.servers = mcp.client
    }
    if (mcp.lazySchemas !== undefined && agentMcp.lazySchemas === undefined) {
      agentMcp.lazySchemas = mcp.lazySchemas
    }
    // Move server to app.mcpServer
    if (isPlainObject(mcp.server) && app.mcpServer === undefined) {
      app.mcpServer = mcp.server
    }
    delete app.mcp
  }

  // Also migrate app.skillDirs and app.permissions to agent (backward compat)
  if (isPlainObject(app)) {
    if (!isPlainObject(raw.agent)) raw.agent = {}
    const agent = raw.agent as Record<string, unknown>
    if (app.skillDirs !== undefined && agent.skillDirs === undefined) {
      agent.skillDirs = app.skillDirs
      delete app.skillDirs
    }
    if (isPlainObject(app.permissions) && agent.permissions === undefined) {
      agent.permissions = app.permissions
      delete app.permissions
    }
    // Remove dead `skills` key
    delete app.skills
  }

  // Rename agent.mcp.client → agent.mcp.servers if needed
  const agent = raw.agent as Record<string, unknown> | undefined
  if (isPlainObject(agent) && isPlainObject(agent.mcp)) {
    const agentMcp = agent.mcp as Record<string, unknown>
    if (agentMcp.client !== undefined && agentMcp.servers === undefined) {
      agentMcp.servers = agentMcp.client
      delete agentMcp.client
    }
  }
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
  const overrides: Record<string, ToolSettings> = {}
  for (const [key, val] of Object.entries(t)) {
    if (key === 'builtin' || key === 'overrides' || key === 'maxResponseSize') continue
    if (val === false) overrides[key] = { enabled: false }
    else if (isPlainObject(val)) overrides[key] = val as ToolSettings
  }
  obj.tools = { builtin, overrides, ...(maxResponseSize !== undefined && { maxResponseSize }) }
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
}

/** Saved recipe arrays to prepend after all merges complete. */
interface RecipeArrays {
  skillDirs: string[]
  mcpServers: unknown[]
  middleware: Record<string, string[]>
}

/** Extract array fields from a recipe's agent config (they'd be lost by deepMerge). */
function extractRecipeArrays(agent: Record<string, unknown>): RecipeArrays {
  const result: RecipeArrays = { skillDirs: [], mcpServers: [], middleware: {} }
  if (Array.isArray(agent.skillDirs)) result.skillDirs = agent.skillDirs as string[]
  if (isPlainObject(agent.mcp) && Array.isArray((agent.mcp as Record<string, unknown>).servers)) {
    result.mcpServers = (agent.mcp as Record<string, unknown>).servers as unknown[]
  }
  if (isPlainObject(agent.middleware)) {
    for (const [hook, entries] of Object.entries(agent.middleware as Record<string, unknown>)) {
      if (Array.isArray(entries)) result.middleware[hook] = entries as string[]
    }
  }
  return result
}

/** Prepend recipe arrays to the final merged config. */
function prependRecipeArrays(config: RaConfig, arrays: RecipeArrays): void {
  if (arrays.skillDirs.length > 0) {
    config.agent.skillDirs = [...arrays.skillDirs, ...config.agent.skillDirs]
  }
  if (arrays.mcpServers.length > 0) {
    config.agent.mcp.servers = [...arrays.mcpServers as typeof config.agent.mcp.servers, ...config.agent.mcp.servers]
  }
  for (const [hook, entries] of Object.entries(arrays.middleware)) {
    const existing = config.agent.middleware[hook] ?? []
    config.agent.middleware[hook] = [...entries, ...existing]
  }
}

// ── Main config loader ──────────────────────────────────────────────

export async function loadConfig(options: LoadConfigOptions = {}, logger?: Logger): Promise<RaConfig> {
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
    normalizeLayer(recipeConfig)

    // Pre-resolve recipe paths against its directory
    const recipeAgent = (recipeConfig.agent ?? recipeConfig) as Record<string, unknown>
    preResolveRecipePaths(recipeAgent, resolved.recipeDir)

    // Save array fields before deepMerge destroys them
    recipeArrays = extractRecipeArrays(recipeAgent)

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
  if (config.agent.systemPrompt && looksLikePath(config.agent.systemPrompt, ['.txt', '.md'])) {
    const resolved = resolvePath(config.agent.systemPrompt, configDir)
    const f = Bun.file(resolved)
    if (await f.exists()) {
      config.agent.systemPrompt = await f.text()
      log.debug('system prompt loaded from file', { path: resolved })
    }
  }

  log.debug('config resolved', { provider: config.agent.provider, model: config.agent.model, interface: config.app.interface })
  return config
}
