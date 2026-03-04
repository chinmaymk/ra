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

function safeParseInt(value: string): number | undefined {
  const n = parseInt(value, 10)
  return Number.isNaN(n) ? undefined : n
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

  // HTTP server
  if (env.RA_HTTP_PORT !== undefined)  setInt(['http', 'port'], env.RA_HTTP_PORT)
  if (env.RA_HTTP_TOKEN !== undefined) set(['http', 'token'], env.RA_HTTP_TOKEN)

  // MCP server
  if (env.RA_MCP_SERVER_ENABLED !== undefined)           set(['mcp', 'server', 'enabled'], env.RA_MCP_SERVER_ENABLED === 'true')
  if (env.RA_MCP_SERVER_PORT !== undefined)              setInt(['mcp', 'server', 'port'], env.RA_MCP_SERVER_PORT)
  if (env.RA_MCP_SERVER_TOOL_NAME !== undefined)         set(['mcp', 'server', 'tool', 'name'], env.RA_MCP_SERVER_TOOL_NAME)
  if (env.RA_MCP_SERVER_TOOL_DESCRIPTION !== undefined)  set(['mcp', 'server', 'tool', 'description'], env.RA_MCP_SERVER_TOOL_DESCRIPTION)

  // Storage
  if (env.RA_STORAGE_PATH !== undefined)         set(['storage', 'path'], env.RA_STORAGE_PATH)
  if (env.RA_STORAGE_MAX_SESSIONS !== undefined) setInt(['storage', 'maxSessions'], env.RA_STORAGE_MAX_SESSIONS)
  if (env.RA_STORAGE_TTL_DAYS !== undefined)     setInt(['storage', 'ttlDays'], env.RA_STORAGE_TTL_DAYS)

  // Skills
  if (env.RA_SKILL_DIRS !== undefined) set(['skillDirs'], env.RA_SKILL_DIRS.split(',').filter(Boolean))
  if (env.RA_SKILLS !== undefined)     set(['skills'], env.RA_SKILLS.split(',').filter(Boolean))

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

  // Gateway (OpenAI-compatible AI gateways: Tailscale Aperture, Databricks, LiteLLM, etc.)
  if (env.RA_GATEWAY_URL !== undefined)     set(['providers', 'gateway', 'url'], env.RA_GATEWAY_URL)
  if (env.RA_GATEWAY_API_KEY !== undefined) set(['providers', 'gateway', 'apiKey'], env.RA_GATEWAY_API_KEY)
  if (env.RA_GATEWAY_HEADERS !== undefined) {
    try { set(['providers', 'gateway', 'headers'], JSON.parse(env.RA_GATEWAY_HEADERS)) } catch {}
  }

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

  // Only try loading systemPrompt as a file if it looks like a path
  if (config.systemPrompt && (
    config.systemPrompt.startsWith('/') ||
    config.systemPrompt.startsWith('./') ||
    config.systemPrompt.startsWith('../') ||
    config.systemPrompt.startsWith('~') ||
    config.systemPrompt.endsWith('.txt') ||
    config.systemPrompt.endsWith('.md')
  )) {
    let resolved: string
    if (config.systemPrompt.startsWith('/')) {
      resolved = config.systemPrompt
    } else if (config.systemPrompt.startsWith('~')) {
      const { homedir } = await import('os')
      resolved = join(homedir(), config.systemPrompt.slice(2))
    } else {
      resolved = join(cwd, config.systemPrompt)
    }
    const f = Bun.file(resolved)
    if (await f.exists()) config.systemPrompt = await f.text()
  }

  return config
}
