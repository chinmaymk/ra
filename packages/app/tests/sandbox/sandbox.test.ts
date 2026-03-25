import { test, expect, describe, mock, beforeEach, afterEach } from 'bun:test'
import { Sandbox } from '../../src/sandbox/sandbox'
import type { SandboxConfig, SandboxEvent } from '../../src/sandbox/types'

function minimalConfig(): SandboxConfig {
  return {
    provider: 'anthropic',
    providerOptions: { apiKey: 'test-key' },
    model: 'claude-sonnet-4-6',
    maxIterations: 10,
    maxRetries: 3,
    toolTimeout: 30000,
    parallelToolCalls: true,
    maxTokenBudget: 0,
    maxDuration: 0,
    maxToolResponseSize: 25000,
    compaction: { enabled: false, threshold: 0.9 },
    tools: { builtin: true, overrides: {} },
    permissions: {},
    middleware: {},
    configDir: '/tmp',
  }
}

/** Create a fake Bun.spawn that simulates a container over NDJSON. */
function mockSpawn(responses: SandboxEvent[]) {
  const stdinChunks: string[] = []

  // Build stdout as NDJSON lines
  const lines = responses.map(e => JSON.stringify(e) + '\n').join('')
  const encoded = new TextEncoder().encode(lines)

  // Create a ReadableStream that yields the encoded NDJSON
  const stdout = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoded)
      controller.close()
    },
  })

  const stdin = {
    write(data: string | Uint8Array) {
      stdinChunks.push(typeof data === 'string' ? data : new TextDecoder().decode(data))
      return data.length
    },
    end() {},
    flush() {},
  }

  const proc = {
    stdin,
    stdout,
    stderr: null,
    pid: 12345,
    kill: mock(() => {}),
    exited: new Promise<number>(() => {}), // never resolves
  }

  return { proc, stdinChunks }
}

describe('Sandbox.create', () => {
  let originalSpawn: typeof Bun.spawn

  beforeEach(() => {
    originalSpawn = Bun.spawn
  })

  afterEach(() => {
    Bun.spawn = originalSpawn
  })

  test('sends init command and waits for ready', async () => {
    const { proc, stdinChunks } = mockSpawn([{ type: 'ready' }])
    Bun.spawn = mock(() => proc) as typeof Bun.spawn

    const sandbox = await Sandbox.create(minimalConfig())

    // Verify init command was sent
    const initCmd = JSON.parse(stdinChunks[0]!)
    expect(initCmd.type).toBe('init')
    expect(initCmd.config.provider).toBe('anthropic')
    expect(initCmd.config.model).toBe('claude-sonnet-4-6')

    sandbox.destroy()
  })

  test('passes docker args with defaults', async () => {
    const { proc } = mockSpawn([{ type: 'ready' }])
    let capturedArgs: string[] = []
    Bun.spawn = mock((args: string[]) => {
      capturedArgs = args
      return proc
    }) as typeof Bun.spawn

    const sandbox = await Sandbox.create(minimalConfig())

    expect(capturedArgs[0]).toBe('docker')
    expect(capturedArgs[1]).toBe('run')
    expect(capturedArgs).toContain('--rm')
    expect(capturedArgs).toContain('-i')
    expect(capturedArgs).toContain('--network')
    expect(capturedArgs).toContain('none')
    expect(capturedArgs[capturedArgs.length - 1]).toBe('ra-sandbox')

    sandbox.destroy()
  })

  test('passes custom docker options', async () => {
    const { proc } = mockSpawn([{ type: 'ready' }])
    let capturedArgs: string[] = []
    Bun.spawn = mock((args: string[]) => {
      capturedArgs = args
      return proc
    }) as typeof Bun.spawn

    const sandbox = await Sandbox.create(minimalConfig(), {
      image: 'my-sandbox:latest',
      memory: '512m',
      cpus: '0.5',
      network: 'bridge',
      volumes: ['/data:/data:ro'],
      extraFlags: ['--read-only'],
    })

    expect(capturedArgs).toContain('--memory')
    expect(capturedArgs).toContain('512m')
    expect(capturedArgs).toContain('--cpus')
    expect(capturedArgs).toContain('0.5')
    expect(capturedArgs).toContain('--network')
    expect(capturedArgs).toContain('bridge')
    expect(capturedArgs).toContain('-v')
    expect(capturedArgs).toContain('/data:/data:ro')
    expect(capturedArgs).toContain('--read-only')
    expect(capturedArgs[capturedArgs.length - 1]).toBe('my-sandbox:latest')

    sandbox.destroy()
  })

  test('times out if ready never arrives', async () => {
    // Spawn that never sends ready
    const { proc } = mockSpawn([])
    Bun.spawn = mock(() => proc) as typeof Bun.spawn

    await expect(
      Sandbox.create(minimalConfig(), { initTimeout: 100 }),
    ).rejects.toThrow('Sandbox init timed out')
  })
})

describe('Sandbox.run', () => {
  let originalSpawn: typeof Bun.spawn

  beforeEach(() => {
    originalSpawn = Bun.spawn
  })

  afterEach(() => {
    Bun.spawn = originalSpawn
  })

  test('sends run command and receives result', async () => {
    const result: SandboxEvent = {
      type: 'result',
      id: '', // will be matched dynamically
      result: {
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
        ],
        iterations: 1,
        usage: { inputTokens: 10, outputTokens: 5 },
        durationMs: 100,
      },
    }

    // We need the sandbox to respond with the correct run id.
    // Since the id is generated inside .run(), we'll intercept stdin to get it
    // then push the result to stdout.
    const stdinChunks: string[] = []
    let stdoutController: ReadableStreamDefaultController<Uint8Array>

    const stdout = new ReadableStream<Uint8Array>({
      start(controller) {
        stdoutController = controller
        // Send ready immediately
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ type: 'ready' }) + '\n'))
      },
    })

    const stdin = {
      write(data: string | Uint8Array) {
        const str = typeof data === 'string' ? data : new TextDecoder().decode(data)
        stdinChunks.push(str)

        // When we see a 'run' command, respond with a result using its id
        try {
          const cmd = JSON.parse(str)
          if (cmd.type === 'run') {
            const response = { ...result, id: cmd.id }
            stdoutController.enqueue(new TextEncoder().encode(JSON.stringify(response) + '\n'))
          }
        } catch { /* not JSON yet */ }

        return str.length
      },
      end() {},
      flush() {},
    }

    const proc = {
      stdin,
      stdout,
      stderr: null,
      pid: 12345,
      kill: mock(() => {}),
      exited: new Promise<number>(() => {}),
    }

    Bun.spawn = mock(() => proc) as typeof Bun.spawn

    const sandbox = await Sandbox.create(minimalConfig())
    const loopResult = await sandbox.run([{ role: 'user', content: 'hi' }])

    expect(loopResult.iterations).toBe(1)
    expect(loopResult.messages).toHaveLength(2)
    expect(loopResult.usage.inputTokens).toBe(10)

    sandbox.destroy()
  })

  test('streams chunks via onChunk callback', async () => {
    const chunks: unknown[] = []
    let stdoutController: ReadableStreamDefaultController<Uint8Array>

    const stdout = new ReadableStream<Uint8Array>({
      start(controller) {
        stdoutController = controller
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ type: 'ready' }) + '\n'))
      },
    })

    const stdin = {
      write(data: string | Uint8Array) {
        const str = typeof data === 'string' ? data : new TextDecoder().decode(data)
        try {
          const cmd = JSON.parse(str)
          if (cmd.type === 'run') {
            const id = cmd.id
            // Send chunks then result
            const events = [
              { type: 'chunk', id, chunk: { type: 'text', delta: 'hello ' } },
              { type: 'chunk', id, chunk: { type: 'text', delta: 'world' } },
              { type: 'result', id, result: { messages: [], iterations: 1, usage: { inputTokens: 0, outputTokens: 0 }, durationMs: 50 } },
            ]
            for (const e of events) {
              stdoutController.enqueue(new TextEncoder().encode(JSON.stringify(e) + '\n'))
            }
          }
        } catch { /* not JSON yet */ }
        return str.length
      },
      end() {},
      flush() {},
    }

    Bun.spawn = mock(() => ({
      stdin, stdout, stderr: null, pid: 1, kill: mock(() => {}),
      exited: new Promise<number>(() => {}),
    })) as typeof Bun.spawn

    const sandbox = await Sandbox.create(minimalConfig())
    await sandbox.run([{ role: 'user', content: 'hi' }], (chunk) => {
      chunks.push(chunk)
    })

    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toEqual({ type: 'text', delta: 'hello ' })
    expect(chunks[1]).toEqual({ type: 'text', delta: 'world' })

    sandbox.destroy()
  })

  test('rejects pending runs on destroy', async () => {
    // A sandbox that never responds to run
    let stdoutController: ReadableStreamDefaultController<Uint8Array>

    const stdout = new ReadableStream<Uint8Array>({
      start(controller) {
        stdoutController = controller
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ type: 'ready' }) + '\n'))
      },
    })

    const stdin = {
      write() { return 0 },
      end() {},
      flush() {},
    }

    Bun.spawn = mock(() => ({
      stdin, stdout, stderr: null, pid: 1, kill: mock(() => {}),
      exited: new Promise<number>(() => {}),
    })) as typeof Bun.spawn

    const sandbox = await Sandbox.create(minimalConfig())
    const runPromise = sandbox.run([{ role: 'user', content: 'hi' }])

    sandbox.destroy()

    await expect(runPromise).rejects.toThrow('Sandbox destroyed')
  })

  test('throws when run called after destroy', async () => {
    const { proc } = mockSpawn([{ type: 'ready' }])
    Bun.spawn = mock(() => proc) as typeof Bun.spawn

    const sandbox = await Sandbox.create(minimalConfig())
    sandbox.destroy()

    expect(() => sandbox.run([{ role: 'user', content: 'hi' }])).toThrow('Sandbox has been destroyed')
  })
})
