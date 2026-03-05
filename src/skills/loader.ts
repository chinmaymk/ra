import { join } from 'path'
import yaml from 'js-yaml'
import type { Skill, SkillMetadata } from './types'

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { frontmatter: {}, body: content }
  const frontmatter = (yaml.load(match[1]!) as Record<string, unknown>) ?? {}
  return { frontmatter, body: match[2] ?? '' }
}

async function listSubdirFiles(skillDir: string, subdir: string): Promise<string[]> {
  const files: string[] = []
  try {
    for await (const name of new Bun.Glob('*').scan({ cwd: join(skillDir, subdir), onlyFiles: true })) {
      files.push(`${subdir}/${name}`)
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
        const entry = rel.split('/')[0]!
        const content = await Bun.file(join(dir, rel)).text()
        const { frontmatter, body } = parseFrontmatter(content)

        if (frontmatter['name'] !== entry) continue

        const metadata: SkillMetadata = {
          name: (frontmatter['name'] as string) ?? entry,
          description: (frontmatter['description'] as string) ?? '',
          license: frontmatter['license'] as string | undefined,
          compatibility: frontmatter['compatibility'] as string | undefined,
          metadata: frontmatter['metadata'] as Record<string, string> | undefined,
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
