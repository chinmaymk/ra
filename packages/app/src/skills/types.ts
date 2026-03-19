export interface SkillMetadata {
  name: string
  description: string
  /** When true, the skill is hidden from the model's available skills list.
   *  It can still be activated by the user via /skill-name in their prompt. */
  disableModelInvocation?: boolean
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

/** Source information for a package installed from a registry */
export interface PackageSource {
  registry: 'npm' | 'github' | 'url' | 'builtin'
  package?: string      // npm package name
  repo?: string         // github owner/repo
  url?: string          // raw URL
  version?: string      // installed version
  recipeName?: string   // builtin recipe name
  installedAt: string   // ISO timestamp
}

/** @deprecated Use PackageSource */
export type SkillSource = PackageSource
