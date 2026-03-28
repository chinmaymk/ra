# Reproducing Karpathy's Autoresearch with ra

<p style="color: #888; margin-top: -0.5em;">March 28, 2026</p>

Andrej Karpathy's [autoresearch](https://github.com/karpathy/autoresearch) is a simple, powerful idea: give an AI agent a small but real LLM training setup and let it experiment autonomously overnight. The agent modifies code, trains for 5 minutes, checks if the result improved, keeps or discards, and repeats. One GPU, one file, one metric.

We reproduced the exact same experiment using ra. The entire agent is a 30-line YAML config and a single skill file — no custom code, no framework glue. This post walks through how we set it up, what ra features make it work, and what happened when we let it run.

## The experiment

The setup is deliberately minimal:

- **One editable file** — `train.py` contains a GPT model (~5.5M params), Muon+AdamW optimizer, and training loop
- **One read-only file** — `prepare.py` handles data loading, tokenization, and evaluation
- **One metric** — `val_bpb` (validation bits per byte). Lower is better
- **One constraint** — each experiment gets exactly 5 minutes of wall-clock training time

The agent runs an infinite loop: hypothesize, modify `train.py`, commit, train, evaluate, keep or discard. Over an 8-hour run you get roughly 100 experiments — a real research campaign.

## Setting up ra

If you don't have ra installed yet:

```bash
# install ra
bun install -g ra-app

# or run directly
bunx ra-app
```

Clone the autoresearch repo and prepare the data:

```bash
git clone https://github.com/karpathy/autoresearch
cd autoresearch
uv sync
uv run prepare.py
```

This downloads the training data and trains a BPE tokenizer. You need an NVIDIA GPU — the experiment was designed for H100 but works on other cards.

## The ra recipe

The entire agent configuration lives in two files. Here's the config:

```yaml
# ra.config.yaml
agent:
  provider: anthropic
  model: claude-sonnet-4-6
  systemPrompt: Read /autoresearch and begin.
  permissions:
    no_rules_rules: true
  maxIterations: 500
  toolTimeout: 900000
  tools:
    builtin: true
    overrides:
      Agent:
        enabled: false
      WebFetch:
        enabled: false
  compaction:
    enabled: true
    threshold: 0.8
```

Let's break down why each setting matters.

### Model choice

We use `claude-sonnet-4-6`. The agent needs to be good at code modification and reasoning about ML experiments, but it doesn't need to be the most powerful model available — it needs to be fast enough to not bottleneck the 5-minute experiment cycle. Sonnet hits the sweet spot.

### Unrestricted shell access

```yaml
permissions:
  no_rules_rules: true
```

The agent needs to run `uv run train.py`, read logs, and execute `git` commands freely. In a normal coding agent you'd want permission guards, but here the agent is operating in an isolated experiment environment on a single repo. We give it full access.

### 500 iterations, 15-minute tool timeout

```yaml
maxIterations: 500
toolTimeout: 900000
```

Each experiment involves multiple tool calls (edit file, commit, run training, read results), so 500 iterations supports well over 100 experiments. The 15-minute tool timeout accommodates the 5-minute training runs plus compilation and startup overhead. If a training run hangs, the timeout kills it rather than blocking the agent forever.

### Disabled tools

```yaml
tools:
  overrides:
    Agent:
      enabled: false
    WebFetch:
      enabled: false
```

We disable `WebFetch` and `Agent` (subagent spawning). The agent should stay focused on the experiment loop — no browsing the web for ideas, no spawning child agents. Everything it needs is in the repo.

### Context compaction

```yaml
compaction:
  enabled: true
  threshold: 0.8
```

This is the critical feature for long-running agents. After 100 experiments, the conversation history would blow past any context window. Compaction automatically summarizes older messages when the context reaches 80% capacity, preserving the agent's ability to reason about recent experiments while retaining a compressed view of earlier ones.

Without compaction, the agent would hit the context limit around experiment 10-15 and stop. With it, the agent can run indefinitely.

## The skill

The skill file is where the agent's behavior is defined — not in code, but in natural language:

```
recipes/karpathy-autoresearch/skills/autoresearch/SKILL.md
```

The skill defines:

**Setup phase** — The agent proposes a run tag (e.g. `mar28`), creates a branch `autoresearch/mar28`, reads the codebase for context, verifies data exists, and initializes `results.tsv`.

**Experimentation rules** — What the agent can and cannot do:
- CAN modify `train.py` — architecture, optimizer, hyperparameters, batch size, model size
- CANNOT modify `prepare.py`, install packages, or change the evaluation harness

**The experiment loop** — The core autonomous cycle:

```
LOOP FOREVER:
1. Review git state and past results in results.tsv
2. Formulate a hypothesis and modify train.py
3. git commit the change
4. Run: uv run train.py > run.log 2>&1
5. Read results: grep "^val_bpb:\|^peak_vram_mb:" run.log
6. If crashed → diagnose, attempt fix or move on
7. Record in results.tsv
8. If val_bpb improved → keep the commit
9. If val_bpb equal or worse → git reset --hard HEAD~1
```

**The autonomy directive** — perhaps the most important line:

> Once the loop begins, do NOT pause to ask the human if you should continue. The human may be away. You are autonomous.

**The simplicity criterion** — a guardrail against complexity creep:

> All else being equal, simpler is better. A small improvement that adds ugly complexity is not worth it. Removing something for equal or better results is a win.

This is the entire agent. No Python orchestration, no state machines, no custom tool implementations. The skill is a markdown document that tells the model what to do, and ra handles the execution loop, tool dispatch, context management, and crash recovery.

## Running it

Start the agent from the autoresearch repo:

```bash
cd /path/to/autoresearch
ra --recipe karpathy-autoresearch
```

Or point directly at the config:

```bash
ra --config /path/to/ra/recipes/karpathy-autoresearch/ra.config.yaml
```

The agent will:

1. Propose a run tag and create a branch
2. Read the codebase
3. Run the unmodified baseline
4. Begin autonomous experimentation

Then walk away. Check back in 8 hours.

## What ra handles for you

The reason this works as a 30-line config rather than a custom Python script is that ra provides the infrastructure an autonomous agent needs out of the box:

**The agent loop** — ra's core loop handles streaming model responses, collecting tool calls, executing them (in parallel when possible), and feeding results back. The loop runs until the model stops calling tools or hits iteration/token/time limits.

**Context compaction** — When the conversation grows too large, ra automatically compresses older messages while preserving recent context. This is what enables multi-hour autonomous runs.

**Tool timeout and crash recovery** — If `train.py` hangs or crashes, the 15-minute tool timeout ensures the agent isn't blocked. The agent sees the error and can diagnose or move on.

**Git-based checkpointing** — The agent uses git commits as experiment checkpoints. Successful experiments advance the branch; failed ones are reverted with `git reset`. This pattern emerges from the skill instructions, not from custom code.

**Structured logging** — Every tool call, model response, and middleware event is logged. You can inspect exactly what the agent did after the fact.

## Anatomy of an experiment cycle

Here's what a single experiment looks like from ra's perspective:

```
[iteration 23]
  beforeModelCall → model generates plan + tool calls
  afterModelResponse → 3 tool calls collected

  tool 1: Edit (modify train.py — increase model depth to 10)
  tool 2: Bash (git add -A && git commit -m "increase depth to 10")
  tool 3: Bash (uv run train.py > run.log 2>&1)    ← 5 min training
    └─ toolTimeout: 900000ms

  tool 4: Bash (grep "^val_bpb:" run.log)
    → val_bpb: 0.9891

  tool 5: Edit (append row to results.tsv)
  tool 6: Bash (git reset --hard HEAD~1)             ← worse result, discard

[iteration 24]
  → agent reviews results.tsv, tries next hypothesis...
```

Each iteration is fully observable. You can see what the agent tried, why it kept or discarded, and how the metric evolved over time.

## Key ra concepts at work

### Recipes

A recipe is a portable, shareable agent configuration. The autoresearch recipe bundles config + skills into a directory that anyone can point ra at. You can install it from GitHub:

```bash
ra recipe install github:chinmaymk/ra/recipes/karpathy-autoresearch
ra --recipe karpathy-autoresearch
```

### Skills

Skills are markdown files with YAML frontmatter. They inject structured instructions into the agent's system prompt. The autoresearch skill defines the entire research methodology — setup, rules, loop, logging format — in natural language that the model follows.

### Compaction

ra's context compaction divides the conversation into three zones: pinned (system messages, always kept), compactable (old messages, summarized or truncated), and recent (latest messages, always kept). When the context hits the threshold, compactable messages are compressed. The agent keeps working without noticing.

### Permissions

`no_rules_rules: true` gives the agent unrestricted tool access. For a sandboxed ML experiment, this is the right call. For a production coding agent, you'd use fine-grained permission rules instead.

## Adapting the experiment

The recipe is a starting point. Here are some modifications you might try:

**Different model** — Swap `claude-sonnet-4-6` for `claude-opus-4-6` for deeper reasoning, or use `gpt-4o` via the OpenAI provider:

```yaml
agent:
  provider: openai
  model: gpt-4o
```

**Custom middleware** — Add a middleware hook to post results to Slack after each experiment:

```yaml
agent:
  middleware:
    afterToolExecution:
      - ./middleware/slack-notify.ts
```

**Different research problem** — The pattern isn't specific to LLM training. Any problem with a single editable file, a clear metric, and a fast evaluation loop can use this recipe structure. Swap out the skill to target image classification, RL reward shaping, or compiler optimization.

**Token budget** — Add a hard cap on total tokens spent:

```yaml
agent:
  maxTokenBudget: 5000000
```

## What we learned

Running autoresearch with ra confirmed a few things:

1. **Config-as-agent works.** The entire research agent is a YAML config and a markdown skill. No glue code, no custom orchestration. ra's built-in loop, tools, and compaction handle the rest.

2. **Compaction is non-negotiable for long runs.** Without it, the agent dies around experiment 15. With it, 100+ experiments run smoothly.

3. **Tool timeouts prevent silent hangs.** ML training runs can hang for many reasons (GPU OOM, infinite loops, NaN loss). The 15-minute timeout ensures the agent always recovers.

4. **Simplicity scales.** Karpathy's original insight — one GPU, one file, one metric — maps naturally to ra's recipe model. The constraints that make the experiment tractable for an AI agent are the same constraints that make it easy to configure.

## Try it yourself

```bash
# 1. Install ra
bun install -g ra-app

# 2. Clone autoresearch
git clone https://github.com/karpathy/autoresearch
cd autoresearch
uv sync && uv run prepare.py

# 3. Run the agent
ra --recipe karpathy-autoresearch
```

The full recipe source is at [`recipes/karpathy-autoresearch`](https://github.com/chinmaymk/ra/tree/main/recipes/karpathy-autoresearch).
