import type { RaConfig } from '../config/types'
import type { SandboxConfig } from './types'

/** Extract a serializable SandboxConfig from a full RaConfig. */
export function buildSandboxConfig(config: RaConfig): SandboxConfig {
  const { app, agent } = config
  return {
    provider: agent.provider,
    providerOptions: (app.providers[agent.provider] ?? {}) as Record<string, unknown>,
    model: agent.model,
    systemPrompt: agent.systemPrompt,
    maxIterations: agent.maxIterations,
    maxRetries: agent.maxRetries,
    toolTimeout: agent.toolTimeout,
    parallelToolCalls: agent.parallelToolCalls,
    maxTokenBudget: agent.maxTokenBudget,
    maxDuration: agent.maxDuration,
    maxToolResponseSize: agent.tools.maxResponseSize ?? 25000,
    thinking: agent.thinking,
    thinkingBudgetCap: agent.thinkingBudgetCap,
    compaction: {
      enabled: agent.compaction.enabled,
      threshold: agent.compaction.threshold,
      strategy: agent.compaction.strategy,
      maxTokens: agent.compaction.maxTokens,
      contextWindow: agent.compaction.contextWindow,
      model: agent.compaction.model,
      prompt: agent.compaction.prompt,
    },
    tools: {
      builtin: agent.tools.builtin,
      overrides: agent.tools.overrides,
    },
    permissions: agent.permissions,
    middleware: agent.middleware,
    configDir: app.configDir,
  }
}
