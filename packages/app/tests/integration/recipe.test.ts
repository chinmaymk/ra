import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test'
import { createTestEnv, type TestEnv } from './helpers/setup'
import { runBinary } from './helpers/binary'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('Recipe e2e', () => {
  let env: TestEnv
  let tmpDir: string

  beforeAll(async () => {
    env = await createTestEnv()
    tmpDir = join(tmpdir(), `ra-recipe-e2e-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
  })

  afterAll(async () => {
    await env.cleanup()
    rmSync(tmpDir, { recursive: true, force: true })
  })
  afterEach(() => env.mock.resetRequests())

  it('--recipe loads agent config from a local recipe directory', async () => {
    // Create a local recipe directory
    const recipeDir = join(tmpDir, 'local-recipe')
    mkdirSync(recipeDir, { recursive: true })
    writeFileSync(join(recipeDir, 'ra.config.yaml'), [
      'agent:',
      '  maxIterations: 7',
      '  context:',
      '    enabled: false',
      '  skillDirs: []',
    ].join('\n'))

    env.mock.enqueue([{ type: 'text', content: 'recipe response' }])

    const { stdout, exitCode } = await runBinary(
      ['--cli', '--recipe', recipeDir, 'hello from recipe'],
      env.binaryEnv,
    )
    expect(exitCode).toBe(0)
    expect(stdout).toContain('recipe response')
  })

  it('--recipe resolves recipe skillDirs relative to recipe directory', async () => {
    // Create recipe with a skill
    const recipeDir = join(tmpDir, 'recipe-with-skill')
    const skillDir = join(recipeDir, 'skills', 'greet')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), [
      '---',
      'name: greet',
      'description: Greeting skill',
      '---',
      'Always greet the user warmly.',
    ].join('\n'))
    writeFileSync(join(recipeDir, 'ra.config.yaml'), [
      'agent:',
      '  skillDirs:',
      '    - ./skills',
      '  context:',
      '    enabled: false',
    ].join('\n'))

    env.mock.enqueue([{ type: 'text', content: 'skill loaded ok' }])

    const { stdout, exitCode } = await runBinary(
      ['--cli', '--recipe', recipeDir, 'test skill loading'],
      env.binaryEnv,
    )
    expect(exitCode).toBe(0)
    expect(stdout).toContain('skill loaded ok')

    // Verify the model received available skills in the request
    const req = env.mock.requests()[0]?.body as Record<string, unknown>
    const messages = (req?.messages ?? []) as { role: string; content: unknown }[]
    const allContent = JSON.stringify(messages)
    expect(allContent).toContain('greet')
  })

  it('--recipe merges with local config: local overrides recipe model', async () => {
    const recipeDir = join(tmpDir, 'recipe-override')
    mkdirSync(recipeDir, { recursive: true })
    writeFileSync(join(recipeDir, 'ra.config.yaml'), [
      'agent:',
      '  model: recipe-model',
      '  maxIterations: 5',
      '  context:',
      '    enabled: false',
      '  skillDirs: []',
    ].join('\n'))

    // Local config file that overrides model
    const projectDir = join(tmpDir, 'project-override')
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(join(projectDir, 'ra.config.yaml'), [
      'agent:',
      '  model: local-model',
    ].join('\n'))

    env.mock.enqueue([{ type: 'text', content: 'merged ok' }])

    const { stdout, exitCode } = await runBinary(
      ['--cli', '--recipe', recipeDir, '--config', join(projectDir, 'ra.config.yaml'), 'test merge'],
      env.binaryEnv,
    )
    expect(exitCode).toBe(0)
    expect(stdout).toContain('merged ok')

    // Verify model used is the local override
    const req = env.mock.requests()[0]?.body as Record<string, unknown>
    expect(req?.model).toBe('local-model')
  })

  it('--recipe CLI flag overrides agent.recipe in config file', async () => {
    // Two recipe directories
    const recipeA = join(tmpDir, 'recipe-a')
    mkdirSync(recipeA, { recursive: true })
    writeFileSync(join(recipeA, 'ra.config.yaml'), [
      'agent:',
      '  model: model-from-a',
      '  context:',
      '    enabled: false',
      '  skillDirs: []',
    ].join('\n'))

    const recipeB = join(tmpDir, 'recipe-b')
    mkdirSync(recipeB, { recursive: true })
    writeFileSync(join(recipeB, 'ra.config.yaml'), [
      'agent:',
      '  model: model-from-b',
      '  context:',
      '    enabled: false',
      '  skillDirs: []',
    ].join('\n'))

    // Config file references recipe A
    const projectDir = join(tmpDir, 'project-priority')
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(join(projectDir, 'ra.config.yaml'), [
      'agent:',
      `  recipe: ${recipeA}`,
    ].join('\n'))

    env.mock.enqueue([{ type: 'text', content: 'priority ok' }])

    // CLI --recipe points to recipe B (should win)
    const { exitCode } = await runBinary(
      ['--cli', '--recipe', recipeB, '--config', join(projectDir, 'ra.config.yaml'), 'test'],
      env.binaryEnv,
    )
    expect(exitCode).toBe(0)

    const req = env.mock.requests()[0]?.body as Record<string, unknown>
    expect(req?.model).toBe('model-from-b')
  })

  it('agent.recipe in config file loads recipe as base', async () => {
    const recipeDir = join(tmpDir, 'recipe-from-config')
    mkdirSync(recipeDir, { recursive: true })
    writeFileSync(join(recipeDir, 'ra.config.yaml'), [
      'agent:',
      '  model: recipe-config-model',
      '  maxIterations: 12',
      '  context:',
      '    enabled: false',
      '  skillDirs: []',
    ].join('\n'))

    const projectDir = join(tmpDir, 'project-config-recipe')
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(join(projectDir, 'ra.config.yaml'), [
      'agent:',
      `  recipe: ${recipeDir}`,
    ].join('\n'))

    env.mock.enqueue([{ type: 'text', content: 'config recipe ok' }])

    const { stdout, exitCode } = await runBinary(
      ['--cli', '--config', join(projectDir, 'ra.config.yaml'), 'test config recipe'],
      env.binaryEnv,
    )
    expect(exitCode).toBe(0)
    expect(stdout).toContain('config recipe ok')

    const req = env.mock.requests()[0]?.body as Record<string, unknown>
    expect(req?.model).toBe('recipe-config-model')
  })

  // ── Recipe skillDirs concatenation ─────────────────────────────────

  it('recipe skillDirs are concatenated with local skillDirs', async () => {
    // Recipe with skill A
    const recipeDir = join(tmpDir, 'recipe-concat')
    const recipeSkills = join(recipeDir, 'skills', 'recipe-skill')
    mkdirSync(recipeSkills, { recursive: true })
    writeFileSync(join(recipeSkills, 'SKILL.md'), [
      '---',
      'name: recipe-skill',
      'description: From recipe',
      '---',
      'Recipe skill body.',
    ].join('\n'))
    writeFileSync(join(recipeDir, 'ra.config.yaml'), [
      'agent:',
      '  skillDirs:',
      '    - ./skills',
      '  context:',
      '    enabled: false',
    ].join('\n'))

    // Local project with skill B
    const projectDir = join(tmpDir, 'project-concat')
    const localSkills = join(projectDir, 'local-skills', 'local-skill')
    mkdirSync(localSkills, { recursive: true })
    writeFileSync(join(localSkills, 'SKILL.md'), [
      '---',
      'name: local-skill',
      'description: From local',
      '---',
      'Local skill body.',
    ].join('\n'))
    writeFileSync(join(projectDir, 'ra.config.yaml'), [
      'agent:',
      `  recipe: ${recipeDir}`,
      '  skillDirs:',
      `    - ${join(projectDir, 'local-skills')}`,
    ].join('\n'))

    env.mock.enqueue([{ type: 'text', content: 'both skills visible' }])

    const { exitCode } = await runBinary(
      ['--cli', '--config', join(projectDir, 'ra.config.yaml'), 'test concat'],
      env.binaryEnv,
    )
    expect(exitCode).toBe(0)

    // Both skills should appear in the model request
    const req = env.mock.requests()[0]?.body as Record<string, unknown>
    const messages = (req?.messages ?? []) as { role: string; content: unknown }[]
    const allContent = JSON.stringify(messages)
    expect(allContent).toContain('recipe-skill')
    expect(allContent).toContain('local-skill')
  })

  // ── Recipe middleware path resolution ──────────────────────────────

  it('recipe middleware paths resolve relative to recipe directory', async () => {
    const recipeDir = join(tmpDir, 'recipe-middleware')
    mkdirSync(join(recipeDir, 'middleware'), { recursive: true })

    // Middleware that writes a marker file
    const markerFile = join(tmpDir, 'mw-marker.txt')
    const escapedMarker = markerFile.replace(/\\/g, '/')
    writeFileSync(join(recipeDir, 'middleware', 'mark.ts'), `
import { writeFileSync } from 'fs'
export default async function() {
  writeFileSync('${escapedMarker}', 'recipe-middleware-fired')
}
`)

    writeFileSync(join(recipeDir, 'ra.config.yaml'), [
      'agent:',
      '  middleware:',
      '    beforeLoopBegin:',
      '      - ./middleware/mark.ts',
      '  context:',
      '    enabled: false',
      '  skillDirs: []',
    ].join('\n'))

    env.mock.enqueue([{ type: 'text', content: 'mw done' }])

    const { exitCode } = await runBinary(
      ['--cli', '--recipe', recipeDir, 'test middleware'],
      env.binaryEnv,
    )
    expect(exitCode).toBe(0)

    const marker = await Bun.file(markerFile).text()
    expect(marker).toBe('recipe-middleware-fired')
  })

  // ── Error cases ────────────────────────────────────────────────────

  it('--recipe with nonexistent path fails with clear error', async () => {
    const { stderr, exitCode } = await runBinary(
      ['--cli', '--recipe', '/nonexistent/recipe/path', 'test'],
      env.binaryEnv,
    )
    expect(exitCode).not.toBe(0)
    expect(stderr).toContain('Recipe not found')
  })

  it('--recipe with nonexistent installed name fails with install hint', async () => {
    const { stderr, exitCode } = await runBinary(
      ['--cli', '--recipe', 'nonexistent/recipe', 'test'],
      env.binaryEnv,
    )
    expect(exitCode).not.toBe(0)
    expect(stderr).toContain('Recipe not found')
    expect(stderr).toContain('ra recipe install')
  })

  // ── Multi-turn with recipe ─────────────────────────────────────────

  it('recipe config persists across resumed sessions', async () => {
    const recipeDir = join(tmpDir, 'recipe-resume')
    mkdirSync(recipeDir, { recursive: true })
    writeFileSync(join(recipeDir, 'ra.config.yaml'), [
      'agent:',
      '  model: resume-recipe-model',
      '  context:',
      '    enabled: false',
      '  skillDirs: []',
    ].join('\n'))

    const sessionId = `recipe-resume-${Date.now()}`

    // Turn 1
    env.mock.enqueue([{ type: 'text', content: 'turn one' }])
    await runBinary(
      ['--cli', '--recipe', recipeDir, `--resume=${sessionId}`, 'first message'],
      env.binaryEnv,
    )
    env.mock.resetRequests()

    // Turn 2 — resume with same recipe
    env.mock.enqueue([{ type: 'text', content: 'turn two' }])
    const { stdout, exitCode } = await runBinary(
      ['--cli', '--recipe', recipeDir, `--resume=${sessionId}`, 'second message'],
      env.binaryEnv,
    )
    expect(exitCode).toBe(0)
    expect(stdout).toContain('turn two')

    // Verify model used same recipe model and prior messages present
    const req = env.mock.requests()[0]?.body as Record<string, unknown>
    expect(req?.model).toBe('resume-recipe-model')
    const allContent = JSON.stringify(req?.messages ?? [])
    expect(allContent).toContain('first message')
    expect(allContent).toContain('second message')
  })
})
