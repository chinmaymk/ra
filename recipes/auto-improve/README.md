# auto-improve

Failure-driven self-improvement loop. Point it at any benchmark and ra autonomously diagnoses what's failing, makes targeted fixes, and validates they work — without blind mutation.

## How it's different

Most auto-improvement approaches are **mutation-driven**: change something, check the score, keep or revert. This recipe is **failure-driven**:

1. **Diagnose** — read the failing cases, trace the code, identify the root cause
2. **Fix** — make a targeted change that addresses a specific failure
3. **Validate** — check that the fix works AND nothing regressed
4. **Iterate** — re-diagnose the new failure landscape

Every change is traceable to a specific failure. No random walks through the search space.

## Setup

Create a `bench.yaml` in your working directory:

```yaml
run: python eval.py
score:
  pattern: "accuracy:\\s*([\\d.]+)"
  direction: higher
results:
  file: results.json
target:
  - src/
validate: bun tsc && bun test
```

Then run:

```bash
ra --config path/to/recipes/auto-improve/ra.config.yaml
```

## bench.yaml Reference

```yaml
# Required: command that executes the benchmark
run: <shell command>

# Required: how to extract the top-line score
score:
  pattern: <regex with one capture group>    # e.g. "pass@1:\s*([\d.]+)"
  direction: higher | lower                  # which way is better

# Optional: per-case detailed results (enables failure-driven diagnosis)
results:
  file: <path>    # json, jsonl, csv, or log file — agent reads it directly

# Optional: what code the agent is allowed to modify
target:
  - <path or glob>    # defaults to cwd if not specified

# Optional: pre-benchmark validation
validate: <shell command>    # e.g. "bun tsc && bun test"
```

## Examples

### SWE-bench

```yaml
run: python -m swebench.harness.run_evaluation --output_dir results/
score:
  pattern: "Resolved:\\s*([\\d.]+)%"
  direction: higher
results:
  file: results/results.json
target:
  - packages/ra/src/
validate: bun tsc
```

### HumanEval

```yaml
run: python run_humaneval.py --output results.jsonl
score:
  pattern: "pass@1:\\s*([\\d.]+)"
  direction: higher
results:
  file: results.jsonl
target:
  - packages/ra/src/
```

### Custom eval suite

```yaml
run: bun run eval:tool-use
score:
  pattern: "score:\\s*([\\d.]+)"
  direction: higher
results:
  file: eval-results.json
target:
  - packages/ra/src/agent/
  - packages/ra/src/tools/
validate: bun tsc && bun test
```

## What the agent does

The agent follows a strict diagnostic protocol:

1. **Understand** — reads the benchmark, the target code, and the detailed results
2. **Diagnose** — categorizes failures by root cause, traces code paths, estimates impact
3. **Fix** — addresses the highest-impact root cause with a minimal, targeted change
4. **Validate** — runs the benchmark, compares per-case results, checks for regressions
5. **Iterate** — returns to diagnosis with updated understanding

All progress is logged to `journal.jsonl` with per-iteration diagnosis, changes, and case-level impact.

## Configuration

| Setting | Value | Why |
|---------|-------|-----|
| `maxIterations` | `500` | Supports long autonomous runs |
| `toolTimeout` | `600000` | 10 min timeout for benchmark runs |
| `WebFetch` | disabled | Keeps agent focused on local code |
| `Agent` | disabled | No subagents needed |
| `compaction` | enabled | Essential for long-running sessions |
