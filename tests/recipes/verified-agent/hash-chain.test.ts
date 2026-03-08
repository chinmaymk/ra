import { test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { afterModelResponse, afterToolExecution, verify, resetChain } from "../../../recipes/verified-agent/middleware/hash-chain"
import type { ModelCallContext, ToolResultContext } from "../../../src/agent/types"

const TEST_SESSION = "test-hashchain-" + Date.now()
const sessionDir = join(".ra", "sessions", TEST_SESSION)

function makeLoopContext(messages: { role: string; content: string }[] = []) {
  return {
    messages: messages as any[],
    iteration: 0,
    maxIterations: 10,
    sessionId: TEST_SESSION,
    usage: { inputTokens: 0, outputTokens: 0 },
    lastUsage: undefined,
    stop: () => {},
    signal: new AbortController().signal,
  }
}

beforeEach(async () => {
  resetChain()
  await Bun.$`rm -rf ${sessionDir}`.quiet()
})

afterEach(async () => {
  await Bun.$`rm -rf ${sessionDir}`.quiet()
})

test("afterModelResponse creates a hash chain entry", async () => {
  const loop = makeLoopContext([{ role: "assistant", content: "hello world" }])
  const ctx: ModelCallContext = {
    request: { model: "test", messages: loop.messages },
    loop,
    stop: loop.stop,
    signal: loop.signal,
  }

  await afterModelResponse(ctx)

  const file = Bun.file(join(sessionDir, "hashchain.jsonl"))
  expect(await file.exists()).toBe(true)

  const text = await file.text()
  const entry = JSON.parse(text.trim())
  expect(entry.role).toBe("assistant")
  expect(entry.seq).toBeGreaterThanOrEqual(0)
  expect(entry.hash).toHaveLength(64)
  expect(entry.prevHash).toHaveLength(64)
  expect(entry.contentHash).toHaveLength(64)
})

test("afterToolExecution creates a hash chain entry with tool metadata", async () => {
  const loop = makeLoopContext()
  const ctx: ToolResultContext = {
    toolCall: { id: "tc_1", name: "read", arguments: '{"path":"foo.ts"}' },
    result: { toolCallId: "tc_1", content: "file contents here" },
    loop,
    stop: loop.stop,
    signal: loop.signal,
  }

  await afterToolExecution(ctx)

  const file = Bun.file(join(sessionDir, "hashchain.jsonl"))
  const text = await file.text()
  const entry = JSON.parse(text.trim().split("\n").pop()!)
  expect(entry.role).toBe("tool")
  expect(entry.toolName).toBe("read")
  expect(entry.toolCallId).toBe("tc_1")
})

test("verify returns valid for untampered chain", async () => {
  // Write a few entries
  const loop = makeLoopContext([{ role: "assistant", content: "first" }])
  const ctx1: ModelCallContext = {
    request: { model: "test", messages: loop.messages },
    loop,
    stop: loop.stop,
    signal: loop.signal,
  }
  await afterModelResponse(ctx1)

  const ctx2: ToolResultContext = {
    toolCall: { id: "tc_1", name: "read", arguments: "{}" },
    result: { toolCallId: "tc_1", content: "data" },
    loop,
    stop: loop.stop,
    signal: loop.signal,
  }
  await afterToolExecution(ctx2)

  const result = await verify(TEST_SESSION)
  expect(result.valid).toBe(true)
  expect(result.entries).toBe(2)
})

test("verify detects tampering", async () => {
  const loop = makeLoopContext([{ role: "assistant", content: "legit" }])
  const ctx: ModelCallContext = {
    request: { model: "test", messages: loop.messages },
    loop,
    stop: loop.stop,
    signal: loop.signal,
  }
  await afterModelResponse(ctx)

  const ctx2: ToolResultContext = {
    toolCall: { id: "tc_1", name: "read", arguments: "{}" },
    result: { toolCallId: "tc_1", content: "real data" },
    loop,
    stop: loop.stop,
    signal: loop.signal,
  }
  await afterToolExecution(ctx2)

  // Tamper with the file — change the first entry's contentHash
  const filePath = join(sessionDir, "hashchain.jsonl")
  const text = await Bun.file(filePath).text()
  const lines = text.trim().split("\n")
  const entry = JSON.parse(lines[0]!)
  entry.contentHash = "deadbeef".repeat(8)
  lines[0] = JSON.stringify(entry)
  await Bun.write(filePath, lines.join("\n") + "\n")

  const result = await verify(TEST_SESSION)
  expect(result.valid).toBe(false)
  expect(result.brokenAt).toBe(0)
})

test("verify returns valid with no chain file", async () => {
  const result = await verify("nonexistent-session-id")
  expect(result.valid).toBe(true)
  expect(result.entries).toBe(0)
})
