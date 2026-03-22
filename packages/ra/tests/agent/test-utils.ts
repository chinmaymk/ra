import type { IProvider, StreamChunk, ChatRequest, ChatResponse, ModelCallContext } from '@chinmaymk/ra'
import { NoopLogger } from '@chinmaymk/ra'

/**
 * Creates a mock provider that yields predetermined response sequences.
 * Each inner array represents one iteration's stream response.
 */
export function mockProvider(responses: StreamChunk[][]): IProvider {
  let callIndex = 0
  return {
    name: 'mock',
    chat: async () => { throw new Error('use stream') },
    async *stream() {
      const chunks = responses[callIndex++] ?? [{ type: 'text', delta: 'done' }, { type: 'done' }]
      for (const chunk of chunks) yield chunk
    },
  }
}

/** Helper that waits but resolves early if the signal fires. */
export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
  })
}

/** Provider that delays mid-stream, useful for testing abort/timeout. */
export function slowProvider(delayMs: number): IProvider {
  return {
    name: 'mock',
    chat: async () => { throw new Error('use stream') },
    async *stream(req: ChatRequest) {
      yield { type: 'text', delta: 'start ' }
      await abortableDelay(delayMs, req.signal)
      if (req.signal?.aborted) return
      yield { type: 'text', delta: 'end' }
      yield { type: 'done' }
    },
  }
}

/** Creates a ModelCallContext suitable for compaction tests. */
export function makeModelCallCtx(messages: import('@chinmaymk/ra').IMessage[], overrides?: Partial<ModelCallContext>): ModelCallContext {
  const logger = new NoopLogger()
  const controller = new AbortController()
  const request: ChatRequest = { model: 'test', messages: [...messages], tools: [] }
  const drain = () => {}
  return {
    stop: () => controller.abort(),
    drain,
    signal: controller.signal,
    logger,
    request,
    loop: {
      stop: () => controller.abort(),
      drain,
      signal: controller.signal,
      logger,
      messages,
      iteration: 1,
      maxIterations: 10,
      sessionId: 'test',
      usage: { inputTokens: 0, outputTokens: 0 },
      lastUsage: undefined,
      resumed: false,
      elapsedMs: 0,
    },
    ...overrides,
  }
}
