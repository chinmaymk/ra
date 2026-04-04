# Workflow Orchestration for ra

## Context

ra supports single-agent execution. We want multi-agent workflows — a company of agents that collaborate. This needs to be simple enough to configure in YAML and powerful enough to scale from a 3-step pipeline to a full org chart.

## The Primitive

A workflow is a map of named **entries**. Each entry runs an agent with a prompt. Dependencies are implicit from `{{var}}` references. That's it.

```yaml
name: build-feature

agents:
  planner: ./agents/planner.yaml
  coder: ./agents/coder.yaml

workflow:
  plan:
    agent: planner
    prompt: ./prompts/plan.md       # file or inline string

  build:
    agent: coder
    prompt: "Implement: {{plan}}"   # {{plan}} = implicit dep
```

Three additional properties extend this:

### `each` — fan-out

One agent instance per item from a source entry's output.

```yaml
  workers:
    agent: coder
    each: plan                      # parse plan output into tasks
    prompt: ./prompts/build.md      # {{item}} = current task
    max: 8                          # optional concurrency cap
```

### `workflow` — nested composition

A sub-workflow that acts as a single entry from the parent's perspective. Enables departments, teams, org charts.

```yaml
  engineering:
    workflow:
      design:
        agent: architect
        prompt: ./prompts/design.md
      build:
        agent: coder
        each: design
        prompt: ./prompts/build.md
```

Parent entries reference `{{engineering}}` to depend on the whole sub-workflow.

### `cron` — repeating

Use existing cron infrastructure for recurring workflows. A workflow can be scheduled as a cron job — no new primitive needed.

```yaml
cron:
  - name: health-check
    schedule: "*/2 * * * *"         # every 2 minutes
    prompt: "Check system health"
    workflow: ./workflows/patrol.yaml
```

### Prompts

Prompts can be inline strings or file paths:

```yaml
  plan:
    agent: planner
    prompt: "Inline prompt: {{input}}"

  build:
    agent: coder
    prompt: ./prompts/build.md      # loaded from file, {{var}} still interpolated
```

File prompts are resolved relative to the workflow YAML. Variables (`{{input}}`, `{{plan}}`, `{{item}}`) are interpolated after loading.

### Revision

Any agent can call a `RequestRevision` tool to send feedback to a prior entry, triggering re-execution of that entry and all downstream entries.

```
QA calls RequestRevision(target: "backend", feedback: "missing auth")
  -> invalidate backend + downstream
  -> re-run backend with feedback appended
  -> re-run QA
  -> repeat up to maxRevisions
```

## Examples

### Simple Pipeline

```yaml
name: build-feature

agents:
  manager: ./agents/manager.yaml
  architect: ./agents/architect.yaml
  backend: ./agents/backend.yaml
  frontend: ./agents/frontend.yaml
  qa: ./agents/qa.yaml

workflow:
  goal:
    agent: manager
    prompt: ./prompts/goal.md

  design:
    agent: architect
    prompt: ./prompts/design.md       # uses {{goal}}

  backend:
    agent: backend
    prompt: ./prompts/backend.md      # uses {{design}}

  frontend:
    agent: frontend
    prompt: ./prompts/frontend.md     # uses {{design}}

  qa:
    agent: qa
    prompt: ./prompts/qa.md           # uses {{design}}, {{backend}}, {{frontend}}

settings:
  maxRevisions: 3
```

`backend` and `frontend` both depend only on `design` — they run in parallel.

### Swarming

```yaml
name: swarm-build

agents:
  planner: ./agents/planner.yaml
  coder: ./agents/coder.yaml
  integrator: ./agents/integrator.yaml

workflow:
  plan:
    agent: planner
    prompt: ./prompts/plan.md

  workers:
    agent: coder
    each: plan
    max: 8
    prompt: ./prompts/worker.md       # {{item}} per task

  integrate:
    agent: integrator
    prompt: ./prompts/integrate.md    # {{workers}} = combined output
```

### Company of Agents

```yaml
name: product-launch

agents:
  ceo: ./agents/ceo.yaml
  architect: ./agents/architect.yaml
  coder: ./agents/coder.yaml
  marketer: ./agents/marketer.yaml
  designer: ./agents/designer.yaml
  pm: ./agents/pm.yaml

workflow:
  strategy:
    agent: ceo
    prompt: ./prompts/strategy.md

  engineering:
    workflow:
      design:
        agent: architect
        prompt: ./prompts/eng-design.md
      build:
        agent: coder
        each: design
        prompt: ./prompts/eng-build.md

  marketing:
    workflow:
      copy:
        agent: marketer
        prompt: ./prompts/mkt-copy.md
      assets:
        agent: designer
        prompt: ./prompts/mkt-assets.md

  launch:
    agent: pm
    prompt: ./prompts/launch.md       # {{engineering}} + {{marketing}}
```

## Diagrams

### Execution Flow

```
  plan (entry)
  +----------+
  | planner  | -> output: ["auth API", "user model", "tests"]
  +----+-----+
       |
       v  workers (each: plan)
  +------------------------------------+
  |  parseTasks(plan) -> 3 items       |
  |                                    |
  |  +---------+ +---------+ +------+  |
  |  | coder/0 | | coder/1 | | c/2  |  |  (parallel)
  |  +----+----+ +----+----+ +--+---+  |
  |       +------+-----+-------+      |
  |              v                     |
  |  variables["workers"] = joined     |
  +----+-------------------------------+
       |
       v
  integrate (entry)
  +------------------+
  | integrator       | -> {{workers}}
  +------------------+
```

### Nested Workflow

```
  strategy
  +----------+
  |   CEO    |
  +----+-----+
       |
       +-------------------+
       v                   v
  engineering (workflow)   marketing (workflow)     <- parallel
  +-----------------+     +-----------------+
  | design -> build |     | copy -> assets  |
  |    (each)       |     |                 |
  +--------+--------+     +--------+--------+
           +-----------+-----------+
                       v
  launch
  +------------------+
  |       PM         | -> {{engineering}} + {{marketing}}
  +------------------+
```

## Package Structure

```
packages/
  ra/              # @chinmaymk/ra -- core library (unchanged)
  workflow/        # @chinmaymk/workflow -- workflow engine (NEW)
  app/             # ra-app -- CLI binary (thin integration)
```

```
workflow -> ra         (AgentLoop, ToolRegistry, providers, types)
app -> workflow        (runWorkflow, types)
app -> ra              (existing)
```

## Types

```typescript
// --- Entries ---

interface WorkerEntry {
  agent: string
  prompt: string                    // inline string or file path
}

interface EachEntry {
  agent: string
  each: string                      // source entry name
  prompt: string
  max?: number
}

interface NestedWorkflowEntry {
  workflow: Record<string, WorkflowEntry>
}

type WorkflowEntry = WorkerEntry | EachEntry | NestedWorkflowEntry

// --- Definition ---

interface WorkflowDef {
  name: string
  agents: Record<string, string>    // name -> config path
  workflow: Record<string, WorkflowEntry>
  settings?: {
    maxRevisions?: number           // default 3
    maxTokenBudget?: number
    maxDuration?: number
  }
}

// --- Results ---

interface EntryResult {
  name: string
  output: string
  status: 'completed' | 'error' | 'revision_requested'
  children?: EntryResult[]          // for each + nested
  error?: string
}

interface WorkflowResult {
  name: string
  entries: EntryResult[]
  status: 'completed' | 'error' | 'budget_exceeded'
  durationMs: number
}

// --- Factory ---

type AgentFactory = (agentKey: string) => Promise<{
  loopOptions: AgentLoopOptions
  systemPrompt?: string
  shutdown?: () => Promise<void>
}>
```

## Engine Algorithm

1. **Parse** workflow map, classify entries (worker, each, nested)
2. **Extract deps** from `{{var}}` refs in prompts (load file prompts first)
3. **Validate** — cycle detection, unknown refs, unknown agents
4. **Seed** variables: `{ input }`
5. **Ready-queue loop**:
   - Find entries where all deps are satisfied
   - Execute ready entries in parallel:
     - **Worker**: interpolate prompt, create agent, inject RequestRevision tool, run loop, store output
     - **Each**: parse source into tasks, spawn N agents (up to max), join outputs
     - **Nested**: recurse into `runWorkflow` with parent variables
   - Handle revisions: invalidate target + downstream, re-run
6. **Return** `WorkflowResult`

## Module Structure

```
packages/workflow/src/
  types.ts              # entry types, type guards, results
  prompt.ts             # load prompt (file or inline) + {{var}} interpolation
  task-parser.ts        # parseTasks() for each entries
  deps.ts               # dependency graph + cycle detection
  scheduler.ts          # ready-queue executor
  revision.ts           # RequestRevision tool
  engine.ts             # runWorkflow()
  index.ts              # exports
```

## Files to Modify

| File | Change |
|------|--------|
| `package.json` (root) | Add workflow to workspaces + test script |
| `tsconfig.json` (root) | Add `@chinmaymk/workflow` path alias |
| `packages/app/package.json` | Add `@chinmaymk/workflow` dep |
| `packages/app/src/config/types.ts` | Add `workflow?` to config |
| `packages/app/src/interfaces/parse-args.ts` | Add `--workflow` flag |
| `packages/app/src/index.ts` | Route `--workflow` to runner |

## Future Extensions

These are NOT built now, but the architecture supports them:

- **Observers**: entries that run alongside others with monitoring tools (add `observe: <target>` property later)
- **Cron workflows**: schedule a workflow as a cron job (extend existing cron to accept `workflow` field)
- **Shared context**: blackboard pattern where entries read/write to shared state
- **Conditional entries**: `when: "{{plan.taskCount}} > 5"` to skip/include entries

## Verification

1. `bun tsc` — zero errors
2. `bun test` — all tests pass
3. Unit tests for: prompt loading, interpolation, task parsing, dep graph, scheduler, revision, engine
4. Integration: `ra --workflow ./test.yaml "build a todo app"` with mock agents
