import type { RaConfig } from './types'

export const defaultConfig: RaConfig = {
  app: {
    interface: 'repl',
    configDir: process.cwd(),
    dataDir: '',
    http: { port: 3000, token: '' },
    inspector: { port: 3002 },
    storage: {
      format: 'jsonl',
      maxSessions: 100,
      ttlDays: 30,
    },
    // Per-provider credentials and connection options. Empty-string apiKeys
    // are placeholders satisfying the underlying SDK types — they get filled
    // in by standard env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, ...)
    // or the secrets store at `~/.ra/secrets.json`, both wired through
    // parse-args. See `interfaces/parse-args.ts` (`STANDARD_ENV`) for the
    // complete mapping. If both env and secrets are empty, the provider's
    // own SDK throws when first invoked, surfacing the missing credential.
    providers: {
      anthropic: { apiKey: '' },
      openai: { apiKey: '' },
      'openai-completions': { apiKey: '' },
      google: { apiKey: '' },
      ollama: { host: 'http://localhost:11434' },
      bedrock: { region: 'us-east-1' },
      azure: { endpoint: '', deployment: '' },
      codex: { accessToken: '' },
      'anthropic-agents-sdk': {},
    },
    mcpServers: [],
    mcpLazySchemas: true,
    raMcpServer: {
      enabled: false,
      port: 3001,
      tool: {
        name: 'ra',
        description: 'Ra AI agent',
      },
    },
    logsEnabled: true,
    logLevel: 'info',
    tracesEnabled: true,
  },
  agent: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    systemPrompt: 'You are a helpful AI assistant.',
    maxIterations: 0,
    maxRetries: 3,
    toolTimeout: 120000,
    maxConcurrency: 4,
    parallelToolCalls: true,
    maxTokenBudget: 0,
    maxDuration: 0,
    hotReload: true,
    tools: {
      builtin: true,
      overrides: {},
      custom: [],
      maxResponseSize: 25000,
    },
    skillDirs: ['.claude/skills', '.agents/skills', '.opencode/skills'],
    permissions: {},
    middleware: {},
    context: {
      enabled: true,
      patterns: [
        'CLAUDE.md',
        'AGENTS.md',
        '.cursorrules',
        '.windsurfrules',
        '.github/copilot-instructions.md',
      ],
      resolvers: [
        { name: 'file', enabled: true },
        { name: 'url', enabled: true },
      ],
      subdirectoryWalk: true,
    },
    compaction: {
      enabled: true,
      threshold: 0.90,
      strategy: 'truncate',
    },
    memory: {
      enabled: false,
      maxMemories: 1000,
      ttlDays: 90,
      injectLimit: 5,
    },
  },
}
