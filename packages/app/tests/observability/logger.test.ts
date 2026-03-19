import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Logger } from '../../src/observability/logger'
import { NoopLogger, type LogEntry } from '@chinmaymk/ra'
import { captureStdout, captureStderr } from '../fixtures'

describe('Logger', () => {
  let captured: string[]
  let restore: () => void

  beforeEach(() => {
    ({ captured, restore } = captureStderr())
  })

  afterEach(() => {
    restore()
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
    restore() // restore stderr first
    const output = captureStdout(() => {
      const logger = new Logger({ level: 'info', output: 'stdout' })
      logger.info('stdout test')
    })
    const entry = JSON.parse(output.trim()) as LogEntry
    expect(entry.message).toBe('stdout test')
  })
})

describe('NoopLogger', () => {
  it('silently discards all messages', () => {
    const stderr = captureStderr()
    try {
      const logger = new NoopLogger()
      logger.debug('d')
      logger.info('i')
      logger.warn('w')
      logger.error('e')
      expect(stderr.captured).toHaveLength(0)
    } finally {
      stderr.restore()
    }
  })
})
