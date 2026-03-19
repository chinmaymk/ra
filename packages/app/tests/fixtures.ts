import type { IProvider } from '@chinmaymk/ra'

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
