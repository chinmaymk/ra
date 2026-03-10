import yaml from 'js-yaml'
import type { Skill, SkillMetadata } from './types'

/// <reference path="./builtin-skills.d.ts" />
// Build-time text imports — embedded in the compiled binary
import writeSkillMd from './builtin/write-skill/SKILL.md' with { type: 'text' }
import writeRecipeMd from './builtin/write-recipe/SKILL.md' with { type: 'text' }
import writeMiddlewareMd from './builtin/write-middleware/SKILL.md' with { type: 'text' }

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { frontmatter: {}, body: content }
  const frontmatter = (yaml.load(match[1]!) as Record<string, unknown>) ?? {}
  return { frontmatter, body: match[2] ?? '' }
}

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

    const metadata: SkillMetadata = {
      name: (frontmatter['name'] as string) ?? name,
      description: (frontmatter['description'] as string) ?? '',
      license: frontmatter['license'] as string | undefined,
      compatibility: frontmatter['compatibility'] as string | undefined,
      metadata: frontmatter['metadata'] as Record<string, string> | undefined,
    }

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
