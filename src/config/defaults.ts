import type { RaConfig } from './types'

export const defaultConfig: RaConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  interface: 'repl',
  systemPrompt: 'You are a helpful AI assistant.',
  configDir: process.cwd(),
  dataDir: '.ra',
  http: { port: 3000, token: '' },
  inspector: { port: 3002 },
  skillDirs: ['.claude/skills', '.agents/skills', '.opencode/skills'],
  skills: [],
  mcp: {
    client: [],
    server: {
      enabled: false,
      port: 3001,
      tool: {
        name: 'ra',
        description: 'Ra AI agent',
      },
    },
    lazySchemas: true,
  },
  providers: {
    anthropic: { apiKey: '' },
    openai: { apiKey: '' },
    google: { apiKey: '' },
    ollama: { host: 'http://localhost:11434' },
    bedrock: { region: 'us-east-1' },
    azure: { endpoint: '', deployment: '', apiKey: '' },
  },
  storage: {
    format: 'jsonl',
    maxSessions: 100,
    ttlDays: 30,
  },
  maxIterations: 50,
  toolTimeout: 30000,
  tools: {
    builtin: true,
    overrides: {},
  },
  builtinSkills: {},
  permissions: {},
  middleware: {},
  maxConcurrency: 4,
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
  logsEnabled: true,
  logLevel: 'info',
  tracesEnabled: true,
}
