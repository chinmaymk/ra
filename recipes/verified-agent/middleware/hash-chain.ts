import type { ToolResultContext, ModelCallContext, LoopContext } from "@chinmaymk/ra"
import { appendFile } from "node:fs/promises"
import { join } from "path"

/**
 * Hash-chain middleware — creates a tamper-evident log of all messages.
 *
 * Every assistant response and tool result gets a SHA-256 hash that chains
 * to the previous entry. If any entry is modified after the fact, the chain
 * breaks and verify() will catch it.
 *
 * Output: .ra/sessions/<id>/hashchain.jsonl
 */

interface HashEntry {
  seq: number
  prevHash: string
  role: string
  contentHash: string
  hash: string
  timestamp: string
  toolCallId?: string
  toolName?: string
}

const GENESIS_HASH = "0".repeat(64)

let seq = 0
let prevHash = GENESIS_HASH

export function resetChain(): void {
  seq = 0
  prevHash = GENESIS_HASH
}

function contentToString(content: string | unknown[]): string {
  if (typeof content === "string") return content
  return JSON.stringify(content)
}

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

async function appendEntry(sessionId: string, entry: HashEntry): Promise<void> {
  const dir = join(".ra", "sessions", sessionId)
  await Bun.$`mkdir -p ${dir}`.quiet()
  const line = JSON.stringify(entry) + "\n"
  await appendFile(join(dir, "hashchain.jsonl"), line)
}

export async function afterModelResponse(ctx: ModelCallContext): Promise<void> {
  const msgs = ctx.loop.messages
  const last = msgs[msgs.length - 1]
  if (!last || last.role !== "assistant") return

  const raw = contentToString(last.content)
  const toolCalls = last.toolCalls ? JSON.stringify(last.toolCalls) : ""
  const contentHash = await sha256(raw + toolCalls)
  const hash = await sha256(prevHash + contentHash)

  const entry: HashEntry = {
    seq: seq++,
    prevHash,
    role: "assistant",
    contentHash,
    hash,
    timestamp: new Date().toISOString(),
  }

  prevHash = hash
  await appendEntry(ctx.loop.sessionId, entry)
}

export async function afterToolExecution(ctx: ToolResultContext): Promise<void> {
  const raw = contentToString(ctx.result.content)
  const contentHash = await sha256(raw)
  const hash = await sha256(prevHash + contentHash)

  const entry: HashEntry = {
    seq: seq++,
    prevHash,
    role: "tool",
    contentHash,
    hash,
    timestamp: new Date().toISOString(),
    toolCallId: ctx.toolCall.id,
    toolName: ctx.toolCall.name,
  }

  prevHash = hash
  await appendEntry(ctx.loop.sessionId, entry)
}

/**
 * Standalone verify function — validates the full hash chain from a session's hashchain.jsonl.
 * Can be called from a script or test.
 */
export async function verify(sessionId: string): Promise<{ valid: boolean; entries: number; brokenAt?: number }> {
  const file = Bun.file(join(".ra", "sessions", sessionId, "hashchain.jsonl"))
  if (!(await file.exists())) return { valid: true, entries: 0 }

  const text = await file.text()
  const lines = text.split("\n").filter((l) => l.trim().length > 0)
  let prev = GENESIS_HASH

  for (let i = 0; i < lines.length; i++) {
    const entry: HashEntry = JSON.parse(lines[i]!)
    if (entry.prevHash !== prev) {
      return { valid: false, entries: lines.length, brokenAt: i }
    }
    const recomputed = await sha256(prev + entry.contentHash)
    if (recomputed !== entry.hash) {
      return { valid: false, entries: lines.length, brokenAt: i }
    }
    prev = entry.hash
  }

  return { valid: true, entries: lines.length }
}
