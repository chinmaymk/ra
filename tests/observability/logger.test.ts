import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Logger, NoopLogger, type LogEntry } from '../../src/observability/logger'
import { tmpdir } from '../tmpdir'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'path'

describe('Logger', () => {
  let captured: string[]
  let originalWrite: typeof process.stderr.write

  beforeEach(() => {
    captured = []
    originalWrite = process.stderr.write
    process.stderr.write = ((data: string) => {
      captured.push(data)
      return true
    }) as typeof process.stderr.write
  })

  afterEach(() => {
    process.stderr.write = originalWrite
  })

  it('outputs JSON log lines to stderr by default', () => {
    const logger = new Logger({ level: 'info', output: 'stderr' })
    logger.info('test message', { key: 'value' })
    expect(captured).toHaveLength(1)
    const entry = JSON.parse(captured[0]!.trim()) as LogEntry
    expect(entry.level).toBe('info')
    expect(entry.message).toBe('test message')
    expect(entry.key).toBe('value')
    expect(entry.timestamp).toBeDefined()
  })

  it('includes sessionId when set', () => {
    const logger = new Logger({ level: 'info', output: 'stderr', sessionId: 'sess-1' })
    logger.info('hello')
    const entry = JSON.parse(captured[0]!.trim()) as LogEntry
    expect(entry.sessionId).toBe('sess-1')
  })

  it('can update sessionId via setSessionId', () => {
    const logger = new Logger({ level: 'info', output: 'stderr' })
    logger.setSessionId('new-sess')
    logger.info('hello')
    const entry = JSON.parse(captured[0]!.trim()) as LogEntry
    expect(entry.sessionId).toBe('new-sess')
  })

  it('filters below configured level', () => {
    const logger = new Logger({ level: 'warn', output: 'stderr' })
    logger.debug('debug msg')
    logger.info('info msg')
    logger.warn('warn msg')
    logger.error('error msg')
    expect(captured).toHaveLength(2)
    const levels = captured.map(c => (JSON.parse(c.trim()) as LogEntry).level)
    expect(levels).toEqual(['warn', 'error'])
  })

  it('outputs all levels at debug', () => {
    const logger = new Logger({ level: 'debug', output: 'stderr' })
    logger.debug('d')
    logger.info('i')
    logger.warn('w')
    logger.error('e')
    expect(captured).toHaveLength(4)
  })

  it('can write to stdout', () => {
    process.stderr.write = originalWrite // restore stderr
    const stdoutCaptured: string[] = []
    const origStdout = process.stdout.write
    process.stdout.write = ((data: string) => {
      stdoutCaptured.push(data)
      return true
    }) as typeof process.stdout.write

    try {
      const logger = new Logger({ level: 'info', output: 'stdout' })
      logger.info('stdout test')
      expect(stdoutCaptured).toHaveLength(1)
      const entry = JSON.parse(stdoutCaptured[0]!.trim()) as LogEntry
      expect(entry.message).toBe('stdout test')
    } finally {
      process.stdout.write = origStdout
    }
  })
})

describe('Logger session output', () => {
  const TEST_DIR = tmpdir('ra-test-logger-session')

  afterEach(async () => { await rm(TEST_DIR, { recursive: true, force: true }) })

  it('buffers lines until setSessionDir is called', async () => {
    const logger = new Logger({ level: 'info', output: 'session' })
    logger.info('before session dir')
    logger.warn('also before')

    // No file yet, lines are buffered
    await mkdir(TEST_DIR, { recursive: true })
    logger.setSessionDir(TEST_DIR)

    // Lines should now be flushed to file
    logger.info('after session dir')
    await logger.flush()

    const content = await Bun.file(join(TEST_DIR, 'logs.jsonl')).text()
    const lines = content.trim().split('\n')
    expect(lines).toHaveLength(3)
    expect(JSON.parse(lines[0]!).message).toBe('before session dir')
    expect(JSON.parse(lines[1]!).message).toBe('also before')
    expect(JSON.parse(lines[2]!).message).toBe('after session dir')
  })

  it('does not write to stderr or stdout in session mode', () => {
    const stderrCaptured: string[] = []
    const stdoutCaptured: string[] = []
    const origStderr = process.stderr.write
    const origStdout = process.stdout.write
    process.stderr.write = ((data: string) => { stderrCaptured.push(data); return true }) as typeof process.stderr.write
    process.stdout.write = ((data: string) => { stdoutCaptured.push(data); return true }) as typeof process.stdout.write

    try {
      const logger = new Logger({ level: 'info', output: 'session' })
      logger.info('silent message')
      expect(stderrCaptured).toHaveLength(0)
      expect(stdoutCaptured).toHaveLength(0)
    } finally {
      process.stderr.write = origStderr
      process.stdout.write = origStdout
    }
  })

  it('setSessionDir is a no-op for non-session output', async () => {
    const captured: string[] = []
    const origStderr = process.stderr.write
    process.stderr.write = ((data: string) => { captured.push(data); return true }) as typeof process.stderr.write

    try {
      const logger = new Logger({ level: 'info', output: 'stderr' })
      await mkdir(TEST_DIR, { recursive: true })
      logger.setSessionDir(TEST_DIR)
      logger.info('still goes to stderr')
      expect(captured).toHaveLength(1)
      expect(JSON.parse(captured[0]!.trim()).message).toBe('still goes to stderr')
    } finally {
      process.stderr.write = origStderr
    }
  })
})

describe('NoopLogger', () => {
  it('silently discards all messages', () => {
    const captured: string[] = []
    const originalWrite = process.stderr.write
    process.stderr.write = ((data: string) => {
      captured.push(data)
      return true
    }) as typeof process.stderr.write

    try {
      const logger = new NoopLogger()
      logger.debug('d')
      logger.info('i')
      logger.warn('w')
      logger.error('e')
      expect(captured).toHaveLength(0)
    } finally {
      process.stderr.write = originalWrite
    }
  })
})
