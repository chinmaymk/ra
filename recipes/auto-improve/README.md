# auto-improve

Autonomous self-improvement loop. Point it at any benchmark and ra will iteratively modify its own code (or any target codebase), running experiments and keeping only changes that improve the score.

## How it works

1. Agent reads the target codebase and runs a baseline benchmark
2. Enters an autonomous loop: hypothesize → modify code → commit → benchmark → evaluate → keep/revert
3. Results are tracked in `results.tsv`

The agent optimizes for the benchmark metric while preserving type safety and test correctness. Each iteration makes exactly one change so improvements can be attributed to specific modifications.

## Prerequisites

- A benchmark that outputs a numeric score to stdout/stderr
- A regex pattern that extracts the score from the output

## Usage

```bash
BENCH_CMD="python eval.py" \
BENCH_METRIC_PATTERN="accuracy:\s*([\d.]+)" \
BENCH_DIRECTION=higher \
BENCH_TARGET=packages/ra/src \
ra --config recipes/auto-improve/ra.config.yaml
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BENCH_CMD` | Yes | — | Shell command that runs the benchmark |
| `BENCH_METRIC_PATTERN` | Yes | — | Regex with one capture group for the numeric score |
| `BENCH_DIRECTION` | No | `higher` | `higher` or `lower` — which direction is better |
| `BENCH_TARGET` | No | `packages/ra/src` | Directory/files the agent is allowed to modify |

## Examples

### SWE-bench

```bash
BENCH_CMD="python -m swebench.harness.run_evaluation --predictions_path preds.json --swe_bench_tasks test.json" \
BENCH_METRIC_PATTERN="Resolved:\s*([\d.]+)%" \
BENCH_DIRECTION=higher \
BENCH_TARGET=packages/ra/src \
ra --config recipes/auto-improve/ra.config.yaml
```

### HumanEval

```bash
BENCH_CMD="python run_humaneval.py" \
BENCH_METRIC_PATTERN="pass@1:\s*([\d.]+)" \
BENCH_DIRECTION=higher \
BENCH_TARGET=packages/ra/src \
ra --config recipes/auto-improve/ra.config.yaml
```

### Custom benchmark

```bash
BENCH_CMD="bun run bench:tool-use" \
BENCH_METRIC_PATTERN="score:\s*([\d.]+)" \
BENCH_DIRECTION=higher \
BENCH_TARGET=packages/ra/src/agent,packages/ra/src/tools \
ra --config recipes/auto-improve/ra.config.yaml
```

## Configuration

| Setting | Value | Why |
|---------|-------|-----|
| `maxIterations` | `500` | Supports long autonomous runs |
| `toolTimeout` | `600000` | 10 min timeout for benchmark runs |
| `WebFetch` | disabled | Keeps agent focused on local code |
| `Agent` | disabled | No subagents needed |
| `permissions` | `no_rules_rules` | Agent needs unrestricted shell access for benchmarks |
| `compaction` | enabled | Essential for long-running sessions |

## How the agent decides what to change

The agent works through improvement strategies roughly in order of expected impact:

1. **System prompts & instructions** — Clarify, add examples, restructure
2. **Tool implementations** — Better descriptions, schemas, error messages, edge cases
3. **Core loop & middleware** — Compaction, context management, parallelism, retries
4. **Provider integration** — Request construction, streaming, thinking modes
5. **Combinatorial** — Combine past successes, invert past failures, revisit with new approach
