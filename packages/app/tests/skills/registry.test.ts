import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { defaultSkillInstallDir, listInstalledSkills, removeSkill } from '../../src/skills/registry'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from '../tmpdir'

const TEST_DIR = tmpdir('ra-test-registry')

beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }))
afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }))

describe('defaultSkillInstallDir', () => {
  it('returns a path under home directory', () => {
    const dir = defaultSkillInstallDir()
    expect(dir).toContain('.ra')
    expect(dir).toContain('skills')
  })
})

describe('listInstalledSkills', () => {
  it('returns empty list when no skills', async () => {
    const skills = await listInstalledSkills(TEST_DIR)
    expect(skills).toEqual([])
  })

  it('lists skills with SKILL.md', async () => {
    mkdirSync(`${TEST_DIR}/review`, { recursive: true })
    writeFileSync(`${TEST_DIR}/review/SKILL.md`, '---\nname: review\ndescription: Review\n---\nBody')
    const skills = await listInstalledSkills(TEST_DIR)
    expect(skills).toHaveLength(1)
    expect(skills[0]!.name).toBe('review')
  })

  it('includes source info when available', async () => {
    mkdirSync(`${TEST_DIR}/review`, { recursive: true })
    writeFileSync(`${TEST_DIR}/review/SKILL.md`, '---\nname: review\ndescription: Review\n---\nBody')
    writeFileSync(`${TEST_DIR}/review/.source.json`, JSON.stringify({
      registry: 'npm',
      package: 'ra-skill-review',
      version: '1.0.0',
      installedAt: '2026-01-01T00:00:00.000Z',
    }))
    const skills = await listInstalledSkills(TEST_DIR)
    expect(skills[0]!.source).toBeDefined()
    expect(skills[0]!.source!.registry).toBe('npm')
    expect(skills[0]!.source!.package).toBe('ra-skill-review')
  })
})

describe('removeSkill', () => {
  it('removes a skill directory', async () => {
    mkdirSync(`${TEST_DIR}/review`, { recursive: true })
    writeFileSync(`${TEST_DIR}/review/SKILL.md`, '---\nname: review\ndescription: Review\n---\nBody')
    await removeSkill('review', TEST_DIR)
    expect(existsSync(`${TEST_DIR}/review`)).toBe(false)
  })

  it('throws for nonexistent skill', async () => {
    await expect(removeSkill('nonexistent', TEST_DIR)).rejects.toThrow('Skill not found')
  })
})
