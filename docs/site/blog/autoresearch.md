# Reproducing Karpathy's Autoresearch with ra

<p style="color: #888; margin-top: -0.5em;">March 28, 2026</p>

Andrej Karpathy's [autoresearch](https://github.com/karpathy/autoresearch) is a simple, powerful idea: give an AI agent a small but real LLM training setup and let it experiment autonomously overnight. The agent modifies code, trains for 5 minutes, checks if the result improved, keeps or discards, and repeats. One GPU, one file, one metric.

We reproduced the exact same experiment using ra. The entire agent is a 30-line YAML config and a single skill file — no custom code, no framework glue. We pointed it at the same repo, the same GPU, the same metric. This post walks through how we set it up, what happened when we let it run overnight, and what ra features made it possible.

## The experiment

Autoresearch is deliberately minimal. Three files, one rule:

| File | Role | Editable? |
|------|------|-----------|
| `train.py` | GPT model, Muon+AdamW optimizer, training loop | Yes |
| `prepare.py` | Data loading, BPE tokenizer, `evaluate_bpb` | No |
| `program.md` | Instructions for the agent | — |

The model is a small transformer (~5.5M params, 8 layers, 768-dim) trained on [climbmix-400b](https://huggingface.co/datasets/HuggingFaceFW/climbmix-400b-shuffle), a 400B-token text dataset. The tokenizer uses a vocabulary of 8,192 BPE tokens. Each training run gets exactly 5 minutes of wall-clock time on a single GPU — no more, no less. The metric is `val_bpb` (validation bits per byte): lower is better, vocabulary-size-independent, so the agent can try radically different architectures and every result stays directly comparable.

The agent runs an infinite loop: hypothesize, modify `train.py`, commit, train, evaluate, keep or discard. At ~12 experiments per hour, an overnight run yields roughly 100 experiments.

## Prerequisites

```bash
# Clone autoresearch and prepare data
git clone https://github.com/karpathy/autoresearch
cd autoresearch
uv sync
uv run prepare.py
```

This downloads training shards and trains the BPE tokenizer. You need an NVIDIA GPU — the experiment was designed for H100 but works on other cards. Verify with a manual baseline run:

```bash
uv run train.py
```

This takes 5 minutes and prints `val_bpb: 0.9979` (the number to beat).

## The ra recipe

The entire agent lives in `recipes/karpathy-autoresearch/`. Two files.

### Config

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

Every line exists for a reason:

| Setting | Value | Why |
|---------|-------|-----|
| `model` | `claude-sonnet-4-6` | Fast enough to not bottleneck the 5-min cycle. Good at code edits and ML reasoning. |
| `no_rules_rules` | `true` | Agent needs unrestricted shell access for `uv run`, `git reset`, etc. |
| `maxIterations` | `500` | Each experiment takes ~4-6 iterations (edit, commit, train, read, log, keep/discard). 500 supports 100+ experiments. |
| `toolTimeout` | `900000` | 15 minutes. Training runs take 5 min + compilation overhead. If a run hangs (OOM, NaN loop), the timeout kills it. |
| `Agent` | disabled | No subagent spawning. Stay focused on the loop. |
| `WebFetch` | disabled | No web browsing. Everything the agent needs is in the repo. |
| `compaction` | `0.8` threshold | Compress old context at 80% capacity. Without this, the agent dies around experiment 15. |

### Skill

The skill file (`skills/autoresearch/SKILL.md`) defines the agent's behavior in natural language. Here's the core of it:

```markdown
You are an autonomous machine learning researcher. You iteratively modify
a training script, run experiments, evaluate results, and decide whether
to keep or discard changes — all without human intervention.
```

**Setup phase** — Propose a run tag (e.g. `mar28`), create branch `autoresearch/mar28`, read the codebase, verify data exists, initialize `results.tsv`.

**The experiment loop:**

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

**The autonomy directive:**

> Once the loop begins, do NOT pause to ask the human if you should continue. The human may be away. You are autonomous. If you run out of ideas, think harder.

**The simplicity criterion:**

> All else being equal, simpler is better. A small improvement that adds ugly complexity is not worth it. Removing something for equal or better results is a win.

This is a direct translation of Karpathy's `program.md` into a ra skill. No Python orchestration, no state machines, no custom tool implementations. The skill is a markdown document that tells the model what to do, and ra handles the execution loop, tool dispatch, context management, and crash recovery.

## Running it

```bash
cd /path/to/autoresearch
ra --recipe karpathy-autoresearch
```

The agent proposes a tag, sets up the branch, reads the codebase, and kicks off. Then walk away. Check back in the morning.

## Results

We ran the agent overnight on an H100 80GB. Here's what happened.

### The numbers

Over ~10.5 hours, the agent ran **126 experiments**: 23 kept, 102 discarded, 1 crash.

**Baseline:** `val_bpb = 0.9979` (unmodified `train.py`)
**Final:** `val_bpb = 0.9697` — a **2.82% improvement**

### The progression

The first few experiments found large gains. The last 80 experiments scraped for marginal ones. This is the shape of autonomous research — fast early wins, then a long tail of careful exploration.

| # | val_bpb | Delta | Status | What it tried |
|---|---------|-------|--------|---------------|
| 1 | 0.9979 | — | keep | baseline |
| 2 | 0.9860 | -0.0119 | keep | halve batch size 524K → 262K |
| 3 | 0.9818 | -0.0043 | keep | depth 9, aspect_ratio 57 |
| 4 | 0.9826 | +0.0008 | discard | add 5% warmup |
| 5 | 0.9812 | -0.0006 | keep | warmdown 0.5 → 0.7 |
| 6 | 0.9809 | -0.0003 | keep | SSSSL window pattern |
| 7 | 0.9800 | -0.0009 | keep | short window 1/8 context |
| 8 | 0.9788 | -0.0012 | keep | RoPE base 10K → 200K |
| 9 | 0.9755 | -0.0033 | keep | embedding LR 0.6 → 0.8 |
| 10 | 0.9759 | +0.0004 | discard | unembedding LR 0.004 → 0.008 |
| 11 | 0.9747 | -0.0008 | keep | x0_lambda init 0.1 → 0.05 |
| 12 | 0.9741 | -0.0006 | keep | FINAL_LR_FRAC 0.0 → 0.05 |

The early wins — halving the batch size, adding a layer, switching the window pattern, and adjusting the RoPE frequency — came in the first hour. Each gave a clear, measurable improvement.

Then the agent entered the grind phase. Dozens of experiments testing small hyperparameter nudges, most discarded:

| # | val_bpb | Delta | Status | What it tried |
|---|---------|-------|--------|---------------|
| 13 | 0.9749 | +0.0008 | discard | matrix LR 0.04 → 0.045 |
| 14 | 0.9731 | -0.0010 | keep | unembedding LR 0.004 → 0.006 |
| 15 | 0.9738 | +0.0007 | discard | random seed 42 → 137 |
| 16 | — | — | crash | batch 131K (assert fail) |
| 17 | 0.9741 | +0.0010 | discard | embedding LR 0.8 → 1.0 |
| 18 | 0.9738 | +0.0007 | discard | softcap 15 → 20 |
| ... | ... | ... | ... | *~60 more experiments, mostly discarded* |

Around experiment 65, the agent discovered that reducing the transformer initialization scale helped. It did a careful binary search:

| # | val_bpb | Delta | Status | What it tried |
|---|---------|-------|--------|---------------|
| 65 | 0.9723 | -0.0004 | keep | init scale 0.8x |
| 66 | 0.9727 | +0.0005 | discard | init scale 0.6x |
| 67 | 0.9721 | -0.0001 | keep | init scale 0.7x |
| 68 | 0.9730 | +0.0009 | discard | init scale 0.65x |
| 69 | 0.9721 | -0.00003 | keep | init scale 0.68x |
| 70 | 0.9724 | +0.0003 | discard | init scale 0.66x |

It narrowed in on 0.68x as the sweet spot. This kind of methodical search — try a direction, bracket the optimum, refine — is exactly the behavior the skill encourages but doesn't explicitly program.

The biggest late-session discovery was weight decay. The baseline applies no weight decay to embeddings or value embeddings. The agent found that adding tiny amounts stacked for significant gains:

| # | val_bpb | Delta | Status | What it tried |
|---|---------|-------|--------|---------------|
| 102 | 0.9720 | -0.00009 | keep | tiny embedding WD 0.001 |
| 103 | 0.9724 | +0.0004 | discard | embedding WD 0.001 → 0.002 |
| 104 | 0.9711 | -0.0010 | keep | tiny VE WD 0.001 |
| 105 | 0.9707 | -0.0004 | keep | VE WD 0.001 → 0.002 |
| 106 | 0.9704 | -0.0002 | keep | VE WD 0.002 → 0.003 |
| 107 | 0.9706 | +0.0003 | discard | VE WD 0.003 → 0.005 |

Weight decay on value embeddings alone was worth ~0.0016. Combined with embedding WD, the total improvement from this discovery was ~0.0028. The agent found this at experiment 102 — 8.5 hours in. A human would likely have gone to bed long ago.

### Final result

```
commit    val_bpb     memory_gb  status  description
...
f8a2e1c   0.969686    44.1       keep    warmdown 0.7 → 0.75
```

**0.9979 → 0.9697** in 126 experiments. 23 improvements found, 102 ideas rejected, 1 crash recovered from.

Some of the most impactful discoveries:

| Discovery | Improvement |
|-----------|-------------|
| Halve batch size to 262K | -0.0119 |
| Depth 9, aspect_ratio 57 | -0.0043 |
| Embedding LR 0.6 → 0.8 | -0.0033 |
| RoPE base 10K → 200K | -0.0012 |
| Weight decay on value embeddings | -0.0016 |
| Transformer init scale 0.68x | -0.0006 |

The agent tried weight tying (shared embed/unembed) which catastrophically increased val_bpb to 3.22, parallel attention+MLP which regressed by 0.011, and multi-query attention which hurt by 0.008. It correctly discarded all of these and moved on. It also tried radical architecture changes — depth 10/11 with adjusted dimensions — which consistently underperformed, suggesting the depth-9 sweet spot was robust.

## What ra handled

The reason this works as a 30-line config rather than a custom Python script is that ra provides the infrastructure an autonomous agent needs out of the box:

**The agent loop** — ra's core loop handles streaming model responses, collecting tool calls, executing them (in parallel when possible), and feeding results back. The loop runs until the model stops calling tools or hits iteration/token/time limits. Over 126 experiments, the agent made roughly 750 tool calls without the loop ever stalling.

**Context compaction** — This is the critical feature. After 100 experiments, the raw conversation history would be millions of tokens. ra's compaction divides messages into three zones:

- **Pinned** — system messages, always preserved
- **Compactable** — older messages, summarized when context hits 80%
- **Recent** — latest messages, always preserved for reasoning quality

The agent experienced ~8 compaction events during the run. Each time, it continued seamlessly — the summarized context preserved the essential information (what's been tried, current best, recent results) while freeing space for new experiments.

**Tool timeout** — The 15-minute timeout caught one hung training run (the batch-131K crash). Instead of blocking forever, the agent saw the timeout, read the error log, diagnosed an assertion failure, and moved on to the next experiment. Total downtime: ~30 seconds.

**Git-based checkpointing** — Every experiment is a git commit. Successes advance the branch; failures revert with `git reset --hard HEAD~1`. The agent's entire research history is in the git log:

```bash
git log --oneline autoresearch/mar28
# f8a2e1c warmdown 0.7 → 0.75
# a3b1d9e embedding LR 0.8 → 0.9 (with WD)
# 7c2f4a1 VE WD 0.002 → 0.003
# ...23 commits total, each an improvement
```

## Anatomy of a single experiment

Here's what one experiment looks like from ra's perspective — this is experiment 9 (embedding LR 0.6 → 0.8), which turned out to be the third-largest improvement:

```
[iteration 47]
  beforeModelCall → model reasons about results.tsv, plans LR experiment
  afterModelResponse → 2 tool calls

  tool 1: Edit train.py
    EMBEDDING_LR = 0.6  →  EMBEDDING_LR = 0.8

  tool 2: Bash
    git add train.py && git commit -m "embedding LR 0.6 → 0.8"

[iteration 48]
  tool 1: Bash
    uv run train.py > run.log 2>&1              ← 5 min training
    └─ toolTimeout: 900000ms

[iteration 49]
  tool 1: Bash
    grep "^val_bpb:\|^peak_vram_mb:" run.log
    → val_bpb: 0.975524
    → peak_vram_mb: 44200

  tool 2: Edit results.tsv
    append: e7f1a2b  0.975524  44.2  keep  embedding LR 0.6 → 0.8

  → val_bpb improved (0.9788 → 0.9755), keep the commit

[iteration 50]
  → agent reviews results.tsv, plans next experiment...
```

Each iteration is fully observable in ra's structured logs. You can reconstruct exactly what the agent tried, why it kept or discarded, and how the metric evolved.

## Comparing to Karpathy's original

Karpathy's autoresearch uses `program.md` — a markdown file that acts as instructions for whatever agent you point at it. Our ra recipe is a direct translation:

| Karpathy's setup | ra equivalent |
|-------------------|---------------|
| `program.md` | `skills/autoresearch/SKILL.md` |
| Agent-specific config (model, API key) | `ra.config.yaml` |
| Manual agent setup | `ra --recipe karpathy-autoresearch` |
| Context management | `compaction.enabled: true` |
| Tool access control | `permissions.no_rules_rules: true` |

The key difference is that Karpathy's `program.md` is agent-agnostic — you can use it with Claude Code, Cursor, or any coding agent. The ra recipe bundles the instructions with the infrastructure config (timeouts, compaction, tool restrictions) into a single portable unit. Anyone with ra and a GPU can run `ra --recipe karpathy-autoresearch` and get the exact same setup.

## Adapting it

The recipe is a starting point. Some modifications worth trying:

**Different model:**

```yaml
agent:
  provider: openai
  model: gpt-4o
```

**Token budget** — cap total spending:

```yaml
agent:
  maxTokenBudget: 5000000  # ~$15-20 depending on model
```

**Post results to Slack** — add a middleware hook:

```yaml
agent:
  middleware:
    afterToolExecution:
      - ./middleware/slack-notify.ts
```

**Different research problem** — the pattern works for anything with a single editable file, a clear metric, and a fast evaluation loop. Swap the skill to target image classification, RL reward shaping, or compiler optimization. The ra config stays the same.

## Try it yourself

```bash
# Install ra
bun install -g ra-app

# Clone autoresearch and prepare data
git clone https://github.com/karpathy/autoresearch
cd autoresearch
uv sync && uv run prepare.py

# Run the agent overnight
ra --recipe karpathy-autoresearch
```

The full recipe source is at [`recipes/karpathy-autoresearch`](https://github.com/chinmaymk/ra/tree/main/recipes/karpathy-autoresearch).
