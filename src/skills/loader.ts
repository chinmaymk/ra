import { join } from 'path'
import fg from 'fast-glob'
import { readText } from '../utils/fs'
import { firstSegment } from '../utils/paths'
import { resolveSkillAsset, type Skill, type SkillMetadata } from './types'
import { parseFrontmatter, extractSkillMetadata } from './frontmatter'

async function listSubdirFiles(skillDir: string, subdir: string): Promise<string[]> {
  const files: string[] = []
  try {
    const matches = await fg('*', { cwd: join(skillDir, subdir), onlyFiles: true })
    for (const name of matches) {
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
      const matches = await fg('*/SKILL.md', { cwd: dir, onlyFiles: true })
      for (const rel of matches) {
        const entry = firstSegment(rel)
        const content = await readText(join(dir, rel))
        const { frontmatter, body } = parseFrontmatter(content)

        if (frontmatter['name'] !== entry) continue

        const metadata = extractSkillMetadata(frontmatter, entry)

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
  return readText(join(skill.dir, rel))
}
