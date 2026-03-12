import { join, dirname, isAbsolute } from 'path'
import yaml from 'js-yaml'
import { parse as parseToml } from 'smol-toml'
import { resolvePath, looksLikePath } from '../utils/paths'
import { safeParseInt, setPath } from '../utils/config-helpers'
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
  // Walk up the directory tree until a config file is found
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


type EnvMapping = [path: string[], type: 'str' | 'int' | 'bool' | 'csv' | 'enum', values?: string[]]

const ENV_MAP: Record<string, EnvMapping> = {
  RA_PROVIDER: [['provider'], 'str'], RA_MODEL: [['model'], 'str'], RA_INTERFACE: [['interface'], 'str'],
  RA_SYSTEM_PROMPT: [['systemPrompt'], 'str'], RA_MAX_ITERATIONS: [['maxIterations'], 'int'],
  RA_THINKING: [['thinking'], 'enum', ['low', 'medium', 'high']],
  RA_TOOL_TIMEOUT: [['toolTimeout'], 'int'], RA_BUILTIN_TOOLS: [['builtinTools'], 'bool'],
  RA_HTTP_PORT: [['http', 'port'], 'int'], RA_HTTP_TOKEN: [['http', 'token'], 'str'],
  RA_MCP_SERVER_ENABLED: [['mcp', 'server', 'enabled'], 'bool'],
  RA_MCP_SERVER_PORT: [['mcp', 'server', 'port'], 'int'],
  RA_MCP_SERVER_TOOL_NAME: [['mcp', 'server', 'tool', 'name'], 'str'],
  RA_MCP_SERVER_TOOL_DESCRIPTION: [['mcp', 'server', 'tool', 'description'], 'str'],
  RA_MCP_LAZY_SCHEMAS: [['mcp', 'lazySchemas'], 'bool'],
  RA_STORAGE_PATH: [['storage', 'path'], 'str'],
  RA_STORAGE_MAX_SESSIONS: [['storage', 'maxSessions'], 'int'],
  RA_STORAGE_TTL_DAYS: [['storage', 'ttlDays'], 'int'],
  RA_SKILL_DIRS: [['skillDirs'], 'csv'], RA_SKILLS: [['skills'], 'csv'],
  RA_MEMORY_ENABLED: [['memory', 'enabled'], 'bool'], RA_MEMORY_PATH: [['memory', 'path'], 'str'],
  RA_MEMORY_MAX_MEMORIES: [['memory', 'maxMemories'], 'int'],
  RA_MEMORY_TTL_DAYS: [['memory', 'ttlDays'], 'int'],
  RA_MEMORY_INJECT_LIMIT: [['memory', 'injectLimit'], 'int'],
  RA_OBSERVABILITY_ENABLED: [['observability', 'enabled'], 'bool'],
  RA_LOG_LEVEL: [['observability', 'logs', 'level'], 'enum', ['debug', 'info', 'warn', 'error']],
  RA_LOG_OUTPUT: [['observability', 'logs', 'output'], 'enum', ['stderr', 'stdout', 'file', 'session']],
  RA_LOG_FILE: [['observability', 'logs', 'filePath'], 'str'],
  RA_TRACE_OUTPUT: [['observability', 'traces', 'output'], 'enum', ['stderr', 'stdout', 'file', 'session']],
  RA_TRACE_FILE: [['observability', 'traces', 'filePath'], 'str'],
  RA_ANTHROPIC_API_KEY: [['providers', 'anthropic', 'apiKey'], 'str'],
  RA_ANTHROPIC_BASE_URL: [['providers', 'anthropic', 'baseURL'], 'str'],
  RA_OPENAI_API_KEY: [['providers', 'openai', 'apiKey'], 'str'],
  RA_OPENAI_BASE_URL: [['providers', 'openai', 'baseURL'], 'str'],
  RA_GOOGLE_API_KEY: [['providers', 'google', 'apiKey'], 'str'],
  RA_GOOGLE_BASE_URL: [['providers', 'google', 'baseURL'], 'str'],
  RA_OLLAMA_HOST: [['providers', 'ollama', 'host'], 'str'],
  RA_BEDROCK_REGION: [['providers', 'bedrock', 'region'], 'str'],
  RA_BEDROCK_API_KEY: [['providers', 'bedrock', 'apiKey'], 'str'],
  RA_AZURE_API_KEY: [['providers', 'azure', 'apiKey'], 'str'],
  RA_AZURE_ENDPOINT: [['providers', 'azure', 'endpoint'], 'str'],
  RA_AZURE_DEPLOYMENT: [['providers', 'azure', 'deployment'], 'str'],
  RA_AZURE_API_VERSION: [['providers', 'azure', 'apiVersion'], 'str'],
}

function loadEnvVars(env: Record<string, string | undefined>): Record<string, unknown> {
  const r: Record<string, unknown> = {}
  for (const [key, [path, type, values]] of Object.entries(ENV_MAP)) {
    const val = env[key]
    if (val === undefined) continue
    if (type === 'str') setPath(r, path, val)
    else if (type === 'int') { const n = safeParseInt(val); if (n !== undefined) setPath(r, path, n) }
    else if (type === 'bool') setPath(r, path, val === 'true')
    else if (type === 'csv') setPath(r, path, val.split(',').filter(Boolean))
    else if (type === 'enum' && values?.includes(val)) setPath(r, path, val)
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

  // Only try loading systemPrompt as a file if it looks like a path
  if (config.systemPrompt && looksLikePath(config.systemPrompt, ['.txt', '.md'])) {
    const resolved = resolvePath(config.systemPrompt, configDir)
    const f = Bun.file(resolved)
    if (await f.exists()) config.systemPrompt = await f.text()
  }

  return config
}
