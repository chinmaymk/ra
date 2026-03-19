import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test'
import { createTestEnv, type TestEnv } from './helpers/setup'
import { runBinaryWithStdin } from './helpers/binary'

describe('CLI integration', () => {
  let env: TestEnv

  beforeAll(async () => { env = await createTestEnv() })
  afterAll(async () => { await env.cleanup() })
  afterEach(() => { env.mock.resetRequests() })

  it('simple prompt → text response → stdout contains response, exit 0', async () => {
    env.mock.enqueue([{ type: 'text', content: 'Paris is the capital of France.' }])
    const { stdout, exitCode } = await runBinaryWithStdin(
      ['--cli', 'What is the capital of France?'],
      '',
      env.binaryEnv,
    )
    expect(exitCode).toBe(0)
    expect(stdout).toContain('Paris is the capital of France.')
  })

  it('piped stdin becomes the prompt in CLI mode', async () => {
    env.mock.enqueue([{ type: 'text', content: 'I see your input.' }])
    const { stdout, exitCode } = await runBinaryWithStdin(
      [],
      'summarize this text',
      env.binaryEnv,
    )
    expect(exitCode).toBe(0)
    expect(stdout).toContain('I see your input.')
    const req = env.mock.requests()[0]
    expect(JSON.stringify(req?.body)).toContain('summarize this text')
  })

  it('provider error → exit nonzero, stderr contains error', async () => {
    env.mock.enqueue([{ type: 'error', status: 500, message: 'Internal Server Error' }])
    const { stderr, exitCode } = await runBinaryWithStdin(
      ['--cli', 'hello'],
      '',
      { ...env.binaryEnv, extra: { RA_MAX_RETRIES: '0' } },
    )
    expect(exitCode).not.toBe(0)
    expect(stderr.length).toBeGreaterThan(0)
  })

  it('--max-iterations 1 with always-tool-calling LLM stops after 1 iteration', async () => {
    for (let i = 0; i < 10; i++) {
      env.mock.enqueue([{ type: 'tool_call', name: 'noop', args: {} }])
    }
    const { exitCode } = await runBinaryWithStdin(
      ['--cli', '--max-iterations', '1', 'go'],
      '',
      env.binaryEnv,
    )
    expect(exitCode).toBe(0)
    expect(env.mock.requests()).toHaveLength(1)
  })

  it('uses openai provider when --provider openai is set', async () => {
    env.mock.enqueue([{ type: 'text', content: 'OpenAI says hello.' }])
    const { stdout, exitCode } = await runBinaryWithStdin(
      ['--cli', '--provider', 'openai', '--model', 'gpt-4o', 'hello'],
      '',
      { ...env.binaryEnv, provider: 'openai', apiKey: 'test-key' },
    )
    expect(exitCode).toBe(0)
    expect(stdout).toContain('OpenAI says hello.')
    expect(env.mock.requests()[0]?.provider).toBe('openai')
  })
})
