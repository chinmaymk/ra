import { join, dirname, isAbsolute } from 'path'
import yaml from 'js-yaml'
import { parse as parseToml } from 'smol-toml'
import { resolvePath, looksLikePath } from '../utils/paths'
import { applyRule, type CoercionRule } from '../utils/config-helpers'
import { defaultConfig } from './defaults'
import type { RaConfig, LoadConfigOptions, ToolsConfig, ToolSettings } from './types'

export { defaultConfig } from './defaults'
export type { RaConfig, LoadConfigOptions, McpClientConfig, McpServerConfig, PermissionsConfig, PermissionRule, PermissionFieldRule, ToolsConfig, ToolSettings } from './types'

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
  RA_DATA_DIR:       { type: 'string', path: ['dataDir'] },
  RA_PROVIDER:       { type: 'string', path: ['provider'] },
  RA_MODEL:          { type: 'string', path: ['model'] },
  RA_INTERFACE:      { type: 'string', path: ['interface'] },
  RA_SYSTEM_PROMPT:  { type: 'string', path: ['systemPrompt'] },
  RA_MAX_ITERATIONS: { type: 'int',    path: ['maxIterations'] },
  RA_MAX_RETRIES:    { type: 'int',    path: ['maxRetries'] },
  RA_THINKING:       { type: 'enum',   path: ['thinking'], values: ['low', 'medium', 'high'] },
  RA_TOOL_TIMEOUT:   { type: 'int',    path: ['toolTimeout'] },
  RA_MAX_TOOL_RESPONSE_SIZE: { type: 'int', path: ['tools', 'maxResponseSize'] },
  RA_TOOLS_BUILTIN:  { type: 'bool',   path: ['tools', 'builtin'] },
  RA_HTTP_PORT:      { type: 'int',    path: ['http', 'port'] },
  RA_HTTP_TOKEN:     { type: 'string', path: ['http', 'token'] },
  RA_MCP_SERVER_ENABLED:          { type: 'bool',   path: ['mcp', 'server', 'enabled'] },
  RA_MCP_SERVER_PORT:             { type: 'int',    path: ['mcp', 'server', 'port'] },
  RA_MCP_SERVER_TOOL_NAME:        { type: 'string', path: ['mcp', 'server', 'tool', 'name'] },
  RA_MCP_SERVER_TOOL_DESCRIPTION: { type: 'string', path: ['mcp', 'server', 'tool', 'description'] },
  RA_MCP_LAZY_SCHEMAS:            { type: 'bool',   path: ['mcp', 'lazySchemas'] },
  RA_STORAGE_MAX_SESSIONS: { type: 'int',    path: ['storage', 'maxSessions'] },
  RA_STORAGE_TTL_DAYS:     { type: 'int',    path: ['storage', 'ttlDays'] },
  RA_SKILL_DIRS:           { type: 'csv',    path: ['skillDirs'] },
  RA_SKILLS:               { type: 'csv',    path: ['skills'] },
  RA_LOGS_ENABLED:      { type: 'bool',   path: ['logsEnabled'] },
  RA_LOG_LEVEL:         { type: 'enum',   path: ['logLevel'], values: ['debug', 'info', 'warn', 'error'] },
  RA_TRACES_ENABLED:    { type: 'bool',   path: ['tracesEnabled'] },
  RA_MEMORY_ENABLED:      { type: 'bool',   path: ['memory', 'enabled'] },
  RA_MEMORY_MAX_MEMORIES: { type: 'int',    path: ['memory', 'maxMemories'] },
  RA_MEMORY_TTL_DAYS:     { type: 'int',    path: ['memory', 'ttlDays'] },
  RA_MEMORY_INJECT_LIMIT: { type: 'int',    path: ['memory', 'injectLimit'] },
  // Provider credentials (env-only — not CLI flags, to avoid leaking in process list/shell history)
  RA_ANTHROPIC_API_KEY:  { type: 'string', path: ['providers', 'anthropic', 'apiKey'] },
  RA_ANTHROPIC_BASE_URL: { type: 'string', path: ['providers', 'anthropic', 'baseURL'] },
  RA_OPENAI_API_KEY:     { type: 'string', path: ['providers', 'openai', 'apiKey'] },
  RA_OPENAI_BASE_URL:    { type: 'string', path: ['providers', 'openai', 'baseURL'] },
  RA_OPENAI_COMPLETIONS_API_KEY:  { type: 'string', path: ['providers', 'openai-completions', 'apiKey'] },
  RA_OPENAI_COMPLETIONS_BASE_URL: { type: 'string', path: ['providers', 'openai-completions', 'baseURL'] },
  RA_GOOGLE_API_KEY:     { type: 'string', path: ['providers', 'google', 'apiKey'] },
  RA_GOOGLE_BASE_URL:    { type: 'string', path: ['providers', 'google', 'baseURL'] },
  RA_OLLAMA_HOST:        { type: 'string', path: ['providers', 'ollama', 'host'] },
  RA_BEDROCK_REGION:     { type: 'string', path: ['providers', 'bedrock', 'region'] },
  RA_BEDROCK_API_KEY:    { type: 'string', path: ['providers', 'bedrock', 'apiKey'] },
  RA_AZURE_API_KEY:      { type: 'string', path: ['providers', 'azure', 'apiKey'] },
  RA_AZURE_ENDPOINT:     { type: 'string', path: ['providers', 'azure', 'endpoint'] },
  RA_AZURE_DEPLOYMENT:   { type: 'string', path: ['providers', 'azure', 'deployment'] },
  RA_AZURE_API_VERSION:  { type: 'string', path: ['providers', 'azure', 'apiVersion'] },
}

function loadEnvVars(env: Record<string, string | undefined>): Record<string, unknown> {
  const r: Record<string, unknown> = {}
  for (const [key, rule] of Object.entries(ENV_RULES)) {
    const val = env[key]
    if (val !== undefined) applyRule(r, rule, val)
  }
  return r
}

/**
 * Normalize the `tools` config section. Supports three shapes:
 *   1. `builtinTools: true/false` (legacy boolean flag)
 *   2. Flat YAML: `tools: { builtin: true, Read: { rootDir: "." }, WebFetch: { enabled: false } }`
 *   3. Canonical: `tools: { builtin: true, overrides: { ... } }`
 * Converts everything into the canonical `{ builtin, overrides }` form.
 */
function normalizeToolsConfig(raw: Record<string, unknown>): void {
  // Legacy: builtinTools boolean → tools.builtin
  if ('builtinTools' in raw) {
    if (!('tools' in raw)) {
      raw.tools = { builtin: !!raw.builtinTools, overrides: {} }
    }
    delete raw.builtinTools
  }

  if (!isPlainObject(raw.tools)) return
  const t = raw.tools
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
  raw.tools = { builtin, overrides, ...(maxResponseSize !== undefined && { maxResponseSize }) }
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<RaConfig> {
  const cwd = options.cwd ?? process.cwd()
  const env = (options.env ?? process.env) as Record<string, string | undefined>

  const { config: fileConfig, filePath: configFilePath } = await loadConfigFile(cwd, options.configPath)
  const configDir = configFilePath ? dirname(configFilePath) : cwd
  const envConfig = loadEnvVars(env)
  const cliArgs = options.cliArgs ?? {}

  // Normalize tools config on each layer before merging
  const layers = [fileConfig, envConfig, cliArgs] as Record<string, unknown>[]
  for (const layer of layers) normalizeToolsConfig(layer)

  // defaults < file < env < CLI
  const merged = layers.reduce(
    (acc, layer) => deepMerge(acc, layer),
    defaultConfig as unknown as Record<string, unknown>,
  )

  const config = merged as unknown as RaConfig
  config.configDir = configDir

  // Resolve dataDir against configDir
  config.dataDir = resolvePath(config.dataDir, configDir)

  // Only try loading systemPrompt as a file if it looks like a path
  if (config.systemPrompt && looksLikePath(config.systemPrompt, ['.txt', '.md'])) {
    const resolved = resolvePath(config.systemPrompt, configDir)
    const f = Bun.file(resolved)
    if (await f.exists()) config.systemPrompt = await f.text()
  }

  return config
}
