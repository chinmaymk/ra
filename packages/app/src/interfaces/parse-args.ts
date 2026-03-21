import { parseArgs as utilParseArgs } from 'util'
import { setPath, applyRule, type CoercionRule } from '../utils/config-helpers'
import type { RaConfig } from '../config/types'

export interface SkillCommand {
  action: 'install' | 'remove' | 'list'
  args: string[]
}

export interface ParsedArgsMeta {
  help: boolean
  version: boolean
  files: string[]
  prompt?: string
  resume: boolean
  configPath?: string
  exec?: string
  showContext: boolean
  showConfig: boolean
  listMemories: boolean
  memories?: string
  forget?: string
  skillCommand?: SkillCommand
}

export interface ParsedArgs {
  config: Partial<RaConfig>
  meta: ParsedArgsMeta
}

// Maps CLI flag names to config paths with type coercion
const FLAG_RULES: Record<string, CoercionRule> = {
  // ── agent section ────────────────────────────────────────────────────
  provider:                      { type: 'string', path: ['agent', 'provider'] },
  model:                         { type: 'string', path: ['agent', 'model'] },
  'system-prompt':               { type: 'string', path: ['agent', 'systemPrompt'] },
  'max-iterations':              { type: 'int',    path: ['agent', 'maxIterations'] },
  thinking:                      { type: 'string', path: ['agent', 'thinking'] },
  'tool-timeout':                { type: 'int',    path: ['agent', 'toolTimeout'] },
  'max-tool-response-size':      { type: 'int',    path: ['agent', 'tools', 'maxResponseSize'] },
  'tools-builtin':               { type: 'bool',   path: ['agent', 'tools', 'builtin'], value: true },
  'anthropic-base-url':          { type: 'string', path: ['agent', 'providers', 'anthropic', 'baseURL'] },
  'openai-base-url':             { type: 'string', path: ['agent', 'providers', 'openai', 'baseURL'] },
  'google-base-url':             { type: 'string', path: ['agent', 'providers', 'google', 'baseURL'] },
  'ollama-host':                 { type: 'string', path: ['agent', 'providers', 'ollama', 'host'] },
  'azure-endpoint':              { type: 'string', path: ['agent', 'providers', 'azure', 'endpoint'] },
  'azure-deployment':            { type: 'string', path: ['agent', 'providers', 'azure', 'deployment'] },
  // ── app section ──────────────────────────────────────────────────────
  'http-port':                   { type: 'int',    path: ['app', 'http', 'port'] },
  'http-token':                  { type: 'string', path: ['app', 'http', 'token'] },
  'inspector-port':              { type: 'int',    path: ['app', 'inspector', 'port'] },
  'mcp-server-enabled':          { type: 'bool',   path: ['app', 'mcp', 'server', 'enabled'], value: true },
  'mcp-server-port':             { type: 'int',    path: ['app', 'mcp', 'server', 'port'] },
  'mcp-server-tool-name':        { type: 'string', path: ['app', 'mcp', 'server', 'tool', 'name'] },
  'mcp-server-tool-description': { type: 'string', path: ['app', 'mcp', 'server', 'tool', 'description'] },
  'data-dir':                    { type: 'string', path: ['app', 'dataDir'] },
  'storage-max-sessions':        { type: 'int',    path: ['app', 'storage', 'maxSessions'] },
  'storage-ttl-days':            { type: 'int',    path: ['app', 'storage', 'ttlDays'] },
  'skill-dir':                   { type: 'string', path: ['app', 'skillDirs'] },
}

export function parseArgs(argv: string[]): ParsedArgs {
  const isScriptPath = argv[1] !== undefined && (
    /\.(ts|js|mjs|cjs)$/.test(argv[1]) || argv[1].startsWith('/$bunfs/')
  )
  const userArgs = argv.slice(isScriptPath ? 2 : 1)

  // Check for skill subcommand: ra skill install|remove|list [args...]
  if (userArgs[0] === 'skill' && userArgs[1] && ['install', 'remove', 'list'].includes(userArgs[1])) {
    const action = userArgs[1] as 'install' | 'remove' | 'list'
    const subArgs = userArgs.slice(2)
    return {
      config: {},
      meta: {
        help: false,
        version: false,
        showContext: false,
        showConfig: false,
        listMemories: false,
        files: [],
        skillCommand: { action, args: subArgs },
      },
    }
  }

  const { values, positionals } = utilParseArgs({
    args: userArgs,
    options: {
      // Meta (not mapped to RaConfig)
      exec:                          { type: 'string' },
      config:                        { type: 'string' },
      file:                          { type: 'string', multiple: true },
      resume:                        { type: 'boolean' },
      help:                          { type: 'boolean', short: 'h' },
      version:                       { type: 'boolean', short: 'v' },
      'show-context':                { type: 'boolean' },
      'show-config':              { type: 'boolean' },
      // Interface selection → config.interface
      http:                          { type: 'boolean' },
      cli:                           { type: 'boolean' },
      repl:                          { type: 'boolean' },
      mcp:                           { type: 'boolean' },
      'mcp-stdio':                   { type: 'boolean' },
      inspector:                     { type: 'boolean' },
      // Top-level config
      provider:                      { type: 'string' },
      model:                         { type: 'string' },
      'system-prompt':               { type: 'string' },
      'max-iterations':              { type: 'string' },
      'thinking':                    { type: 'string' },
      'tool-timeout':                { type: 'string' },
      'max-tool-response-size':      { type: 'string' },
      'tools-builtin':               { type: 'boolean' },
      // HTTP server
      'http-port':                   { type: 'string' },
      'http-token':                  { type: 'string' },
      // Inspector
      'inspector-port':              { type: 'string' },
      // MCP server
      'mcp-server-enabled':          { type: 'boolean' },
      'mcp-server-port':             { type: 'string' },
      'mcp-server-tool-name':        { type: 'string' },
      'mcp-server-tool-description': { type: 'string' },
      // Memory
      'memory':                      { type: 'boolean' },
      'list-memories':               { type: 'boolean' },
      'memories':                    { type: 'string' },
      'forget':                      { type: 'string' },
      // Data directory & storage
      'data-dir':                    { type: 'string' },
      'storage-max-sessions':        { type: 'string' },
      'storage-ttl-days':            { type: 'string' },
      // Skills
      'skill-dir':                   { type: 'string', multiple: true },
      // Provider connection options (non-sensitive)
      'anthropic-base-url':          { type: 'string' },
      'openai-base-url':             { type: 'string' },
      'google-base-url':             { type: 'string' },
      'ollama-host':                 { type: 'string' },
      'azure-endpoint':              { type: 'string' },
      'azure-deployment':            { type: 'string' },
    },
    strict: false,
    allowPositionals: true,
  })

  const r: Record<string, unknown> = {}

  // Interface selection (first match wins, order matters: mcp-stdio before mcp)
  const interfaceFlags = ['mcp-stdio', 'mcp', 'http', 'inspector', 'repl', 'cli'] as const
  for (const flag of interfaceFlags) {
    if (values[flag]) { setPath(r, ['app', 'interface'], flag); break }
  }

  // Apply declarative flag rules
  for (const [flag, rule] of Object.entries(FLAG_RULES)) {
    const val = values[flag]
    if (val !== undefined) applyRule(r, rule, val as string | boolean)
  }

  // Memory — --memories, --list-memories, and --forget imply --memory
  if (values['memory'] || values['list-memories'] || values['memories'] || values['forget']) setPath(r, ['agent', 'memory', 'enabled'], true)

  return {
    config: r as Partial<RaConfig>,
    meta: {
      help:         (values.help as boolean | undefined) ?? false,
      version:      (values.version as boolean | undefined) ?? false,
      showContext:   (values['show-context'] as boolean | undefined) ?? false,
      showConfig:  (values['show-config'] as boolean | undefined) ?? false,
      listMemories:  (values['list-memories'] as boolean | undefined) ?? false,
      memories:      values.memories as string | undefined,
      forget:        values.forget as string | undefined,
      files:      (values.file as string[] | undefined) ?? [],
      prompt:     positionals.join(' ') || undefined,
      resume:     (values.resume as boolean | undefined) ?? false,
      configPath: values.config as string | undefined,
      exec:       values.exec as string | undefined,
    },
  }
}
