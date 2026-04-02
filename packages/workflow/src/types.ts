import type { AgentLoopOptions, TokenUsage, Logger } from '@chinmaymk/ra'

export interface WorkflowDefinition {
  name: string
  team: Record<string, string>
  steps: WorkflowStep[]
  settings?: WorkflowSettings
}

export interface WorkflowStep {
  name: string
  agent: string
  prompt: string
}

export interface WorkflowSettings {
  maxRounds?: number
  maxTokenBudget?: number
  maxDuration?: number
}

export interface RevisionRequest {
  targetStep: string
  feedback: string
}

export interface StepResult {
  step: string
  output: string
  round: number
  usage: TokenUsage
  durationMs: number
}

export interface WorkflowResult {
  name: string
  steps: StepResult[]
  totalUsage: TokenUsage
  totalDurationMs: number
  stopReason?: 'token_budget_exceeded' | 'max_duration_exceeded' | 'aborted'
}

export type AgentFactory = (teamKey: string) => Promise<AgentLoopOptions>

export interface WorkflowRunnerOptions {
  definition: WorkflowDefinition
  agentFactory: AgentFactory
  input: string
  logger?: Logger
  signal?: AbortSignal
}
