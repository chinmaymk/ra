/**
 * Generates a self-contained TypeScript entry point for a bundled ra binary.
 *
 * The generated file is thin (~50 lines) because all interface logic lives in
 * src/run.ts and all wiring lives in src/bootstrap.ts.  The entry just:
 *   1. Embeds config, skills, and middleware imports
 *   2. Calls loadConfig (env + CLI only, no file discovery)
 *   3. Calls bootstrap() with pre-resolved skills/middleware overrides
 *   4. Calls run() to launch the appropriate interface
 */
import type { RaConfig } from '../config/types'
import type { EmbeddedSkill, MiddlewareImport } from './index'

export interface CodegenOptions {
  config: RaConfig
  embeddedSkills: EmbeddedSkill[]
  middlewareImports: MiddlewareImport[]
  raSourceDir: string
  binaryName: string
}

function escapeString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$')
}

function serializeConfig(config: RaConfig): string {
  const serializable: Record<string, unknown> = { ...config }
  delete serializable.middleware
  delete serializable.configDir
  serializable.skillDirs = []

  return JSON.stringify(serializable, (_, v) => {
    if (typeof v === 'function') return undefined
    return v
  }, 2)
}

export function generateEntryPoint(opts: CodegenOptions): string {
  const { config, embeddedSkills, middlewareImports, raSourceDir, binaryName } = opts

  const lines: string[] = []

  lines.push('#!/usr/bin/env bun')
  lines.push(`// Auto-generated bundled entry point for "${binaryName}"`)
  lines.push(`// Generated at ${new Date().toISOString()}`)
  lines.push(`// This binary is self-contained and non-extensible.`)
  lines.push('')

  // ── Imports from ra source ─────────────────────────────────────
  lines.push(`import { bootstrap } from '${raSourceDir}/bootstrap'`)
  lines.push(`import { loadConfig } from '${raSourceDir}/config'`)
  lines.push(`import { parseArgs } from '${raSourceDir}/interfaces/parse-args'`)
  lines.push(`import { errorMessage } from '${raSourceDir}/utils/errors'`)
  lines.push(`import { readStdin, run } from '${raSourceDir}/run'`)
  lines.push('')

  // ── Middleware imports ──────────────────────────────────────────
  const mwVarNames: Map<string, string[]> = new Map()
  let mwIdx = 0
  for (const mw of middlewareImports) {
    if (mw.type === 'file' && mw.path) {
      const varName = `__mw${mwIdx++}`
      lines.push(`import ${varName} from '${mw.path}'`)
      const hooks = mwVarNames.get(mw.hook) ?? []
      hooks.push(varName)
      mwVarNames.set(mw.hook, hooks)
    }
  }
  lines.push('')

  // ── Embedded config ────────────────────────────────────────────
  lines.push(`const BUNDLED_CONFIG = ${serializeConfig(config)}`)
  lines.push('')

  // ── Embedded skills ────────────────────────────────────────────
  lines.push('const BUNDLED_SKILLS = new Map()')
  for (const skill of embeddedSkills) {
    lines.push(`BUNDLED_SKILLS.set(${JSON.stringify(skill.name)}, {`)
    lines.push(`  metadata: ${JSON.stringify(skill.metadata)},`)
    lines.push(`  body: \`${escapeString(skill.body)}\`,`)
    lines.push(`  dir: 'bundled:${skill.name}',`)
    lines.push(`  scripts: ${JSON.stringify(skill.scripts)},`)
    lines.push(`  references: ${JSON.stringify(skill.references ? Object.keys(skill.references) : [])},`)
    lines.push(`  assets: ${JSON.stringify(skill.assets)},`)
    lines.push('})')
  }
  lines.push('')

  // ── Bundled middleware object ───────────────────────────────────
  lines.push('const BUNDLED_MIDDLEWARE = {')
  const allHooks = new Set<string>()
  for (const mw of middlewareImports) allHooks.add(mw.hook)
  for (const hook of allHooks) {
    const parts: string[] = []
    for (const mw of middlewareImports.filter(m => m.hook === hook)) {
      if (mw.type === 'file') {
        const hookVars = mwVarNames.get(hook) ?? []
        if (hookVars.length > 0) parts.push(hookVars.shift()!)
      } else if (mw.type === 'inline' && mw.expression) {
        parts.push(`(${mw.expression})`)
      }
    }
    lines.push(`  ${hook}: [${parts.join(', ')}],`)
  }
  lines.push('}')
  lines.push('')

  // ── Main function ──────────────────────────────────────────────
  lines.push(`async function main() {
  const parsed = parseArgs(process.argv)

  if (parsed.meta.version) {
    console.log('${binaryName} (bundled ra agent)')
    process.exit(0)
  }
  if (parsed.meta.help) {
    console.log(\`${binaryName} — bundled ra agent

USAGE
  ${binaryName} [options] [prompt]

OPTIONS
  --provider <name>       Override provider
  --model <name>          Override model
  --cli                   Oneshot mode (default when prompt given)
  --repl                  Interactive REPL mode
  --http                  Start HTTP API server
  --mcp                   Start MCP HTTP server
  --mcp-stdio             Start MCP stdio server
  --version, -v           Print version
  --help, -h              Print this help

ENV VARS
  RA_PROVIDER, RA_MODEL, RA_ANTHROPIC_API_KEY, RA_OPENAI_API_KEY, etc.\`)
    process.exit(0)
  }

  // Read piped stdin
  const isNonCliInterface = parsed.config.interface && parsed.config.interface !== 'cli'
  if (!isNonCliInterface) {
    const stdinContent = await readStdin()
    if (stdinContent) {
      parsed.meta.prompt = parsed.meta.prompt
        ? parsed.meta.prompt + '\\n\\n' + stdinContent
        : stdinContent
      parsed.config.interface = 'cli'
    }
  }

  // Load config with env vars + CLI flags only (skip config file discovery — everything is bundled)
  const config = await loadConfig({
    cwd: process.cwd(),
    configPath: '__bundled__',
    cliArgs: parsed.config,
    env: process.env,
  })

  // Overlay bundled config values (bundled takes precedence over defaults)
  const bundled = BUNDLED_CONFIG
  for (const key of Object.keys(bundled)) {
    if (key === 'providers') continue // keep env-var-resolved provider config
    if (parsed.config[key] !== undefined) continue // CLI flags take precedence
    config[key] = bundled[key]
  }

  // Force-merge provider settings from bundled config (except API keys, which come from env)
  if (bundled.providers) {
    for (const [prov, provConfig] of Object.entries(bundled.providers)) {
      if (!provConfig) continue
      for (const [k, v] of Object.entries(provConfig)) {
        if (k.toLowerCase().includes('key') || k.toLowerCase().includes('secret')) continue
        if (!config.providers[prov]) config.providers[prov] = {}
        if (config.providers[prov][k] === undefined) config.providers[prov][k] = v
      }
    }
  }

  // Skip runtime middleware loading — we pass pre-resolved middleware to bootstrap
  config.middleware = {}

  const app = await bootstrap(config, {
    sessionId: parsed.meta.resume,
    skills: BUNDLED_SKILLS,
    middleware: BUNDLED_MIDDLEWARE,
  })

  await run(parsed, app)
}

main().catch((err) => {
  console.error(errorMessage(err))
  process.exit(1)
})`)

  return lines.join('\n')
}
