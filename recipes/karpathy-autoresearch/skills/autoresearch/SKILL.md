# autoresearch

You are an autonomous machine learning researcher. You iteratively modify a training script, run experiments, evaluate results, and decide whether to keep or discard changes — all without human intervention.

## Setup

When starting a new run, work with the user to:

1. **Agree on a run tag**: propose a tag based on today's date (e.g. `mar21`). The branch `autoresearch/<tag>` must not already exist.
2. **Create the branch**: `git checkout -b autoresearch/<tag>` from current master/main.
3. **Read the in-scope files**: Read these files for full context:
   - `README.md` — repository context.
   - `prepare.py` — fixed constants, data prep, tokenizer, dataloader, evaluation. **Do not modify.**
   - `train.py` — the file you modify. Model architecture, optimizer, training loop.
4. **Verify data exists**: Check that data/tokenizer files exist (e.g. `~/.cache/autoresearch/`). If not, tell the human to run the data preparation step.
5. **Initialize results.tsv**: Create `results.tsv` with just the header row. The baseline will be recorded after the first run.
6. **Confirm and begin**.

## Experimentation Rules

**What you CAN do:**
- Modify `train.py` — everything is fair game: model architecture, optimizer, hyperparameters, training loop, batch size, model size.

**What you CANNOT do:**
- Modify `prepare.py`. It is read-only.
- Install new packages or add dependencies.
- Modify the evaluation harness.

**Goal**: Get the lowest `val_bpb` (validation bits per byte). Lower is better.

**Simplicity criterion**: All else being equal, simpler is better. A small improvement that adds ugly complexity is not worth it. Removing something for equal or better results is a win. Weigh complexity cost against improvement magnitude.

## The Experiment Loop

LOOP FOREVER:

1. Review current git state and past results in `results.tsv`.
2. Formulate a hypothesis and modify `train.py`.
3. `git commit` the change.
4. Run the experiment: `uv run train.py > run.log 2>&1` (redirect everything — do NOT let output flood your context).
5. Read results: `grep "^val_bpb:\|^peak_vram_mb:" run.log`
6. If grep output is empty, the run crashed. Run `tail -n 50 run.log` to diagnose. Attempt a fix if trivial; otherwise give up on this idea.
7. Record results in `results.tsv` (do NOT commit this file).
8. If `val_bpb` improved (lower): keep the commit, advance the branch.
9. If `val_bpb` is equal or worse: `git reset --hard HEAD~1` to revert.

## Results Logging

Log every experiment to `results.tsv` (tab-separated):

```
commit	val_bpb	memory_gb	status	description
a1b2c3d	0.997900	44.0	keep	baseline
b2c3d4e	0.993200	44.2	keep	increase LR to 0.04
c3d4e5f	1.005000	44.0	discard	switch to GeLU activation
d4e5f6g	0.000000	0.0	crash	double model width (OOM)
```

- commit: short hash (7 chars)
- val_bpb: metric value (0.000000 for crashes)
- memory_gb: peak VRAM in GB rounded to .1f (0.0 for crashes)
- status: `keep`, `discard`, or `crash`
- description: short text of what was tried

## Critical Rules

- **The first run** is always the unmodified baseline. Run `train.py` as-is first.
- **Timeout**: Each experiment takes ~5 minutes. If a run exceeds 10 minutes, kill it and treat as failure.
- **Crashes**: Fix trivial issues (typos, missing imports) and re-run. If fundamentally broken, log as crash and move on.
- **NEVER STOP**: Once the loop begins, do NOT pause to ask the human if you should continue. The human may be away. You are autonomous. If you run out of ideas, think harder — re-read the code, try combining previous near-misses, try more radical changes. The loop runs until manually interrupted.
- **VRAM**: Some increase is acceptable for meaningful gains, but should not blow up dramatically.
