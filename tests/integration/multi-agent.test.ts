import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { startMockLLMServer, type MockLLMServer } from './helpers/mock-llm-server'
import { ensureBinary, BINARY_PATH, type BinaryRunResult } from './helpers/binary'

async function runMultiAgent(args: string[], env: Record<string, string>): Promise<BinaryRunResult> {
  const proc = Bun.spawn([BINARY_PATH, ...args], { env, stdout: 'pipe', stderr: 'pipe', stdin: 'pipe' })
  proc.stdin.end()
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const exitCode = await proc.exited
  return { stdout, stderr, exitCode }
}

describe('Multi-agent integration', () => {
  let mock: MockLLMServer
  let tmp: string
  let configPath: string
  let baseEnv: Record<string, string>

  beforeAll(async () => {
    await ensureBinary()
    mock = await startMockLLMServer()
    tmp = join(tmpdir(), `ra-multi-agent-int-${Date.now()}`)

    mkdirSync(join(tmp, 'agents', 'coder'), { recursive: true })
    mkdirSync(join(tmp, 'agents', 'reviewer'), { recursive: true })

    // Each agent has a distinct model so we can verify routing via mock requests
    writeFileSync(join(tmp, 'agents', 'coder', 'ra.config.yml'), [
      'provider: anthropic',
      'model: claude-coder-test',
      'systemPrompt: You are a coder.',
      'context:',
      '  enabled: false',
    ].join('\n'))

    writeFileSync(join(tmp, 'agents', 'reviewer', 'ra.config.yml'), [
      'provider: anthropic',
      'model: claude-reviewer-test',
      'systemPrompt: You are a reviewer.',
      'context:',
      '  enabled: false',
    ].join('\n'))

    configPath = join(tmp, 'ra.config.yml')
    writeFileSync(configPath, [
      'interface: repl',
      `dataDir: ${join(tmp, '.ra')}`,
      'defaultAgent: coder',
      'agents:',
      `  coder: ${join(tmp, 'agents', 'coder', 'ra.config.yml')}`,
      `  reviewer: ${join(tmp, 'agents', 'reviewer', 'ra.config.yml')}`,
    ].join('\n'))

    baseEnv = {
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
      HOME: process.env.HOME ?? '/tmp',
      RA_ANTHROPIC_API_KEY: 'test-key',
      RA_ANTHROPIC_BASE_URL: mock.anthropicBaseURL,
    }
  })

  afterAll(async () => {
    await mock.stop()
    rmSync(tmp, { recursive: true, force: true })
  })

  afterEach(() => { mock.resetRequests() })

  it('--agent coder routes to coder agent with correct model', async () => {
    mock.enqueue([{ type: 'text', content: 'Code written.' }])
    const { stdout, exitCode } = await runMultiAgent(
      ['--config', configPath, '--cli', '--agent', 'coder', 'write code'],
      baseEnv,
    )
    expect(exitCode).toBe(0)
    expect(stdout).toContain('Code written.')
    const req = mock.requests()[0]
    expect((req?.body as Record<string, unknown>)?.model).toBe('claude-coder-test')
  })

  it('--agent reviewer routes to reviewer agent with correct model', async () => {
    mock.enqueue([{ type: 'text', content: 'Looks good.' }])
    const { stdout, exitCode } = await runMultiAgent(
      ['--config', configPath, '--cli', '--agent', 'reviewer', 'review this'],
      baseEnv,
    )
    expect(exitCode).toBe(0)
    expect(stdout).toContain('Looks good.')
    const req = mock.requests()[0]
    expect((req?.body as Record<string, unknown>)?.model).toBe('claude-reviewer-test')
  })

  it('defaults to defaultAgent (coder) when --agent is omitted', async () => {
    mock.enqueue([{ type: 'text', content: 'Default reply.' }])
    const { stdout, exitCode } = await runMultiAgent(
      ['--config', configPath, '--cli', 'hello'],
      baseEnv,
    )
    expect(exitCode).toBe(0)
    expect(stdout).toContain('Default reply.')
    const req = mock.requests()[0]
    expect((req?.body as Record<string, unknown>)?.model).toBe('claude-coder-test')
  })

  it('--agent with unknown name exits with error', async () => {
    const { exitCode, stderr } = await runMultiAgent(
      ['--config', configPath, '--cli', '--agent', 'nonexistent', 'hello'],
      baseEnv,
    )
    expect(exitCode).not.toBe(0)
    expect(stderr).toContain('nonexistent')
  })

  it('each agent gets isolated dataDir under orchestrator dataDir', async () => {
    mock.enqueue([{ type: 'text', content: 'ok' }])
    await runMultiAgent(
      ['--config', configPath, '--cli', '--agent', 'coder', 'hello'],
      baseEnv,
    )
    expect(existsSync(join(tmp, '.ra', 'coder', 'sessions'))).toBe(true)
  })

  it('system prompt from agent config is sent to provider', async () => {
    mock.enqueue([{ type: 'text', content: 'ok' }])
    await runMultiAgent(
      ['--config', configPath, '--cli', '--agent', 'reviewer', 'hello'],
      baseEnv,
    )
    const req = mock.requests()[0]
    const body = req?.body as Record<string, unknown>
    const system = body?.system as string | Array<{ text: string }>
    const systemText = typeof system === 'string' ? system : system?.map(s => s.text).join('')
    expect(systemText).toContain('You are a reviewer.')
  })
})
