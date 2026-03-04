import { join } from 'path'
import yaml from 'js-yaml'
import { parse as parseToml } from 'smol-toml'
import { defaultConfig } from './defaults'
import type { RaConfig, LoadConfigOptions } from './types'

export { defaultConfig } from './defaults'
export type { RaConfig, LoadConfigOptions, McpClientConfig, McpServerConfig } from './types'

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

async function loadConfigFile(cwd: string, configPath?: string): Promise<Partial<RaConfig>> {
  const candidates = configPath
    ? [configPath.startsWith('/') ? configPath : join(cwd, configPath)]
    : CONFIG_FILES.map(name => join(cwd, name))
  for (const full of candidates) {
    if (await Bun.file(full).exists()) return parseFile(full)
  }
  return {}
}

async function parseFile(path: string): Promise<Partial<RaConfig>> {
  const content = await Bun.file(path).text()
  if (path.endsWith('.json')) return JSON.parse(content) as Partial<RaConfig>
  if (path.endsWith('.yaml') || path.endsWith('.yml')) return yaml.load(content) as Partial<RaConfig>
  if (path.endsWith('.toml')) return parseToml(content) as Partial<RaConfig>
  return {}
}

// Sets a deeply nested value at a dot-path without clobbering sibling keys
function setPath(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let cur = obj
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!
    if (cur[key] === undefined || typeof cur[key] !== 'object') cur[key] = {}
    cur = cur[key] as Record<string, unknown>
  }
  cur[path[path.length - 1]!] = value
}

function loadEnvVars(env: Record<string, string | undefined>): Record<string, unknown> {
  const r: Record<string, unknown> = {}
  const set = (path: string[], value: unknown) => setPath(r, path, value)

  // Top-level
  if (env.RA_PROVIDER !== undefined)       set(['provider'], env.RA_PROVIDER)
  if (env.RA_MODEL !== undefined)          set(['model'], env.RA_MODEL)
  if (env.RA_INTERFACE !== undefined)      set(['interface'], env.RA_INTERFACE)
  if (env.RA_SYSTEM_PROMPT !== undefined)  set(['systemPrompt'], env.RA_SYSTEM_PROMPT)
  if (env.RA_MAX_ITERATIONS !== undefined) set(['maxIterations'], parseInt(env.RA_MAX_ITERATIONS, 10))

  // HTTP server
  if (env.RA_HTTP_PORT !== undefined)  set(['http', 'port'], parseInt(env.RA_HTTP_PORT, 10))
  if (env.RA_HTTP_TOKEN !== undefined) set(['http', 'token'], env.RA_HTTP_TOKEN)

  // MCP server
  if (env.RA_MCP_SERVER_ENABLED !== undefined)           set(['mcp', 'server', 'enabled'], env.RA_MCP_SERVER_ENABLED === 'true')
  if (env.RA_MCP_SERVER_PORT !== undefined)              set(['mcp', 'server', 'port'], parseInt(env.RA_MCP_SERVER_PORT, 10))
  if (env.RA_MCP_SERVER_TRANSPORT !== undefined)         set(['mcp', 'server', 'transport'], env.RA_MCP_SERVER_TRANSPORT)
  if (env.RA_MCP_SERVER_TOOL_NAME !== undefined)         set(['mcp', 'server', 'tool', 'name'], env.RA_MCP_SERVER_TOOL_NAME)
  if (env.RA_MCP_SERVER_TOOL_DESCRIPTION !== undefined)  set(['mcp', 'server', 'tool', 'description'], env.RA_MCP_SERVER_TOOL_DESCRIPTION)

  // Storage
  if (env.RA_STORAGE_PATH !== undefined)         set(['storage', 'path'], env.RA_STORAGE_PATH)
  if (env.RA_STORAGE_MAX_SESSIONS !== undefined) set(['storage', 'maxSessions'], parseInt(env.RA_STORAGE_MAX_SESSIONS, 10))
  if (env.RA_STORAGE_TTL_DAYS !== undefined)     set(['storage', 'ttlDays'], parseInt(env.RA_STORAGE_TTL_DAYS, 10))

  // Provider credentials — env-only (not CLI flags, to avoid leaking in process list/shell history)
  if (env.RA_ANTHROPIC_API_KEY !== undefined)  set(['providers', 'anthropic', 'apiKey'], env.RA_ANTHROPIC_API_KEY)
  if (env.RA_ANTHROPIC_BASE_URL !== undefined) set(['providers', 'anthropic', 'baseURL'], env.RA_ANTHROPIC_BASE_URL)
  if (env.RA_OPENAI_API_KEY !== undefined)     set(['providers', 'openai', 'apiKey'], env.RA_OPENAI_API_KEY)
  if (env.RA_OPENAI_BASE_URL !== undefined)    set(['providers', 'openai', 'baseURL'], env.RA_OPENAI_BASE_URL)
  if (env.RA_GOOGLE_API_KEY !== undefined)     set(['providers', 'google', 'apiKey'], env.RA_GOOGLE_API_KEY)
  if (env.RA_OLLAMA_HOST !== undefined)        set(['providers', 'ollama', 'host'], env.RA_OLLAMA_HOST)

  return r
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<RaConfig> {
  const cwd = options.cwd ?? process.cwd()
  const env = (options.env ?? process.env) as Record<string, string | undefined>

  const fileConfig = await loadConfigFile(cwd, options.configPath)
  const envConfig = loadEnvVars(env)
  const cliArgs = options.cliArgs ?? {}

  // defaults < file < env < CLI
  const merged = [fileConfig, envConfig, cliArgs].reduce(
    (acc, layer) => deepMerge(acc, layer as Record<string, unknown>),
    defaultConfig as unknown as Record<string, unknown>,
  )

  const config = merged as unknown as RaConfig
  const f = Bun.file(config.systemPrompt)
  if (await f.exists()) config.systemPrompt = await f.text()

  return config
}
