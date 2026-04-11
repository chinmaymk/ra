import { existsSync } from 'fs'
import { join } from 'path'

const PROJECT_ROOT = join(import.meta.dir, '../../..')
export const BINARY_PATH = join(PROJECT_ROOT, 'dist/ra')

export async function ensureBinary(): Promise<void> {
  if (!existsSync(BINARY_PATH)) {
    console.log('[integration] Building binary...')
    const result = await Bun.$`bun run compile`.cwd(PROJECT_ROOT).quiet()
    if (result.exitCode !== 0) {
      throw new Error(`Binary build failed:\n${result.stderr.toString()}`)
    }
  }
}

export interface BinaryRunResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface BinaryEnv {
  provider?: string
  apiKey?: string
  anthropicBaseURL?: string
  openaiBaseURL?: string
  googleBaseURL?: string
  storageDir?: string
  extra?: Record<string, string>
}

/** Build CLI args from BinaryEnv */
function buildArgs(opts: BinaryEnv): string[] {
  const args: string[] = []
  if (opts.provider) args.push('--provider', opts.provider)
  if (opts.storageDir) args.push('--data-dir', opts.storageDir)
  if (opts.anthropicBaseURL) args.push('--anthropic-base-url', opts.anthropicBaseURL)
  if (opts.openaiBaseURL) args.push('--openai-base-url', opts.openaiBaseURL)
  if (opts.googleBaseURL) args.push('--google-base-url', opts.googleBaseURL)
  return args
}

/** Build env vars from BinaryEnv (credentials, base URLs) */
function buildEnv(opts: BinaryEnv): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: process.env.HOME ?? '/tmp',
  }
  if (opts.apiKey) {
    const p = opts.provider ?? 'anthropic'
    if (p === 'anthropic') env['ANTHROPIC_API_KEY'] = opts.apiKey
    else if (p === 'openai') env['OPENAI_API_KEY'] = opts.apiKey
    else if (p === 'google') env['GOOGLE_API_KEY'] = opts.apiKey
  }
  if (opts.extra) Object.assign(env, opts.extra)
  return env
}

/**
 * Default cwd for spawned test binaries. We can't use the test runner's cwd
 * (the ra repo root), because `loadConfig` auto-discovers `ra.config.yml`
 * there — any dev with a local config will see the recipe/model/etc. from
 * that file silently override what the test set up. Pin cwd to the test's
 * isolated storage dir so only the config the test explicitly passes has
 * any effect.
 */
function resolveCwd(opts: BinaryEnv): string {
  return opts.storageDir ?? '/tmp'
}

/** Run binary to completion, return stdout/stderr/exitCode */
export async function runBinary(args: string[], binaryEnv: BinaryEnv): Promise<BinaryRunResult> {
  const proc = Bun.spawn([BINARY_PATH, ...buildArgs(binaryEnv), ...args], {
    cwd: resolveCwd(binaryEnv),
    env: buildEnv(binaryEnv),
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'pipe',
  })
  proc.stdin.end()
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const exitCode = await proc.exited
  return { stdout, stderr, exitCode }
}

/** Run binary with piped stdin */
export async function runBinaryWithStdin(args: string[], input: string, binaryEnv: BinaryEnv): Promise<BinaryRunResult> {
  const proc = Bun.spawn([BINARY_PATH, ...buildArgs(binaryEnv), ...args], {
    cwd: resolveCwd(binaryEnv),
    env: buildEnv(binaryEnv),
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'pipe',
  })
  proc.stdin.write(input)
  proc.stdin.end()
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const exitCode = await proc.exited
  return { stdout, stderr, exitCode }
}

export interface InteractiveProcess {
  write(text: string): void
  readAvailable(): Promise<string>
  kill(): void
  exited: Promise<BinaryRunResult>
}

/** Spawn an interactive binary process (for REPL tests) */
export function spawnBinary(args: string[], binaryEnv: BinaryEnv): InteractiveProcess {
  const proc = Bun.spawn([BINARY_PATH, ...buildArgs(binaryEnv), ...args], {
    cwd: resolveCwd(binaryEnv),
    env: buildEnv(binaryEnv),
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'pipe',
  })

  const stdoutBufs: Uint8Array[] = []
  const decoder = new TextDecoder()

  // Drain stdout into buffer
  ;(async () => {
    for await (const chunk of proc.stdout) {
      stdoutBufs.push(chunk)
    }
  })()

  return {
    write(text: string) { proc.stdin.write(text) },
    async readAvailable(): Promise<string> {
      await new Promise(r => setTimeout(r, 200))
      const all = stdoutBufs.splice(0).map(b => decoder.decode(b)).join('')
      return all
    },
    kill() { proc.kill() },
    exited: (async () => {
      const exitCode = await proc.exited
      const stdout = stdoutBufs.map(b => decoder.decode(b)).join('')
      const stderr = await new Response(proc.stderr).text()
      return { stdout, stderr, exitCode }
    })(),
  }
}

/**
 * Spawn a binary that logs `listening on port N` / `ra web running at
 * http://localhost:N` to stderr and return the parsed port. Shared plumbing
 * for `spawnHttpServer` and `spawnWebBinary`.
 */
async function spawnServerBinary(
  args: string[],
  binaryEnv: BinaryEnv,
  portRegex: RegExp,
): Promise<{ proc: InteractiveProcess; port: number }> {
  const proc = Bun.spawn([BINARY_PATH, ...buildArgs(binaryEnv), ...args], {
    env: buildEnv(binaryEnv),
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'pipe',
  })

  const decoder = new TextDecoder()
  const stdoutBufs: Uint8Array[] = []
  ;(async () => { for await (const chunk of proc.stdout) stdoutBufs.push(chunk) })()

  const stderrBufs: string[] = []
  let portResolve: ((port: number) => void) | undefined
  let portReject: ((err: Error) => void) | undefined
  const portPromise = new Promise<number>((resolve, reject) => {
    portResolve = resolve
    portReject = reject
  })

  const timer = setTimeout(() => portReject!(new Error('server did not report port within 10s')), 10000)
  let portFound = false
  ;(async () => {
    try {
      for await (const chunk of proc.stderr) {
        const text = decoder.decode(chunk)
        stderrBufs.push(text)
        if (!portFound) {
          const m = stderrBufs.join('').match(portRegex)
          if (m) {
            portFound = true
            clearTimeout(timer)
            portResolve!(parseInt(m[1]!, 10))
          }
        }
      }
      if (!portFound) {
        clearTimeout(timer)
        portReject!(new Error('server stderr closed without port announcement'))
      }
    } catch (err) {
      if (!portFound) {
        clearTimeout(timer)
        portReject!(err instanceof Error ? err : new Error(String(err)))
      }
    }
  })()

  const port = await portPromise

  const interactiveProc: InteractiveProcess = {
    write(text: string) { proc.stdin.write(text) },
    async readAvailable(): Promise<string> {
      await new Promise(r => setTimeout(r, 200))
      return stdoutBufs.splice(0).map(b => decoder.decode(b)).join('')
    },
    kill() { proc.kill() },
    exited: (async () => {
      const exitCode = await proc.exited
      return { stdout: stdoutBufs.map(b => decoder.decode(b)).join(''), stderr: stderrBufs.join(''), exitCode }
    })(),
  }

  return { proc: interactiveProc, port }
}

/** Spawn `ra web` with port 0, return the bound port. */
export async function spawnWebBinary(binaryEnv: BinaryEnv): Promise<{ proc: InteractiveProcess; port: number }> {
  return spawnServerBinary(
    ['--web', '--http-port', '0'],
    binaryEnv,
    /ra web running at http:\/\/localhost:(\d+)/,
  )
}

/** Spawn HTTP server binary with port 0, read actual port from stderr */
export async function spawnHttpServer(args: string[], binaryEnv: BinaryEnv): Promise<{ proc: InteractiveProcess; port: number }> {
  const proc = Bun.spawn([BINARY_PATH, ...buildArgs(binaryEnv), ...args, '--http-port', '0'], {
    env: buildEnv(binaryEnv),
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'pipe',
  })

  const decoder = new TextDecoder()
  const stdoutBufs: Uint8Array[] = []
  ;(async () => { for await (const chunk of proc.stdout) stdoutBufs.push(chunk) })()

  // Read stderr continuously — we must keep draining the pipe even after
  // finding the port, otherwise observability logs fill the pipe buffer
  // and the server process blocks/crashes.
  const stderrBufs: string[] = []
  let portResolve: ((port: number) => void) | undefined
  let portReject: ((err: Error) => void) | undefined
  const portPromise = new Promise<number>((resolve, reject) => {
    portResolve = resolve
    portReject = reject
  })

  const timer = setTimeout(() => portReject!(new Error('HTTP server did not report port within 10s')), 10000)
  let portFound = false
  ;(async () => {
    try {
      for await (const chunk of proc.stderr) {
        const text = decoder.decode(chunk)
        stderrBufs.push(text)
        if (!portFound) {
          const combined = stderrBufs.join('')
          const m = combined.match(/HTTP server listening on port (\d+)/)
          if (m) {
            portFound = true
            clearTimeout(timer)
            portResolve!(parseInt(m[1]!, 10))
          }
        }
      }
      if (!portFound) {
        clearTimeout(timer)
        portReject!(new Error('HTTP server stderr closed without port announcement'))
      }
    } catch (err) {
      if (!portFound) {
        clearTimeout(timer)
        portReject!(err instanceof Error ? err : new Error(String(err)))
      }
    }
  })()

  const port = await portPromise

  const interactiveProc: InteractiveProcess = {
    write(text: string) { proc.stdin.write(text) },
    async readAvailable(): Promise<string> {
      await new Promise(r => setTimeout(r, 200))
      return stdoutBufs.splice(0).map(b => decoder.decode(b)).join('')
    },
    kill() { proc.kill() },
    exited: (async () => {
      const exitCode = await proc.exited
      return { stdout: stdoutBufs.map(b => decoder.decode(b)).join(''), stderr: '', exitCode }
    })(),
  }

  return { proc: interactiveProc, port }
}
