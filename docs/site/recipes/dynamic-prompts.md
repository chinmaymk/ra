# Dynamic Prompts

Use `beforeModelCall` middleware to inject context, conditionally modify instructions, react to conversation state, and filter tools — all without any new config concepts.

## Runtime context injection

Inject dynamic data into the conversation before each model call. Useful for providing current project state, timestamps, or external data.

```ts
// middleware/inject-context.ts
export default async (ctx) => {
  const gitBranch = await Bun.$`git branch --show-current`.text()
  const todos = await Bun.$`grep -r "TODO" src/ --count`.text().catch(() => 'none')

  ctx.request.messages.push({
    role: 'system',
    content: [
      `Current time: ${new Date().toISOString()}`,
      `Git branch: ${gitBranch.trim()}`,
      `Open TODOs: ${todos.trim()}`,
    ].join('\n'),
  })
}
```

```yaml
# ra.config.yml
middleware:
  beforeModelCall:
    - "./middleware/inject-context.ts"
```

This runs before every model call, so the agent always sees fresh context.

## Conditional prompt sections

Add or remove instructions based on what tools are available, how far into the conversation you are, or any other condition.

```ts
// middleware/conditional-instructions.ts
export default async (ctx) => {
  const hasWriteTools = ctx.request.tools?.some(t => t.name.startsWith('write_'))
  const isFirstCall = ctx.loop.iteration === 0

  const sections: string[] = []

  if (hasWriteTools) {
    sections.push('You have write access. Always create a backup before modifying files.')
  }

  if (isFirstCall) {
    sections.push('Start by understanding the request fully before taking action.')
  }

  if (sections.length > 0) {
    ctx.request.messages.push({
      role: 'system',
      content: sections.join('\n\n'),
    })
  }
}
```

```yaml
middleware:
  beforeModelCall:
    - "./middleware/conditional-instructions.ts"
```

## Reactive prompt adaptation

Modify behavior based on what's happened in the conversation — tool failures, long-running loops, repeated patterns.

```ts
// middleware/adaptive.ts
export default async (ctx) => {
  const messages = ctx.loop.messages
  const instructions: string[] = []

  // Detect recent tool errors
  const recentTools = messages.filter(m => m.role === 'tool').slice(-3)
  const hasRecentError = recentTools.some(m =>
    typeof m.content === 'string' && m.content.includes('error')
  )

  if (hasRecentError) {
    instructions.push(
      'A recent tool call failed. Review the error message carefully before retrying. ' +
      'Consider a different approach if the same tool has failed multiple times.'
    )
  }

  // Encourage wrapping up after many iterations
  if (ctx.loop.iteration > 8) {
    instructions.push(
      'You have been iterating for a while. Consider summarizing your progress ' +
      'and presenting what you have so far.'
    )
  }

  if (instructions.length > 0) {
    ctx.request.messages.push({
      role: 'system',
      content: instructions.join('\n\n'),
    })
  }
}
```

```yaml
middleware:
  beforeModelCall:
    - "./middleware/adaptive.ts"
```

## Dynamic tool filtering

Control which tools the model can use based on conversation context. Useful for progressive disclosure, safety guardrails, or role-based access.

```ts
// middleware/filter-tools.ts
export default async (ctx) => {
  if (!ctx.request.tools) return

  // Remove destructive tools in the first iteration (let the agent plan first)
  if (ctx.loop.iteration === 0) {
    ctx.request.tools = ctx.request.tools.filter(
      t => !['delete_file', 'execute_command'].includes(t.name)
    )
    return
  }

  // After 3 failed tool calls, restrict to read-only tools
  const toolMessages = ctx.loop.messages.filter(m => m.role === 'tool')
  const recentErrors = toolMessages.slice(-3).filter(m =>
    typeof m.content === 'string' && m.content.includes('error')
  )

  if (recentErrors.length >= 3) {
    ctx.request.tools = ctx.request.tools.filter(
      t => t.name.startsWith('read_') || t.name.startsWith('search_')
    )
    ctx.request.messages.push({
      role: 'system',
      content: 'Multiple tool calls have failed. Restricted to read-only tools. ' +
               'Analyze the situation before attempting writes again.',
    })
  }
}
```

```yaml
middleware:
  beforeModelCall:
    - "./middleware/filter-tools.ts"
```

## Composing multiple dynamic prompts

Middleware runs in array order, so you can layer concerns:

```yaml
middleware:
  beforeModelCall:
    - "./middleware/inject-context.ts"
    - "./middleware/conditional-instructions.ts"
    - "./middleware/adaptive.ts"
    - "./middleware/filter-tools.ts"
```

Each middleware independently reads and modifies the request. Keep each focused on one concern.
