export interface SkillMetadata {
  name: string
  description: string
  license?: string
  compatibility?: string
  metadata?: Record<string, string>
}

/** Lightweight skill index entry — loaded eagerly during bootstrap. */
export interface SkillIndex {
  metadata: SkillMetadata
  dir: string           // absolute path to skill directory
}

/** Full skill — loaded lazily on first reference. */
export interface Skill extends SkillIndex {
  body: string          // markdown body from SKILL.md (after frontmatter)
  scripts: string[]     // relative paths like 'scripts/run.ts'
  references: string[]  // relative paths like 'references/REFERENCE.md'
  assets: string[]      // relative paths like 'assets/template.json'
}

/** Resolve an asset name against a list of relative paths (e.g. "run.ts" matches "scripts/run.ts"). */
export function resolveSkillAsset(list: string[], name: string, prefix: string): string | undefined {
  const prefixed = `${prefix}/${name}`
  const prefixedWin = `${prefix}\\${name}`
  return list.find(entry => entry === name || entry === prefixed || entry === prefixedWin)
}

/** Source information for a skill installed from a registry */
export interface SkillSource {
  registry: 'npm' | 'github' | 'url'
  package?: string      // npm package name
  repo?: string         // github owner/repo
  url?: string          // raw URL
  version?: string      // installed version
  installedAt: string   // ISO timestamp
}
