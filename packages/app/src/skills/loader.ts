import { join } from 'path'
import { firstSegment } from '../utils/paths'
import { resolveSkillAsset, type Skill, type SkillIndex, type SkillMetadata } from './types'
import { parseFrontmatter, extractSkillMetadata } from './frontmatter'

async function listSubdirFiles(skillDir: string, subdir: string): Promise<string[]> {
  const files: string[] = []
  try {
    for await (const name of new Bun.Glob('*').scan({ cwd: join(skillDir, subdir), onlyFiles: true })) {
      files.push(join(subdir, name))
    }
  } catch { /* subdir doesn't exist */ }
  return files
}

/**
 * Scan skill directories for SKILL.md files and return lightweight index entries.
 * Only reads frontmatter — does not load bodies, scripts, or references.
 */
export async function loadSkillIndex(dirs: string[]): Promise<Map<string, SkillIndex>> {
  const result = new Map<string, SkillIndex>()

  for (const dir of dirs) {
    try {
      for await (const rel of new Bun.Glob('*/SKILL.md').scan({ cwd: dir, onlyFiles: true })) {
        const entry = firstSegment(rel)
        const content = await Bun.file(join(dir, rel)).text()
        const { frontmatter } = parseFrontmatter(content)

        if (frontmatter['name'] !== entry) continue

        const metadata = extractSkillMetadata(frontmatter, entry)
        result.set(entry, { metadata, dir: join(dir, entry) })
      }
    } catch { /* dir doesn't exist */ }
  }

  return result
}

/**
 * Load a single skill fully from its index entry.
 * Reads the SKILL.md body and enumerates scripts/, references/, assets/.
 */
export async function loadSkill(index: SkillIndex): Promise<Skill> {
  const content = await Bun.file(join(index.dir, 'SKILL.md')).text()
  const { body } = parseFrontmatter(content)
  const [scripts, references, assets] = await Promise.all([
    listSubdirFiles(index.dir, 'scripts'),
    listSubdirFiles(index.dir, 'references'),
    listSubdirFiles(index.dir, 'assets'),
  ])
  return { ...index, body, scripts, references, assets }
}

export function buildAvailableSkillsXml(skills: Map<string, SkillIndex>, exclude?: Set<string>): string {
  const entries: string[] = []
  for (const [name, skill] of skills) {
    if (exclude?.has(name)) continue
    if (skill.metadata.disableModelInvocation) continue
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
