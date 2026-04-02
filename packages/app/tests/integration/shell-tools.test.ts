import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test'
import { writeFileSync, mkdirSync, chmodSync, readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTestEnv, type TestEnv } from './helpers/setup'
import { runBinary } from './helpers/binary'

describe('Shell script tools integration', () => {
  let env: TestEnv
  let tmpDir: string

  beforeAll(async () => {
    env = await createTestEnv()
    tmpDir = join(tmpdir(), `ra-shell-tools-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    mkdirSync(join(tmpDir, 'tools'), { recursive: true })
  })

  afterAll(async () => { await env.cleanup() })
  afterEach(() => env.mock.resetRequests())

  function writeScript(name: string, content: string): string {
    const path = join(tmpDir, 'tools', name)
    writeFileSync(path, content, { mode: 0o755 })
    chmodSync(path, 0o755)
    return path
  }

  function writeConfig(name: string, toolFiles: string[]): string {
    const configFile = join(tmpDir, `${name}.config.json`)
    writeFileSync(configFile, JSON.stringify({
      agent: {
        tools: { custom: toolFiles },
        context: { enabled: false },
        skillDirs: [],
      },
    }))
    return configFile
  }

  it('LLM calls a shell script tool and receives its output', async () => {
    const toolFile = writeScript('greet.sh', `#!/bin/bash
if [ "$1" = "--describe" ]; then
  echo '{"name":"ShellGreet","description":"Greet a person","parameters":{"name":{"type":"string","description":"Name"}}}'
  exit 0
fi
read -r input
name=$(echo "$input" | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "Hello, $name! From a shell script."
`)

    const configFile = writeConfig('shell-greet', [toolFile])

    env.mock.enqueue([{ type: 'tool_call', name: 'ShellGreet', args: { name: 'Bob' } }])
    env.mock.enqueue([{ type: 'text', content: 'The greeting was: Hello, Bob! From a shell script.' }])

    const { stdout, exitCode } = await runBinary(
      ['--cli', '--config', configFile, '--max-iterations', '5', 'greet Bob'],
      env.binaryEnv,
    )

    expect(exitCode).toBe(0)
    expect(stdout).toContain('Hello, Bob! From a shell script.')

    // Verify the tool result was sent back to the model
    const reqs = env.mock.requests()
    expect(reqs).toHaveLength(2)
    const secondReqBody = JSON.stringify(reqs[1]?.body)
    expect(secondReqBody).toContain('Hello, Bob! From a shell script.')
  })

  it('shell tool schema is sent to the model', async () => {
    const toolFile = writeScript('schema-check.sh', `#!/bin/bash
if [ "$1" = "--describe" ]; then
  cat << 'EOF'
{"name":"ShellLookup","description":"Look up a value","inputSchema":{"type":"object","properties":{"key":{"type":"string","description":"The key"},"ns":{"type":"string","description":"Namespace"}},"required":["key"]}}
EOF
  exit 0
fi
read -r input
echo "found"
`)

    const configFile = writeConfig('shell-schema', [toolFile])

    env.mock.enqueue([{ type: 'text', content: 'Got it.' }])

    const { exitCode } = await runBinary(
      ['--cli', '--config', configFile, 'hello'],
      env.binaryEnv,
    )

    expect(exitCode).toBe(0)

    const reqBody = env.mock.requests()[0]?.body as Record<string, unknown>
    const tools = reqBody?.tools as Array<{ name: string; input_schema?: unknown }> | undefined
    expect(tools).toBeDefined()

    const shellTool = tools!.find(t => t.name === 'ShellLookup')
    expect(shellTool).toBeDefined()
    expect(shellTool!.input_schema).toEqual({
      type: 'object',
      properties: {
        key: { type: 'string', description: 'The key' },
        ns: { type: 'string', description: 'Namespace' },
      },
      required: ['key'],
    })
  })

  it('shell tool with parameters shorthand converts to JSON Schema', async () => {
    const toolFile = writeScript('params-shorthand.sh', `#!/bin/bash
if [ "$1" = "--describe" ]; then
  echo '{"name":"ShellAdd","description":"Add numbers","parameters":{"a":{"type":"number","description":"First"},"b":{"type":"number","description":"Second"}}}'
  exit 0
fi
read -r input
a=$(echo "$input" | grep -o '"a":[0-9]*' | head -1 | cut -d':' -f2)
b=$(echo "$input" | grep -o '"b":[0-9]*' | head -1 | cut -d':' -f2)
echo $(( a + b ))
`)

    const configFile = writeConfig('shell-add', [toolFile])

    env.mock.enqueue([{ type: 'tool_call', name: 'ShellAdd', args: { a: 17, b: 25 } }])
    env.mock.enqueue([{ type: 'text', content: 'The sum is 42.' }])

    const { stdout, exitCode } = await runBinary(
      ['--cli', '--config', configFile, '--max-iterations', '5', 'add 17 and 25'],
      env.binaryEnv,
    )

    expect(exitCode).toBe(0)
    expect(stdout).toContain('The sum is 42.')

    // Verify the tool schema used parameters shorthand → JSON Schema conversion
    const reqBody = env.mock.requests()[0]?.body as Record<string, unknown>
    const tools = reqBody?.tools as Array<{ name: string; input_schema?: unknown }> | undefined
    const addTool = tools!.find(t => t.name === 'ShellAdd')
    expect(addTool).toBeDefined()
    expect(addTool!.input_schema).toEqual({
      type: 'object',
      properties: {
        a: { type: 'number', description: 'First' },
        b: { type: 'number', description: 'Second' },
      },
      required: ['a', 'b'],
    })

    // Verify the sum was sent back to model
    const secondReqBody = JSON.stringify(env.mock.requests()[1]?.body)
    expect(secondReqBody).toContain('42')
  })

  it('shell tool error is returned to the model as error result', async () => {
    const toolFile = writeScript('fail.sh', `#!/bin/bash
if [ "$1" = "--describe" ]; then
  echo '{"name":"ShellFail","description":"Always fails","parameters":{}}'
  exit 0
fi
echo "something broke" >&2
exit 1
`)

    const configFile = writeConfig('shell-fail', [toolFile])

    env.mock.enqueue([{ type: 'tool_call', name: 'ShellFail', args: {} }])
    env.mock.enqueue([{ type: 'text', content: 'The tool failed.' }])

    const { stdout, exitCode } = await runBinary(
      ['--cli', '--config', configFile, '--max-iterations', '5', 'try failing'],
      env.binaryEnv,
    )

    expect(exitCode).toBe(0)
    expect(stdout).toContain('The tool failed.')

    // Verify error was sent back to model
    const secondReqBody = JSON.stringify(env.mock.requests()[1]?.body)
    expect(secondReqBody).toContain('exited with code 1')
  })

  it('shell script tools coexist with builtin tools', async () => {
    const toolFile = writeScript('coexist.sh', `#!/bin/bash
if [ "$1" = "--describe" ]; then
  echo '{"name":"ShellPing","description":"Returns pong","parameters":{}}'
  exit 0
fi
echo "pong"
`)

    const configFile = join(tmpDir, 'shell-coexist.config.json')
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

    const reqBody = env.mock.requests()[0]?.body as Record<string, unknown>
    const tools = reqBody?.tools as Array<{ name: string }> | undefined
    expect(tools).toBeDefined()

    const toolNames = tools!.map(t => t.name)
    expect(toolNames).toContain('ShellPing')  // shell script tool
    expect(toolNames).toContain('Read')       // builtin
    expect(toolNames).toContain('Bash')       // builtin
  })

  it('shell script tools coexist with TS custom tools', async () => {
    const shellTool = writeScript('shell-mix.sh', `#!/bin/bash
if [ "$1" = "--describe" ]; then
  echo '{"name":"ShellMix","description":"Shell tool","parameters":{}}'
  exit 0
fi
echo "from-shell"
`)

    const tsTool = join(tmpDir, 'tools', 'ts-mix.ts')
    writeFileSync(tsTool, `
export default {
  name: 'TsMix',
  description: 'TypeScript tool',
  inputSchema: { type: 'object', properties: {} },
  async execute() { return 'from-ts' },
}
`)

    const configFile = join(tmpDir, 'shell-mix.config.json')
    writeFileSync(configFile, JSON.stringify({
      agent: {
        tools: { builtin: false, custom: [shellTool, tsTool] },
        context: { enabled: false },
        skillDirs: [],
      },
    }))

    env.mock.enqueue([{ type: 'tool_call', name: 'ShellMix', args: {} }])
    env.mock.enqueue([{ type: 'tool_call', name: 'TsMix', args: {} }])
    env.mock.enqueue([{ type: 'text', content: 'Both tools returned results.' }])

    const { stdout, exitCode } = await runBinary(
      ['--cli', '--config', configFile, '--max-iterations', '5', 'call both tools'],
      env.binaryEnv,
    )

    expect(exitCode).toBe(0)
    expect(stdout).toContain('Both tools returned results.')

    // Verify both tools were present in first request
    const reqBody = env.mock.requests()[0]?.body as Record<string, unknown>
    const tools = reqBody?.tools as Array<{ name: string }> | undefined
    const toolNames = tools!.map(t => t.name)
    expect(toolNames).toContain('ShellMix')
    expect(toolNames).toContain('TsMix')

    // Verify both tool results were sent back
    const req2Body = JSON.stringify(env.mock.requests()[1]?.body)
    expect(req2Body).toContain('from-shell')
    const req3Body = JSON.stringify(env.mock.requests()[2]?.body)
    expect(req3Body).toContain('from-ts')
  })

  it('shell tool is logged and traced', async () => {
    const toolFile = writeScript('traced.sh', `#!/bin/bash
if [ "$1" = "--describe" ]; then
  echo '{"name":"ShellTraced","description":"Traced shell tool","parameters":{"x":{"type":"string","description":"Input"}}}'
  exit 0
fi
read -r input
x=$(echo "$input" | grep -o '"x":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "traced-result-$x"
`)

    const configFile = writeConfig('shell-traced', [toolFile])

    // Snapshot session dirs before the run
    const sessionsDir = join(env.storageDir, 'sessions')
    const beforeDirs = new Set(existsSync(sessionsDir) ? readdirSync(sessionsDir) : [])

    env.mock.enqueue([{ type: 'tool_call', name: 'ShellTraced', args: { x: 'hello' } }])
    env.mock.enqueue([{ type: 'text', content: 'Done tracing.' }])

    const { exitCode } = await runBinary(
      ['--cli', '--config', configFile, '--max-iterations', '5', 'test tracing'],
      env.binaryEnv,
    )

    expect(exitCode).toBe(0)

    // Find the new session directory
    const afterDirs = readdirSync(sessionsDir)
    const newDirs = afterDirs.filter(d => !beforeDirs.has(d) && existsSync(join(sessionsDir, d, 'logs.jsonl')))
    expect(newDirs.length).toBe(1)
    const sessionDir = join(sessionsDir, newDirs[0]!)

    // Verify logs contain shell tool execution entries
    const logsContent = readFileSync(join(sessionDir, 'logs.jsonl'), 'utf8')
    const logLines = logsContent.trim().split('\n').map(l => JSON.parse(l))

    const customToolsLoaded = logLines.find((l: { message?: string }) => l.message === 'custom tools loaded')
    expect(customToolsLoaded).toBeDefined()
    expect(customToolsLoaded.tools).toContain('ShellTraced')

    const executingTool = logLines.find((l: { message?: string; tool?: string }) =>
      l.message === 'executing tool' && l.tool === 'ShellTraced'
    )
    expect(executingTool).toBeDefined()

    const toolComplete = logLines.find((l: { message?: string; tool?: string }) =>
      l.message === 'tool execution complete' && l.tool === 'ShellTraced'
    )
    expect(toolComplete).toBeDefined()

    // Verify traces contain shell tool span
    const tracesPath = join(sessionDir, 'traces.jsonl')
    const tracesContent = readFileSync(tracesPath, 'utf8')
    const traceLines = tracesContent.trim().split('\n').map(l => JSON.parse(l))

    const toolSpan = traceLines.find((t: { name?: string; attributes?: { tool?: string } }) =>
      t.name === 'agent.tool_execution' && t.attributes?.tool === 'ShellTraced'
    )
    expect(toolSpan).toBeDefined()
    expect(toolSpan.status).toBe('ok')
  })

  it('shell tool loaded via shell: prefix in config', async () => {
    const toolFile = writeScript('prefixed.sh', `#!/bin/bash
if [ "$1" = "--describe" ]; then
  echo '{"name":"ShellPrefixed","description":"Loaded with shell: prefix","parameters":{}}'
  exit 0
fi
echo "prefixed-result"
`)

    const configFile = join(tmpDir, 'shell-prefixed.config.json')
    writeFileSync(configFile, JSON.stringify({
      agent: {
        tools: { custom: [`shell: ${toolFile}`] },
        context: { enabled: false },
        skillDirs: [],
      },
    }))

    env.mock.enqueue([{ type: 'tool_call', name: 'ShellPrefixed', args: {} }])
    env.mock.enqueue([{ type: 'text', content: 'Got the prefixed result.' }])

    const { stdout, exitCode } = await runBinary(
      ['--cli', '--config', configFile, '--max-iterations', '5', 'call it'],
      env.binaryEnv,
    )

    expect(exitCode).toBe(0)
    expect(stdout).toContain('Got the prefixed result.')

    const secondReqBody = JSON.stringify(env.mock.requests()[1]?.body)
    expect(secondReqBody).toContain('prefixed-result')
  })
})
