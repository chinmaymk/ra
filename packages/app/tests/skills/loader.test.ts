import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { loadSkills, loadSkillMetadata, buildAvailableSkillsXml, buildActiveSkillXml, readSkillReference } from '../../src/skills/loader'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from '../tmpdir'

const TEST_DIR = tmpdir('ra-test-skills')

beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }))
afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }))

describe('loadSkills', () => {
  it('loads skill from directory with SKILL.md', async () => {
    mkdirSync(`${TEST_DIR}/greet`, { recursive: true })
    writeFileSync(`${TEST_DIR}/greet/SKILL.md`, '---\nname: greet\ndescription: Greets users warmly\n---\nHello! Greet the user.')
    const skills = await loadSkills([TEST_DIR])
    expect(skills.get('greet')).toBeDefined()
    expect(skills.get('greet')!.body).toBe('Hello! Greet the user.')
    expect(skills.get('greet')!.metadata.description).toBe('Greets users warmly')
  })

  it('validates name matches directory name', async () => {
    mkdirSync(`${TEST_DIR}/greet`, { recursive: true })
    writeFileSync(`${TEST_DIR}/greet/SKILL.md`, '---\nname: wrong-name\ndescription: Mismatch\n---\nBody')
    const skills = await loadSkills([TEST_DIR])
    expect(skills.get('greet')).toBeUndefined()
  })

  it('detects scripts directory', async () => {
    mkdirSync(`${TEST_DIR}/fetch/scripts`, { recursive: true })
    writeFileSync(`${TEST_DIR}/fetch/SKILL.md`, '---\nname: fetch\ndescription: Fetches data\n---\nFetch stuff')
    writeFileSync(`${TEST_DIR}/fetch/scripts/run.ts`, 'console.log("fetched")')
    const skills = await loadSkills([TEST_DIR])
    expect(skills.get('fetch')!.scripts).toContain('scripts/run.ts')
  })

  it('progressive disclosure: loadSkillMetadata only loads name + description', async () => {
    mkdirSync(`${TEST_DIR}/heavy`, { recursive: true })
    writeFileSync(`${TEST_DIR}/heavy/SKILL.md`, '---\nname: heavy\ndescription: Heavy skill\n---\nVery long body...')
    const metadata = await loadSkillMetadata([TEST_DIR])
    expect(metadata.get('heavy')!.name).toBe('heavy')
    expect(metadata.get('heavy')!.description).toBe('Heavy skill')
    expect((metadata.get('heavy') as any).body).toBeUndefined()
  })

  it('later dirs override earlier ones for same name', async () => {
    const DIR2 = tmpdir('ra-test-skills-2')
    mkdirSync(`${TEST_DIR}/greet`, { recursive: true })
    mkdirSync(`${DIR2}/greet`, { recursive: true })
    writeFileSync(`${TEST_DIR}/greet/SKILL.md`, '---\nname: greet\ndescription: First\n---\nFirst')
    writeFileSync(`${DIR2}/greet/SKILL.md`, '---\nname: greet\ndescription: Second\n---\nSecond')
    const skills = await loadSkills([TEST_DIR, DIR2])
    expect(skills.get('greet')!.metadata.description).toBe('Second')
    rmSync(DIR2, { recursive: true, force: true })
  })
})

describe('buildAvailableSkillsXml', () => {
  it('generates XML with name, description, and location for each skill', async () => {
    mkdirSync(`${TEST_DIR}/greet`, { recursive: true })
    writeFileSync(`${TEST_DIR}/greet/SKILL.md`, '---\nname: greet\ndescription: Greets users warmly\n---\nHello! Greet the user.')
    const skills = await loadSkills([TEST_DIR])
    const xml = buildAvailableSkillsXml(skills)
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
    const skills = await loadSkills([TEST_DIR])
    const xml = buildAvailableSkillsXml(skills, new Set(['greet']))
    expect(xml).not.toContain('<name>greet</name>')
    expect(xml).toContain('<name>review</name>')
  })
})

describe('buildActiveSkillXml', () => {
  it('wraps skill body in skill XML tags', async () => {
    mkdirSync(`${TEST_DIR}/greet`, { recursive: true })
    writeFileSync(`${TEST_DIR}/greet/SKILL.md`, '---\nname: greet\ndescription: Greets users warmly\n---\nHello! Greet the user.')
    const skills = await loadSkills([TEST_DIR])
    const xml = buildActiveSkillXml(skills.get('greet')!)
    expect(xml).toBe('<skill name="greet">\nHello! Greet the user.\n</skill>')
  })
})

describe('readSkillReference', () => {
  it('reads a reference file by full path', async () => {
    mkdirSync(`${TEST_DIR}/review/references`, { recursive: true })
    writeFileSync(`${TEST_DIR}/review/SKILL.md`, '---\nname: review\ndescription: Review\n---\nBody')
    writeFileSync(`${TEST_DIR}/review/references/guide.md`, '# Style Guide\nUse consistent naming.')
    const skills = await loadSkills([TEST_DIR])
    const skill = skills.get('review')!
    const content = await readSkillReference(skill, 'references/guide.md')
    expect(content).toContain('Style Guide')
  })

  it('reads a reference file by short name', async () => {
    mkdirSync(`${TEST_DIR}/review/references`, { recursive: true })
    writeFileSync(`${TEST_DIR}/review/SKILL.md`, '---\nname: review\ndescription: Review\n---\nBody')
    writeFileSync(`${TEST_DIR}/review/references/guide.md`, '# Style Guide')
    const skills = await loadSkills([TEST_DIR])
    const skill = skills.get('review')!
    const content = await readSkillReference(skill, 'guide.md')
    expect(content).toContain('Style Guide')
  })

  it('throws for nonexistent reference', async () => {
    mkdirSync(`${TEST_DIR}/review`, { recursive: true })
    writeFileSync(`${TEST_DIR}/review/SKILL.md`, '---\nname: review\ndescription: Review\n---\nBody')
    const skills = await loadSkills([TEST_DIR])
    const skill = skills.get('review')!
    await expect(readSkillReference(skill, 'nonexistent.md')).rejects.toThrow('Reference not found')
  })
})
