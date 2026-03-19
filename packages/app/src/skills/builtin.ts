import type { Skill } from './types'
import { parseFrontmatter, extractSkillMetadata } from './frontmatter'

/// <reference path="./builtin-skills.d.ts" />
// Build-time text imports — embedded in the compiled binary
import writeSkillMd from './builtin/write-skill/SKILL.md' with { type: 'text' }
import writeRecipeMd from './builtin/write-recipe/SKILL.md' with { type: 'text' }
import writeMiddlewareMd from './builtin/write-middleware/SKILL.md' with { type: 'text' }

const builtinSources: [string, string][] = [
  ['write-skill', writeSkillMd],
  ['write-recipe', writeRecipeMd],
  ['write-middleware', writeMiddlewareMd],
]

export function loadBuiltinSkills(config: Record<string, boolean> = {}): Map<string, Skill> {
  const skills = new Map<string, Skill>()

  for (const [name, content] of builtinSources) {
    if (config[name] === false) continue

    const { frontmatter, body } = parseFrontmatter(content)
    const metadata = extractSkillMetadata(frontmatter, name)

    skills.set(name, {
      metadata,
      body,
      dir: `builtin:${name}`,
      scripts: [],
      references: [],
      assets: [],
    })
  }

  return skills
}
