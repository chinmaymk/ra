import { join } from 'path'
import yaml from 'js-yaml'
import { firstSegment } from '../utils/paths'
import { resolveSkillAsset, type Skill, type SkillMetadata, type SkillHook } from './types'
import type { LoopContext, ModelCallContext, MiddlewareConfig } from '../agent/types'

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { frontmatter: {}, body: content }
  const frontmatter = (yaml.load(match[1]!) as Record<string, unknown>) ?? {}
  return { frontmatter, body: match[2] ?? '' }
}

function parseHooks(raw: unknown): SkillHook[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const hooks: SkillHook[] = []
  for (const entry of raw) {
    if (typeof entry === 'string') {
      hooks.push({ run: entry })
    } else if (entry && typeof entry === 'object' && typeof entry.run === 'string') {
      hooks.push({
        run: entry.run,
        ...(typeof entry.as === 'string' && { as: entry.as }),
        ...(typeof entry.label === 'string' && { label: entry.label }),
      })
    }
  }
  return hooks.length > 0 ? hooks : undefined
}

async function listSubdirFiles(skillDir: string, subdir: string): Promise<string[]> {
  const files: string[] = []
  try {
    for await (const name of new Bun.Glob('*').scan({ cwd: join(skillDir, subdir), onlyFiles: true })) {
      files.push(join(subdir, name))
    }
  } catch { /* subdir doesn't exist */ }
  return files
}

async function scanSkillDirs<T>(
  dirs: string[],
  build: (skillDir: string, metadata: SkillMetadata, body: string) => Promise<T>,
): Promise<Map<string, T>> {
  const result = new Map<string, T>()

  for (const dir of dirs) {
    try {
      for await (const rel of new Bun.Glob('*/SKILL.md').scan({ cwd: dir, onlyFiles: true })) {
        const entry = firstSegment(rel)
        const content = await Bun.file(join(dir, rel)).text()
        const { frontmatter, body } = parseFrontmatter(content)

        if (frontmatter['name'] !== entry) continue

        const before = parseHooks(frontmatter['before'])
        const after = parseHooks(frontmatter['after'])
        const metadata: SkillMetadata = {
          name: (frontmatter['name'] as string) ?? entry,
          description: (frontmatter['description'] as string) ?? '',
          license: frontmatter['license'] as string | undefined,
          compatibility: frontmatter['compatibility'] as string | undefined,
          metadata: frontmatter['metadata'] as Record<string, string> | undefined,
          ...(before && { before }),
          ...(after && { after }),
        }

        result.set(entry, await build(join(dir, entry), metadata, body))
      }
    } catch { /* dir doesn't exist */ }
  }

  return result
}

export function loadSkills(dirs: string[]): Promise<Map<string, Skill>> {
  return scanSkillDirs(dirs, async (skillDir, metadata, body) => {
    const [scripts, references, assets] = await Promise.all([
      listSubdirFiles(skillDir, 'scripts'),
      listSubdirFiles(skillDir, 'references'),
      listSubdirFiles(skillDir, 'assets'),
    ])
    return { metadata, body, dir: skillDir, scripts, references, assets }
  })
}

export function loadSkillMetadata(dirs: string[]): Promise<Map<string, SkillMetadata>> {
  return scanSkillDirs(dirs, async (_, metadata) => metadata)
}

export function buildAvailableSkillsXml(skills: Map<string, Skill>, exclude?: Set<string>): string {
  const entries: string[] = []
  for (const [name, skill] of skills) {
    if (exclude?.has(name)) continue
    entries.push(
      `  <skill>\n    <name>${name}</name>\n    <description>${skill.metadata.description}</description>\n    <location>${join(skill.dir, 'SKILL.md')}</location>\n  </skill>`
    )
  }
  if (entries.length === 0) return ''
  return `<available_skills>\n${entries.join('\n')}\n</available_skills>`
}

export function buildActiveSkillXml(skill: Skill): string {
  return `<skill name="${skill.metadata.name}">\n${skill.body}\n</skill>`
}

/**
 * Read the content of a reference file from a skill.
 */
export async function readSkillReference(skill: Skill, refName: string): Promise<string> {
  const rel = resolveSkillAsset(skill.references, refName, 'references')
  if (!rel) throw new Error(`Reference not found: ${refName} in skill ${skill.metadata.name}`)
  return Bun.file(join(skill.dir, rel)).text()
}

async function runHook(hook: SkillHook, cwd: string): Promise<string> {
  const proc = Bun.spawn(['sh', '-c', hook.run], { cwd, stdout: 'pipe', stderr: 'pipe', env: process.env })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exitCode !== 0) {
    throw new Error(`Skill hook "${hook.label ?? hook.run}" exited with code ${exitCode}: ${stderr.trim()}`)
  }
  return stdout
}

/**
 * Build middleware from a skill's before/after hooks.
 * - before → beforeLoopBegin (+ beforeModelCall resolver if `as` is set)
 * - after  → afterLoopComplete
 */
export function buildSkillHookMiddleware(skill: Skill): Partial<MiddlewareConfig> {
  const result: Partial<MiddlewareConfig> = {}
  const captured = new Map<string, string>()

  if (skill.metadata.before?.length) {
    result.beforeLoopBegin = [async () => {
      for (const hook of skill.metadata.before!) {
        const out = await runHook(hook, skill.dir)
        if (hook.as) captured.set(hook.as, out)
      }
    }]

    if (skill.metadata.before.some(h => h.as)) {
      result.beforeModelCall = [async (ctx: ModelCallContext) => {
        for (const msg of ctx.request.messages) {
          if (typeof msg.content !== 'string') continue
          for (const [name, value] of captured) {
            if (msg.content.includes(`@${name}`)) {
              msg.content = msg.content.replaceAll(`@${name}`, value)
            }
          }
        }
      }]
    }
  }

  if (skill.metadata.after?.length) {
    result.afterLoopComplete = [async () => {
      for (const hook of skill.metadata.after!) {
        await runHook(hook, skill.dir)
      }
    }]
  }

  return result
}
