# auto-improve

Parallel self-improvement loop that explores all of ra's degrees of freedom. Point it at any benchmark and it spawns parallel agents — each tuning one or more axes (prompts, model, thinking, tools, compaction, code, skills, middleware) — then layers winners and iterates.

Axes interact: a prompt change that fails alone might succeed paired with a thinking mode change. The orchestrator decides when to explore axes in isolation, when to combine them, and when to ablate accumulated changes.

## How it works

```
                          ┌── Agent: prompt + thinking ── benchmark ──→ score
                          │         (temp copy)
Orchestrator ── diagnose  ├── Agent: tools + code ─────── benchmark ──→ score
failures ─┐               │         (temp copy)
          │               └── Agent: compaction ────────── benchmark ──→ score
          │                           │       (temp copy)
          │                 rank proposals
          │                           │
          │   ┌───────── hot-reload: edit real files directly ──────────┐
          └── │ write best ── benchmark ──→ ✓                          │
              │ add next ──── benchmark ──→ still better? keep : revert│
              │ add next ──── benchmark ──→ ...                        │
              └── commit ──────────────────────────────────────────────┘
```

1. **Understand** — read benchmark, target config, codebase, and baseline results
2. **Diagnose** — replay failing cases, cluster by root cause, decide which axes to explore jointly or in isolation
3. **Explore in parallel** — spawn agents, each tuning one or more axes; smoke-test with subset first
4. **Layer** — apply proposals in rank order, verifying each addition with a benchmark run
5. **Checkpoint** — update `best/` directory and git tag on every new best score
6. **Iterate** — re-diagnose, evolve strategy, consult anti-patterns, repeat

## Key features

### Hot-reload integration
Changes to config, system prompt, middleware, and custom tool files take effect immediately — no restart needed. The integration phase writes changes directly to the real files, benchmarks against them, and iterates. Parallel exploration agents still use temp copies, but sequential layering is instant.

### Parallel multi-axis exploration
Up to 4 agents explore different axes simultaneously via the Agent tool. Agents can explore axes in isolation, jointly, or test ablations.

### Variance-aware scoring
For noisy benchmarks, set `runs: N` to run the benchmark multiple times. The orchestrator computes mean ± stddev and only trusts improvements that exceed 2x the standard deviation.

### Fast feedback with subset
Define `run_subset` in bench.yaml for a cheap smoke test (~10% of cases). Agents test proposals on the subset first and only commit to a full run for promising changes.

### Single-case replay
Before proposing changes, the orchestrator replays specific failing cases with verbose output to diagnose exactly where the agent-under-test goes wrong. Ground truth, not guesswork.

### Checkpointing
`best/` directory always contains the canonical best config, code, prompt, and skills. Git tags mark each improvement. Campaign can resume from any crash or cron restart.

### Anti-pattern memory
`anti-patterns.md` persists failed hypotheses across context compaction and cron runs. The orchestrator reads it before every round to avoid repeating mistakes.

### Working state
`state.md` is the orchestrator's scratchpad — current failure landscape, axis ROI, next priority. Overwritten each round so it's always current. Injected at loop start so the agent has its latest analysis even after compaction.

### Axis ROI tracking
The orchestrator tracks how many times each axis has been explored and the cumulative gain. Saturated axes are deprioritized. Untried axes are high-value exploration targets.

### Auto-save
`afterLoopIteration` middleware writes `progress.json` after every iteration — if the process crashes, the next run knows where things left off.

### Structured agent reports
Subagents are told to return results as JSON blocks with score, case diffs, unified diffs, and descriptions. This makes integration reliable and journal entries reproducible.

### Cron scheduling
Run the loop on a timer for continuous improvement:

```yaml
app:
  interface: cron
cron:
  - name: "auto-improve"
    schedule: "0 */2 * * *"
    prompt: "Read /auto-improve and continue from where we left off."
    agent: path/to/recipes/auto-improve/ra.config.yaml
```

## Setup

### 1. Create bench.yaml

```yaml
run: python eval.py --config $CONFIG
run_subset: python eval.py --config $CONFIG --subset 20
score:
  pattern: "accuracy:\\s*([\\d.]+)"
  direction: higher
results:
  file: results.json
runs: 3
target_score: 90.0
config: ./agent-under-test.config.yaml
code:
  - src/tools/
prompt: ./system-prompt.md
validate: bun tsc && bun test
```

### 2. Run

```bash
ra --config path/to/recipes/auto-improve/ra.config.yaml
```

## bench.yaml reference

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `run` | Yes | — | Full benchmark command. `$CONFIG` = config path |
| `run_subset` | No | — | Fast subset command for smoke-testing |
| `score.pattern` | Yes | — | Regex with one capture group for the number |
| `score.direction` | Yes | — | `higher` or `lower` |
| `results.file` | No | — | Per-case results file for failure analysis |
| `runs` | No | `1` | Runs per evaluation (for variance estimation) |
| `target_score` | No | — | Stop when reached |
| `config` | No | — | Ra config to optimize |
| `code` | No | — | Source code directories to modify |
| `prompt` | No | — | System prompt file |
| `skills` | No | — | Skill directories |
| `validate` | No | — | Pre-benchmark validation command |

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

## Output files

| File | Purpose |
|------|---------|
| `journal.jsonl` | One JSON line per iteration: score, proposals, diffs, case-level impact |
| `anti-patterns.md` | Failed hypotheses and why they didn't work (survives compaction) |
| `state.md` | Current failure landscape, axis ROI, next priority (overwritten each round) |
| `best/` | Canonical best config/code/prompt/skills (always restorable) |
| `progress.json` | Last iteration number, timestamp, token usage (auto-saved) |
| `bench.log` | Latest benchmark stdout/stderr |

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
