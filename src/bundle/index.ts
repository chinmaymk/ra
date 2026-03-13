/**
 * Bundle command — compiles a custom ra binary with embedded config, skills, and middleware.
 *
 * Usage: ra bundle --output ./my-agent [--config ./ra.config.yaml]
 *
 * The resulting binary is self-contained and non-extensible:
 *   - Config is baked in (env vars for API keys still work)
 *   - Skills are embedded as string literals
 *   - Middleware is imported at compile time (bundled into the binary)
 *   - No runtime filesystem discovery for config, skills, or middleware
 */
import { join, dirname, isAbsolute, resolve } from 'path'
import { tmpdir } from 'os'
import { mkdir, rm } from 'node:fs/promises'
import { loadConfig } from '../config'
import type { RaConfig } from '../config/types'
import { loadSkills } from '../skills/loader'
import { resolvePath } from '../utils/paths'
import { generateEntryPoint } from './codegen'

export interface BundleOptions {
  output: string
  configPath?: string
  cwd?: string
  name?: string
}

export async function bundle(opts: BundleOptions): Promise<void> {
  const cwd = opts.cwd ?? process.cwd()

  // ── Load config ──────────────────────────────────────────────────
  const config = await loadConfig({
    cwd,
    configPath: opts.configPath,
    env: process.env as Record<string, string | undefined>,
  })

  // ── Resolve output path ──────────────────────────────────────────
  const outputPath = isAbsolute(opts.output) ? opts.output : resolve(cwd, opts.output)

  // ── Collect skills ───────────────────────────────────────────────
  const resolvedSkillDirs = config.skillDirs.map(d => resolvePath(d, config.configDir))
  const skillMap = await loadSkills(resolvedSkillDirs)

  // Also embed skill reference files
  const embeddedSkills: EmbeddedSkill[] = []
  for (const [name, skill] of skillMap) {
    const refs: Record<string, string> = {}
    for (const refPath of skill.references) {
      const content = await Bun.file(join(skill.dir, refPath)).text()
      refs[refPath] = content
    }
    embeddedSkills.push({
      name,
      metadata: skill.metadata,
      body: skill.body,
      references: refs,
      scripts: skill.scripts,
      assets: skill.assets,
    })
  }

  // ── Resolve middleware file paths ────────────────────────────────
  const middlewareImports: MiddlewareImport[] = []
  for (const [hook, entries] of Object.entries(config.middleware ?? {})) {
    for (const entry of entries) {
      // Only file-based middleware can be bundled; inline expressions are embedded as-is
      const isFile = entry.startsWith('./') || entry.startsWith('../') || entry.startsWith('/') || entry.endsWith('.ts') || entry.endsWith('.js')
      if (isFile) {
        const resolved = isAbsolute(entry) ? entry : resolve(config.configDir, entry)
        middlewareImports.push({ hook, type: 'file', path: resolved })
      } else {
        middlewareImports.push({ hook, type: 'inline', expression: entry })
      }
    }
  }

  // ── Generate entry point ─────────────────────────────────────────
  const raSourceDir = join(dirname(new URL(import.meta.url).pathname), '..')
  const entrySource = generateEntryPoint({
    config,
    embeddedSkills,
    middlewareImports,
    raSourceDir,
    binaryName: opts.name ?? 'ra-custom',
  })

  // ── Write temp entry and compile ─────────────────────────────────
  const tmpDir = join(tmpdir(), `ra-bundle-${Date.now()}`)
  await mkdir(tmpDir, { recursive: true })
  const entryPath = join(tmpDir, 'entry.ts')
  await Bun.write(entryPath, entrySource)

  console.error(`[bundle] Config:     ${config.configDir}`)
  console.error(`[bundle] Skills:     ${embeddedSkills.map(s => s.name).join(', ') || '(none)'}`)
  console.error(`[bundle] Middleware: ${middlewareImports.length} hook(s)`)
  console.error(`[bundle] Compiling → ${outputPath}`)

  // Ensure output directory exists
  await mkdir(dirname(outputPath), { recursive: true })

  const result = Bun.spawnSync({
    cmd: [
      'bun', 'build', entryPath,
      '--compile', '--target', 'bun',
      '--outfile', outputPath,
    ],
    cwd: raSourceDir,
    stdout: 'inherit',
    stderr: 'inherit',
  })

  // Cleanup temp directory
  await rm(tmpDir, { recursive: true, force: true })

  if (result.exitCode !== 0) {
    throw new Error(`Compilation failed with exit code ${result.exitCode}`)
  }

  console.error(`[bundle] Done! Binary written to ${outputPath}`)
}

export interface EmbeddedSkill {
  name: string
  metadata: { name: string; description: string; license?: string; compatibility?: string; metadata?: Record<string, string> }
  body: string
  references: Record<string, string>
  scripts: string[]
  assets: string[]
}

export interface MiddlewareImport {
  hook: string
  type: 'file' | 'inline'
  path?: string
  expression?: string
}
