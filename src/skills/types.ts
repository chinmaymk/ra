export interface SkillMetadata {
  name: string
  description: string
  license?: string
  compatibility?: string
  metadata?: Record<string, string>
  allowedTools?: string[]
}

export interface Skill {
  metadata: SkillMetadata
  body: string          // markdown body from SKILL.md (after frontmatter)
  dir: string           // absolute path to skill directory
  scripts: string[]     // relative paths like 'scripts/run.ts'
  references: string[]  // relative paths like 'references/REFERENCE.md'
  assets: string[]      // relative paths like 'assets/template.json'
}
