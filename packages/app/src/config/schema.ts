/**
 * Schema constants shared between the CLI parser, the config loader, and
 * the validator. Lives in `config/` (rather than `interfaces/`) so the
 * dependency graph stays one-directional: interfaces depend on config,
 * never the other way around.
 *
 * The standard env-var mapping and `FLAG_RULES` table are also here so
 * that `loadConfig` (which knows nothing about yargs) can build a config
 * layer from environment variables on its own, using the exact same
 * source of truth the CLI parser uses to populate yargs option defaults.
 */

import { setPath, type CoercionRule } from '../utils/config-helpers'

export const PROVIDERS = [
  'anthropic', 'openai', 'openai-completions', 'google',
  'ollama', 'bedrock', 'azure', 'codex', 'anthropic-agents-sdk',
] as const
export type Provider = typeof PROVIDERS[number]

export const INTERFACE_FLAGS = ['mcp-stdio', 'mcp', 'http', 'inspector', 'cron', 'repl', 'cli'] as const
export type InterfaceFlag = typeof INTERFACE_FLAGS[number]

export const THINKING_LEVELS = ['low', 'medium', 'high'] as const

/**
 * Flags that are only meaningful when --provider is one of these values.
 * Validated only when --provider is explicitly given on the CLI; otherwise
 * the flag passes through (a config file or recipe may set the provider).
 */
export const PROVIDER_SCOPED: Readonly<Record<string, readonly Provider[]>> = {
  'anthropic-base-url': ['anthropic'],
  'openai-base-url':    ['openai', 'openai-completions'],
  'google-base-url':    ['google'],
  'ollama-host':        ['ollama'],
  'bedrock-base-url':   ['bedrock'],
  'azure-endpoint':     ['azure'],
  'azure-deployment':   ['azure'],
}

/**
 * Flags that are only meaningful when one of the listed interface flags is
 * active. Validated only when an interface flag is explicitly given on the
 * CLI; otherwise the flag passes through (config may set the interface).
 */
export const INTERFACE_SCOPED: Readonly<Record<string, readonly InterfaceFlag[]>> = {
  'http-port':        ['http'],
  'http-token':       ['http'],
  'inspector-port':   ['inspector'],
  'run-immediately':  ['cron'],
}

/**
 * Maps each yargs flag to the nested config path it writes to and any
 * type coercion that must happen along the way. Single source of truth
 * shared by parse-args (for the CLI fill) and `buildStandardEnvLayer`
 * below (for the env-var fill in `loadConfig`).
 */
export const FLAG_RULES: Record<string, CoercionRule> = {
  // ── agent section ────────────────────────────────────────────────────
  provider:                      { type: 'string', path: ['agent', 'provider'] },
  model:                         { type: 'string', path: ['agent', 'model'] },
  'system-prompt':               { type: 'string', path: ['agent', 'systemPrompt'] },
  'max-iterations':              { type: 'int',    path: ['agent', 'maxIterations'] },
  thinking:                      { type: 'string', path: ['agent', 'thinking'] },
  'thinking-budget-cap':         { type: 'int',    path: ['agent', 'thinkingBudgetCap'] },
  'tool-timeout':                { type: 'int',    path: ['agent', 'toolTimeout'] },
  'max-tool-response-size':      { type: 'int',    path: ['agent', 'tools', 'maxResponseSize'] },
  'tools-builtin':               { type: 'bool',   path: ['agent', 'tools', 'builtin'], value: true },
  // ── app section ──────────────────────────────────────────────────────
  'anthropic-base-url':          { type: 'string', path: ['app', 'providers', 'anthropic', 'baseURL'] },
  'openai-base-url':             { type: 'string', path: ['app', 'providers', 'openai', 'baseURL'] },
  'google-base-url':             { type: 'string', path: ['app', 'providers', 'google', 'baseURL'] },
  'ollama-host':                 { type: 'string', path: ['app', 'providers', 'ollama', 'host'] },
  'bedrock-base-url':            { type: 'string', path: ['app', 'providers', 'bedrock', 'baseURL'] },
  'azure-endpoint':              { type: 'string', path: ['app', 'providers', 'azure', 'endpoint'] },
  'azure-deployment':            { type: 'string', path: ['app', 'providers', 'azure', 'deployment'] },
  'http-port':                   { type: 'int',    path: ['app', 'http', 'port'] },
  'http-token':                  { type: 'string', path: ['app', 'http', 'token'] },
  'inspector-port':              { type: 'int',    path: ['app', 'inspector', 'port'] },
  'mcp-server-enabled':          { type: 'bool',   path: ['app', 'raMcpServer', 'enabled'], value: true },
  'mcp-server-port':             { type: 'int',    path: ['app', 'raMcpServer', 'port'] },
  'mcp-server-tool-name':        { type: 'string', path: ['app', 'raMcpServer', 'tool', 'name'] },
  'mcp-server-tool-description': { type: 'string', path: ['app', 'raMcpServer', 'tool', 'description'] },
  'data-dir':                    { type: 'string', path: ['app', 'dataDir'] },
  'storage-max-sessions':        { type: 'int',    path: ['app', 'storage', 'maxSessions'] },
  'storage-ttl-days':            { type: 'int',    path: ['app', 'storage', 'ttlDays'] },
  'skill-dir':                   { type: 'string', path: ['agent', 'skillDirs'] },
  // ── credentials (hidden from --help; resolved from env or secrets store) ──
  'anthropic-api-key':           { type: 'string', path: ['app', 'providers', 'anthropic', 'apiKey'] },
  'openai-api-key':              { type: 'string', path: ['app', 'providers', 'openai', 'apiKey'] },
  'google-api-key':              { type: 'string', path: ['app', 'providers', 'google', 'apiKey'] },
  'azure-api-key':               { type: 'string', path: ['app', 'providers', 'azure', 'apiKey'] },
  'aws-access-key-id':           { type: 'string', path: ['app', 'providers', 'bedrock', 'accessKeyId'] },
  'aws-secret-access-key':       { type: 'string', path: ['app', 'providers', 'bedrock', 'secretAccessKey'] },
  'aws-session-token':           { type: 'string', path: ['app', 'providers', 'bedrock', 'sessionToken'] },
  'aws-region':                  { type: 'string', path: ['app', 'providers', 'bedrock', 'region'] },
  'bedrock-api-key':             { type: 'string', path: ['app', 'providers', 'bedrock', 'apiKey'] },
  'codex-access-token':          { type: 'string', path: ['app', 'providers', 'codex', 'accessToken'] },
}

/**
 * Maps each yargs flag (where applicable) to the canonical, ecosystem-standard
 * environment variable that supplies its default. Filled in AFTER the CLI
 * parser's `checkScopedFlags` runs so that having e.g. `OPENAI_BASE_URL` set
 * in your shell does not trip the `--openai-base-url is only valid with
 * --provider openai` check when running `ra --provider anthropic`.
 *
 * Standard names match what each vendor's official SDK reads on its own,
 * so users with existing env setups don't have to learn `RA_*` aliases.
 */
export const STANDARD_ENV: Readonly<Record<string, string>> = {
  // Provider credentials
  'anthropic-api-key':     'ANTHROPIC_API_KEY',
  'openai-api-key':        'OPENAI_API_KEY',
  'google-api-key':        'GOOGLE_API_KEY',
  'azure-api-key':         'AZURE_OPENAI_API_KEY',
  'aws-access-key-id':     'AWS_ACCESS_KEY_ID',
  'aws-secret-access-key': 'AWS_SECRET_ACCESS_KEY',
  'aws-session-token':     'AWS_SESSION_TOKEN',
  'aws-region':            'AWS_REGION',
  'bedrock-api-key':       'AWS_BEDROCK_API_KEY',
  'codex-access-token':    'CODEX_ACCESS_TOKEN',
  // Connection options
  'anthropic-base-url':    'ANTHROPIC_BASE_URL',
  'openai-base-url':       'OPENAI_BASE_URL',
  'google-base-url':       'GOOGLE_BASE_URL',
  'ollama-host':           'OLLAMA_HOST',
  'azure-endpoint':        'AZURE_OPENAI_ENDPOINT',
  'azure-deployment':      'AZURE_OPENAI_DEPLOYMENT',
}

/**
 * Build a nested config layer populated only from standard environment
 * variables (and the secrets store via `buildMergedEnv`). Used by
 * `loadConfig` so it works correctly when called directly without going
 * through `parseArgs`. Single source of truth: `STANDARD_ENV` + `FLAG_RULES`
 * power both this layer-builder and the CLI parser's post-yargs env fill.
 */
export function buildStandardEnvLayer(env: Record<string, string | undefined>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [flag, envName] of Object.entries(STANDARD_ENV)) {
    const v = env[envName]
    if (!v || v.length === 0) continue
    const rule = FLAG_RULES[flag]
    if (!rule) continue
    setPath(result, rule.path, v)
    // --openai-api-key and --openai-base-url apply to both openai and
    // openai-completions providers (they share credentials). Mirror
    // the same dual-mapping the CLI parser does.
    if (flag === 'openai-api-key') {
      setPath(result, ['app', 'providers', 'openai-completions', 'apiKey'], v)
    } else if (flag === 'openai-base-url') {
      setPath(result, ['app', 'providers', 'openai-completions', 'baseURL'], v)
    }
  }
  return result
}
