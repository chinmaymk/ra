/**
 * Disambiguation test — checks whether a model correctly chooses
 * session-scoped vs persistent tools when both are available.
 *
 * Run:  ANTHROPIC_API_KEY=sk-... bun run tests/session-memory/disambiguation-test.ts
 *
 * Compares two naming schemes:
 *   A) session_memory_write / session_memory_delete   (current)
 *   B) scratchpad_write / scratchpad_delete            (proposed)
 *
 * Uses the Anthropic SDK directly to avoid ra bootstrapping overhead.
 */
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

// ── Tool definitions ──────────────────────────────────────────────────

const persistentTools: Anthropic.Tool[] = [
  {
    name: 'memory_save',
    description:
      'Save a fact to persistent memory for future conversations. ' +
      'Proactively save when you learn: user preferences (tools, style, conventions), ' +
      'project decisions (tech stack, architecture), corrections ("actually we use X not Y"), ' +
      'or key context (team, deployment, constraints). ' +
      'To update an existing memory, use memory_forget to remove the old version first, then save the new one.',
    input_schema: {
      type: 'object' as const,
      properties: {
        content: { type: 'string', description: 'Self-contained fact to remember' },
        tags: { type: 'string', description: 'Category tag: preference, project, convention, team, or tooling' },
      },
      required: ['content'],
    },
  },
  {
    name: 'memory_search',
    description:
      'Search persistent memories by keyword. ' +
      'Recent memories are automatically recalled at conversation start — ' +
      'use this for targeted lookups when you need specific context not in the recalled set.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Full-text search keywords' },
        limit: { type: 'number', description: 'Max results (default: 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_forget',
    description:
      'Delete memories matching a search query. Use when the user corrects previous information, ' +
      'a fact becomes outdated, or before saving an updated version.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search keywords to match memories to delete' },
      },
      required: ['query'],
    },
  },
]

const sessionToolsA: Anthropic.Tool[] = [
  {
    name: 'session_memory_write',
    description:
      'Store a key-value pair in session memory — a scratchpad that lasts for the entire conversation. ' +
      'Entries written here are guaranteed to remain visible to you in every turn, even as older messages ' +
      'are summarized. Use for task checklists, plans, intermediate results, key facts. ' +
      'Session memory is NOT persisted across sessions — for long-term memory use memory_save instead.',
    input_schema: {
      type: 'object' as const,
      properties: {
        key: { type: 'string', description: 'Short descriptive identifier' },
        value: { type: 'string', description: 'The content to store' },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'session_memory_delete',
    description: 'Remove an entry from session memory by key.',
    input_schema: {
      type: 'object' as const,
      properties: {
        key: { type: 'string', description: 'The key to remove' },
      },
      required: ['key'],
    },
  },
]

const sessionToolsB: Anthropic.Tool[] = [
  {
    name: 'scratchpad_write',
    description:
      'Store a key-value pair in the scratchpad — a temporary notepad that lasts for this conversation only. ' +
      'Entries are guaranteed to remain visible to you in every turn, even as older messages are summarized. ' +
      'Use for task checklists, plans, intermediate results, key facts. ' +
      'The scratchpad is NOT persisted across sessions — for long-term memory use memory_save instead.',
    input_schema: {
      type: 'object' as const,
      properties: {
        key: { type: 'string', description: 'Short descriptive identifier' },
        value: { type: 'string', description: 'The content to store' },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'scratchpad_delete',
    description: 'Remove an entry from the scratchpad by key.',
    input_schema: {
      type: 'object' as const,
      properties: {
        key: { type: 'string', description: 'The key to remove' },
      },
      required: ['key'],
    },
  },
]

// ── Test cases ────────────────────────────────────────────────────────

interface TestCase {
  prompt: string
  expectSession: boolean
}

const testCases: TestCase[] = [
  {
    prompt: 'Keep track of a checklist for this conversation: "- [ ] step 1\\n- [ ] step 2\\n- [ ] step 3"',
    expectSession: true,
  },
  {
    prompt: 'Remember that I always prefer tabs over spaces. Save this preference so you know it in future conversations.',
    expectSession: false,
  },
  {
    prompt: 'Write down the current plan so you don\'t forget it if context gets compacted: "1. Fix the bug 2. Write tests 3. Deploy"',
    expectSession: true,
  },
  {
    prompt: 'Our project uses PostgreSQL 16 and runs on Kubernetes. Remember this for next time.',
    expectSession: false,
  },
]

// ── Runner ────────────────────────────────────────────────────────────

async function runSingle(
  tools: Anthropic.Tool[],
  prompt: string,
): Promise<string[]> {
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: 'You are a helpful assistant. You have access to both persistent memory (survives across conversations) and a session scratchpad (only this conversation). Choose the right tool for each task. Do NOT explain your reasoning — just use the correct tool.',
    tools,
    messages: [{ role: 'user', content: prompt }],
  })

  return response.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    .map(b => b.name)
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Disambiguation Test: session_memory_* vs scratchpad_* ===')
  console.log('Model: claude-haiku-4-5-20251001\n')

  const sessionNames: Record<string, string[]> = {
    A: ['session_memory_write', 'session_memory_delete'],
    B: ['scratchpad_write', 'scratchpad_delete'],
  }

  for (const [variant, label] of [['A', 'session_memory_*'], ['B', 'scratchpad_*']] as const) {
    const sessionTools = variant === 'A' ? sessionToolsA : sessionToolsB
    const allTools = [...persistentTools, ...sessionTools]

    console.log(`\n--- Variant ${variant}: ${label} ---\n`)

    let correct = 0
    for (const tc of testCases) {
      const toolsUsed = await runSingle(allTools, tc.prompt)
      const usedSession = toolsUsed.some(t => sessionNames[variant]!.includes(t))
      const usedPersistent = toolsUsed.some(t => ['memory_save', 'memory_search', 'memory_forget'].includes(t))

      const isCorrect = tc.expectSession
        ? usedSession && !usedPersistent
        : usedPersistent && !usedSession

      const expected = tc.expectSession ? 'session' : 'persistent'
      const status = isCorrect ? 'PASS' : 'FAIL'
      console.log(`  [${status}] Expected: ${expected.padEnd(10)} | Used: ${toolsUsed.join(', ').padEnd(30)} | "${tc.prompt.slice(0, 55)}..."`)
      if (isCorrect) correct++
    }
    console.log(`\n  Score: ${correct}/${testCases.length}`)
  }
}

main().catch(console.error)
