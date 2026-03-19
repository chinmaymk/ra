import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ensureBinary } from './binary'
import { startMockLLMServer, type MockLLMServer } from './mock-llm-server'
import type { BinaryEnv } from './binary'

export interface TestEnv {
  mock: MockLLMServer
  storageDir: string
  binaryEnv: BinaryEnv
  cleanup(): Promise<void>
}

/** Create a test environment with mock LLM server and temp storage */
export async function createTestEnv(provider: 'anthropic' | 'openai' | 'google' = 'anthropic'): Promise<TestEnv> {
  await ensureBinary()
  const mock = await startMockLLMServer()
  const storageDir = join(tmpdir(), `ra-int-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(storageDir, { recursive: true })

  const binaryEnv: BinaryEnv = {
    provider,
    apiKey: 'test-key',
    anthropicBaseURL: mock.anthropicBaseURL,
    openaiBaseURL: mock.openaiBaseURL,
    googleBaseURL: mock.googleBaseURL,
    storageDir,
  }

  return {
    mock,
    storageDir,
    binaryEnv,
    async cleanup() {
      await mock.stop()
      rmSync(storageDir, { recursive: true, force: true })
    },
  }
}
