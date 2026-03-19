import { describe, it, expect, afterEach } from 'bun:test'
import { createObservability, type ObservabilityConfig } from '../../src/observability'
import { NoopLogger } from '@chinmaymk/ra'
import { NoopTracer } from '../../src/observability/tracer'
import { tmpdir } from '../tmpdir'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'path'

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
    }, { sessionId: 'test-session' })
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

  it('session output writes logs and traces to session directory', async () => {
    const TEST_DIR = tmpdir('ra-test-obs-session')
    await mkdir(TEST_DIR, { recursive: true })

    try {
      const { logger, tracer } = createObservability({
        enabled: true,
        logs: { level: 'info', output: 'session' },
        traces: { output: 'session' },
      }, { sessionId: 'sess-1', sessionDir: TEST_DIR })

      logger.info('hello from logger')
      const span = tracer.startSpan('test.op')
      tracer.endSpan(span)
      await logger.flush()
      await tracer.flush()

      const logs = await Bun.file(join(TEST_DIR, 'logs.jsonl')).text()
      expect(JSON.parse(logs.trim()).message).toBe('hello from logger')

      const traces = await Bun.file(join(TEST_DIR, 'traces.jsonl')).text()
      expect(JSON.parse(traces.trim()).name).toBe('test.op')
    } finally {
      await rm(TEST_DIR, { recursive: true, force: true })
    }
  })
})
