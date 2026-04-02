import {
  AgentLoop,
  ToolRegistry,
  accumulateUsage,
  extractTextContent,
  NoopLogger,
} from '@chinmaymk/ra'
import type { TokenUsage, Logger } from '@chinmaymk/ra'
import type {
  WorkflowRunnerOptions,
  WorkflowResult,
  StepResult,
  WorkflowStep,
  RevisionRequest,
} from './types'
import { buildDependencyGraph, detectCycle, toExecutionGroups, resolvePrompt, getTransitiveDependents } from './graph'
import { createRevisionTool, extractRevisionRequests } from './tools'

const DEFAULT_MAX_ROUNDS = 3

export async function runWorkflow(options: WorkflowRunnerOptions): Promise<WorkflowResult> {
  const { definition, agentFactory, input, signal } = options
  const logger: Logger = options.logger ?? new NoopLogger()
  const settings = definition.settings ?? {}
  const maxRounds = settings.maxRounds ?? DEFAULT_MAX_ROUNDS
  const maxTokenBudget = settings.maxTokenBudget ?? 0
  const maxDuration = settings.maxDuration ?? 0

  const startTime = Date.now()

  // ── Validate ────────────────────────────────────────────────────────
  const graph = buildDependencyGraph(definition.steps)
  const cycle = detectCycle(graph)
  if (cycle) {
    throw new Error(`Cycle detected in workflow: ${cycle.join(' → ')}`)
  }

  const stepMap = new Map(definition.steps.map(s => [s.name, s]))
  const executionGroups = toExecutionGroups(graph)

  logger.info('workflow_start', {
    name: definition.name,
    stepCount: definition.steps.length,
    groups: executionGroups.length,
    settings: { maxRounds, maxTokenBudget, maxDuration },
  })

  // ── State ───────────────────────────────────────────────────────────
  const outputs = new Map<string, string>()
  const roundCounts = new Map<string, number>()
  const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 }
  const stepResults: StepResult[] = []
  const feedbackMap = new Map<string, string>()
  let stopReason: WorkflowResult['stopReason']

  // ── Execute ─────────────────────────────────────────────────────────
  let pendingGroups = [...executionGroups]

  while (pendingGroups.length > 0) {
    if (signal?.aborted) {
      stopReason = 'aborted'
      break
    }

    const group = pendingGroups.shift()!
    const stepsToRun = group.map(name => stepMap.get(name)!).filter(Boolean)

    const groupRevisions: RevisionRequest[] = []

    const results = await Promise.all(
      stepsToRun.map(async (step) => {
        // Budget checks
        if (maxTokenBudget > 0 && (totalUsage.inputTokens + totalUsage.outputTokens) >= maxTokenBudget) {
          logger.info('step_skipped', { step: step.name, reason: 'token_budget_exceeded' })
          return null
        }
        if (maxDuration > 0 && (Date.now() - startTime) >= maxDuration) {
          logger.info('step_skipped', { step: step.name, reason: 'max_duration_exceeded' })
          return null
        }

        const round = (roundCounts.get(step.name) ?? 0) + 1
        if (round > maxRounds) {
          logger.info('step_skipped', { step: step.name, reason: 'max_rounds_exceeded', round })
          return null
        }

        roundCounts.set(step.name, round)
        return executeStep(step, round, feedbackMap.get(step.name))
      }),
    )

    // Check if any budget was exceeded during execution
    if (maxTokenBudget > 0 && (totalUsage.inputTokens + totalUsage.outputTokens) >= maxTokenBudget) {
      stopReason = 'token_budget_exceeded'
    }
    if (maxDuration > 0 && (Date.now() - startTime) >= maxDuration) {
      stopReason = 'max_duration_exceeded'
    }

    // Process results
    for (const result of results) {
      if (!result) continue
      groupRevisions.push(...result.revisions)
    }

    if (stopReason) break

    // Handle revisions
    if (groupRevisions.length > 0) {
      const revisedSteps = handleRevisions(groupRevisions, graph, roundCounts, maxRounds, logger, feedbackMap)
      if (revisedSteps.size > 0) {
        const revisionGroups = computeRevisionGroups(revisedSteps, graph)
        pendingGroups = [...revisionGroups, ...pendingGroups]
      }
    }
  }

  const totalDurationMs = Date.now() - startTime

  logger.info('workflow_complete', {
    totalDurationMs,
    totalUsage,
    stepCount: stepResults.length,
    stopReason,
  })

  return {
    name: definition.name,
    steps: stepResults,
    totalUsage,
    totalDurationMs,
    ...(stopReason && { stopReason }),
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  async function executeStep(
    step: WorkflowStep,
    round: number,
    feedback: string | undefined,
  ): Promise<{ revisions: RevisionRequest[] } | null> {
    const stepStart = Date.now()

    logger.info('step_start', { step: step.name, agent: step.agent, round, group: 0 })

    // Build agent
    const agentOpts = await agentFactory(step.agent)

    // Clone tools and add revision tool if applicable
    const tools = new ToolRegistry()
    for (const tool of agentOpts.tools.all()) {
      tools.register(tool)
    }

    // Valid revision targets: all completed steps before this one
    const validTargets = [...outputs.keys()].filter(name => name !== step.name)
    if (validTargets.length > 0) {
      tools.register(createRevisionTool(validTargets))
    }

    // Resolve prompt
    let prompt = resolvePrompt(step.prompt, outputs, input)
    if (round > 1 && feedback) {
      prompt += `\n\n---\n\n**Revision feedback (round ${round}):**\n${feedback}`
    }

    // Run agent loop
    const loop = new AgentLoop({
      ...agentOpts,
      tools,
      logger,
    })

    const result = await loop.run([{ role: 'user', content: prompt }])

    // Accumulate usage
    accumulateUsage(totalUsage, result.usage)

    // Extract output from last assistant message
    const lastAssistant = [...result.messages].reverse().find(m => m.role === 'assistant')
    const output = lastAssistant ? extractTextContent(lastAssistant.content) : ''

    outputs.set(step.name, output)

    const durationMs = Date.now() - stepStart
    const stepResult: StepResult = {
      step: step.name,
      output,
      round,
      usage: result.usage,
      durationMs,
    }
    stepResults.push(stepResult)

    logger.info('step_complete', {
      step: step.name,
      round,
      durationMs,
      usage: result.usage,
      outputLength: output.length,
    })

    // Extract revision requests
    const revisions = extractRevisionRequests(result.messages)
    for (const rev of revisions) {
      logger.info('step_revision', {
        fromStep: step.name,
        targetStep: rev.targetStep,
        feedback: rev.feedback.slice(0, 200),
      })
    }

    return { revisions }
  }
}

function handleRevisions(
  revisions: RevisionRequest[],
  graph: Map<string, Set<string>>,
  roundCounts: Map<string, number>,
  maxRounds: number,
  logger: Logger,
  feedbackMap: Map<string, string>,
): Set<string> {
  const stepsToRerun = new Set<string>()

  // Deduplicate by target, concatenate feedback
  const byTarget = new Map<string, string[]>()
  for (const rev of revisions) {
    const existing = byTarget.get(rev.targetStep) ?? []
    existing.push(rev.feedback)
    byTarget.set(rev.targetStep, existing)
  }

  for (const [target, feedbacks] of byTarget) {
    const currentRound = roundCounts.get(target) ?? 0
    if (currentRound >= maxRounds) {
      logger.warn('revision_skipped', {
        step: target,
        reason: 'max_rounds_exceeded',
        round: currentRound,
      })
      continue
    }

    // Store feedback for the target step
    feedbackMap.set(target, feedbacks.join('\n\n'))
    stepsToRerun.add(target)

    // Add transitive dependents
    const dependents = getTransitiveDependents(target, graph)
    for (const dep of dependents) {
      stepsToRerun.add(dep)
    }
  }

  return stepsToRerun
}

/** Compute execution groups for a set of steps that need re-running, respecting dependency order. */
function computeRevisionGroups(
  stepsToRerun: Set<string>,
  graph: Map<string, Set<string>>,
): string[][] {
  // Build a subgraph of only the steps that need re-running
  const subgraph = new Map<string, Set<string>>()
  for (const step of stepsToRerun) {
    const deps = graph.get(step) ?? new Set()
    // Only include deps that are also being re-run
    const filteredDeps = new Set([...deps].filter(d => stepsToRerun.has(d)))
    subgraph.set(step, filteredDeps)
  }

  return toExecutionGroups(subgraph)
}
