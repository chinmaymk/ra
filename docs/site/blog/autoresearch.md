# Running Karpathy's Autoresearch with ra

<p style="color: #888; margin-top: -0.5em;">March 28, 2026</p>

Andrej Karpathy's [autoresearch](https://github.com/karpathy/autoresearch) gives an AI agent a small but real LLM training setup and lets it experiment autonomously overnight. The agent modifies code, trains for 5 minutes, checks if the result improved, keeps or discards, and repeats. One GPU, one file, one metric.

ra ships with a [recipe](https://github.com/chinmaymk/ra/tree/main/recipes/karpathy-autoresearch) that runs the exact same experiment. This post explains how the recipe works, what each config setting does, and why an autonomous overnight agent needs different infrastructure than a normal coding assistant.

## What is autoresearch?

Three files, one rule:

| File | Role | Editable? |
|------|------|-----------|
| `train.py` | GPT model, Muon+AdamW optimizer, training loop | Yes |
| `prepare.py` | Data loading, BPE tokenizer, `evaluate_bpb` | No |
| `program.md` | Instructions for the agent | — |

The default model is a small transformer (8 layers, 512-dim, 4 heads) trained on [climbmix-400b](https://huggingface.co/datasets/HuggingFaceFW/climbmix-400b-shuffle), a 400B-token text dataset. Vocabulary is 8,192 BPE tokens, context length is 2,048 tokens. Each training run gets exactly 300 seconds of wall-clock time on a single GPU. The metric is `val_bpb` (validation bits per byte) — lower is better, vocabulary-size-independent, so the agent can try radically different architectures and every result stays directly comparable.

The agent runs an infinite loop: hypothesize, modify `train.py`, commit, train, evaluate, keep or discard. At ~12 experiments per hour, an overnight run yields roughly 100 experiments. Community runs have reported going from a baseline of `val_bpb = 0.9979` down to `0.9697` in [126 experiments](https://github.com/karpathy/autoresearch/discussions/43) — a 2.8% improvement found entirely by the agent.

## Why ra?

Karpathy's `program.md` is agent-agnostic — you can paste it into Claude Code, Cursor, or any coding agent. That works, but you're relying on whatever context management, timeout behavior, and tool configuration your agent happens to have. For a 10-hour autonomous run, those defaults matter a lot.

ra's recipe bundles the instructions *with* the infrastructure config into a single portable unit. The things that make overnight autonomy work — context compaction, tool timeouts, tool restrictions — are explicit settings, not hidden defaults.

| Problem | What goes wrong without it | ra setting |
|---------|---------------------------|------------|
| Context overflow | Agent dies around experiment 15 when conversation exceeds context window | `compaction.enabled: true` at 80% threshold |
| Hung training run | Agent blocks forever on OOM or NaN loop | `toolTimeout: 900000` (15 min) |
| Agent gets distracted | Spawns subagents or browses the web instead of running experiments | `Agent: disabled`, `WebFetch: disabled` |
| Permission prompts | Agent pauses to ask permission for `git reset --hard` at 3am | `no_rules_rules: true` |
| Not enough iterations | Default iteration limits (~50-200) end the run after a few hours | `maxIterations: 500` |

## The recipe

The entire agent lives in two files.

### ra.config.yaml

```yaml
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

**`model: claude-sonnet-4-6`** — The agent needs to be good at code modification and ML reasoning, but it also needs to be fast. Each experiment cycle involves 4-6 tool calls (edit, commit, train, grep, log, keep/discard). If the model takes 30 seconds per response, that's 3 minutes of overhead on top of the 5-minute training run — a 60% tax. Sonnet keeps overhead under a minute.

**`no_rules_rules: true`** — The agent needs to run `uv run train.py`, `git reset --hard HEAD~1`, and read arbitrary log files without being asked for permission. In a normal coding agent you'd want guards. Here the agent is operating in an isolated experiment on a single repo. There's nothing to protect it from.

**`maxIterations: 500`** — Each experiment takes ~4-6 loop iterations. 500 iterations supports well over 100 experiments. Setting this too low is the most common reason an autonomous agent stops early.

**`toolTimeout: 900000`** — 15 minutes. Training runs take 5 minutes plus torch compilation overhead on the first run. If a run hangs (OOM, infinite loop, NaN loss that doesn't trigger the guard), the timeout kills the tool call and returns an error. The agent reads the error, diagnoses or moves on.

**`Agent: disabled`, `WebFetch: disabled`** — The agent should not spawn subagents or browse the web. Both are distractions. The skill tells the agent everything it needs to know, and the codebase is self-contained.

**`compaction.enabled: true`** — This is the most important setting. Without it, here's what happens: each experiment generates ~2-4K tokens of conversation (tool calls, tool results, model reasoning). After 15 experiments, that's 30-60K tokens. After 50, it's 100-200K. The agent hits the context window and stops.

With compaction at 80% threshold, ra divides the conversation into three zones:

- **Pinned** — system prompt and skill instructions, always preserved
- **Compactable** — older experiment cycles, summarized or truncated when context hits 80%
- **Recent** — the last few experiments, always preserved at full fidelity

The agent doesn't notice when compaction happens. It sees a summarized history of past experiments and full detail on recent ones — which is exactly the information it needs to plan the next experiment.

### skills/autoresearch/SKILL.md

The skill is a direct translation of Karpathy's `program.md`. It defines the agent's behavior in natural language with YAML frontmatter:

```yaml
---
name: autoresearch
description: Autonomous ML research agent that iteratively modifies
  training code, runs experiments, and tracks results.
---
```

The body defines four things:

**Setup phase** — Propose a run tag (e.g. `mar28`), create branch `autoresearch/mar28`, read `README.md`, `prepare.py` (read-only), and `train.py` (the file to modify), verify data exists in `~/.cache/autoresearch/`, initialize `results.tsv` with header row, confirm before starting.

**Experimentation rules:**
- **CAN** modify `train.py` — everything is fair game: model architecture, optimizer, hyperparameters, training loop, batch size, model size
- **CANNOT** modify `prepare.py`, install new packages, or alter the evaluation harness

**The experiment loop:**

```
LOOP FOREVER:
1. Review current git state and past results in results.tsv
2. Formulate a hypothesis and modify train.py
3. git commit the change
4. Run the experiment: uv run train.py > run.log 2>&1
5. Read results: grep "^val_bpb:\|^peak_vram_mb:" run.log
6. If grep output is empty, the run crashed. Run tail -n 50 run.log
   to diagnose. Attempt a fix if trivial; otherwise give up on this idea.
7. Record results in results.tsv (do NOT commit this file)
8. If val_bpb improved (lower): keep the commit, advance the branch
9. If val_bpb is equal or worse: git reset --hard HEAD~1 to revert
```

Step 4 redirects all output to a log file — this is critical. Without `> run.log 2>&1`, training output floods the conversation context. A single 5-minute training run can produce 50K+ tokens of progress bars and loss values. The redirect keeps the context clean; the agent reads only what it needs via `grep`.

**Results logging** in `results.tsv` (tab-separated, never committed):

```
commit	val_bpb	memory_gb	status	description
a1b2c3d	0.997900	44.0	keep	baseline
b2c3d4e	0.993200	44.2	keep	increase LR to 0.04
c3d4e5f	1.005000	44.0	discard	switch to GeLU activation
d4e5f6g	0.000000	0.0	crash	double model width (OOM)
```

The TSV file is the agent's memory across compaction events. When older conversation messages get summarized, `results.tsv` still contains the full history of every experiment. The agent reads it at the start of each cycle to decide what to try next.

**The autonomy directive:**

> Once the loop begins, do NOT pause to ask the human if you should continue. The human may be away. You are autonomous. If you run out of ideas, think harder — re-read the code, try combining previous near-misses, try more radical changes. The loop runs until manually interrupted.

## How ra runs one experiment

Here's what happens inside ra during a single experiment cycle. This is the level of detail you'd see in ra's structured logs:

```
[iteration 23] beforeModelCall
  → model reads results.tsv, sees current best val_bpb = 0.9788
  → decides to try increasing embedding learning rate
  afterModelResponse → 2 tool calls

  [tool 1] Edit train.py
    old: EMBEDDING_LR = 0.6
    new: EMBEDDING_LR = 0.8
  [tool 2] Bash
    git add train.py && git commit -m "embedding LR 0.6 → 0.8"

[iteration 24] beforeModelCall
  afterModelResponse → 1 tool call

  [tool 1] Bash                              ← 5 min training run
    uv run train.py > run.log 2>&1
    toolTimeout: 900000ms

[iteration 25] beforeModelCall
  afterModelResponse → 1 tool call

  [tool 1] Bash
    grep "^val_bpb:\|^peak_vram_mb:" run.log
    → val_bpb: 0.975524
    → peak_vram_mb: 44200

[iteration 26] beforeModelCall
  → model compares 0.975524 < 0.9788 → improvement, keep
  afterModelResponse → 1 tool call

  [tool 1] Bash
    echo -e "e7f1a2b\t0.975524\t44.2\tkeep\tembedding LR 0.6 → 0.8" >> results.tsv

[iteration 27]
  → agent reads results.tsv, plans next experiment...
```

Five iterations, four tool calls, one 5-minute training run. Multiply by 100 and you have an overnight session.

The key ra features at work:

- **Tool timeout** on iteration 24 — if `train.py` hangs, the timeout fires after 15 minutes and the agent sees an error instead of blocking forever
- **Compaction** — after ~15 experiment cycles like this, the older ones get summarized to free context space
- **No permission prompts** — `git commit`, `git reset --hard`, shell execution all proceed without asking

## What to expect

Based on [published community runs](https://github.com/karpathy/autoresearch/discussions/43):

- ~12 experiments per hour (~5 min training + agent overhead)
- ~100 experiments in an 8-10 hour overnight run
- Roughly 15-20% of experiments will be kept as improvements
- Typical overall improvement: 2-3% val_bpb reduction from baseline
- Common winning strategies: batch size tuning, depth/width adjustments, learning rate schedules, weight decay on embeddings, initialization scaling
- Common failures: weight tying, multi-query attention, aggressive architecture changes

The agent tends to find large gains early (batch size, model depth) and spend the later hours grinding through small hyperparameter adjustments. This matches what you'd expect from any optimization process — low-hanging fruit first, diminishing returns later.

## Try it yourself

### 1. Install ra

```bash
curl -fsSL https://raw.githubusercontent.com/chinmaymk/ra/main/install.sh | bash
```

Or [build from source](/getting-started/install) if you prefer.

### 2. Set up your provider

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

### 3. Clone autoresearch and prepare data

```bash
git clone https://github.com/karpathy/autoresearch
cd autoresearch
uv sync
uv run prepare.py
```

Requires an NVIDIA GPU, Python 3.10+, and [uv](https://docs.astral.sh/uv/). Data download is ~5GB.

### 4. Run the baseline (optional)

```bash
uv run train.py
```

Takes 5 minutes. Confirms your GPU works and prints the baseline `val_bpb`.

### 5. Start the agent

```bash
ra --config /path/to/ra/recipes/karpathy-autoresearch/ra.config.yaml
```

Or install the recipe and run by name:

```bash
ra recipe install chinmaymk/ra
ra --recipe karpathy-autoresearch
```

The agent sets up a branch, runs the baseline, and enters the autonomous loop. Check progress anytime by reading `results.tsv`.

### 6. Customize

Override any setting with a local `ra.config.yaml`:

```yaml
agent:
  recipe: karpathy-autoresearch
  model: claude-opus-4-6       # more capable model
  maxTokenBudget: 5000000      # cap total token spend
```

Or swap providers entirely:

```yaml
agent:
  recipe: karpathy-autoresearch
  provider: openai
  model: gpt-4o
```

The full recipe source is at [`recipes/karpathy-autoresearch`](https://github.com/chinmaymk/ra/tree/main/recipes/karpathy-autoresearch).
