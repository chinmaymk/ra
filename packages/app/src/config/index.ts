import { join, dirname, isAbsolute } from 'path'
import yaml from 'js-yaml'
import { parse as parseToml } from 'smol-toml'
import { resolvePath, looksLikePath } from '../utils/paths'
import { interpolateEnvVars, coerceTypes } from '../utils/config-helpers'
import { defaultConfig } from './defaults'
import { NoopLogger } from '@chinmaymk/ra'
import type { Logger } from '@chinmaymk/ra'
import type { RaConfig, LoadConfigOptions, ToolsConfig, ToolSettings } from './types'

export { defaultConfig } from './defaults'
export type { RaConfig, LoadConfigOptions, McpClientConfig, McpServerConfig, PermissionsConfig, PermissionRule, PermissionFieldRule, ToolsConfig, ToolSettings, AppConfig, AgentConfig, CronJob } from './types'

const CONFIG_FILES = [
  'ra.config.json',
  'ra.config.yaml',
  'ra.config.yml',
  'ra.config.toml',
]

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

export function deepMerge(
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
  'tools', 'middleware', 'context', 'compaction', 'memory',
])

// Keys that belong under `app` when found at the top level (legacy flat config)
const APP_KEYS = new Set([
  'interface', 'dataDir', 'http', 'inspector', 'storage',
  'skillDirs', 'skills', 'mcp', 'permissions', 'providers',
  'logsEnabled', 'logLevel', 'tracesEnabled',
])

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

  // Normalize first so flat keys land at their proper nested paths
  for (const layer of [fileConfig, cliArgs]) {
    normalizeFlatConfig(layer)
    normalizeToolsConfig(layer)
  }

  // Coerce after normalization so schema paths match (e.g. "50" → 50)
  const coercedFileConfig = coerceTypes(fileConfig, rawDefaults) as Record<string, unknown>

  // defaults < file < CLI
  const defaults = interpolateEnvVars(rawDefaults, env) as Record<string, unknown>
  const merged = [coercedFileConfig, cliArgs].reduce(
    (acc, layer) => deepMerge(acc, layer),
    defaults,
  )

  const config = merged as unknown as RaConfig
  config.app.configDir = configDir

  // Resolve dataDir against configDir
  config.app.dataDir = resolvePath(config.app.dataDir, configDir)

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
