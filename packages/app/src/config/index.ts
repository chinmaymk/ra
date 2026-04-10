import { join, dirname, isAbsolute } from 'path'
import yaml from 'js-yaml'
import { parse as parseToml } from 'smol-toml'
import { resolvePath, looksLikePath, homeDir, configHandle } from '../utils/paths'
import { isPlainObject, interpolateEnvVars, coerceTypes } from '../utils/config-helpers'
import { buildMergedEnv } from '../secrets/store'
import { buildStandardEnvLayer, PROVIDERS, INTERFACE_FLAGS } from './schema'
import { defaultConfig } from './defaults'
import { CONFIG_FILES } from '../registry/helpers'
import { NoopLogger } from '@chinmaymk/ra'
import type { Logger } from '@chinmaymk/ra'
import type { RaConfig, LoadConfigOptions, ToolsConfig, ToolSettings } from './types'

export { defaultConfig } from './defaults'
export type { RaConfig, LoadConfigOptions, McpServerEntry, RaMcpServerConfig, PermissionsConfig, PermissionRule, PermissionFieldRule, ToolsConfig, ToolSettings, AppConfig, AgentConfig, CronJob } from './types'

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
 * Normalize the `tools` config section into the canonical
 * `{ builtin, overrides, custom, maxResponseSize? }` form. Users can write
 * `tools: { Read: { rootDir: "." }, WebFetch: { enabled: false } }` and it
 * gets folded into `overrides`. Anything already canonical passes through
 * untouched.
 */
function normalizeToolsConfig(raw: Record<string, unknown>): void {
  const agent = raw.agent as Record<string, unknown> | undefined
  if (!isPlainObject(agent) || !isPlainObject(agent.tools)) return
  const t = agent.tools
  // Already canonical form.
  if (isPlainObject(t.overrides)) return

  const builtin = t.builtin !== undefined ? !!t.builtin : true
  const maxResponseSize = typeof t.maxResponseSize === 'number' ? t.maxResponseSize : undefined
  const custom = Array.isArray(t.custom) ? t.custom as string[] : []
  const overrides: Record<string, ToolSettings> = {}
  for (const [key, val] of Object.entries(t)) {
    if (key === 'builtin' || key === 'overrides' || key === 'maxResponseSize' || key === 'custom') continue
    if (val === false) overrides[key] = { enabled: false }
    else if (isPlainObject(val)) overrides[key] = val as ToolSettings
  }
  agent.tools = { builtin, overrides, custom, ...(maxResponseSize !== undefined && { maxResponseSize }) }
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
  // Resolve env from explicit options, falling back to process.env. The
  // secrets store is consulted via `buildMergedEnv`, so callers that pass
  // their own env (typically tests) get isolation from the host shell while
  // still benefitting from any secrets stored under the active profile.
  const explicitEnv = options.env as Record<string, string | undefined> | undefined
  const env = explicitEnv
    ? { ...buildMergedEnv(process.env.RA_PROFILE || 'default'), ...explicitEnv }
    : buildMergedEnv(process.env.RA_PROFILE || 'default')

  const { config: rawFileConfig, filePath: configFilePath } = await loadConfigFile(cwd, options.configPath)
  const configDir = configFilePath ? dirname(configFilePath) : cwd

  if (configFilePath) {
    log.info('config file loaded', { path: configFilePath })
  } else {
    log.debug('no config file found', { cwd, searchedFiles: CONFIG_FILES })
  }

  const defaults = JSON.parse(JSON.stringify(defaultConfig)) as Record<string, unknown>
  const envLayer = buildStandardEnvLayer(env)
  // Interpolate ${VAR} references in file values, then coerce string leaves
  // (like `port: ${PORT}` → "3000" → 3000) against the defaults schema.
  // Defaults and CLI args stay untouched — they're already properly typed.
  const interpolatedFile = interpolateEnvVars(rawFileConfig, env)
  const fileConfig = coerceTypes(interpolatedFile, defaults) as Record<string, unknown>
  const cliArgs = (options.cliArgs ?? {}) as Record<string, unknown>

  // Only one normalizer left: tools config supports a flat form so users can
  // write `tools: { Read: { ... } }` instead of `tools: { overrides: { ... } }`.
  normalizeToolsConfig(fileConfig)
  normalizeToolsConfig(cliArgs)

  // ── Recipe resolution ────────────────────────────────────────────
  // Recipe source: --recipe flag takes priority, then agent.recipe in config file
  const recipeName = options.recipeName
    ?? (isPlainObject(fileConfig.agent) ? (fileConfig.agent as Record<string, unknown>).recipe as string | undefined : undefined)

  let recipeArrays: RecipeArrays | undefined
  let recipeLayer: Record<string, unknown> | undefined
  if (recipeName) {
    const resolved = await resolveRecipe(recipeName, cwd)
    if (!resolved) {
      throw new Error(`Recipe not found: "${recipeName}". Install it with: ra recipe install <source>`)
    }
    const rawRecipeConfig = await parseFile(resolved.configPath)
    const recipeConfig = coerceTypes(
      interpolateEnvVars(rawRecipeConfig, env),
      defaults,
    ) as Record<string, unknown>

    // Recipes must only define agent configuration — reject app stanza.
    if (recipeConfig.app !== undefined) {
      throw new Error(`Recipe "${recipeName}" contains an "app" stanza. Recipes may only define "agent" configuration.`)
    }

    normalizeToolsConfig(recipeConfig)

    // Pre-resolve recipe paths against its directory
    const recipeAgent = (recipeConfig.agent ?? recipeConfig) as Record<string, unknown>
    preResolveRecipePaths(recipeAgent, resolved.recipeDir)

    // Save array fields before deepMerge destroys them
    recipeArrays = extractRecipeArrays(recipeConfig)

    recipeLayer = isPlainObject(recipeConfig.agent) ? recipeConfig : { agent: recipeConfig }

    // Strip recipe key from file config
    if (isPlainObject(fileConfig.agent)) {
      delete (fileConfig.agent as Record<string, unknown>).recipe
    }

    log.info('recipe loaded', { recipe: recipeName, path: resolved.configPath })
  }

  // defaults < env (standard env vars + secrets) < recipe < file < CLI
  const layers = recipeLayer
    ? [envLayer, recipeLayer, fileConfig, cliArgs]
    : [envLayer, fileConfig, cliArgs]
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

/**
 * Validate the merged config. Yargs `.choices()` already enforces enums on
 * CLI flags; this exists to catch the same mistakes when they come from a
 * config file or recipe (which yargs never sees). Numeric range checks and
 * structural MCP-server checks are unique to this layer.
 */
function validateConfig(config: RaConfig): void {
  const { agent, app } = config
  const errors: string[] = []
  const provs = PROVIDERS as readonly string[]
  const ifaces = INTERFACE_FLAGS as readonly string[]

  if (!agent.provider) errors.push('agent.provider is required (e.g. "anthropic", "openai", "google")')
  else if (!provs.includes(agent.provider)) errors.push(`agent.provider "${agent.provider}" is not a valid provider. Valid options: ${provs.join(', ')}`)
  if (!agent.model) errors.push('agent.model is required (e.g. "claude-sonnet-4-6", "gpt-4o")')
  if (app.interface && !ifaces.includes(app.interface)) errors.push(`app.interface "${app.interface}" is not valid. Valid options: ${ifaces.join(', ')}`)

  if (typeof agent.maxIterations === 'number' && agent.maxIterations < 0) errors.push('agent.maxIterations must be 0 (unlimited) or a positive number')
  if (typeof agent.maxRetries    === 'number' && agent.maxRetries    < 0) errors.push('agent.maxRetries must be 0 or a positive number')
  if (typeof agent.toolTimeout   === 'number' && agent.toolTimeout   < 0) errors.push('agent.toolTimeout must be 0 (unlimited) or a positive number of milliseconds')

  const t = agent.compaction?.threshold
  if (typeof t === 'number' && (t <= 0 || t > 1)) errors.push('agent.compaction.threshold must be between 0 and 1 (e.g. 0.9 = 90% of context window)')
  if (typeof app.http?.port === 'number' && (app.http.port < 0 || app.http.port > 65535)) errors.push('app.http.port must be between 0 and 65535')

  app.mcpServers?.forEach((entry, i) => {
    if (!entry) return
    if (!entry.name)      errors.push(`app.mcpServers[${i}].name is required`)
    if (!entry.transport) errors.push(`app.mcpServers[${i}].transport is required ("stdio" or "sse")`)
    if (entry.transport === 'stdio' && !entry.command) errors.push(`app.mcpServers[${i}].command is required for stdio transport`)
    if (entry.transport === 'sse'   && !entry.url)     errors.push(`app.mcpServers[${i}].url is required for sse transport`)
  })

  if (errors.length > 0) throw new ConfigError(`Invalid configuration:\n  ${errors.join('\n  ')}`)
}
