# auto-improve

Parallel self-improvement loop that explores all of ra's degrees of freedom simultaneously. Point it at any benchmark and it spawns parallel agents — each tuning a different axis (prompts, model, thinking, tools, compaction, code, skills, middleware) — then combines winners and iterates.

## How it works

```
                          ┌─── Agent: system prompt ──── benchmark ──→ score
                          │
Orchestrator ─── analyze  ├─── Agent: thinking mode ──── benchmark ──→ score
failures ─┐               │
          │               ├─── Agent: tool config ────── benchmark ──→ score
          │               │
          └── spawn ──────└─── Agent: target code ────── benchmark ──→ score
                                      │
                              collect results
                                      │
                              combine winners ──── benchmark ──→ combined score
                                      │
                              commit + iterate
```

1. **Understand** — read benchmark, target config, codebase, and baseline results
2. **Diagnose** — analyze failures to know which axes matter most
3. **Explore in parallel** — spawn agents via the Agent tool, each tuning one axis
4. **Combine** — apply winners, verify combined score, commit
5. **Iterate** — re-diagnose, explore new axes, repeat

## Degrees of freedom

| Axis | What's tuned | Examples |
|------|-------------|----------|
| System prompt | Instructions, examples, structure | Add few-shot examples, clarify output format |
| Model & provider | Model selection | sonnet vs opus, GPT-4o |
| Thinking mode | Extended thinking | off/low/medium/high/adaptive, budget cap |
| Tool config | Enable/disable, descriptions, schemas | Improve Grep description, disable unused tools |
| Compaction | Threshold, prompt | Adjust when context compacts, what to preserve |
| Resources | Iterations, timeouts, token budget | More iterations, longer tool timeout |
| Skills | Skill content and descriptions | Add checklist skill, improve activation triggers |
| Middleware | Custom hooks | Add validation hook, context injection |
| Target code | Tool/middleware implementations | Fix edge cases, improve error messages |

## Setup

### 1. Create bench.yaml

```yaml
# What to benchmark
run: python eval.py --config $CONFIG
score:
  pattern: "accuracy:\\s*([\\d.]+)"
  direction: higher
results:
  file: results.json

# What can be tuned
config: ./agent-under-test.config.yaml
code:
  - src/tools/
  - src/middleware/
prompt: ./system-prompt.md
skills:
  - ./skills/
validate: bun tsc && bun test
```

### 2. Run

```bash
ra --config path/to/recipes/auto-improve/ra.config.yaml
```

The orchestrator reads your bench.yaml, runs a baseline, analyzes failures, and enters the parallel improvement loop.

### 3. Continuous improvement with cron

For long-running campaigns, add cron scheduling to run the loop on a timer:

```yaml
app:
  interface: cron

cron:
  - name: "auto-improve"
    schedule: "0 */2 * * *"    # Every 2 hours
    prompt: "Read /auto-improve and continue from where we left off."
    agent: path/to/recipes/auto-improve/ra.config.yaml
```

Each cron run reads `journal.jsonl`, picks up where the last run left off, and does another round of parallel exploration.

## bench.yaml reference

```yaml
# Required
run: <benchmark command>           # Use $CONFIG for the config path
score:
  pattern: <regex>                 # One capture group for the number
  direction: higher | lower

# Optional
results:
  file: <path>                     # Per-case results for failure analysis
config: <path>                     # Ra config to optimize
code:                              # Source code to modify
  - <path or glob>
prompt: <path>                     # System prompt file
skills:                            # Skill directories
  - <path>
validate: <command>                # Pre-benchmark validation
```

## Output

All progress is logged to `journal.jsonl` — one JSON line per outer-loop iteration:

```json
{
  "iteration": 3,
  "score": 78.2,
  "best": 76.5,
  "delta": "+1.7",
  "axes_explored": ["prompt", "tools", "thinking"],
  "proposals": [
    {"axis": "prompt", "score": 77.8, "applied": true, "description": "Added output format examples"},
    {"axis": "tools", "score": 78.2, "applied": true, "description": "Improved Grep description"},
    {"axis": "thinking", "score": 76.1, "applied": false, "description": "Tried adaptive thinking"}
  ],
  "combined_score": 78.2,
  "remaining_failures": 35
}
```

## Configuration

| Setting | Value | Why |
|---------|-------|-----|
| `model` | `claude-sonnet-4-6` | Good balance of speed and capability for orchestration |
| `thinking` | `high` | Orchestrator needs deep reasoning for failure analysis |
| `maxIterations` | `500` | Supports long autonomous campaigns |
| `toolTimeout` | `600000` | 10 min for benchmark runs |
| `Agent.maxConcurrency` | `4` | Up to 4 parallel exploration agents |
| `Agent.maxDepth` | `2` | Agents can spawn sub-agents if needed |
| `compaction` | enabled | Essential for long-running sessions |
