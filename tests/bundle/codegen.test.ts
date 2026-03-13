import { describe, it, expect } from 'bun:test'
import { generateEntryPoint } from '../../src/bundle/codegen'
import { defaultConfig } from '../../src/config'
import type { RaConfig } from '../../src/config/types'
import type { EmbeddedSkill, MiddlewareImport } from '../../src/bundle'

function makeConfig(overrides: Partial<RaConfig> = {}): RaConfig {
  return { ...defaultConfig, configDir: '/tmp/test', ...overrides } as RaConfig
}

describe('generateEntryPoint', () => {
  it('generates valid TypeScript with embedded config', () => {
    const source = generateEntryPoint({
      config: makeConfig({ model: 'gpt-4o', provider: 'openai' }),
      embeddedSkills: [],
      middlewareImports: [],
      raSourceDir: '/home/user/ra/src',
      binaryName: 'test-agent',
    })

    expect(source).toContain('#!/usr/bin/env bun')
    expect(source).toContain('Auto-generated bundled entry point for "test-agent"')
    expect(source).toContain('BUNDLED_CONFIG')
    expect(source).toContain('"model": "gpt-4o"')
    expect(source).toContain('"provider": "openai"')
  })

  it('embeds skills as string literals', () => {
    const skills: EmbeddedSkill[] = [{
      name: 'test-skill',
      metadata: { name: 'test-skill', description: 'A test skill' },
      body: '# Test Skill\n\nDo something useful.',
      references: { 'references/checklist.md': '- [ ] Step 1\n- [ ] Step 2' },
      scripts: ['scripts/run.sh'],
      assets: [],
    }]

    const source = generateEntryPoint({
      config: makeConfig(),
      embeddedSkills: skills,
      middlewareImports: [],
      raSourceDir: '/home/user/ra/src',
      binaryName: 'test-agent',
    })

    expect(source).toContain('BUNDLED_SKILLS.set("test-skill"')
    expect(source).toContain('# Test Skill')
    expect(source).toContain("dir: 'bundled:test-skill'")
  })

  it('imports middleware files', () => {
    const middleware: MiddlewareImport[] = [
      { hook: 'beforeModelCall', type: 'file', path: '/path/to/middleware.ts' },
      { hook: 'afterModelResponse', type: 'file', path: '/path/to/budget.ts' },
    ]

    const source = generateEntryPoint({
      config: makeConfig(),
      embeddedSkills: [],
      middlewareImports: middleware,
      raSourceDir: '/home/user/ra/src',
      binaryName: 'test-agent',
    })

    expect(source).toContain("import __mw0 from '/path/to/middleware.ts'")
    expect(source).toContain("import __mw1 from '/path/to/budget.ts'")
    expect(source).toContain('beforeModelCall: [__mw0]')
    expect(source).toContain('afterModelResponse: [__mw1]')
  })

  it('handles inline middleware expressions', () => {
    const middleware: MiddlewareImport[] = [
      { hook: 'onStreamChunk', type: 'inline', expression: '(ctx) => { console.log(ctx) }' },
    ]

    const source = generateEntryPoint({
      config: makeConfig(),
      embeddedSkills: [],
      middlewareImports: middleware,
      raSourceDir: '/home/user/ra/src',
      binaryName: 'test-agent',
    })

    expect(source).toContain('onStreamChunk: [((ctx) => { console.log(ctx) })]')
  })

  it('includes ra source imports', () => {
    const source = generateEntryPoint({
      config: makeConfig(),
      embeddedSkills: [],
      middlewareImports: [],
      raSourceDir: '/home/user/ra/src',
      binaryName: 'test-agent',
    })

    expect(source).toContain("from '/home/user/ra/src/bootstrap'")
    expect(source).toContain("from '/home/user/ra/src/config'")
    expect(source).toContain("from '/home/user/ra/src/agent/loop'")
  })

  it('strips middleware and configDir from serialized config', () => {
    const config = makeConfig({
      middleware: { beforeModelCall: ['./test.ts'] },
    })

    const source = generateEntryPoint({
      config,
      embeddedSkills: [],
      middlewareImports: [],
      raSourceDir: '/home/user/ra/src',
      binaryName: 'test-agent',
    })

    // middleware is handled separately, not in BUNDLED_CONFIG
    expect(source).toContain('config.middleware = {}')
  })

  it('clears skillDirs in serialized config', () => {
    const config = makeConfig({
      skillDirs: ['./skills', '.claude/skills'],
    })

    const source = generateEntryPoint({
      config,
      embeddedSkills: [],
      middlewareImports: [],
      raSourceDir: '/home/user/ra/src',
      binaryName: 'test-agent',
    })

    // skillDirs should be empty — skills are embedded, not loaded from disk
    expect(source).toContain('"skillDirs": []')
  })

  it('skips config file discovery at runtime', () => {
    const source = generateEntryPoint({
      config: makeConfig(),
      embeddedSkills: [],
      middlewareImports: [],
      raSourceDir: '/home/user/ra/src',
      binaryName: 'test-agent',
    })

    // Should pass a sentinel configPath to prevent loadConfig from discovering files
    expect(source).toContain("configPath: '__bundled__'")
  })

  it('preserves compaction settings in serialized config', () => {
    const source = generateEntryPoint({
      config: makeConfig(),
      embeddedSkills: [],
      middlewareImports: [],
      raSourceDir: '/home/user/ra/src',
      binaryName: 'test-agent',
    })

    // compaction should be in BUNDLED_CONFIG (not stripped)
    expect(source).toContain('"compaction"')
    expect(source).toContain('"threshold"')
  })

  it('escapes backticks and dollar signs in skill bodies', () => {
    const skills: EmbeddedSkill[] = [{
      name: 'escape-test',
      metadata: { name: 'escape-test', description: 'Test escaping' },
      body: 'Use `code` and $variable and ${template}',
      references: {},
      scripts: [],
      assets: [],
    }]

    const source = generateEntryPoint({
      config: makeConfig(),
      embeddedSkills: skills,
      middlewareImports: [],
      raSourceDir: '/home/user/ra/src',
      binaryName: 'test-agent',
    })

    // Should escape backticks and dollar signs for template literal safety
    expect(source).toContain('\\`code\\`')
    expect(source).toContain('\\$variable')
    expect(source).toContain('\\${template}')
  })
})
