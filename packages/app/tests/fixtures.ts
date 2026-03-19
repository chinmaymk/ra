import type { IProvider, StreamChunk } from '@chinmaymk/ra'
import { SessionStorage } from '../src/storage/sessions'
import { tmpdir } from './tmpdir'

/** Simple mock provider that streams a single text response. */
export function mockProvider(text: string): IProvider {
  return {
    name: 'mock',
    chat: async () => { throw new Error() },
    async *stream() {
      yield { type: 'text', delta: text }
      yield { type: 'done' }
    },
  }
}

/** Mock provider that emits thinking then text. */
export function mockProviderWithThinking(thinkingDelta: string, textDelta: string): IProvider {
  return {
    name: 'mock',
    chat: async () => { throw new Error() },
    async *stream() {
      yield { type: 'thinking', delta: thinkingDelta }
      yield { type: 'text', delta: textDelta }
      yield { type: 'done' }
    },
  }
}

/** Mock provider that yields predetermined response sequences (multi-turn). */
export function mockSequenceProvider(responses: StreamChunk[][]): IProvider {
  let callIndex = 0
  return {
    name: 'mock',
    chat: async () => { throw new Error('use stream') },
    async *stream() {
      const chunks = responses[callIndex++] ?? [{ type: 'text' as const, delta: 'done' }, { type: 'done' as const }]
      for (const chunk of chunks) yield chunk
    },
  }
}

/** Create a SessionStorage instance in a temp directory. */
export async function makeStorage(name: string): Promise<SessionStorage> {
  const storage = new SessionStorage(tmpdir(name))
  await storage.init()
  return storage
}

/**
 * Capture stdout writes during a synchronous function call.
 * Returns the captured output string.
 */
export function captureStdout(fn: () => void): string {
  const chunks: string[] = []
  const origWrite = process.stdout.write.bind(process.stdout)
  process.stdout.write = (chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
    return true
  }
  try {
    fn()
  } finally {
    process.stdout.write = origWrite
  }
  return chunks.join('')
}

/**
 * Capture stderr writes. Returns { captured, restore }.
 * Call restore() in afterEach to reset stderr.
 */
export function captureStderr(): { captured: string[]; restore: () => void } {
  const captured: string[] = []
  const originalWrite = process.stderr.write
  process.stderr.write = ((data: string) => {
    captured.push(data)
    return true
  }) as typeof process.stderr.write
  return { captured, restore: () => { process.stderr.write = originalWrite } }
}
