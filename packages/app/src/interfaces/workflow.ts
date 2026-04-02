/**
 * Workflow CLI interface — `ra workflow run <path> [prompt]`
 *
 * Lightweight bootstrap: no sessions, no MCP, no memory, no skills.
 * Each team member agent gets: provider + builtin tools + config.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import yaml from 'js-yaml'
import { ToolRegistry, createProvider, buildProviderConfig, NoopLogger } from '@chinmaymk/ra'
import type { AgentLoopOptions, Logger } from '@chinmaymk/ra'
import { runWorkflow } from '@chinmaymk/ra-workflow'
import type { WorkflowDefinition, WorkflowResult, AgentFactory } from '@chinmaymk/ra-workflow'
import { loadConfig } from '../config'
import { registerBuiltinTools } from '../tools'

interface WorkflowFileContent {
  name?: string
  team?: Record<string, string>
  steps?: Array<{ name?: string; agent?: string; prompt?: string }>
  settings?: { maxRounds?: number; maxTokenBudget?: number; maxDuration?: number }
}

function parseWorkflowFile(filePath: string): WorkflowDefinition {
  const absPath = resolve(filePath)
  const raw = readFileSync(absPath, 'utf-8')
  const parsed = yaml.load(raw) as WorkflowFileContent

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid workflow file: ${absPath}`)
  }
  if (!parsed.name) throw new Error('Workflow file must have a "name" field')
  if (!parsed.team || Object.keys(parsed.team).length === 0) throw new Error('Workflow file must have a "team" section')
  if (!parsed.steps || parsed.steps.length === 0) throw new Error('Workflow file must have a "steps" section')

  for (const step of parsed.steps) {
    if (!step.name) throw new Error('Each step must have a "name" field')
    if (!step.agent) throw new Error(`Step "${step.name}" must have an "agent" field`)
    if (!step.prompt) throw new Error(`Step "${step.name}" must have a "prompt" field`)
  }

  return {
    name: parsed.name,
    team: parsed.team,
    steps: parsed.steps as WorkflowDefinition['steps'],
    settings: parsed.settings,
  }
}

function createAgentFactory(
  team: Record<string, string>,
  workflowDir: string,
): AgentFactory {
  const cache = new Map<string, AgentLoopOptions>()

  return async (teamKey: string) => {
    const cached = cache.get(teamKey)
    if (cached) return cached

    const configPath = team[teamKey]
    if (!configPath) throw new Error(`Unknown team member: "${teamKey}"`)

    const absConfigPath = resolve(workflowDir, configPath)
    const config = await loadConfig({
      cwd: dirname(absConfigPath),
      configPath: absConfigPath,
      env: process.env as Record<string, string | undefined>,
    })

    const providers = config.app.providers as unknown as Record<string, Record<string, unknown>>
    const providerConfig = buildProviderConfig(
      config.agent.provider,
      providers[config.agent.provider] ?? {},
    )
    const provider = createProvider(providerConfig)

    const tools = new ToolRegistry()
    if (config.agent.tools.builtin) {
      registerBuiltinTools(tools, config.agent.tools)
    }

    const opts: AgentLoopOptions = {
      provider,
      tools,
      model: config.agent.model,
      maxIterations: config.agent.maxIterations,
      thinking: config.agent.thinking,
      thinkingBudgetCap: config.agent.thinkingBudgetCap,
      compaction: config.agent.compaction,
      toolTimeout: config.agent.toolTimeout,
      maxToolResponseSize: config.agent.tools.maxResponseSize,
      parallelToolCalls: config.agent.parallelToolCalls,
      ...(config.agent.systemPrompt && {
        middleware: {
          beforeModelCall: [async (ctx) => {
            // Inject system prompt if not already present
            if (!ctx.request.messages.some(m => m.role === 'system')) {
              ctx.request.messages.unshift({ role: 'system', content: config.agent.systemPrompt })
            }
          }],
        },
      }),
    }

    cache.set(teamKey, opts)
    return opts
  }
}

/** Entry point for `ra workflow run <path> [prompt]` */
export async function runWorkflowCommand(workflowPath: string, input: string): Promise<void> {
  const absPath = resolve(workflowPath)
  const workflowDir = dirname(absPath)
  const definition = parseWorkflowFile(absPath)
  const agentFactory = createAgentFactory(definition.team, workflowDir)

  const controller = new AbortController()
  process.on('SIGINT', () => controller.abort())
  process.on('SIGTERM', () => controller.abort())

  process.stderr.write(`Workflow: ${definition.name}\n`)
  process.stderr.write(`Steps: ${definition.steps.map(s => s.name).join(' → ')}\n`)
  process.stderr.write(`Input: ${input || '(none)'}\n\n`)

  const logger = new ConsoleWorkflowLogger()

  const result = await runWorkflow({
    definition,
    agentFactory,
    input,
    logger,
    signal: controller.signal,
  })

  // Print results
  process.stderr.write('\n')
  if (result.stopReason) {
    process.stderr.write(`Stopped: ${result.stopReason}\n`)
  }
  process.stderr.write(`Duration: ${(result.totalDurationMs / 1000).toFixed(1)}s\n`)
  process.stderr.write(`Tokens: ${result.totalUsage.inputTokens + result.totalUsage.outputTokens}\n\n`)

  // Print the final step's output to stdout
  const lastStep = result.steps.at(-1)
  if (lastStep) {
    process.stdout.write(lastStep.output)
    process.stdout.write('\n')
  }
}

/** Simple stderr logger for workflow progress. */
class ConsoleWorkflowLogger implements Logger {
  debug() {}

  info(message: string, data?: Record<string, unknown>) {
    if (message === 'step_start') {
      const { step, round } = data as { step: string; round: number }
      process.stderr.write(`  [${step}] running${round > 1 ? ` (round ${round})` : ''}...\n`)
    } else if (message === 'step_complete') {
      const { step, durationMs, usage } = data as { step: string; durationMs: number; usage: { inputTokens: number; outputTokens: number } }
      process.stderr.write(`  [${step}] done (${(durationMs / 1000).toFixed(1)}s, ${usage.inputTokens + usage.outputTokens} tokens)\n`)
    } else if (message === 'step_revision') {
      const { fromStep, targetStep } = data as { fromStep: string; targetStep: string }
      process.stderr.write(`  [${fromStep}] → revision requested: ${targetStep}\n`)
    } else if (message === 'step_skipped') {
      const { step, reason } = data as { step: string; reason: string }
      process.stderr.write(`  [${step}] skipped (${reason})\n`)
    }
  }

  warn(message: string, data?: Record<string, unknown>) {
    process.stderr.write(`  warn: ${message} ${JSON.stringify(data)}\n`)
  }

  error(message: string, data?: Record<string, unknown>) {
    process.stderr.write(`  error: ${message} ${JSON.stringify(data)}\n`)
  }

  async flush() {}
}
