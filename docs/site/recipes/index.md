# Recipes

Common patterns and pre-built agent configurations.

## Pre-built recipes

ra ships with ready-to-use agent configurations in the `recipes/` directory.

### Coding Agent

A general-purpose coding agent with file editing, shell execution, codebase navigation, extended thinking, and smart context compaction. Uses 200 max iterations and high thinking budget.

```bash
ra --config recipes/coding-agent/ra.config.yaml
```

### Code Review Agent

Reviews diffs for correctness, style, and performance. Connects to GitHub via MCP, includes a diff-gathering script and style guide, and enforces a token budget via middleware.

```bash
ra --config recipes/code-review-agent/ra.config.yaml --file diff.patch "Review this"
```

## Common patterns

### Project-specific agent

Drop a `ra.config.yml` in your repo:

```yaml
provider: anthropic
model: claude-sonnet-4-6
systemPrompt: |
  You are an expert on this codebase. You know TypeScript, Bun, and the project structure.
  When asked to make changes, write the code directly — don't describe what to do.
skillDirs:
  - .ra/skills
```

Now `ra` in that directory becomes a project-aware agent.

### CI code reviewer

```yaml
# .github/workflows/review.yml
- name: Review PR
  run: git diff origin/main | ra --skill code-review "Review this PR diff"
```

### Pipe and chain

```bash
# Summarize a log file
cat server.log | ra "Summarize errors in the last 100 lines"

# Review a diff
git diff | ra --skill code-review "Review this diff"

# Chain: extract → summarize
ra "List all TODO comments" | ra "Group by priority and format as a table"
```

### Rate limit fallback

```bash
# Primary provider fails? Flip and keep going
RA_PROVIDER=openai ra "Continue where we left off"
```

### MCP tool in Claude Desktop

```json
{
  "mcpServers": {
    "project-agent": {
      "command": "ra",
      "args": ["--mcp-stdio"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

### Middleware for audit logging

```ts
// middleware/audit.ts
export default async (ctx) => {
  const entry = {
    ts: new Date().toISOString(),
    messages: ctx.messages.length,
  }
  await Bun.file('audit.log').writer().write(JSON.stringify(entry) + '\n')
}
```

```yaml
# ra.config.yml
middleware:
  afterLoopComplete:
    - "./middleware/audit.ts"
```

### Scripting with --exec

Use `--exec` to run a TypeScript or JavaScript file that imports ra's internals programmatically:

```bash
ra --exec ./scripts/batch-review.ts
```
