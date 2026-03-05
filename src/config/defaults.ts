import type { RaConfig } from './types'

export const defaultConfig: RaConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  interface: 'repl',
  systemPrompt: 'You are a helpful AI assistant.',
  http: { port: 3000, token: '' },
  skillDirs: [],
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
    path: '.ra/sessions',
    format: 'jsonl',
    maxSessions: 100,
    ttlDays: 30,
  },
  maxIterations: 50,
  toolTimeout: 30000,
  builtinTools: false,
  middleware: {},
  compaction: {
    enabled: true,
    threshold: 0.80,
  },
}
