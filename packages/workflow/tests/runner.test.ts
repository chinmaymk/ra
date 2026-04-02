import { describe, it, expect } from 'bun:test'
import { runWorkflow, REVISION_MARKER } from '@chinmaymk/ra-workflow'
import type { WorkflowDefinition, AgentFactory } from '@chinmaymk/ra-workflow'
import { ToolRegistry } from '@chinmaymk/ra'
import type { IProvider, StreamChunk } from '@chinmaymk/ra'

function mockProvider(responses: StreamChunk[][]): IProvider {
  let callIndex = 0
  return {
    name: 'mock',
    chat: async () => { throw new Error('use stream') },
    async *stream() {
      const chunks = responses[callIndex++] ?? [{ type: 'text', delta: 'done' }, { type: 'done' }]
      for (const chunk of chunks) yield chunk
    },
  }
}

function textResponse(text: string): StreamChunk[] {
  return [{ type: 'text', delta: text }, { type: 'done' }]
}

function revisionResponse(text: string, step: string, feedback: string): StreamChunk[] {
  return [
    { type: 'text', delta: text },
    { type: 'tool_call_start', id: 'tc1', name: 'request_revision' },
    { type: 'tool_call_delta', id: 'tc1', argsDelta: JSON.stringify({ step, feedback }) },
    { type: 'tool_call_end', id: 'tc1' },
    { type: 'done' },
  ]
}

function createFactory(providerMap: Record<string, IProvider>): AgentFactory {
  return async (teamKey: string) => {
    const provider = providerMap[teamKey]
    if (!provider) throw new Error(`No provider for team key: ${teamKey}`)
    return { provider, tools: new ToolRegistry() }
  }
}

describe('runWorkflow', () => {
  it('runs a linear two-step workflow', async () => {
    const definition: WorkflowDefinition = {
      name: 'test',
      team: { pm: './pm.yaml', dev: './dev.yaml' },
      steps: [
        { name: 'goal', agent: 'pm', prompt: 'Define: {{input}}' },
        { name: 'code', agent: 'dev', prompt: 'Build: {{goal}}' },
      ],
    }

    const result = await runWorkflow({
      definition,
      agentFactory: createFactory({
        pm: mockProvider([textResponse('Build a todo app')]),
        dev: mockProvider([textResponse('const app = express()')]),
      }),
      input: 'todo app',
    })

    expect(result.name).toBe('test')
    expect(result.steps).toHaveLength(2)
    expect(result.steps[0]!.step).toBe('goal')
    expect(result.steps[0]!.output).toBe('Build a todo app')
    expect(result.steps[1]!.step).toBe('code')
    expect(result.steps[1]!.output).toBe('const app = express()')
  })

  it('runs parallel steps', async () => {
    const definition: WorkflowDefinition = {
      name: 'parallel',
      team: { pm: './pm.yaml', be: './be.yaml', fe: './fe.yaml' },
      steps: [
        { name: 'goal', agent: 'pm', prompt: '{{input}}' },
        { name: 'backend', agent: 'be', prompt: 'API: {{goal}}' },
        { name: 'frontend', agent: 'fe', prompt: 'UI: {{goal}}' },
      ],
    }

    const result = await runWorkflow({
      definition,
      agentFactory: createFactory({
        pm: mockProvider([textResponse('build it')]),
        be: mockProvider([textResponse('api done')]),
        fe: mockProvider([textResponse('ui done')]),
      }),
      input: 'go',
    })

    expect(result.steps).toHaveLength(3)
    const stepNames = result.steps.map(s => s.step)
    expect(stepNames).toContain('backend')
    expect(stepNames).toContain('frontend')
  })

  it('handles revision loop', async () => {
    const definition: WorkflowDefinition = {
      name: 'revision',
      team: { pm: './pm.yaml', dev: './dev.yaml', qa: './qa.yaml' },
      steps: [
        { name: 'goal', agent: 'pm', prompt: '{{input}}' },
        { name: 'code', agent: 'dev', prompt: 'Build: {{goal}}' },
        { name: 'review', agent: 'qa', prompt: 'Review: {{code}}' },
      ],
      settings: { maxRounds: 3 },
    }

    // QA's first call returns a revision, second call (after code is re-run) approves
    const qaProvider = mockProvider([
      revisionResponse('needs fix', 'code', 'add error handling'),
      textResponse('looks good'),
    ])

    // Dev runs twice: initial + after revision
    const devProvider = mockProvider([
      textResponse('basic code'),
      textResponse('code with error handling'),
    ])

    const result = await runWorkflow({
      definition,
      agentFactory: createFactory({
        pm: mockProvider([textResponse('build it')]),
        dev: devProvider,
        qa: qaProvider,
      }),
      input: 'go',
    })

    // Should have: goal(1) + code(1) + review(1) + code(2) + review(2)
    expect(result.steps.length).toBeGreaterThanOrEqual(4)
    const codeSteps = result.steps.filter(s => s.step === 'code')
    expect(codeSteps.length).toBe(2)
    expect(codeSteps[1]!.round).toBe(2)
  })

  it('respects maxRounds cap', async () => {
    const definition: WorkflowDefinition = {
      name: 'cap',
      team: { pm: './pm.yaml', dev: './dev.yaml', qa: './qa.yaml' },
      steps: [
        { name: 'goal', agent: 'pm', prompt: '{{input}}' },
        { name: 'code', agent: 'dev', prompt: 'Build: {{goal}}' },
        { name: 'review', agent: 'qa', prompt: 'Review: {{code}}' },
      ],
      settings: { maxRounds: 2 },
    }

    // QA always requests revision
    const qaProvider = mockProvider([
      revisionResponse('fix it', 'code', 'still broken'),
      revisionResponse('fix it', 'code', 'still broken'),
      revisionResponse('fix it', 'code', 'still broken'),
    ])

    const devProvider = mockProvider([
      textResponse('v1'),
      textResponse('v2'),
      textResponse('v3'),
    ])

    const result = await runWorkflow({
      definition,
      agentFactory: createFactory({
        pm: mockProvider([textResponse('go')]),
        dev: devProvider,
        qa: qaProvider,
      }),
      input: 'go',
    })

    // Code should only run maxRounds=2 times
    const codeSteps = result.steps.filter(s => s.step === 'code')
    expect(codeSteps.length).toBeLessThanOrEqual(2)
  })

  it('stops on token budget exceeded', async () => {
    const definition: WorkflowDefinition = {
      name: 'budget',
      team: { a: './a.yaml', b: './b.yaml', c: './c.yaml' },
      steps: [
        { name: 'first', agent: 'a', prompt: '{{input}}' },
        { name: 'second', agent: 'b', prompt: '{{first}}' },
        { name: 'third', agent: 'c', prompt: '{{second}}' },
      ],
      settings: { maxTokenBudget: 1 },
    }

    // The mock provider reports usage via the done chunk
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('use stream') },
      async *stream() {
        yield { type: 'text', delta: 'output' }
        yield { type: 'done', usage: { inputTokens: 100, outputTokens: 100 } }
      },
    }

    const result = await runWorkflow({
      definition,
      agentFactory: async () => ({ provider, tools: new ToolRegistry() }),
      input: 'go',
    })

    // Should stop before all steps complete
    expect(result.stopReason).toBe('token_budget_exceeded')
    expect(result.steps.length).toBeLessThan(3)
  })

  it('throws on cyclic dependency', async () => {
    const definition: WorkflowDefinition = {
      name: 'cycle',
      team: { a: './a.yaml' },
      steps: [
        { name: 'x', agent: 'a', prompt: '{{y}}' },
        { name: 'y', agent: 'a', prompt: '{{x}}' },
      ],
    }

    await expect(
      runWorkflow({
        definition,
        agentFactory: async () => ({ provider: mockProvider([]), tools: new ToolRegistry() }),
        input: 'go',
      }),
    ).rejects.toThrow('Cycle')
  })

  it('handles abort signal', async () => {
    const controller = new AbortController()
    const definition: WorkflowDefinition = {
      name: 'abort',
      team: { a: './a.yaml', b: './b.yaml' },
      steps: [
        { name: 'first', agent: 'a', prompt: '{{input}}' },
        { name: 'second', agent: 'b', prompt: '{{first}}' },
      ],
    }

    // Abort before the second step runs
    controller.abort()

    const result = await runWorkflow({
      definition,
      agentFactory: createFactory({
        a: mockProvider([textResponse('done')]),
        b: mockProvider([textResponse('never runs')]),
      }),
      input: 'go',
      signal: controller.signal,
    })

    expect(result.stopReason).toBe('aborted')
    expect(result.steps).toHaveLength(0)
  })
})
