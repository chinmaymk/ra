import type { ToolExecutionContext, LoopContext } from "@chinmaymk/ra"

/**
 * Workflow-guard middleware — enforces tool execution ordering.
 *
 * Define a workflow as a list of steps with optional `requires` dependencies.
 * The guard prevents a tool from running until its prerequisites have completed.
 *
 * Configure via RA_WORKFLOW env var (JSON) or import and call setWorkflow().
 *
 * Example workflow:
 *   [
 *     { "tool": "glob",  "id": "find" },
 *     { "tool": "read",  "id": "read",  "requires": ["find"] },
 *     { "tool": "write", "id": "write", "requires": ["read"] }
 *   ]
 *
 * Tools not in the workflow are allowed freely (passthrough).
 */

export interface WorkflowStep {
  id: string
  tool: string
  requires?: string[]
}

let workflow: WorkflowStep[] = []
const completed = new Set<string>()
const toolToSteps = new Map<string, WorkflowStep[]>()

function loadWorkflow(): void {
  if (workflow.length > 0) return

  const env = process.env.RA_WORKFLOW
  if (env) {
    setWorkflow(JSON.parse(env))
  }
}

export function setWorkflow(steps: WorkflowStep[]): void {
  workflow = steps
  toolToSteps.clear()
  completed.clear()

  for (const step of steps) {
    const existing = toolToSteps.get(step.tool) || []
    existing.push(step)
    toolToSteps.set(step.tool, existing)
  }
}

export function getCompleted(): ReadonlySet<string> {
  return completed
}

export function reset(): void {
  workflow = []
  toolToSteps.clear()
  completed.clear()
}

export default async function workflowGuard(ctx: ToolExecutionContext): Promise<void> {
  loadWorkflow()
  if (workflow.length === 0) return

  const toolName = ctx.toolCall.name
  const steps = toolToSteps.get(toolName)

  // Tool not in workflow — allow freely
  if (!steps) return

  for (const step of steps) {
    if (completed.has(step.id)) continue

    const missing = (step.requires || []).filter((dep) => !completed.has(dep))
    if (missing.length > 0) {
      // Inject a message telling the model what it needs to do first
      const names = missing
        .map((id) => {
          const dep = workflow.find((s) => s.id === id)
          return dep ? `${dep.tool} (step: ${dep.id})` : id
        })
        .join(", ")

      ctx.loop.messages.push({
        role: "user",
        content: `[workflow-guard] Cannot run "${toolName}" yet. Required steps not completed: ${names}. Please complete those first.`,
      })

      // Mark this tool call as blocked by stopping execution of THIS tool
      // The model will see the injected message and adjust
      ctx.stop()
      return
    }

    // Prerequisites met — mark this step as completed
    completed.add(step.id)
    return
  }
}
