import type { RaConfig } from './types'

export const defaultConfig: RaConfig = {
  app: {
    interface: 'repl',
    configDir: process.cwd(),
    dataDir: '.ra',
    http: { port: 3000, token: '' },
    inspector: { port: 3002 },
    storage: {
      format: 'jsonl',
      maxSessions: 100,
      ttlDays: 30,
    },
    providers: {
      anthropic: { apiKey: '${ANTHROPIC_API_KEY:-}' },
      openai: { apiKey: '${OPENAI_API_KEY:-}' },
      'openai-completions': { apiKey: '${OPENAI_API_KEY:-}' },
      google: { apiKey: '${GOOGLE_API_KEY:-}' },
      ollama: { host: '${OLLAMA_HOST:-http://localhost:11434}' },
      bedrock: { region: '${AWS_REGION:-us-east-1}' },
      azure: { endpoint: '${AZURE_OPENAI_ENDPOINT:-}', deployment: '${AZURE_OPENAI_DEPLOYMENT:-}', apiKey: '${AZURE_OPENAI_API_KEY:-}' },
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
    maxIterations: 50,
    maxRetries: 3,
    toolTimeout: 30000,
    maxConcurrency: 4,
    parallelToolCalls: true,
    maxTokenBudget: 0,
    maxDuration: 0,
    tools: {
      builtin: true,
      overrides: {},
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
      threshold: 0.80,
    },
    memory: {
      enabled: false,
      maxMemories: 1000,
      ttlDays: 90,
      injectLimit: 5,
    },
  },
}
