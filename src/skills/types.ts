export interface SkillMetadata {
  name: string
  description: string
  license?: string
  compatibility?: string
  metadata?: Record<string, string>
}

export interface Skill {
  metadata: SkillMetadata
  body: string          // markdown body from SKILL.md (after frontmatter)
  dir: string           // absolute path to skill directory
  scripts: string[]     // relative paths like 'scripts/run.ts'
  references: string[]  // relative paths like 'references/REFERENCE.md'
  assets: string[]      // relative paths like 'assets/template.json'
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
