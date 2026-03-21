import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { loadSkillIndex, loadSkill, buildAvailableSkillsXml, buildActiveSkillXml, readSkillReference } from '../../src/skills/loader'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from '../tmpdir'

const TEST_DIR = tmpdir('ra-test-skills')

beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }))
afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }))

describe('loadSkillIndex', () => {
  it('indexes skill from directory with SKILL.md', async () => {
    mkdirSync(`${TEST_DIR}/greet`, { recursive: true })
    writeFileSync(`${TEST_DIR}/greet/SKILL.md`, '---\nname: greet\ndescription: Greets users warmly\n---\nHello! Greet the user.')
    const index = await loadSkillIndex([TEST_DIR])
    expect(index.get('greet')).toBeDefined()
    expect(index.get('greet')!.metadata.description).toBe('Greets users warmly')
    expect(index.get('greet')!.dir).toContain('greet')
    // Index should NOT have the body (lazy)
    expect((index.get('greet') as any).body).toBeUndefined()
  })

  it('validates name matches directory name', async () => {
    mkdirSync(`${TEST_DIR}/greet`, { recursive: true })
    writeFileSync(`${TEST_DIR}/greet/SKILL.md`, '---\nname: wrong-name\ndescription: Mismatch\n---\nBody')
    const index = await loadSkillIndex([TEST_DIR])
    expect(index.get('greet')).toBeUndefined()
  })

  it('later dirs override earlier ones for same name', async () => {
    const DIR2 = tmpdir('ra-test-skills-2')
    mkdirSync(`${TEST_DIR}/greet`, { recursive: true })
    mkdirSync(`${DIR2}/greet`, { recursive: true })
    writeFileSync(`${TEST_DIR}/greet/SKILL.md`, '---\nname: greet\ndescription: First\n---\nFirst')
    writeFileSync(`${DIR2}/greet/SKILL.md`, '---\nname: greet\ndescription: Second\n---\nSecond')
    const index = await loadSkillIndex([TEST_DIR, DIR2])
    expect(index.get('greet')!.metadata.description).toBe('Second')
    rmSync(DIR2, { recursive: true, force: true })
  })
})

describe('loadSkill', () => {
  it('loads full skill from index entry', async () => {
    mkdirSync(`${TEST_DIR}/greet`, { recursive: true })
    writeFileSync(`${TEST_DIR}/greet/SKILL.md`, '---\nname: greet\ndescription: Greets users warmly\n---\nHello! Greet the user.')
    const index = await loadSkillIndex([TEST_DIR])
    const skill = await loadSkill(index.get('greet')!)
    expect(skill.body).toBe('Hello! Greet the user.')
    expect(skill.metadata.description).toBe('Greets users warmly')
  })

  it('detects scripts directory', async () => {
    mkdirSync(`${TEST_DIR}/fetch/scripts`, { recursive: true })
    writeFileSync(`${TEST_DIR}/fetch/SKILL.md`, '---\nname: fetch\ndescription: Fetches data\n---\nFetch stuff')
    writeFileSync(`${TEST_DIR}/fetch/scripts/run.ts`, 'console.log("fetched")')
    const index = await loadSkillIndex([TEST_DIR])
    const skill = await loadSkill(index.get('fetch')!)
    expect(skill.scripts).toContain('scripts/run.ts')
  })
})

describe('buildAvailableSkillsXml', () => {
  it('generates XML with name, description, and location for each skill', async () => {
    mkdirSync(`${TEST_DIR}/greet`, { recursive: true })
    writeFileSync(`${TEST_DIR}/greet/SKILL.md`, '---\nname: greet\ndescription: Greets users warmly\n---\nHello! Greet the user.')
    const index = await loadSkillIndex([TEST_DIR])
    const xml = buildAvailableSkillsXml(index)
    expect(xml).toContain('<available_skills>')
    expect(xml).toContain('<name>greet</name>')
    expect(xml).toContain('<description>Greets users warmly</description>')
    expect(xml).toContain(`<location>${TEST_DIR}/greet/SKILL.md</location>`)
    expect(xml).toContain('</available_skills>')
  })

  it('returns empty string for empty skill map', () => {
    const xml = buildAvailableSkillsXml(new Map())
    expect(xml).toBe('')
  })

  it('excludes skills listed in the exclude set', async () => {
    mkdirSync(`${TEST_DIR}/greet`, { recursive: true })
    mkdirSync(`${TEST_DIR}/review`, { recursive: true })
    writeFileSync(`${TEST_DIR}/greet/SKILL.md`, '---\nname: greet\ndescription: Greets\n---\nBody')
    writeFileSync(`${TEST_DIR}/review/SKILL.md`, '---\nname: review\ndescription: Reviews\n---\nBody')
    const index = await loadSkillIndex([TEST_DIR])
    const xml = buildAvailableSkillsXml(index, new Set(['greet']))
    expect(xml).not.toContain('<name>greet</name>')
    expect(xml).toContain('<name>review</name>')
  })
})

describe('buildActiveSkillXml', () => {
  it('wraps skill body in skill XML tags', async () => {
    mkdirSync(`${TEST_DIR}/greet`, { recursive: true })
    writeFileSync(`${TEST_DIR}/greet/SKILL.md`, '---\nname: greet\ndescription: Greets users warmly\n---\nHello! Greet the user.')
    const index = await loadSkillIndex([TEST_DIR])
    const skill = await loadSkill(index.get('greet')!)
    const xml = buildActiveSkillXml(skill)
    expect(xml).toBe('<skill name="greet">\nHello! Greet the user.\n</skill>')
  })
})

describe('readSkillReference', () => {
  it('reads a reference file by full path', async () => {
    mkdirSync(`${TEST_DIR}/review/references`, { recursive: true })
    writeFileSync(`${TEST_DIR}/review/SKILL.md`, '---\nname: review\ndescription: Review\n---\nBody')
    writeFileSync(`${TEST_DIR}/review/references/guide.md`, '# Style Guide\nUse consistent naming.')
    const index = await loadSkillIndex([TEST_DIR])
    const skill = await loadSkill(index.get('review')!)
    const content = await readSkillReference(skill, 'references/guide.md')
    expect(content).toContain('Style Guide')
  })

  it('reads a reference file by short name', async () => {
    mkdirSync(`${TEST_DIR}/review/references`, { recursive: true })
    writeFileSync(`${TEST_DIR}/review/SKILL.md`, '---\nname: review\ndescription: Review\n---\nBody')
    writeFileSync(`${TEST_DIR}/review/references/guide.md`, '# Style Guide')
    const index = await loadSkillIndex([TEST_DIR])
    const skill = await loadSkill(index.get('review')!)
    const content = await readSkillReference(skill, 'guide.md')
    expect(content).toContain('Style Guide')
  })

  it('throws for nonexistent reference', async () => {
    mkdirSync(`${TEST_DIR}/review`, { recursive: true })
    writeFileSync(`${TEST_DIR}/review/SKILL.md`, '---\nname: review\ndescription: Review\n---\nBody')
    const index = await loadSkillIndex([TEST_DIR])
    const skill = await loadSkill(index.get('review')!)
    await expect(readSkillReference(skill, 'nonexistent.md')).rejects.toThrow('Reference not found')
  })
})
