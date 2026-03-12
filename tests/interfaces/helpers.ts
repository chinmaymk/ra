import { ToolRegistry } from '../../src/agent/tool-registry'
import { SessionStorage } from '../../src/storage/sessions'
import type { IProvider } from '../../src/providers/types'

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

export async function makeStorage(dir: string): Promise<SessionStorage> {
  const storage = new SessionStorage(dir)
  await storage.init()
  return storage
}
