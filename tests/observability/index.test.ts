import { describe, it, expect } from 'bun:test'
import { createObservability, type ObservabilityConfig } from '../../src/observability'
import { NoopLogger } from '../../src/observability/logger'
import { NoopTracer } from '../../src/observability/tracer'

const defaultConfig: ObservabilityConfig = {
  enabled: true,
  logs: { level: 'info', output: 'stderr' },
  traces: { output: 'stderr' },
}

describe('createObservability', () => {
  it('returns noop instances when disabled', () => {
    const { logger, tracer } = createObservability({ ...defaultConfig, enabled: false })
    expect(logger).toBeInstanceOf(NoopLogger)
    expect(tracer).toBeInstanceOf(NoopTracer)
  })

  it('returns real instances when enabled', () => {
    const { logger, tracer } = createObservability(defaultConfig)
    expect(logger).not.toBeInstanceOf(NoopLogger)
    expect(tracer).not.toBeInstanceOf(NoopTracer)
  })

  it('sets sessionId on the logger when provided', () => {
    const { logger } = createObservability({
      ...defaultConfig,
      logs: { level: 'error', output: 'stderr' },
    }, 'test-session')
    const captured: string[] = []
    const orig = process.stderr.write
    process.stderr.write = ((data: string) => { captured.push(data); return true }) as typeof process.stderr.write
    try {
      logger.error('test')
      const entry = JSON.parse(captured[0]!.trim())
      expect(entry.sessionId).toBe('test-session')
    } finally {
      process.stderr.write = orig
    }
  })

  it('supports separate log and trace file outputs', () => {
    const { logger, tracer } = createObservability({
      enabled: true,
      logs: { level: 'debug', output: 'stderr' },
      traces: { output: 'stderr' },
    })
    expect(logger).not.toBeInstanceOf(NoopLogger)
    expect(tracer).not.toBeInstanceOf(NoopTracer)
  })
})
