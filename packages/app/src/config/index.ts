import { join, dirname, isAbsolute } from 'path'
import yaml from 'js-yaml'
import { parse as parseToml } from 'smol-toml'
import { resolvePath, looksLikePath } from '../utils/paths'
import { applyRule, type CoercionRule } from '../utils/config-helpers'
import { defaultConfig } from './defaults'
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

const ENV_RULES: Record<string, CoercionRule> = {
  // ── app section ──────────────────────────────────────────────────────
  RA_DATA_DIR:       { type: 'string', path: ['app', 'dataDir'] },
  RA_INTERFACE:      { type: 'string', path: ['app', 'interface'] },
  RA_HTTP_PORT:      { type: 'int',    path: ['app', 'http', 'port'] },
  RA_HTTP_TOKEN:     { type: 'string', path: ['app', 'http', 'token'] },
  RA_STORAGE_MAX_SESSIONS: { type: 'int',    path: ['app', 'storage', 'maxSessions'] },
  RA_STORAGE_TTL_DAYS:     { type: 'int',    path: ['app', 'storage', 'ttlDays'] },
  RA_SKILL_DIRS:           { type: 'csv',    path: ['app', 'skillDirs'] },
  RA_MCP_SERVER_ENABLED:          { type: 'bool',   path: ['app', 'mcp', 'server', 'enabled'] },
  RA_MCP_SERVER_PORT:             { type: 'int',    path: ['app', 'mcp', 'server', 'port'] },
  RA_MCP_SERVER_TOOL_NAME:        { type: 'string', path: ['app', 'mcp', 'server', 'tool', 'name'] },
  RA_MCP_SERVER_TOOL_DESCRIPTION: { type: 'string', path: ['app', 'mcp', 'server', 'tool', 'description'] },
  RA_MCP_LAZY_SCHEMAS:            { type: 'bool',   path: ['app', 'mcp', 'lazySchemas'] },
  RA_LOGS_ENABLED:      { type: 'bool',   path: ['app', 'logsEnabled'] },
  RA_LOG_LEVEL:         { type: 'enum',   path: ['app', 'logLevel'], values: ['debug', 'info', 'warn', 'error'] },
  RA_TRACES_ENABLED:    { type: 'bool',   path: ['app', 'tracesEnabled'] },
  // ── agent section ────────────────────────────────────────────────────
  RA_PROVIDER:       { type: 'string', path: ['agent', 'provider'] },
  RA_MODEL:          { type: 'string', path: ['agent', 'model'] },
  RA_SYSTEM_PROMPT:  { type: 'string', path: ['agent', 'systemPrompt'] },
  RA_MAX_ITERATIONS: { type: 'int',    path: ['agent', 'maxIterations'] },
  RA_MAX_RETRIES:    { type: 'int',    path: ['agent', 'maxRetries'] },
  RA_THINKING:       { type: 'enum',   path: ['agent', 'thinking'], values: ['low', 'medium', 'high'] },
  RA_TOOL_TIMEOUT:   { type: 'int',    path: ['agent', 'toolTimeout'] },
  RA_MAX_TOOL_RESPONSE_SIZE: { type: 'int', path: ['agent', 'tools', 'maxResponseSize'] },
  RA_TOOLS_BUILTIN:  { type: 'bool',   path: ['agent', 'tools', 'builtin'] },
  RA_MEMORY_ENABLED:      { type: 'bool',   path: ['agent', 'memory', 'enabled'] },
  RA_MEMORY_MAX_MEMORIES: { type: 'int',    path: ['agent', 'memory', 'maxMemories'] },
  RA_MEMORY_TTL_DAYS:     { type: 'int',    path: ['agent', 'memory', 'ttlDays'] },
  RA_MEMORY_INJECT_LIMIT: { type: 'int',    path: ['agent', 'memory', 'injectLimit'] },
  // Provider credentials (env-only — not CLI flags, to avoid leaking in process list/shell history)
  RA_ANTHROPIC_API_KEY:  { type: 'string', path: ['agent', 'providers', 'anthropic', 'apiKey'] },
  RA_ANTHROPIC_BASE_URL: { type: 'string', path: ['agent', 'providers', 'anthropic', 'baseURL'] },
  RA_OPENAI_API_KEY:     { type: 'string', path: ['agent', 'providers', 'openai', 'apiKey'] },
  RA_OPENAI_BASE_URL:    { type: 'string', path: ['agent', 'providers', 'openai', 'baseURL'] },
  RA_OPENAI_COMPLETIONS_API_KEY:  { type: 'string', path: ['agent', 'providers', 'openai-completions', 'apiKey'] },
  RA_OPENAI_COMPLETIONS_BASE_URL: { type: 'string', path: ['agent', 'providers', 'openai-completions', 'baseURL'] },
  RA_GOOGLE_API_KEY:     { type: 'string', path: ['agent', 'providers', 'google', 'apiKey'] },
  RA_GOOGLE_BASE_URL:    { type: 'string', path: ['agent', 'providers', 'google', 'baseURL'] },
  RA_OLLAMA_HOST:        { type: 'string', path: ['agent', 'providers', 'ollama', 'host'] },
  RA_BEDROCK_REGION:     { type: 'string', path: ['agent', 'providers', 'bedrock', 'region'] },
  RA_BEDROCK_API_KEY:    { type: 'string', path: ['agent', 'providers', 'bedrock', 'apiKey'] },
  RA_AZURE_API_KEY:      { type: 'string', path: ['agent', 'providers', 'azure', 'apiKey'] },
  RA_AZURE_ENDPOINT:     { type: 'string', path: ['agent', 'providers', 'azure', 'endpoint'] },
  RA_AZURE_DEPLOYMENT:   { type: 'string', path: ['agent', 'providers', 'azure', 'deployment'] },
  RA_AZURE_API_VERSION:  { type: 'string', path: ['agent', 'providers', 'azure', 'apiVersion'] },
}

function loadEnvVars(env: Record<string, string | undefined>): Record<string, unknown> {
  const r: Record<string, unknown> = {}
  for (const [key, rule] of Object.entries(ENV_RULES)) {
    const val = env[key]
    if (val !== undefined) applyRule(r, rule, val)
  }
  return r
}

// Keys that belong under `agent` when found at the top level (legacy flat config)
const AGENT_KEYS = new Set([
  'provider', 'model', 'thinking', 'systemPrompt', 'providers',
  'maxIterations', 'maxRetries', 'toolTimeout', 'maxConcurrency',
  'tools', 'middleware', 'context', 'compaction', 'memory',
])

// Keys that belong under `app` when found at the top level (legacy flat config)
const APP_KEYS = new Set([
  'interface', 'dataDir', 'http', 'inspector', 'storage',
  'skillDirs', 'skills', 'mcp', 'permissions',
  'logsEnabled', 'logLevel', 'tracesEnabled',
])

/**
 * Migrate legacy flat config keys into their `app`/`agent` sections.
 * Before the app/agent split, all keys lived at the top level.
 * This shim lets old configs (e.g. `providers.anthropic.apiKey`) keep working.
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

export async function loadConfig(options: LoadConfigOptions = {}): Promise<RaConfig> {
  const cwd = options.cwd ?? process.cwd()
  const env = (options.env ?? process.env) as Record<string, string | undefined>

  const { config: fileConfig, filePath: configFilePath } = await loadConfigFile(cwd, options.configPath)
  const configDir = configFilePath ? dirname(configFilePath) : cwd
  const envConfig = loadEnvVars(env)
  const cliArgs = options.cliArgs ?? {}

  // Migrate legacy flat config keys into app/agent sections, then normalize tools
  const layers = [fileConfig, envConfig, cliArgs] as Record<string, unknown>[]
  for (const layer of layers) {
    normalizeFlatConfig(layer)
    normalizeToolsConfig(layer)
  }

  // defaults < file < env < CLI
  // Deep clone defaults to prevent mutation of the shared defaultConfig object
  const defaults = JSON.parse(JSON.stringify(defaultConfig)) as Record<string, unknown>
  const merged = layers.reduce(
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
    if (await f.exists()) config.agent.systemPrompt = await f.text()
  }

  return config
}
