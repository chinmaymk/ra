import { describe, it, expect } from 'bun:test'
import { loadBuiltinSkills } from '../../src/skills/builtin'
import { buildAvailableSkillsXml } from '../../src/skills/loader'

describe('loadBuiltinSkills', () => {
  it('loads all three built-in skills', () => {
    const skills = loadBuiltinSkills()
    expect(skills.has('write-skill')).toBe(true)
    expect(skills.has('write-recipe')).toBe(true)
    expect(skills.has('write-middleware')).toBe(true)
  })

  it('each skill has metadata and body', () => {
    const skills = loadBuiltinSkills()
    for (const [name, skill] of skills) {
      expect(skill.metadata.name).toBe(name)
      expect(skill.metadata.description).toBeTruthy()
      expect(skill.body).toBeTruthy()
    }
  })

  it('filters out disabled skills', () => {
    const skills = loadBuiltinSkills({ 'write-skill': false })
    expect(skills.has('write-skill')).toBe(false)
    expect(skills.has('write-recipe')).toBe(true)
    expect(skills.has('write-middleware')).toBe(true)
  })

  it('returns all skills when config is empty object', () => {
    const skills = loadBuiltinSkills({})
    expect(skills.size).toBe(3)
  })
})

describe('built-in skills integration with available_skills XML', () => {
  it('built-in skills appear in available_skills XML', () => {
    const skills = loadBuiltinSkills()
    const xml = buildAvailableSkillsXml(skills)
    expect(xml).toContain('<name>write-skill</name>')
    expect(xml).toContain('<name>write-recipe</name>')
    expect(xml).toContain('<name>write-middleware</name>')
  })

  it('built-in skills location uses builtin: prefix', () => {
    const skills = loadBuiltinSkills()
    const xml = buildAvailableSkillsXml(skills)
    expect(xml).toContain('builtin:write-skill/SKILL.md')
  })
})
