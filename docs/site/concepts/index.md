# What is ra?

**ra is an agent runtime that gets out of your way.** No hidden system prompts. No tools you can't disable. No middleware step you can't intercept. Every decision the agent makes flows through hooks you control and lives in a config file you commit alongside your code.

Most agent frameworks make a deal with you: trade control for convenience. ra refuses the trade. The whole loop — model call, tool dispatch, streaming chunks, errors — is reachable, inspectable, and replaceable.

```bash
ra "What is the capital of France?"
ra --provider openai --model gpt-4.1 "Explain this error"
git diff | ra "Review this diff for security issues"
cat server.log | ra "Find the root cause of these errors"
ra   # interactive REPL
```

## The config is the agent

Most agent frameworks ship with opinions. ra ships blank.

No default system prompt. No default tools. No assumptions about what your agent should do or how it should think. The binary is a runtime waiting for instructions — and `ra.config.yml` is where the instructions live.

That file isn't *configuration*. It's the agent itself. Model, tools, prompt, permissions, middleware, memory, skills — all of it. Change a line and you have a different agent. Drop the file into a new repo and you have a different agent there too.

```yaml
# ra.config.yml
agent:
  provider: anthropic
  model: claude-sonnet-4-6
  thinking: adaptive
  skillDirs: [./skills]
  middleware:
    - ./middleware/audit-log.ts
permissions:
  rules:
    - tool: Bash
      command:
        deny: ["--force", "--no-verify"]
```

Same binary, three repos, three completely different agents:

- `~/work/api` — cautious senior engineer, reads before writing, can't run `--force`
- `~/work/blog` — terse release-notes generator, no shell, no internet
- `~/work/oncall` — log triager that reads `*.log`, posts findings to Slack, then stops

Pull the repo, run `ra`, get the exact agent the team agreed on. No global state. No dotfiles to copy. Nothing baked into your shell history. The agent lives in git, like everything else that matters.

## What's in the box

ra is small at the core and wide at the edges. Here's the whole surface:

**The loop**
- [Agent loop](/core/agent-loop) — model → tools → repeat, with streaming, configurable iteration limits, and middleware hooks at every step
- [Context control](/core/context-control) — smart compaction, token tracking, prompt caching, extended thinking, and deterministic discovery for `CLAUDE.md` / `AGENTS.md` / `README.md`
- [Sessions](/core/sessions) — JSONL persistence, resume from any interface, auto-prune
- [Memory](/configuration/#agent-memory) — SQLite + FTS5, save and search across conversations

**Models, your choice**
Talk to Anthropic, OpenAI, Google, Ollama, Bedrock, Azure, OpenRouter, or LiteLLM. Bring your own API key, or use your existing [Anthropic](https://console.anthropic.com/) or [OpenAI / Codex](https://platform.openai.com/) subscription. Switch with `--provider`.

**Extension points**
- [Built-in tools](/tools/) for filesystem, shell, network, and user interaction
- [Custom tools](/tools/custom) — TypeScript, shell, or any scripting language
- [Skills](/skills/) — reusable instruction bundles, pulled from GitHub repos or npm packages
- [Middleware](/middleware/) — intercept, modify, or stop the loop at every stage
- [MCP](/modes/mcp) both ways — pull tools from external servers, or expose ra itself as one

**Interfaces**
Same agent, different shape: [CLI](/modes/cli), [REPL](/modes/repl), [HTTP server](/modes/http), [MCP server](/modes/mcp), and [scheduled cron jobs](/modes/cron). Zero runtime dependencies.

**Observability you can actually read**
Structured JSONL logs and trace spans per session. The built-in [Inspector](/modes/inspector) renders the full picture — iterations, token spend, tool calls, complete message history — in your browser.

**Configuration that layers cleanly**
[Layered config](/configuration/): CLI flags > env vars > config file > defaults. YAML, JSON, or TOML. No magic, no hidden defaults.

## In practice

### Triage a flaky test

```bash
cat test-output.log | ra "Why is this test failing? Find the root cause."
```

Reads the logs, explains the root cause, and exits. Pipe the output to Slack or a PR comment.

### Design a feature with context

```bash
ra
› /attach src/auth.ts
› How should I add rate limiting to this endpoint?
```

Attach files, ask follow-ups, keep context. Resume the session tomorrow with `/resume`.

### Research a topic end-to-end

```bash
ra "Survey the current state of WebTransport support across browsers and CDNs. \
    Write a summary with a recommendation to research.md"
```

Fetches pages, reads specs, compares options, and writes a structured report you can share with your team.

### Slice a dataset

```bash
ra --file survey-results.csv "Find the three strongest correlations, \
    flag any obvious outliers, and write a one-page summary"
```

Reads the file, runs shell commands to slice the data, and delivers findings in plain language.

### Generate release notes

```bash
ra "Write a changelog for v3.0 based on commits since the v2.9 tag. \
    Group by feature, fix, and breaking change."
```

Walks git history, categorizes commits, and produces a polished changelog — works for migration guides or any structured writing grounded in your repo.

### Add AI to your product

```bash
ra --http --http-port 3000
```

POST a message, get SSE chunks back. No framework — just `Bun.serve()` under the hood.

### Give your editor a specialist

```bash
ra --mcp-stdio --config recipes/code-review-agent
```

Now Cursor or Claude Desktop has a dedicated code reviewer that uses your project's style guide, your skills, your system prompt.
