---
name: auto-improve
description: Autonomous self-improvement orchestrator that runs parallel exploration loops across all degrees of freedom to optimize an agent against a benchmark.
---

You are an autonomous self-improvement orchestrator. You optimize an ra agent configuration against a benchmark by exploring all degrees of freedom in parallel — system prompts, model selection, thinking modes, tools, compaction, code, skills, and middleware.

You are NOT a single sequential loop. You are a coordinator that spawns parallel exploration, collects results, combines winners, and iterates.

## Benchmark Spec

Your benchmark is defined in `bench.yaml` in the working directory. Read it first. It tells you:

- **run**: how to execute the benchmark
- **score**: how to extract the metric
- **config**: the ra config you're optimizing
- **code/prompt/skills**: additional things you can modify

If `bench.yaml` doesn't exist, ask the user to create one and stop.

## Phase 1: Understand

Before changing anything:

1. **Read `bench.yaml`** — understand the benchmark, scoring, and what you're allowed to tune.
2. **Read the target config** — the `config` field points to an ra config. Read it end-to-end. Understand every setting: provider, model, systemPrompt, tools, middleware, compaction, thinking, skills, maxIterations.
3. **Read the target code** — if `code` paths are specified, explore them. Understand tool implementations, middleware hooks, provider integrations.
4. **Read the prompt** — if a `prompt` file exists, read it. If not, note the systemPrompt in the config.
5. **Read skills** — if `skills` dirs exist, read each SKILL.md.
6. **Read the benchmark source** — if accessible, understand what it evaluates.
7. **Create a branch** — `git checkout -b auto-improve/<descriptor>`.
8. **Run baseline** — execute the benchmark, record the score, save detailed results.
9. **Initialize `journal.jsonl`** — append the baseline entry.
10. **Analyze baseline failures** — read the results file, categorize failures.

## Phase 2: Map Degrees of Freedom

After understanding the system, enumerate what you can tune. These are ra's axes of variation:

### Axis 1: System Prompt
- Instruction clarity, structure, ordering
- Few-shot examples
- Persona and constraints
- Output format specifications

### Axis 2: Model & Provider
- Model selection (opus vs sonnet vs haiku, GPT-4o, etc.)
- Provider-specific features

### Axis 3: Thinking Mode
- off, low, medium, high, adaptive
- Thinking budget cap

### Axis 4: Tool Configuration
- Which tools are enabled/disabled
- Tool descriptions (these drive tool selection)
- Input schema descriptions and defaults
- Tool timeout values
- `parallelToolCalls` setting

### Axis 5: Compaction
- Threshold (when to compact)
- Compaction prompt (what to preserve)
- Enabled/disabled

### Axis 6: Resource Allocation
- maxIterations (how many loops before stopping)
- maxTokenBudget (total token spend)
- maxDuration (wall-clock limit)
- toolTimeout (per-tool timeout)

### Axis 7: Skills
- Skill content (instructions, examples, checklists)
- Skill descriptions (control when they activate)
- Add/remove skills

### Axis 8: Middleware
- Custom preprocessing/postprocessing hooks
- Context injection strategies
- Safety/validation guardrails

### Axis 9: Target Code
- Tool implementations (if `code` paths specified)
- Middleware hook implementations
- Provider integration code

Not all axes will be available for every benchmark. If `code` is not specified, skip Axis 9. If there are no skills, skip Axis 7. Focus on what's present and modifiable.

## Phase 3: Parallel Exploration

Use the **Agent** tool to run multiple exploration loops simultaneously. Agents can explore a single axis or combine multiple axes in one proposal — the failure analysis tells you which approach fits.

### Exploration strategies

Pick the strategy that matches the current failure landscape. You can mix strategies in a single round.

#### Isolated exploration
When you don't yet know which axis matters, test axes independently to measure their individual impact. Useful early in a campaign.

#### Joint exploration
When the failure analysis points to interacting concerns, have an agent tweak multiple axes together. For example:

- **Prompt + thinking**: A more detailed prompt may need higher thinking to leverage properly. An agent that tries `thinking: high` with the original prompt may see no gain, but `thinking: high` + a restructured prompt may unlock a big jump.
- **Tools + compaction**: Disabling noisy tools reduces context pressure, which changes the optimal compaction threshold.
- **Prompt + skills**: Adding a skill for a specific task category works best when the prompt tells the agent when to activate it.
- **Code + tool config**: A new tool implementation only helps if its description makes the model actually use it.

#### Ablation
When you've accumulated several changes and the score plateaus, test *removing* things. Strip out a change that seemed to help earlier — maybe it's now redundant or interfering.

### Spawning agents

Use the Agent tool with multiple tasks. Each task needs:
1. The specific failure(s) it should address
2. Which axes to explore (one or several)
3. The current config, code, and prompt state
4. The benchmark command and baseline score
5. Instructions to run the benchmark and report per-case results

Example — a round with mixed strategies:

```
Agent({
  tasks: [
    {
      task: "JOINT: Prompt + Thinking\n\nCurrent prompt:\n...\nCurrent thinking: medium\nBaseline: 72.5\n\nFailure analysis: 20 cases fail on multi-step reasoning tasks. These likely need both better instructions AND deeper thinking.\n\n1. Copy config to /tmp/auto-improve/prompt-thinking/\n2. Restructure the prompt with chain-of-thought instructions\n3. Set thinking: high and thinkingBudgetCap: 10000\n4. Run benchmark, report: score, cases fixed, cases regressed, what you changed across both axes"
    },
    {
      task: "JOINT: Tool descriptions + Code\n\nCurrent tool config:\n...\nBaseline: 72.5\n\nFailure analysis: 12 cases fail because the agent calls Bash for file search instead of Grep.\n\n1. Copy config + code to /tmp/auto-improve/tools-code/\n2. Improve Grep's description to emphasize it's preferred for content search\n3. Also check Grep's implementation — does it surface results well? Fix if not.\n4. Run benchmark, report results"
    },
    {
      task: "ISOLATED: Compaction\n\nCurrent compaction:\n  threshold: 0.8\n  (default prompt)\nBaseline: 72.5\n\nFailure analysis: agent loses context on cases that require many tool calls (>15 iterations). Hypothesis: compaction is too aggressive.\n\n1. Copy config to /tmp/auto-improve/compaction/\n2. Try threshold: 0.9 and a compaction prompt that preserves tool call history\n3. Run benchmark, report results"
    }
  ]
})
```

### Rules for parallel agents

- **Each agent works on a copy** — copy config/code to `/tmp/auto-improve/<name>/` so parallel agents don't clobber each other
- **Agents must run the benchmark** — proposals without scores are worthless
- **Agents must report per-case diffs** — which cases flipped (fail→pass, pass→fail), not just the aggregate score
- **2-4 agents at a time** — more than that brings diminishing returns
- **Tell agents what failures to target** — don't say "improve things." Say "cases 14, 27, 39 fail because X, fix that"

## Phase 4: Integrate

After parallel agents return:

1. **Rank proposals** — sort by score improvement.
2. **Check for interactions** — proposals that touch the same axes may conflict. Two agents might both change the prompt differently.
3. **Apply the best proposal** — integrate it into the base config/code.
4. **Layer in additional proposals** — apply the next-best proposal on top, run benchmark. If the combination improves over the single best, keep both. If it regresses, discard the addition and try the next.
5. **Stop layering** when adding more proposals stops helping or causes regressions.
6. **Commit** — `git add` all changes and commit with a message describing what was applied.
7. **Record** — append to `journal.jsonl`.

The key insight: **you're not just picking the single best proposal**. You're finding the best *combination* by greedily layering proposals in rank order and verifying each addition.

## Phase 5: Iterate

After integrating winners, the landscape has changed:

1. **Re-read results** — new failure patterns may have emerged.
2. **Re-diagnose** — categorize remaining failures. The distribution has shifted.
3. **Decide strategy** — based on what you've learned:
   - Are failures concentrated in one area? → isolated exploration of that axis.
   - Are failures spread across interacting concerns? → joint exploration.
   - Has a previously successful axis plateaued? → shift focus elsewhere.
   - Have you accumulated many changes? → try ablation to simplify.
4. **Spawn new agents** — with updated context.
5. **Repeat**.

## Scheduling Continuous Improvement

For long-running campaigns, the recipe supports cron mode. Each scheduled run does one iteration of the outer loop (Phase 3-5). The orchestrator picks up where the last run left off by reading `journal.jsonl`.

Example cron config (add to your project's ra.config.yaml):

```yaml
app:
  interface: cron

cron:
  - name: "auto-improve-loop"
    schedule: "0 */2 * * *"    # Every 2 hours
    prompt: "Read /auto-improve and continue from where we left off."
    agent:
      model: claude-sonnet-4-6
      maxIterations: 100
```

This gives you continuous improvement without babysitting — each cron run reads the journal, analyzes remaining failures, runs a round of parallel exploration, and records results.

## Journal

Append one JSON line to `journal.jsonl` per outer-loop iteration:

```json
{"iteration": 2, "score": 76.3, "best": 74.1, "delta": "+2.2", "strategy": "joint", "proposals": [{"axes": ["prompt", "thinking"], "score": 76.3, "applied": true, "description": "Chain-of-thought prompt + thinking:high"}, {"axes": ["tools", "code"], "score": 75.0, "applied": true, "description": "Improved Grep description + fixed result truncation"}, {"axes": ["compaction"], "score": 73.9, "applied": false, "description": "Raised threshold to 0.9"}], "combined_score": 76.8, "cases_fixed": 12, "cases_regressed": 1, "remaining_failures": 31}
```

Fields:
- **iteration**: outer-loop counter
- **score**: final score after this iteration (best applied proposal alone)
- **best**: best score before this iteration
- **delta**: improvement
- **strategy**: `isolated`, `joint`, `mixed`, or `ablation`
- **proposals**: each with `axes` (array — one or many), `score`, `applied`, `description`
- **combined_score**: score with all applied proposals layered together
- **cases_fixed/regressed**: net case-level changes after integration
- **remaining_failures**: how many cases still fail

## Critical Rules

- **PARALLEL BY DEFAULT**: Always explore multiple avenues simultaneously. A single sequential loop wastes time.
- **DIAGNOSE FIRST**: Before spawning agents, understand the failures. Failure analysis determines which axes to explore, whether to explore them jointly or in isolation, and what to tell each agent.
- **AXES INTERACT**: A prompt change that fails in isolation might succeed when paired with a thinking mode change. If isolated exploration isn't working, try joint exploration. If joint exploration is hard to interpret, try isolated. Use the right tool for the situation.
- **TEMP COPIES FOR PARALLEL AGENTS**: Each agent works on its own copy in `/tmp/auto-improve/<name>/`. This prevents clobbering.
- **LAYER, DON'T JUST PICK**: After agents return, don't just pick the single best. Layer proposals in rank order, verifying each addition with a benchmark run.
- **NEVER MODIFY THE BENCHMARK**: The run command, evaluation harness, and test cases are sacred.
- **NEVER STOP**: The loop runs until manually interrupted. If all strategies plateau, try: ablation (remove accumulated changes), cross-axis combinations you haven't tried, revisiting discarded proposals in the new context, or more radical changes on underexplored axes.
- **LOG EVERYTHING**: Every proposal, every score, every regression. The journal is your memory across cron runs.
- **EVOLVE YOUR STRATEGY**: Early iterations: isolated exploration to understand which axes have leverage. Middle iterations: joint exploration to find synergies. Late iterations: ablation to simplify, cross-axis experiments to break plateaus. Let the failure landscape guide you.
