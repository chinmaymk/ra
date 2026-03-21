# karpathy-autoresearch

Autonomous ML research agent based on [Karpathy's autoresearch](https://github.com/karpathy/autoresearch). The agent iteratively modifies a training script, runs 5-minute experiments, evaluates results, and keeps or discards changes — all without human intervention.

## How it works

1. Agent reads the codebase (`prepare.py`, `train.py`)
2. Establishes a baseline by running `train.py` unmodified
3. Enters an autonomous loop: hypothesize → modify `train.py` → commit → train → evaluate → keep/discard
4. Results are tracked in `results.tsv`

The agent optimizes for the lowest `val_bpb` (validation bits per byte) while respecting a simplicity criterion — complexity must be justified by meaningful improvement.

## Prerequisites

- Clone [karpathy/autoresearch](https://github.com/karpathy/autoresearch)
- NVIDIA GPU (tested on H100)
- Python 3.10+ and [uv](https://docs.astral.sh/uv/)
- Run `uv sync && uv run prepare.py` to prepare data

## Usage

```bash
cd /path/to/autoresearch
ra --config /path/to/ra/recipes/karpathy-autoresearch/ra.config.yaml
```

The system prompt tells the agent to `Read /autoresearch and begin` — the context resolver injects the skill body, and the agent kicks off autonomously. Each experiment takes ~5 minutes. Over an 8-hour period, expect ~100 experiments.

## Configuration

| Setting | Value | Why |
|---------|-------|-----|
| `interface` | `repl` | Interactive setup, then autonomous loop |
| `maxIterations` | `500` | Supports long autonomous runs (~100 experiments) |
| `toolTimeout` | `900000` | 15 min timeout for training runs |
| `AskUserQuestion` | disabled | Agent must not pause to ask questions |
| `WebFetch` | disabled | No internet needed, keeps agent focused |
| `Agent` | disabled | No subagents needed |
| `permissions` | `no_rules_rules` | Agent needs unrestricted shell access for training |
| `compaction` | enabled | Essential for long-running sessions |
