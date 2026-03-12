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

function loadEnvVars(env: Record<string, string | undefined>): Record<string, unknown> {
  const r: Record<string, unknown> = {}
  const set = (path: string[], value: unknown) => setPath(r, path, value)
  const setInt = (path: string[], value: string) => { const n = safeParseInt(value); if (n !== undefined) set(path, n) }

  // Top-level
  if (env.RA_PROVIDER !== undefined)       set(['provider'], env.RA_PROVIDER)
  if (env.RA_MODEL !== undefined)          set(['model'], env.RA_MODEL)
  if (env.RA_INTERFACE !== undefined)      set(['interface'], env.RA_INTERFACE)
  if (env.RA_SYSTEM_PROMPT !== undefined)  set(['systemPrompt'], env.RA_SYSTEM_PROMPT)
  if (env.RA_MAX_ITERATIONS !== undefined) setInt(['maxIterations'], env.RA_MAX_ITERATIONS)
  if (env.RA_THINKING !== undefined && ['low', 'medium', 'high'].includes(env.RA_THINKING)) {
    set(['thinking'], env.RA_THINKING)
  }
  if (env.RA_TOOL_TIMEOUT !== undefined) setInt(['toolTimeout'], env.RA_TOOL_TIMEOUT)
  if (env.RA_BUILTIN_TOOLS !== undefined) set(['builtinTools'], env.RA_BUILTIN_TOOLS === 'true')

  // HTTP server
  if (env.RA_HTTP_PORT !== undefined)  setInt(['http', 'port'], env.RA_HTTP_PORT)
  if (env.RA_HTTP_TOKEN !== undefined) set(['http', 'token'], env.RA_HTTP_TOKEN)

  // MCP server
  if (env.RA_MCP_SERVER_ENABLED !== undefined)           set(['mcp', 'server', 'enabled'], env.RA_MCP_SERVER_ENABLED === 'true')
  if (env.RA_MCP_SERVER_PORT !== undefined)              setInt(['mcp', 'server', 'port'], env.RA_MCP_SERVER_PORT)
  if (env.RA_MCP_SERVER_TOOL_NAME !== undefined)         set(['mcp', 'server', 'tool', 'name'], env.RA_MCP_SERVER_TOOL_NAME)
  if (env.RA_MCP_SERVER_TOOL_DESCRIPTION !== undefined)  set(['mcp', 'server', 'tool', 'description'], env.RA_MCP_SERVER_TOOL_DESCRIPTION)
  if (env.RA_MCP_LAZY_SCHEMAS !== undefined)              set(['mcp', 'lazySchemas'], env.RA_MCP_LAZY_SCHEMAS === 'true')

  // Storage
  if (env.RA_STORAGE_PATH !== undefined)         set(['storage', 'path'], env.RA_STORAGE_PATH)
  if (env.RA_STORAGE_MAX_SESSIONS !== undefined) setInt(['storage', 'maxSessions'], env.RA_STORAGE_MAX_SESSIONS)
  if (env.RA_STORAGE_TTL_DAYS !== undefined)     setInt(['storage', 'ttlDays'], env.RA_STORAGE_TTL_DAYS)

  // Skills
  if (env.RA_SKILL_DIRS !== undefined) set(['skillDirs'], env.RA_SKILL_DIRS.split(',').filter(Boolean))
  if (env.RA_SKILLS !== undefined)     set(['skills'], env.RA_SKILLS.split(',').filter(Boolean))

  // Memory
  if (env.RA_MEMORY_ENABLED !== undefined)       set(['memory', 'enabled'], env.RA_MEMORY_ENABLED === 'true')
  if (env.RA_MEMORY_PATH !== undefined)          set(['memory', 'path'], env.RA_MEMORY_PATH)
  if (env.RA_MEMORY_MAX_MEMORIES !== undefined)  setInt(['memory', 'maxMemories'], env.RA_MEMORY_MAX_MEMORIES)
  if (env.RA_MEMORY_TTL_DAYS !== undefined)      setInt(['memory', 'ttlDays'], env.RA_MEMORY_TTL_DAYS)
  if (env.RA_MEMORY_INJECT_LIMIT !== undefined)  setInt(['memory', 'injectLimit'], env.RA_MEMORY_INJECT_LIMIT)

  // Observability
  if (env.RA_OBSERVABILITY_ENABLED !== undefined) set(['observability', 'enabled'], env.RA_OBSERVABILITY_ENABLED === 'true')
  // Logs
  if (env.RA_LOG_LEVEL !== undefined && ['debug', 'info', 'warn', 'error'].includes(env.RA_LOG_LEVEL))
    set(['observability', 'logs', 'level'], env.RA_LOG_LEVEL)
  if (env.RA_LOG_OUTPUT !== undefined && ['stderr', 'stdout', 'file', 'session'].includes(env.RA_LOG_OUTPUT))
    set(['observability', 'logs', 'output'], env.RA_LOG_OUTPUT)
  if (env.RA_LOG_FILE !== undefined) set(['observability', 'logs', 'filePath'], env.RA_LOG_FILE)
  // Traces
  if (env.RA_TRACE_OUTPUT !== undefined && ['stderr', 'stdout', 'file', 'session'].includes(env.RA_TRACE_OUTPUT))
    set(['observability', 'traces', 'output'], env.RA_TRACE_OUTPUT)
  if (env.RA_TRACE_FILE !== undefined) set(['observability', 'traces', 'filePath'], env.RA_TRACE_FILE)

  // Provider credentials — env-only (not CLI flags, to avoid leaking in process list/shell history)
  if (env.RA_ANTHROPIC_API_KEY !== undefined)  set(['providers', 'anthropic', 'apiKey'], env.RA_ANTHROPIC_API_KEY)
  if (env.RA_ANTHROPIC_BASE_URL !== undefined) set(['providers', 'anthropic', 'baseURL'], env.RA_ANTHROPIC_BASE_URL)
  if (env.RA_OPENAI_API_KEY !== undefined)     set(['providers', 'openai', 'apiKey'], env.RA_OPENAI_API_KEY)
  if (env.RA_OPENAI_BASE_URL !== undefined)    set(['providers', 'openai', 'baseURL'], env.RA_OPENAI_BASE_URL)
  if (env.RA_GOOGLE_API_KEY !== undefined)     set(['providers', 'google', 'apiKey'], env.RA_GOOGLE_API_KEY)
  if (env.RA_GOOGLE_BASE_URL !== undefined)    set(['providers', 'google', 'baseURL'], env.RA_GOOGLE_BASE_URL)
  if (env.RA_OLLAMA_HOST !== undefined)        set(['providers', 'ollama', 'host'], env.RA_OLLAMA_HOST)
  if (env.RA_BEDROCK_REGION !== undefined)  set(['providers', 'bedrock', 'region'], env.RA_BEDROCK_REGION)
  if (env.RA_BEDROCK_API_KEY !== undefined) set(['providers', 'bedrock', 'apiKey'], env.RA_BEDROCK_API_KEY)
  if (env.RA_AZURE_API_KEY !== undefined)    set(['providers', 'azure', 'apiKey'], env.RA_AZURE_API_KEY)
  if (env.RA_AZURE_ENDPOINT !== undefined)   set(['providers', 'azure', 'endpoint'], env.RA_AZURE_ENDPOINT)
  if (env.RA_AZURE_DEPLOYMENT !== undefined) set(['providers', 'azure', 'deployment'], env.RA_AZURE_DEPLOYMENT)
  if (env.RA_AZURE_API_VERSION !== undefined) set(['providers', 'azure', 'apiVersion'], env.RA_AZURE_API_VERSION)

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
