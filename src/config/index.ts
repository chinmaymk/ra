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

function loadEnvVars(env: Record<string, string | undefined>): Partial<RaConfig> {
  const result: Partial<RaConfig> = {}
  if (env.RA_PROVIDER !== undefined) result.provider = env.RA_PROVIDER as RaConfig['provider']
  if (env.RA_MODEL !== undefined) result.model = env.RA_MODEL
  if (env.RA_INTERFACE !== undefined) result.interface = env.RA_INTERFACE as RaConfig['interface']
  if (env.RA_SYSTEM_PROMPT !== undefined) result.systemPrompt = env.RA_SYSTEM_PROMPT
  if (env.RA_MAX_ITERATIONS !== undefined) result.maxIterations = parseInt(env.RA_MAX_ITERATIONS, 10)
  return result
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
