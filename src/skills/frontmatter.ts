import yaml from 'js-yaml'
import type { SkillMetadata } from './types'

/** Parse YAML frontmatter from a SKILL.md file. */
export function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { frontmatter: {}, body: content }
  const frontmatter = (yaml.load(match[1]!) as Record<string, unknown>) ?? {}
  return { frontmatter, body: match[2] ?? '' }
}

/** Extract SkillMetadata from parsed frontmatter, using `fallbackName` when frontmatter lacks a name. */
export function extractSkillMetadata(frontmatter: Record<string, unknown>, fallbackName: string): SkillMetadata {
  return {
    name: (frontmatter['name'] as string) ?? fallbackName,
    description: (frontmatter['description'] as string) ?? '',
    license: frontmatter['license'] as string | undefined,
    compatibility: frontmatter['compatibility'] as string | undefined,
    metadata: frontmatter['metadata'] as Record<string, string> | undefined,
  }
}
