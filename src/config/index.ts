import { join, dirname, isAbsolute } from 'path'
import yaml from 'js-yaml'
import { parse as parseToml } from 'smol-toml'
import { resolvePath, looksLikePath } from '../utils/paths'
import { setPath, safeParseInt } from '../utils/config-helpers'
import { defaultConfig } from './defaults'
import type { RaConfig, LoadConfigOptions } from './types'

export { defaultConfig } from './defaults'
export type { RaConfig, LoadConfigOptions, McpClientConfig, McpServerConfig, PermissionsConfig, PermissionRule, PermissionFieldRule } from './types'

const CONFIG_FILES = [
  'ra.config.json',
  'ra.config.yaml',
  'ra.config.yml',
  'ra.config.toml',
]

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] !== null &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(
        target[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>,
      )
    } else {
      result[key] = source[key]
    }
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

type EnvRule =
  | { type: 'string'; path: string[] }
  | { type: 'int'; path: string[] }
  | { type: 'bool'; path: string[] }
  | { type: 'csv'; path: string[] }
  | { type: 'enum'; path: string[]; values: string[] }

const ENV_RULES: Record<string, EnvRule> = {
  RA_DATA_DIR:       { type: 'string', path: ['dataDir'] },
  RA_PROVIDER:       { type: 'string', path: ['provider'] },
  RA_MODEL:          { type: 'string', path: ['model'] },
  RA_INTERFACE:      { type: 'string', path: ['interface'] },
  RA_SYSTEM_PROMPT:  { type: 'string', path: ['systemPrompt'] },
  RA_MAX_ITERATIONS: { type: 'int',    path: ['maxIterations'] },
  RA_THINKING:       { type: 'enum',   path: ['thinking'], values: ['low', 'medium', 'high'] },
  RA_TOOL_TIMEOUT:   { type: 'int',    path: ['toolTimeout'] },
  RA_BUILTIN_TOOLS:  { type: 'bool',   path: ['builtinTools'] },
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
  RA_SESSION_MEMORY_ENABLED: { type: 'bool', path: ['sessionMemory', 'enabled'] },
  RA_MEMORY_ENABLED:      { type: 'bool',   path: ['memory', 'enabled'] },
  RA_MEMORY_MAX_MEMORIES: { type: 'int',    path: ['memory', 'maxMemories'] },
  RA_MEMORY_TTL_DAYS:     { type: 'int',    path: ['memory', 'ttlDays'] },
  RA_MEMORY_INJECT_LIMIT: { type: 'int',    path: ['memory', 'injectLimit'] },
  // Provider credentials (env-only — not CLI flags, to avoid leaking in process list/shell history)
  RA_ANTHROPIC_API_KEY:  { type: 'string', path: ['providers', 'anthropic', 'apiKey'] },
  RA_ANTHROPIC_BASE_URL: { type: 'string', path: ['providers', 'anthropic', 'baseURL'] },
  RA_OPENAI_API_KEY:     { type: 'string', path: ['providers', 'openai', 'apiKey'] },
  RA_OPENAI_BASE_URL:    { type: 'string', path: ['providers', 'openai', 'baseURL'] },
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
    if (val === undefined) continue
    if (rule.type === 'string') setPath(r, rule.path, val)
    else if (rule.type === 'int') { const n = safeParseInt(val); if (n !== undefined) setPath(r, rule.path, n) }
    else if (rule.type === 'bool') setPath(r, rule.path, val === 'true')
    else if (rule.type === 'csv') setPath(r, rule.path, val.split(',').filter(Boolean))
    else if (rule.type === 'enum' && rule.values.includes(val)) setPath(r, rule.path, val)
  }
  return r
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<RaConfig> {
  const cwd = options.cwd ?? process.cwd()
  const env = (options.env ?? process.env) as Record<string, string | undefined>

  const { config: fileConfig, filePath: configFilePath } = await loadConfigFile(cwd, options.configPath)
  const configDir = configFilePath ? dirname(configFilePath) : cwd
  const envConfig = loadEnvVars(env)
  const cliArgs = options.cliArgs ?? {}

  // defaults < file < env < CLI
  const merged = [fileConfig, envConfig, cliArgs].reduce(
    (acc, layer) => deepMerge(acc, layer as Record<string, unknown>),
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
