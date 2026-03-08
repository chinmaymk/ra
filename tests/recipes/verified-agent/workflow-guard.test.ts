import { test, expect, beforeEach } from "bun:test"
import workflowGuard, { setWorkflow, getCompleted, reset } from "../../../recipes/verified-agent/middleware/workflow-guard"
import type { ToolExecutionContext } from "../../../src/agent/types"
import type { IMessage } from "../../../src/providers/types"

function makeCtx(toolName: string, messages: IMessage[] = []): ToolExecutionContext {
  let stopped = false
  return {
    toolCall: { id: "tc_1", name: toolName, arguments: "{}" },
    loop: {
      messages,
      iteration: 0,
      maxIterations: 10,
      sessionId: "test-session",
      usage: { inputTokens: 0, outputTokens: 0 },
      lastUsage: undefined,
      stop: () => { stopped = true },
      signal: new AbortController().signal,
    },
    stop: () => { stopped = true },
    signal: new AbortController().signal,
    get _stopped() { return stopped },
  } as ToolExecutionContext & { _stopped: boolean }
}

beforeEach(() => {
  reset()
})

test("allows tools not in workflow", async () => {
  setWorkflow([
    { id: "find", tool: "glob" },
    { id: "read", tool: "read", requires: ["find"] },
  ])

  const ctx = makeCtx("execute-bash")
  await workflowGuard(ctx)

  // Should not stop — tool not in workflow
  expect((ctx as any)._stopped).toBe(false)
  expect(ctx.loop.messages).toHaveLength(0)
})

test("allows tools with no prerequisites", async () => {
  setWorkflow([
    { id: "find", tool: "glob" },
    { id: "read", tool: "read", requires: ["find"] },
  ])

  const ctx = makeCtx("glob")
  await workflowGuard(ctx)

  expect((ctx as any)._stopped).toBe(false)
  expect(getCompleted().has("find")).toBe(true)
})

test("blocks tools with unmet prerequisites", async () => {
  setWorkflow([
    { id: "find", tool: "glob" },
    { id: "read", tool: "read", requires: ["find"] },
  ])

  const messages: IMessage[] = []
  const ctx = makeCtx("read", messages)
  await workflowGuard(ctx)

  expect((ctx as any)._stopped).toBe(true)
  expect(messages.length).toBe(1)
  expect(messages[0]!.content).toContain("workflow-guard")
  expect(messages[0]!.content).toContain("glob")
})

test("allows tools after prerequisites are met", async () => {
  setWorkflow([
    { id: "find", tool: "glob" },
    { id: "read", tool: "read", requires: ["find"] },
  ])

  // Complete "find" step
  const ctx1 = makeCtx("glob")
  await workflowGuard(ctx1)
  expect(getCompleted().has("find")).toBe(true)

  // Now "read" should be allowed
  const ctx2 = makeCtx("read")
  await workflowGuard(ctx2)
  expect((ctx2 as any)._stopped).toBe(false)
  expect(getCompleted().has("read")).toBe(true)
})

test("no-op when no workflow is set", async () => {
  const ctx = makeCtx("glob")
  await workflowGuard(ctx)
  expect((ctx as any)._stopped).toBe(false)
})

test("multi-step dependency chain", async () => {
  setWorkflow([
    { id: "find", tool: "glob" },
    { id: "read", tool: "read", requires: ["find"] },
    { id: "write", tool: "write", requires: ["find", "read"] },
  ])

  // Write blocked — needs find and read
  const ctx1 = makeCtx("write", [])
  await workflowGuard(ctx1)
  expect((ctx1 as any)._stopped).toBe(true)

  // Do find
  await workflowGuard(makeCtx("glob"))

  // Write still blocked — needs read
  const ctx2 = makeCtx("write", [])
  await workflowGuard(ctx2)
  expect((ctx2 as any)._stopped).toBe(true)

  // Do read
  await workflowGuard(makeCtx("read"))

  // Now write is allowed
  const ctx3 = makeCtx("write")
  await workflowGuard(ctx3)
  expect((ctx3 as any)._stopped).toBe(false)
  expect(getCompleted().has("write")).toBe(true)
})
