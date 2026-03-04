import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { logger, setLogLevel, setJsonMode } from '../../src/utils/logger'

describe('logger', () => {
  let output: string[]
  let originalWrite: typeof process.stderr.write

  beforeEach(() => {
    output = []
    originalWrite = process.stderr.write
    process.stderr.write = ((chunk: string) => {
      output.push(chunk)
      return true
    }) as typeof process.stderr.write
    setLogLevel('debug')
    setJsonMode(false)
  })

  afterEach(() => {
    process.stderr.write = originalWrite
  })

  it('logs at info level', () => {
    logger.info('test message')
    expect(output.length).toBe(1)
    expect(output[0]).toContain('INFO')
    expect(output[0]).toContain('test message')
  })

  it('filters below current level', () => {
    setLogLevel('warn')
    logger.debug('should not appear')
    logger.info('should not appear')
    expect(output.length).toBe(0)
    logger.warn('should appear')
    expect(output.length).toBe(1)
  })

  it('outputs JSON in json mode', () => {
    setJsonMode(true)
    logger.info('json test', { key: 'value' })
    const parsed = JSON.parse(output[0]!)
    expect(parsed.level).toBe('info')
    expect(parsed.msg).toBe('json test')
    expect(parsed.key).toBe('value')
    expect(parsed.timestamp).toBeDefined()
  })

  it('creates child loggers with base fields', () => {
    setJsonMode(true)
    const child = logger.child({ component: 'http', requestId: '123' })
    child.info('child message')
    const parsed = JSON.parse(output[0]!)
    expect(parsed.component).toBe('http')
    expect(parsed.requestId).toBe('123')
    expect(parsed.msg).toBe('child message')
  })
})
