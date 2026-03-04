import { parseArgs as utilParseArgs } from 'util'
import type { RaConfig } from '../config/types'

export interface ParsedArgsMeta {
  help: boolean
  files: string[]
  skills: string[]
  prompt?: string
  resume?: string
  configPath?: string
}

export interface ParsedArgs {
  config: Partial<RaConfig>
  meta: ParsedArgsMeta
}

function setPath(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let cur = obj
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!
    if (cur[key] === undefined || typeof cur[key] !== 'object') cur[key] = {}
    cur = cur[key] as Record<string, unknown>
  }
  cur[path[path.length - 1]!] = value
}

export function parseArgs(argv: string[]): ParsedArgs {
  const isScriptPath = argv[1] !== undefined && (
    /\.(ts|js|mjs|cjs)$/.test(argv[1]) || argv[1].startsWith('/$bunfs/')
  )
  const userArgs = argv.slice(isScriptPath ? 2 : 1)

  const { values, positionals } = utilParseArgs({
    args: userArgs,
    options: {
      // Meta (not mapped to RaConfig)
      config:                        { type: 'string' },
      skill:                         { type: 'string', multiple: true },
      file:                          { type: 'string', multiple: true },
      resume:                        { type: 'string' },
      help:                          { type: 'boolean', short: 'h' },
      // Interface selection → config.interface
      http:                          { type: 'boolean' },
      cli:                           { type: 'boolean' },
      repl:                          { type: 'boolean' },
      mcp:                           { type: 'boolean' },
      // Top-level config
      provider:                      { type: 'string' },
      model:                         { type: 'string' },
      'system-prompt':               { type: 'string' },
      'max-iterations':              { type: 'string' },
      'thinking':                    { type: 'string' },
      // HTTP server
      'http-port':                   { type: 'string' },
      'http-token':                  { type: 'string' },
      // MCP server
      'mcp-server-enabled':          { type: 'boolean' },
      'mcp-server-port':             { type: 'string' },
      'mcp-server-transport':        { type: 'string' },
      'mcp-server-tool-name':        { type: 'string' },
      'mcp-server-tool-description': { type: 'string' },
      // Storage
      'storage-path':                { type: 'string' },
      'storage-max-sessions':        { type: 'string' },
      'storage-ttl-days':            { type: 'string' },
      // Skills
      'skill-dir':                   { type: 'string', multiple: true },
      // Provider connection options (non-sensitive)
      'anthropic-base-url':          { type: 'string' },
      'openai-base-url':             { type: 'string' },
      'ollama-host':                 { type: 'string' },
    },
    strict: false,
    allowPositionals: true,
  })

  const r: Record<string, unknown> = {}
  const set = (path: string[], value: unknown) => setPath(r, path, value)

  // Interface selection
  if (values.mcp)       set(['interface'], 'mcp')
  else if (values.http) set(['interface'], 'http')
  else if (values.repl) set(['interface'], 'repl')
  else if (values.cli)  set(['interface'], 'cli')

  // Top-level
  if (values.provider)           set(['provider'], values.provider)
  if (values.model)              set(['model'], values.model)
  if (values['system-prompt'])   set(['systemPrompt'], values['system-prompt'])
  if (values['max-iterations'])  set(['maxIterations'], parseInt(values['max-iterations'] as string, 10))
  if (values['thinking'])        set(['thinking'], values['thinking'])

  // HTTP server
  if (values['http-port'])   set(['http', 'port'], parseInt(values['http-port'] as string, 10))
  if (values['http-token'])  set(['http', 'token'], values['http-token'])

  // MCP server
  if (values['mcp-server-enabled'])          set(['mcp', 'server', 'enabled'], true)
  if (values['mcp-server-port'])             set(['mcp', 'server', 'port'], parseInt(values['mcp-server-port'] as string, 10))
  if (values['mcp-server-transport'])        set(['mcp', 'server', 'transport'], values['mcp-server-transport'])
  if (values['mcp-server-tool-name'])        set(['mcp', 'server', 'tool', 'name'], values['mcp-server-tool-name'])
  if (values['mcp-server-tool-description']) set(['mcp', 'server', 'tool', 'description'], values['mcp-server-tool-description'])

  // Storage
  if (values['storage-path'])          set(['storage', 'path'], values['storage-path'])
  if (values['storage-max-sessions'])  set(['storage', 'maxSessions'], parseInt(values['storage-max-sessions'] as string, 10))
  if (values['storage-ttl-days'])      set(['storage', 'ttlDays'], parseInt(values['storage-ttl-days'] as string, 10))

  // Skills
  if (values['skill-dir']) set(['skillDirs'], values['skill-dir'])

  // Provider connection options
  if (values['anthropic-base-url']) set(['providers', 'anthropic', 'baseURL'], values['anthropic-base-url'])
  if (values['openai-base-url'])    set(['providers', 'openai', 'baseURL'], values['openai-base-url'])
  if (values['ollama-host'])        set(['providers', 'ollama', 'host'], values['ollama-host'])

  return {
    config: r as Partial<RaConfig>,
    meta: {
      help:       (values.help as boolean | undefined) ?? false,
      files:      (values.file as string[] | undefined) ?? [],
      skills:     (values.skill as string[] | undefined) ?? [],
      prompt:     positionals.join(' ') || undefined,
      resume:     values.resume as string | undefined,
      configPath: values.config as string | undefined,
    },
  }
}
