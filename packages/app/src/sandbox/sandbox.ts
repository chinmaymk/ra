/**
 * Sandbox — Docker-isolated ra agent instances.
 *
 * Each Sandbox spawns a Docker container running sandbox-entry.ts.
 * Communication happens over NDJSON on stdin/stdout.
 */
import { randomUUID } from 'node:crypto'
import type { IMessage, StreamChunk } from '@chinmaymk/ra'
import type {
  SandboxConfig,
  SandboxCommand,
  SandboxEvent,
  SandboxLoopResult,
  SandboxOptions,
} from './types'

const DEFAULT_IMAGE = 'ra-sandbox'
const DEFAULT_INIT_TIMEOUT = 30_000

interface PendingRun {
  resolve: (result: SandboxLoopResult) => void
  reject: (error: Error) => void
  onChunk?: (chunk: StreamChunk) => void
}

/** Writable handle returned by Bun.spawn when stdin is 'pipe'. */
interface StdinPipe {
  write(data: string | Uint8Array): number
  end(): void
  flush(): void | Promise<void>
}

export class Sandbox {
  private stdin: StdinPipe
  private proc: ReturnType<typeof Bun.spawn>
  private pending = new Map<string, PendingRun>()
  private buffer = ''
  private destroyed = false

  private constructor(stdin: StdinPipe, proc: ReturnType<typeof Bun.spawn>) {
    this.stdin = stdin
    this.proc = proc
  }

  /** Create a new sandbox. Spawns a Docker container and waits for it to be ready. */
  static async create(
    config: SandboxConfig,
    options: SandboxOptions = {},
  ): Promise<Sandbox> {
    const image = options.image ?? DEFAULT_IMAGE
    const initTimeout = options.initTimeout ?? DEFAULT_INIT_TIMEOUT

    const args = buildDockerArgs(image, options)
    const proc = Bun.spawn(args, {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const stdin = proc.stdin as unknown as StdinPipe

    const sandbox = new Sandbox(stdin, proc)
    sandbox.startReading()

    const readyPromise = sandbox.waitForReady(initTimeout)
    sandbox.send({ type: 'init', config })
    await readyPromise

    return sandbox
  }

  /** Run the agent loop with the given messages. */
  async run(
    messages: IMessage[],
    onChunk?: (chunk: StreamChunk) => void,
  ): Promise<SandboxLoopResult> {
    this.assertAlive()
    const id = randomUUID()

    return new Promise<SandboxLoopResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onChunk })
      this.send({ type: 'run', id, messages })
    })
  }

  /** Abort the currently running loop. */
  abort(id?: string): void {
    if (this.destroyed) return
    const runId = id ?? this.pending.keys().next().value
    if (runId) this.send({ type: 'abort', id: runId })
  }

  /** Terminate the container. */
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true

    for (const [, pending] of this.pending) {
      pending.reject(new Error('Sandbox destroyed'))
    }
    this.pending.clear()

    try { this.stdin.end() } catch { /* already closed */ }
    this.proc.kill()
  }

  /** True if the container process has exited. */
  get exited(): boolean {
    return this.destroyed
  }

  // ── Internal ────────────────────────────────────────────────────────

  private send(cmd: SandboxCommand) {
    this.assertAlive()
    this.stdin.write(JSON.stringify(cmd) + '\n')
  }

  private assertAlive() {
    if (this.destroyed) throw new Error('Sandbox has been destroyed')
  }

  private waitForReady(timeout: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Sandbox init timed out after ${timeout}ms`))
        this.destroy()
      }, timeout)

      const check = (event: SandboxEvent) => {
        if (event.type === 'ready') {
          clearTimeout(timer)
          this.offEvent(check)
          resolve()
        }
      }
      this.onEvent(check)
    })
  }

  // ── Event dispatching ───────────────────────────────────────────────

  private eventListeners: Array<(event: SandboxEvent) => void> = []

  private onEvent(fn: (event: SandboxEvent) => void) {
    this.eventListeners.push(fn)
  }

  private offEvent(fn: (event: SandboxEvent) => void) {
    this.eventListeners = this.eventListeners.filter(l => l !== fn)
  }

  private dispatch(event: SandboxEvent) {
    for (const listener of this.eventListeners) {
      listener(event)
    }

    if ('id' in event && event.id) {
      const pending = this.pending.get(event.id)
      if (!pending) return

      switch (event.type) {
        case 'chunk':
          pending.onChunk?.(event.chunk)
          break
        case 'result':
          this.pending.delete(event.id)
          pending.resolve(event.result)
          break
        case 'error':
          this.pending.delete(event.id)
          pending.reject(new Error(event.error))
          break
      }
    }
  }

  // ── Stdout reader ───────────────────────────────────────────────────

  private async startReading() {
    const stdout = this.proc.stdout as unknown as ReadableStream<Uint8Array> | null
    if (!stdout) return

    const decoder = new TextDecoder()
    const reader = stdout.getReader()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        this.buffer += decoder.decode(value, { stream: true })
        const lines = this.buffer.split('\n')
        this.buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue

          try {
            const event = JSON.parse(trimmed) as SandboxEvent
            this.dispatch(event)
          } catch {
            // Non-JSON output from container — ignore
          }
        }
      }
    } catch {
      // Stream closed
    } finally {
      if (!this.destroyed) {
        this.destroyed = true
        for (const [, pending] of this.pending) {
          pending.reject(new Error('Sandbox container exited unexpectedly'))
        }
        this.pending.clear()
      }
    }
  }
}

// ── Docker command builder ────────────────────────────────────────────

function buildDockerArgs(image: string, options: SandboxOptions): string[] {
  const args = ['docker', 'run', '--rm', '-i']

  if (options.memory) args.push('--memory', options.memory)
  if (options.cpus) args.push('--cpus', options.cpus)

  const network = options.network ?? 'none'
  args.push('--network', network)

  if (options.volumes) {
    for (const vol of options.volumes) {
      args.push('-v', vol)
    }
  }

  if (options.extraFlags) {
    args.push(...options.extraFlags)
  }

  args.push(image)
  return args
}
