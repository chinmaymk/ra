import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test'
import { createTestEnv, type TestEnv } from './helpers/setup'
import { runBinary } from './helpers/binary'
import { join } from 'path'
import { writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'

const FIXTURE_MCP_SERVER = join(import.meta.dir, 'fixtures/mcp-server/server.ts')

describe('MCP client integration', () => {
  let env: TestEnv
  let tmpDir: string

  beforeAll(async () => {
    env = await createTestEnv()
    tmpDir = join(tmpdir(), `ra-mcp-test-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
  })

  afterAll(async () => { await env.cleanup() })
  afterEach(() => env.mock.resetRequests())

  it('connects to stdio MCP server and registers its tools', async () => {
    env.mock.enqueue([{ type: 'tool_call', name: 'echo_text', args: { text: 'hello MCP' } }])
    env.mock.enqueue([{ type: 'text', content: 'MCP tool returned: echo: hello MCP' }])

    const mcpConfig = JSON.stringify({
      mcp: {
        client: [{
          name: 'test-mcp',
          transport: 'stdio',
          command: 'bun',
          args: ['run', FIXTURE_MCP_SERVER],
        }],
      },
    })
    const configFile = join(tmpDir, 'ra.config.json')
    writeFileSync(configFile, mcpConfig)

    const { stdout, exitCode } = await runBinary(
      ['--cli', '--config', configFile, 'call the echo tool with hello MCP'],
      env.binaryEnv,
    )
    expect(exitCode).toBe(0)
    expect(stdout).toContain('echo: hello MCP')
  })

  it('MCP tool execution error is returned as error tool result (loop does not crash)', async () => {
    env.mock.enqueue([{ type: 'tool_call', name: 'fail_tool', args: {} }])
    env.mock.enqueue([{ type: 'text', content: 'Tool failed but I continue.' }])

    const configFile = join(tmpDir, 'ra.config.json')
    writeFileSync(configFile, JSON.stringify({
      mcp: {
        client: [{ name: 'test-mcp', transport: 'stdio', command: 'bun', args: ['run', FIXTURE_MCP_SERVER] }],
      },
    }))

    const { stdout, exitCode } = await runBinary(
      ['--cli', '--config', configFile, 'call fail_tool'],
      env.binaryEnv,
    )
    expect(exitCode).toBe(0)
    expect(stdout).toContain('Tool failed but I continue.')
  })
})
