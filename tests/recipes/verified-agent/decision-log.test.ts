import { test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import {
  beforeModelCall,
  afterModelResponse,
  beforeToolExecution,
  afterToolExecution,
  afterLoopIteration,
  afterLoopComplete,
  onError,
} from "../../../recipes/verified-agent/middleware/decision-log"
import type {
  ModelCallContext,
  ToolExecutionContext,
  ToolResultContext,
  LoopContext,
  ErrorContext,
} from "../../../src/agent/types"

const TEST_SESSION = "test-decisions-" + Date.now()
const sessionDir = join(".ra", "sessions", TEST_SESSION)

function makeLoop(messages: any[] = []): LoopContext {
  return {
    messages,
    iteration: 1,
    maxIterations: 10,
    sessionId: TEST_SESSION,
    usage: { inputTokens: 100, outputTokens: 50 },
    lastUsage: { inputTokens: 100, outputTokens: 50 },
    stop: () => {},
    signal: new AbortController().signal,
  }
}

async function readDecisions(): Promise<any[]> {
  const file = Bun.file(join(sessionDir, "decisions.jsonl"))
  if (!(await file.exists())) return []
  const text = await file.text()
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
}

beforeEach(async () => {
  await Bun.$`rm -rf ${sessionDir}`.quiet()
})

afterEach(async () => {
  await Bun.$`rm -rf ${sessionDir}`.quiet()
})

test("beforeModelCall logs calling_model event", async () => {
  const loop = makeLoop()
  const ctx: ModelCallContext = {
    request: {
      model: "claude-sonnet-4-6",
      messages: [{ role: "user" as const, content: "hello" }],
      tools: [{ name: "read", description: "read a file", inputSchema: {}, execute: async () => "" }],
    },
    loop,
    stop: loop.stop,
    signal: loop.signal,
  }

  await beforeModelCall(ctx)

  const records = await readDecisions()
  expect(records).toHaveLength(1)
  expect(records[0].event).toBe("calling_model")
  expect(records[0].detail.model).toBe("claude-sonnet-4-6")
  expect(records[0].detail.availableTools).toEqual(["read"])
})

test("afterModelResponse logs model_responded event", async () => {
  const loop = makeLoop([{ role: "assistant", content: "I'll help you with that." }])
  const ctx: ModelCallContext = {
    request: { model: "test", messages: loop.messages },
    loop,
    stop: loop.stop,
    signal: loop.signal,
  }

  await afterModelResponse(ctx)

  const records = await readDecisions()
  expect(records).toHaveLength(1)
  expect(records[0].event).toBe("model_responded")
  expect(records[0].detail.responsePreview).toContain("I'll help you")
})

test("tool execution lifecycle logs both start and complete", async () => {
  const loop = makeLoop()

  const toolCtx: ToolExecutionContext = {
    toolCall: { id: "tc_1", name: "read", arguments: '{"path":"src/main.ts"}' },
    loop,
    stop: loop.stop,
    signal: loop.signal,
  }
  await beforeToolExecution(toolCtx)

  const resultCtx: ToolResultContext = {
    toolCall: { id: "tc_1", name: "read", arguments: '{"path":"src/main.ts"}' },
    result: { toolCallId: "tc_1", content: "file contents" },
    loop,
    stop: loop.stop,
    signal: loop.signal,
  }
  await afterToolExecution(resultCtx)

  const records = await readDecisions()
  expect(records).toHaveLength(2)
  expect(records[0].event).toBe("tool_starting")
  expect(records[0].detail.tool).toBe("read")
  expect(records[1].event).toBe("tool_completed")
  expect(records[1].detail.isError).toBe(false)
})

test("afterLoopIteration logs iteration_complete", async () => {
  const loop = makeLoop()
  await afterLoopIteration(loop)

  const records = await readDecisions()
  expect(records).toHaveLength(1)
  expect(records[0].event).toBe("iteration_complete")
  expect(records[0].detail.iteration).toBe(1)
})

test("afterLoopComplete logs loop_complete", async () => {
  const loop = makeLoop()
  await afterLoopComplete(loop)

  const records = await readDecisions()
  expect(records).toHaveLength(1)
  expect(records[0].event).toBe("loop_complete")
})

test("onError logs error_occurred", async () => {
  const loop = makeLoop()
  const ctx: ErrorContext = {
    error: new Error("something broke"),
    loop,
    phase: "tool_execution",
    stop: loop.stop,
    signal: loop.signal,
  }

  await onError(ctx)

  const records = await readDecisions()
  expect(records).toHaveLength(1)
  expect(records[0].event).toBe("error_occurred")
  expect(records[0].detail.phase).toBe("tool_execution")
  expect(records[0].detail.message).toBe("something broke")
})

test("long content is truncated in logs", async () => {
  const longContent = "x".repeat(2000)
  const loop = makeLoop([{ role: "assistant", content: longContent }])
  const ctx: ModelCallContext = {
    request: { model: "test", messages: loop.messages },
    loop,
    stop: loop.stop,
    signal: loop.signal,
  }

  await afterModelResponse(ctx)

  const records = await readDecisions()
  expect(records[0].detail.responsePreview.length).toBeLessThan(600)
  expect(records[0].detail.responsePreview).toContain("truncated")
})
