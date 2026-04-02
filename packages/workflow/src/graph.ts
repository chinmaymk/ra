import type { WorkflowStep } from './types'

const TEMPLATE_REF = /\{\{(\w+)\}\}/g

/** Extract step dependencies from a prompt template. Filters out the special `{{input}}` ref. */
export function extractDependencies(prompt: string): string[] {
  const deps: string[] = []
  for (const match of prompt.matchAll(TEMPLATE_REF)) {
    const ref = match[1]!
    if (ref !== 'input' && !deps.includes(ref)) deps.push(ref)
  }
  return deps
}

/** Build a dependency graph from workflow steps. Returns Map<stepName, Set<dependencyNames>>. */
export function buildDependencyGraph(steps: WorkflowStep[]): Map<string, Set<string>> {
  const stepNames = new Set(steps.map(s => s.name))
  const graph = new Map<string, Set<string>>()

  // Check for duplicate names
  if (stepNames.size !== steps.length) {
    const seen = new Set<string>()
    for (const step of steps) {
      if (seen.has(step.name)) throw new Error(`Duplicate step name: "${step.name}"`)
      seen.add(step.name)
    }
  }

  for (const step of steps) {
    const deps = extractDependencies(step.prompt)
    for (const dep of deps) {
      if (!stepNames.has(dep)) {
        throw new Error(`Step "${step.name}" references unknown step "{{${dep}}}"`)
      }
    }
    graph.set(step.name, new Set(deps))
  }

  return graph
}

/** Detect a cycle in the dependency graph. Returns the cycle path or null. */
export function detectCycle(graph: Map<string, Set<string>>): string[] | null {
  const WHITE = 0, GRAY = 1, BLACK = 2
  const color = new Map<string, number>()
  const parent = new Map<string, string | null>()

  for (const node of graph.keys()) color.set(node, WHITE)

  for (const node of graph.keys()) {
    if (color.get(node) === WHITE) {
      const cycle = dfs(node, graph, color, parent)
      if (cycle) return cycle
    }
  }
  return null
}

function dfs(
  node: string,
  graph: Map<string, Set<string>>,
  color: Map<string, number>,
  parent: Map<string, string | null>,
): string[] | null {
  const WHITE = 0, GRAY = 1, BLACK = 2
  color.set(node, GRAY)

  for (const dep of graph.get(node) ?? []) {
    if (color.get(dep) === GRAY) {
      // Found a cycle — reconstruct path
      const path = [dep, node]
      let cur = node
      while (parent.get(cur) && parent.get(cur) !== dep) {
        cur = parent.get(cur)!
        path.push(cur)
      }
      path.reverse()
      return path
    }
    if (color.get(dep) === WHITE) {
      parent.set(dep, node)
      const cycle = dfs(dep, graph, color, parent)
      if (cycle) return cycle
    }
  }

  color.set(node, BLACK)
  return null
}

/** Topological sort into execution groups. Steps in the same group can run in parallel. */
export function toExecutionGroups(graph: Map<string, Set<string>>): string[][] {
  const inDegree = new Map<string, number>()
  for (const node of graph.keys()) inDegree.set(node, 0)

  for (const deps of graph.values()) {
    for (const dep of deps) {
      // dep is depended on — but inDegree tracks how many deps each node has
    }
  }

  // In our graph, edges go from step → its dependencies.
  // For Kahn's, we need: a node is ready when all its deps are done.
  // So inDegree[node] = number of dependencies it has.
  for (const [node, deps] of graph) {
    inDegree.set(node, deps.size)
  }

  const groups: string[][] = []
  const done = new Set<string>()

  while (done.size < graph.size) {
    const ready: string[] = []
    for (const [node, degree] of inDegree) {
      if (!done.has(node) && degree === 0) ready.push(node)
    }

    if (ready.length === 0) {
      throw new Error('Cycle detected in dependency graph')
    }

    groups.push(ready.sort())

    for (const node of ready) {
      done.add(node)
      // Reduce inDegree for nodes that depend on this one
      for (const [other, deps] of graph) {
        if (deps.has(node) && !done.has(other)) {
          inDegree.set(other, (inDegree.get(other) ?? 0) - 1)
        }
      }
    }
  }

  return groups
}

/** Resolve template references in a prompt string. */
export function resolvePrompt(
  template: string,
  outputs: Map<string, string>,
  input: string,
): string {
  return template.replace(TEMPLATE_REF, (_match, ref: string) => {
    if (ref === 'input') return input
    const output = outputs.get(ref)
    if (output === undefined) throw new Error(`Missing output for step "{{${ref}}}"`)
    return output
  })
}

/** Get all transitive dependents of a step (steps that directly or indirectly depend on it). */
export function getTransitiveDependents(
  stepName: string,
  graph: Map<string, Set<string>>,
): Set<string> {
  const dependents = new Set<string>()
  const queue = [stepName]

  while (queue.length > 0) {
    const current = queue.shift()!
    for (const [node, deps] of graph) {
      if (deps.has(current) && !dependents.has(node)) {
        dependents.add(node)
        queue.push(node)
      }
    }
  }

  return dependents
}
