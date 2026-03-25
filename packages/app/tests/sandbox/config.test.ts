import { test, expect } from 'bun:test'
import { buildSandboxConfig } from '../../src/sandbox/config'
import type { RaConfig } from '../../src/config/types'
import { defaultConfig } from '../../src/config/defaults'

function makeConfig(overrides: Partial<RaConfig['agent']> = {}): RaConfig {
  return {
    ...defaultConfig,
    agent: { ...defaultConfig.agent, ...overrides },
  }
}

test('buildSandboxConfig extracts provider and model', () => {
  const config = makeConfig({ provider: 'openai', model: 'gpt-4o' })
  const sandbox = buildSandboxConfig(config)

  expect(sandbox.provider).toBe('openai')
  expect(sandbox.model).toBe('gpt-4o')
})

test('buildSandboxConfig extracts provider options', () => {
  const config = makeConfig({ provider: 'anthropic' })
  const sandbox = buildSandboxConfig(config)

  expect(sandbox.providerOptions).toEqual(config.app.providers.anthropic)
})

test('buildSandboxConfig extracts agent limits', () => {
  const config = makeConfig({
    maxIterations: 10,
    maxRetries: 5,
    toolTimeout: 60000,
    parallelToolCalls: false,
    maxTokenBudget: 100000,
    maxDuration: 300000,
  })
  const sandbox = buildSandboxConfig(config)

  expect(sandbox.maxIterations).toBe(10)
  expect(sandbox.maxRetries).toBe(5)
  expect(sandbox.toolTimeout).toBe(60000)
  expect(sandbox.parallelToolCalls).toBe(false)
  expect(sandbox.maxTokenBudget).toBe(100000)
  expect(sandbox.maxDuration).toBe(300000)
})

test('buildSandboxConfig extracts compaction settings', () => {
  const config = makeConfig({
    compaction: {
      enabled: true,
      threshold: 0.85,
      strategy: 'summarize',
    },
  })
  const sandbox = buildSandboxConfig(config)

  expect(sandbox.compaction.enabled).toBe(true)
  expect(sandbox.compaction.threshold).toBe(0.85)
  expect(sandbox.compaction.strategy).toBe('summarize')
})

test('buildSandboxConfig extracts tools config', () => {
  const config = makeConfig({
    tools: {
      builtin: true,
      overrides: { Bash: { enabled: false } },
    },
  })
  const sandbox = buildSandboxConfig(config)

  expect(sandbox.tools.builtin).toBe(true)
  expect(sandbox.tools.overrides.Bash?.enabled).toBe(false)
})

test('buildSandboxConfig extracts thinking settings', () => {
  const config = makeConfig({
    thinking: 'high',
    thinkingBudgetCap: 8192,
  })
  const sandbox = buildSandboxConfig(config)

  expect(sandbox.thinking).toBe('high')
  expect(sandbox.thinkingBudgetCap).toBe(8192)
})

test('buildSandboxConfig extracts permissions', () => {
  const config = makeConfig({
    permissions: {
      default_action: 'deny',
      rules: [{ tool: 'Read' }],
    },
  })
  const sandbox = buildSandboxConfig(config)

  expect(sandbox.permissions.default_action).toBe('deny')
  expect(sandbox.permissions.rules).toHaveLength(1)
})

test('buildSandboxConfig extracts middleware', () => {
  const config = makeConfig({
    middleware: {
      beforeModelCall: ['./middleware/log.ts'],
    },
  })
  const sandbox = buildSandboxConfig(config)

  expect(sandbox.middleware.beforeModelCall).toEqual(['./middleware/log.ts'])
})

test('buildSandboxConfig result is JSON-serializable', () => {
  const config = makeConfig()
  const sandbox = buildSandboxConfig(config)

  const serialized = JSON.stringify(sandbox)
  const deserialized = JSON.parse(serialized)

  expect(deserialized.provider).toBe(sandbox.provider)
  expect(deserialized.model).toBe(sandbox.model)
  expect(deserialized.maxIterations).toBe(sandbox.maxIterations)
})
