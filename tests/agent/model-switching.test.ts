import { describe, it, expect } from 'bun:test'
import {
  scoreComplexity,
  ruleMatches,
  createModelSwitchingMiddleware,
  type ModelSwitchRule,
  type ComplexityLevel,
  type ModelSwitchConfig,
} from '../../src/agent/model-switching'
import type { IProvider, IMessage, StreamChunk } from '../../src/providers/types'
import type { ModelCallContext, LoopContext, StoppableContext } from '../../src/agent/types'
import { AgentLoop } from '../../src/agent/loop'
import { ToolRegistry } from '../../src/agent/tool-registry'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockProvider(responses: StreamChunk[][]): IProvider {
  let callIndex = 0
  return {
    name: 'mock',
    chat: async () => { throw new Error('use stream') },
    async *stream() {
      const chunks = responses[callIndex++] ?? [{ type: 'text' as const, delta: 'done' }, { type: 'done' as const }]
      for (const chunk of chunks) yield chunk
    },
  }
}

function makeStoppable(): StoppableContext {
  const controller = new AbortController()
  return { stop: () => controller.abort(), signal: controller.signal }
}

function makeLoopContext(overrides: Partial<LoopContext> = {}): LoopContext {
  return {
    ...makeStoppable(),
    messages: [],
    iteration: 1,
    maxIterations: 50,
    sessionId: 'test',
    usage: { inputTokens: 0, outputTokens: 0 },
    lastUsage: undefined,
    ...overrides,
  }
}

function makeModelCallContext(overrides: {
  model?: string
  loop?: Partial<LoopContext>
} = {}): ModelCallContext {
  const loop = makeLoopContext(overrides.loop)
  return {
    ...makeStoppable(),
    request: { model: overrides.model ?? 'claude-sonnet-4-6', messages: loop.messages, tools: [] },
    loop,
  }
}

// ---------------------------------------------------------------------------
// scoreComplexity
// ---------------------------------------------------------------------------

describe('scoreComplexity', () => {
  it('returns simple for short messages', () => {
    const messages: IMessage[] = [{ role: 'user', content: 'What is 2+2?' }]
    expect(scoreComplexity(messages)).toBe('simple')
  })

  it('returns simple for empty messages', () => {
    expect(scoreComplexity([])).toBe('simple')
  })

  it('returns moderate for medium-length multi-step messages', () => {
    const messages: IMessage[] = [{
      role: 'user',
      content: 'First, read the file src/config.ts. Then update the model field to use gpt-4o. Also make sure the tests pass after the change.',
    }]
    expect(scoreComplexity(messages)).toBe('moderate')
  })

  it('returns complex for broad-scope refactoring requests', () => {
    const messages: IMessage[] = [{
      role: 'user',
      content: `I need you to refactor the entire codebase to migrate from CommonJS to ESM modules.
This involves updating every file in the src/ directory and all the tests/ as well.
First, update package.json to set "type": "module".
Then go through each file and rewrite the require() calls to import statements.
After that, update all the test files to use the new import syntax.
Finally, make sure the whole build pipeline still works.
\`\`\`json
{ "type": "module" }
\`\`\`
Also check tsconfig.json and update moduleResolution settings across the entire project.`,
    }]
    expect(scoreComplexity(messages)).toBe('complex')
  })

  it('uses the last user message when multiple exist', () => {
    const messages: IMessage[] = [
      { role: 'user', content: 'Refactor the entire codebase to migrate every module across all files' },
      { role: 'assistant', content: 'Sure, I will help.' },
      { role: 'user', content: 'hi' },
    ]
    expect(scoreComplexity(messages)).toBe('simple')
  })
})

// ---------------------------------------------------------------------------
// ruleMatches
// ---------------------------------------------------------------------------

describe('ruleMatches', () => {
  const baseCtx = {
    iteration: 5,
    inputTokens: 10000,
    outputTokens: 5000,
    toolCallCount: 8,
    complexity: 'moderate' as ComplexityLevel,
  }

  it('matches afterIteration when iteration exceeds threshold', () => {
    const rule: ModelSwitchRule = { model: 'haiku', afterIteration: 3 }
    expect(ruleMatches(rule, baseCtx)).toBe(true)
  })

  it('does not match afterIteration when iteration is at threshold', () => {
    const rule: ModelSwitchRule = { model: 'haiku', afterIteration: 5 }
    expect(ruleMatches(rule, baseCtx)).toBe(false)
  })

  it('matches inputTokensAbove', () => {
    const rule: ModelSwitchRule = { model: 'haiku', inputTokensAbove: 5000 }
    expect(ruleMatches(rule, baseCtx)).toBe(true)
  })

  it('matches outputTokensAbove', () => {
    const rule: ModelSwitchRule = { model: 'haiku', outputTokensAbove: 4000 }
    expect(ruleMatches(rule, baseCtx)).toBe(true)
  })

  it('matches toolCallCountAbove', () => {
    const rule: ModelSwitchRule = { model: 'haiku', toolCallCountAbove: 5 }
    expect(ruleMatches(rule, baseCtx)).toBe(true)
  })

  it('matches complexity level', () => {
    const rule: ModelSwitchRule = { model: 'haiku', complexity: 'moderate' }
    expect(ruleMatches(rule, baseCtx)).toBe(true)
  })

  it('does not match wrong complexity level', () => {
    const rule: ModelSwitchRule = { model: 'haiku', complexity: 'complex' }
    expect(ruleMatches(rule, baseCtx)).toBe(false)
  })

  it('requires all conditions to match (AND logic)', () => {
    const rule: ModelSwitchRule = { model: 'haiku', afterIteration: 3, inputTokensAbove: 50000 }
    // iteration passes but tokens don't
    expect(ruleMatches(rule, baseCtx)).toBe(false)
  })

  it('does not match a rule with no conditions', () => {
    const rule: ModelSwitchRule = { model: 'haiku' }
    expect(ruleMatches(rule, baseCtx)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// createModelSwitchingMiddleware
// ---------------------------------------------------------------------------

describe('createModelSwitchingMiddleware', () => {
  it('switches model when rule matches', async () => {
    const config: ModelSwitchConfig = {
      enabled: true,
      rules: [{ model: 'claude-haiku-4-5-20251001', afterIteration: 2 }],
    }
    const provider = mockProvider([])
    const mw = createModelSwitchingMiddleware(config, { defaultProvider: provider })

    const ctx = makeModelCallContext({ loop: { iteration: 5 } })
    await mw(ctx)

    expect(ctx.request.model).toBe('claude-haiku-4-5-20251001')
  })

  it('does not switch when no rules match', async () => {
    const config: ModelSwitchConfig = {
      enabled: true,
      rules: [{ model: 'claude-haiku-4-5-20251001', afterIteration: 10 }],
    }
    const provider = mockProvider([])
    const mw = createModelSwitchingMiddleware(config, { defaultProvider: provider })

    const ctx = makeModelCallContext({ loop: { iteration: 3 } })
    await mw(ctx)

    expect(ctx.request.model).toBe('claude-sonnet-4-6')
  })

  it('last matching rule wins', async () => {
    const config: ModelSwitchConfig = {
      enabled: true,
      rules: [
        { model: 'claude-haiku-4-5-20251001', afterIteration: 1 },
        { model: 'gpt-4o-mini', afterIteration: 3 },
      ],
    }
    const provider = mockProvider([])
    const mw = createModelSwitchingMiddleware(config, { defaultProvider: provider })

    const ctx = makeModelCallContext({ loop: { iteration: 5 } })
    await mw(ctx)

    expect(ctx.request.model).toBe('gpt-4o-mini')
  })

  it('switches provider when rule specifies one', async () => {
    const config: ModelSwitchConfig = {
      enabled: true,
      rules: [{ model: 'gpt-4o-mini', provider: 'openai', afterIteration: 1 }],
    }
    const defaultProvider = mockProvider([])
    const openaiProvider: IProvider = {
      name: 'openai',
      chat: async () => { throw new Error('use stream') },
      async *stream() { yield { type: 'done' as const } },
    }
    const mw = createModelSwitchingMiddleware(config, {
      defaultProvider,
      createProvider: (name) => {
        if (name === 'openai') return openaiProvider
        throw new Error(`Unknown provider: ${name}`)
      },
    })

    const ctx = makeModelCallContext({ loop: { iteration: 3 } })
    await mw(ctx)

    expect(ctx.request.model).toBe('gpt-4o-mini')
    expect(ctx.provider).toBeDefined()
    expect(ctx.provider!.name).toBe('openai')
  })

  it('uses complexity-based switching with heuristics', async () => {
    const config: ModelSwitchConfig = {
      enabled: true,
      rules: [{ model: 'claude-haiku-4-5-20251001', complexity: 'simple' }],
    }
    const provider = mockProvider([])
    const mw = createModelSwitchingMiddleware(config, { defaultProvider: provider })

    const ctx = makeModelCallContext({ loop: { messages: [{ role: 'user', content: 'hi' }] } })
    await mw(ctx)

    expect(ctx.request.model).toBe('claude-haiku-4-5-20251001')
  })

  it('does not switch for complex task when rule targets simple', async () => {
    const config: ModelSwitchConfig = {
      enabled: true,
      rules: [{ model: 'claude-haiku-4-5-20251001', complexity: 'simple' }],
    }
    const provider = mockProvider([])
    const mw = createModelSwitchingMiddleware(config, { defaultProvider: provider })

    const ctx = makeModelCallContext({
      loop: {
        messages: [{
          role: 'user',
          content: 'Refactor the entire codebase across all files, migrate every module, then rewrite all the tests. First update package.json, then each source file, finally the build pipeline.\n```json\n{}\n```\nAlso redesign the whole architecture.',
        }],
      },
    })
    await mw(ctx)

    expect(ctx.request.model).toBe('claude-sonnet-4-6')
  })
})

// ---------------------------------------------------------------------------
// Integration: AgentLoop with model switching
// ---------------------------------------------------------------------------

describe('AgentLoop with model switching', () => {
  it('switches model during loop execution', async () => {
    const modelsUsed: string[] = []
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('use stream') },
      async *stream(request) {
        modelsUsed.push(request.model)
        // First call: make a tool call so the loop iterates again
        if (modelsUsed.length === 1) {
          yield { type: 'tool_call_start' as const, id: 'tc1', name: 'echo' }
          yield { type: 'tool_call_delta' as const, id: 'tc1', argsDelta: '{"text":"hi"}' }
          yield { type: 'tool_call_end' as const, id: 'tc1' }
          yield { type: 'done' as const, usage: { inputTokens: 100, outputTokens: 50 } }
        } else {
          yield { type: 'text' as const, delta: 'done' }
          yield { type: 'done' as const, usage: { inputTokens: 100, outputTokens: 50 } }
        }
      },
    }

    const tools = new ToolRegistry()
    tools.register({
      name: 'echo',
      description: 'echo',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      execute: async (input) => (input as { text: string }).text,
    })

    const loop = new AgentLoop({
      provider,
      tools,
      model: 'claude-sonnet-4-6',
      maxIterations: 5,
      modelSwitching: {
        enabled: true,
        rules: [{ model: 'claude-haiku-4-5-20251001', afterIteration: 1 }],
      },
    })

    await loop.run([{ role: 'user', content: 'hi' }])

    expect(modelsUsed[0]).toBe('claude-sonnet-4-6')
    expect(modelsUsed[1]).toBe('claude-haiku-4-5-20251001')
  })
})
