import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test'
import { writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTestEnv, type TestEnv } from './helpers/setup'
import { runBinary } from './helpers/binary'

describe('Custom tools integration', () => {
  let env: TestEnv
  let tmpDir: string

  beforeAll(async () => {
    env = await createTestEnv()
    tmpDir = join(tmpdir(), `ra-custom-tools-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    mkdirSync(join(tmpDir, 'tools'), { recursive: true })
  })

  afterAll(async () => { await env.cleanup() })
  afterEach(() => env.mock.resetRequests())

  it('LLM calls a custom tool and receives its output', async () => {
    // Write a custom tool file
    const toolFile = join(tmpDir, 'tools', 'greet.ts')
    writeFileSync(toolFile, `
export default {
  name: 'Greet',
  description: 'Greet a person by name',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Name to greet' },
    },
    required: ['name'],
  },
  async execute(input: unknown) {
    const { name } = input as { name: string }
    return 'Hello, ' + name + '! Welcome aboard.'
  },
}
`)

    // Config referencing the custom tool
    const configFile = join(tmpDir, 'ra-greet.config.json')
    writeFileSync(configFile, JSON.stringify({
      agent: {
        tools: { custom: [toolFile] },
        context: { enabled: false },
        skillDirs: [],
      },
    }))

    // LLM calls the custom tool, then responds with final answer using tool output
    env.mock.enqueue([{ type: 'tool_call', name: 'Greet', args: { name: 'Alice' } }])
    env.mock.enqueue([{ type: 'text', content: 'The greeting was: Hello, Alice! Welcome aboard.' }])

    const { stdout, exitCode } = await runBinary(
      ['--cli', '--config', configFile, '--max-iterations', '5', 'greet Alice'],
      env.binaryEnv,
    )

    expect(exitCode).toBe(0)
    expect(stdout).toContain('Hello, Alice! Welcome aboard.')

    // Verify the tool result was sent back to the model in the second request
    const reqs = env.mock.requests()
    expect(reqs).toHaveLength(2)
    const secondReqBody = JSON.stringify(reqs[1]?.body)
    expect(secondReqBody).toContain('Hello, Alice! Welcome aboard.')
  })

  it('custom tool using parameters shorthand works end-to-end', async () => {
    const toolFile = join(tmpDir, 'tools', 'add.ts')
    writeFileSync(toolFile, `
export default {
  name: 'Add',
  description: 'Add two numbers together',
  parameters: {
    a: { type: 'number', description: 'First number' },
    b: { type: 'number', description: 'Second number' },
  },
  async execute(input: unknown) {
    const { a, b } = input as { a: number; b: number }
    return String(a + b)
  },
}
`)

    const configFile = join(tmpDir, 'ra-add.config.json')
    writeFileSync(configFile, JSON.stringify({
      agent: {
        tools: { custom: [toolFile] },
        context: { enabled: false },
        skillDirs: [],
      },
    }))

    env.mock.enqueue([{ type: 'tool_call', name: 'Add', args: { a: 17, b: 25 } }])
    env.mock.enqueue([{ type: 'text', content: 'The sum is 42.' }])

    const { stdout, exitCode } = await runBinary(
      ['--cli', '--config', configFile, '--max-iterations', '5', 'add 17 and 25'],
      env.binaryEnv,
    )

    expect(exitCode).toBe(0)
    expect(stdout).toContain('The sum is 42.')

    // Verify tool result was sent back
    const secondReqBody = JSON.stringify(env.mock.requests()[1]?.body)
    expect(secondReqBody).toContain('42')
  })

  it('custom tool from factory function works', async () => {
    const toolFile = join(tmpDir, 'tools', 'counter.ts')
    writeFileSync(toolFile, `
let count = 0
export default function createCounter() {
  return {
    name: 'Counter',
    description: 'Increment and return a counter',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      count++
      return 'count=' + count
    },
  }
}
`)

    const configFile = join(tmpDir, 'ra-counter.config.json')
    writeFileSync(configFile, JSON.stringify({
      agent: {
        tools: { custom: [toolFile] },
        context: { enabled: false },
        skillDirs: [],
      },
    }))

    env.mock.enqueue([{ type: 'tool_call', name: 'Counter', args: {} }])
    env.mock.enqueue([{ type: 'tool_call', name: 'Counter', args: {} }])
    env.mock.enqueue([{ type: 'text', content: 'Counter reached 2.' }])

    const { stdout, exitCode } = await runBinary(
      ['--cli', '--config', configFile, '--max-iterations', '5', 'count twice'],
      env.binaryEnv,
    )

    expect(exitCode).toBe(0)
    expect(stdout).toContain('Counter reached 2.')
  })

  it('custom tool schema is sent to the model', async () => {
    const toolFile = join(tmpDir, 'tools', 'lookup.ts')
    writeFileSync(toolFile, `
export default {
  name: 'Lookup',
  description: 'Look up a value by key',
  parameters: {
    key: { type: 'string', description: 'The key to look up' },
    namespace: { type: 'string', description: 'Optional namespace', optional: true },
  },
  async execute(input: unknown) {
    const { key } = input as { key: string }
    return 'value_for_' + key
  },
}
`)

    const configFile = join(tmpDir, 'ra-lookup.config.json')
    writeFileSync(configFile, JSON.stringify({
      agent: {
        tools: { custom: [toolFile] },
        context: { enabled: false },
        skillDirs: [],
      },
    }))

    env.mock.enqueue([{ type: 'text', content: 'Got it.' }])

    const { exitCode } = await runBinary(
      ['--cli', '--config', configFile, 'hello'],
      env.binaryEnv,
    )

    expect(exitCode).toBe(0)

    // Verify the tool schema was sent to the model
    const reqBody = env.mock.requests()[0]?.body as Record<string, unknown>
    const tools = reqBody?.tools as Array<{ name: string; input_schema?: unknown }> | undefined
    expect(tools).toBeDefined()

    const lookupTool = tools!.find(t => t.name === 'Lookup')
    expect(lookupTool).toBeDefined()
    expect(lookupTool!.input_schema).toEqual({
      type: 'object',
      properties: {
        key: { type: 'string', description: 'The key to look up' },
        namespace: { type: 'string', description: 'Optional namespace' },
      },
      required: ['key'],
    })
  })

  it('custom tools coexist with builtin tools', async () => {
    const toolFile = join(tmpDir, 'tools', 'ping.ts')
    writeFileSync(toolFile, `
export default {
  name: 'Ping',
  description: 'Return pong',
  inputSchema: { type: 'object', properties: {} },
  async execute() { return 'pong' },
}
`)

    const configFile = join(tmpDir, 'ra-coexist.config.json')
    writeFileSync(configFile, JSON.stringify({
      agent: {
        tools: { builtin: true, custom: [toolFile] },
        context: { enabled: false },
        skillDirs: [],
      },
    }))

    env.mock.enqueue([{ type: 'text', content: 'ok' }])

    const { exitCode } = await runBinary(
      ['--cli', '--config', configFile, 'hi'],
      env.binaryEnv,
    )

    expect(exitCode).toBe(0)

    // Verify both builtin and custom tools are sent to the model
    const reqBody = env.mock.requests()[0]?.body as Record<string, unknown>
    const tools = reqBody?.tools as Array<{ name: string }> | undefined
    expect(tools).toBeDefined()

    const toolNames = tools!.map(t => t.name)
    expect(toolNames).toContain('Ping')    // custom
    expect(toolNames).toContain('Read')    // builtin
    expect(toolNames).toContain('Write')   // builtin
  })

  it('multiple custom tools from separate files all load', async () => {
    const toolA = join(tmpDir, 'tools', 'tool-a.ts')
    const toolB = join(tmpDir, 'tools', 'tool-b.ts')
    writeFileSync(toolA, `
export default {
  name: 'ToolA',
  description: 'First tool',
  inputSchema: { type: 'object', properties: {} },
  async execute() { return 'a' },
}
`)
    writeFileSync(toolB, `
export default {
  name: 'ToolB',
  description: 'Second tool',
  inputSchema: { type: 'object', properties: {} },
  async execute() { return 'b' },
}
`)

    const configFile = join(tmpDir, 'ra-multi.config.json')
    writeFileSync(configFile, JSON.stringify({
      agent: {
        tools: { builtin: false, custom: [toolA, toolB] },
        context: { enabled: false },
        skillDirs: [],
      },
    }))

    env.mock.enqueue([{ type: 'text', content: 'ok' }])

    const { exitCode } = await runBinary(
      ['--cli', '--config', configFile, 'hi'],
      env.binaryEnv,
    )

    expect(exitCode).toBe(0)

    const reqBody = env.mock.requests()[0]?.body as Record<string, unknown>
    const tools = reqBody?.tools as Array<{ name: string }> | undefined
    expect(tools).toBeDefined()

    const toolNames = tools!.map(t => t.name)
    expect(toolNames).toContain('ToolA')
    expect(toolNames).toContain('ToolB')
    // Builtin tools should NOT be present (builtin: false)
    expect(toolNames).not.toContain('Read')
  })

  it('custom tool execution is logged and traced', async () => {
    const toolFile = join(tmpDir, 'tools', 'traced.ts')
    writeFileSync(toolFile, `
export default {
  name: 'Traced',
  description: 'A tool we want to see in logs and traces',
  inputSchema: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
  async execute(input: unknown) {
    const { x } = input as { x: string }
    return 'traced-result-' + x
  },
}
`)

    const configFile = join(tmpDir, 'ra-traced.config.json')
    writeFileSync(configFile, JSON.stringify({
      agent: {
        tools: { custom: [toolFile] },
        context: { enabled: false },
        skillDirs: [],
      },
    }))

    // Snapshot session dirs before the run
    const sessionsDir = join(env.storageDir, 'sessions')
    const beforeDirs = new Set(existsSync(sessionsDir) ? readdirSync(sessionsDir) : [])

    env.mock.enqueue([{ type: 'tool_call', name: 'Traced', args: { x: 'hello' } }])
    env.mock.enqueue([{ type: 'text', content: 'Done tracing.' }])

    const { exitCode } = await runBinary(
      ['--cli', '--config', configFile, '--max-iterations', '5', 'test tracing'],
      env.binaryEnv,
    )

    expect(exitCode).toBe(0)

    // Find the new session directory created by this run
    const afterDirs = readdirSync(sessionsDir)
    const newDirs = afterDirs.filter(d => !beforeDirs.has(d) && existsSync(join(sessionsDir, d, 'logs.jsonl')))
    expect(newDirs.length).toBe(1)
    const sessionDir = join(sessionsDir, newDirs[0]!)

    // Verify logs contain custom tool execution entries
    const logsContent = readFileSync(join(sessionDir, 'logs.jsonl'), 'utf8')
    const logLines = logsContent.trim().split('\n').map(l => JSON.parse(l))

    const customToolsLoaded = logLines.find((l: { message?: string }) => l.message === 'custom tools loaded')
    expect(customToolsLoaded).toBeDefined()
    expect(customToolsLoaded.tools).toContain('Traced')

    const executingTool = logLines.find((l: { message?: string; tool?: string }) =>
      l.message === 'executing tool' && l.tool === 'Traced'
    )
    expect(executingTool).toBeDefined()

    const toolComplete = logLines.find((l: { message?: string; tool?: string }) =>
      l.message === 'tool execution complete' && l.tool === 'Traced'
    )
    expect(toolComplete).toBeDefined()

    // Verify traces contain custom tool span
    const tracesPath = join(sessionDir, 'traces.jsonl')
    const tracesContent = readFileSync(tracesPath, 'utf8')
    const traceLines = tracesContent.trim().split('\n').map(l => JSON.parse(l))

    const toolSpan = traceLines.find((t: { name?: string; attributes?: { tool?: string } }) =>
      t.name === 'agent.tool_execution' && t.attributes?.tool === 'Traced'
    )
    expect(toolSpan).toBeDefined()
    expect(toolSpan.status).toBe('ok')

    // Verify the custom_tools.load span exists
    const loadSpan = traceLines.find((t: { name?: string }) => t.name === 'custom_tools.load')
    expect(loadSpan).toBeDefined()
    expect(loadSpan.status).toBe('ok')
    expect(loadSpan.attributes.tools).toContain('Traced')
  })

  it('custom tool error is logged with error level', async () => {
    const toolFile = join(tmpDir, 'tools', 'traced-fail.ts')
    writeFileSync(toolFile, `
export default {
  name: 'TracedFail',
  description: 'Fails and should be logged as error',
  inputSchema: { type: 'object', properties: {} },
  async execute() { throw new Error('traced-failure-reason') },
}
`)

    const configFile = join(tmpDir, 'ra-traced-fail.config.json')
    writeFileSync(configFile, JSON.stringify({
      agent: {
        tools: { custom: [toolFile] },
        context: { enabled: false },
        skillDirs: [],
      },
    }))

    // Snapshot session dirs before the run
    const sessionsDir = join(env.storageDir, 'sessions')
    const beforeDirs = new Set(readdirSync(sessionsDir))

    env.mock.enqueue([{ type: 'tool_call', name: 'TracedFail', args: {} }])
    env.mock.enqueue([{ type: 'text', content: 'Failed as expected.' }])

    const { exitCode } = await runBinary(
      ['--cli', '--config', configFile, '--max-iterations', '5', 'test error tracing'],
      env.binaryEnv,
    )

    expect(exitCode).toBe(0)

    // Find the new session directory
    const afterDirs = readdirSync(sessionsDir)
    const newDirs = afterDirs.filter(d => !beforeDirs.has(d) && existsSync(join(sessionsDir, d, 'logs.jsonl')))
    expect(newDirs.length).toBe(1)
    const sessionDir = join(sessionsDir, newDirs[0]!)

    const logsContent = readFileSync(join(sessionDir, 'logs.jsonl'), 'utf8')
    const logLines = logsContent.trim().split('\n').map(l => JSON.parse(l))

    const errorLog = logLines.find((l: { message?: string; level?: string; tool?: string }) =>
      l.message === 'tool execution failed' && l.level === 'error' && l.tool === 'TracedFail'
    )
    expect(errorLog).toBeDefined()
    expect(errorLog.error).toContain('traced-failure-reason')

    // Verify trace span has error status
    const tracesPath = join(sessionDir, 'traces.jsonl')
    const tracesContent = readFileSync(tracesPath, 'utf8')
    const traceLines = tracesContent.trim().split('\n').map(l => JSON.parse(l))

    const errorSpan = traceLines.find((t: { name?: string; attributes?: { tool?: string } }) =>
      t.name === 'agent.tool_execution' && t.attributes?.tool === 'TracedFail'
    )
    expect(errorSpan).toBeDefined()
    expect(errorSpan.status).toBe('error')
    expect(errorSpan.attributes.error).toContain('traced-failure-reason')
  })

  it('tool that throws returns error result to the model', async () => {
    const toolFile = join(tmpDir, 'tools', 'fail.ts')
    writeFileSync(toolFile, `
export default {
  name: 'Fail',
  description: 'Always fails',
  inputSchema: { type: 'object', properties: {} },
  async execute() { throw new Error('something went wrong') },
}
`)

    const configFile = join(tmpDir, 'ra-fail.config.json')
    writeFileSync(configFile, JSON.stringify({
      agent: {
        tools: { custom: [toolFile] },
        context: { enabled: false },
        skillDirs: [],
      },
    }))

    env.mock.enqueue([{ type: 'tool_call', name: 'Fail', args: {} }])
    env.mock.enqueue([{ type: 'text', content: 'The tool failed as expected.' }])

    const { stdout, exitCode } = await runBinary(
      ['--cli', '--config', configFile, '--max-iterations', '5', 'try it'],
      env.binaryEnv,
    )

    expect(exitCode).toBe(0)
    expect(stdout).toContain('The tool failed as expected.')

    // Verify error was sent back to model
    const secondReqBody = JSON.stringify(env.mock.requests()[1]?.body)
    expect(secondReqBody).toContain('something went wrong')
  })
})
