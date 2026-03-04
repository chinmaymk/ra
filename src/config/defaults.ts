import type { RaConfig } from './types'

export const defaultConfig: RaConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  interface: 'repl',
  systemPrompt: 'You are a helpful AI assistant.',
  http: { port: 3000, token: '' },
  skills: [],
  alwaysLoad: [],
  mcp: {
    client: [],
    server: {
      enabled: false,
      transport: 'http' as const,
      port: 3001,
      tool: {
        name: 'ra',
        description: 'Ra AI agent',
        inputSchema: {},
      },
    },
  },
  providers: {
    anthropic: { apiKey: '' },
    openai: { apiKey: '' },
    google: { apiKey: '' },
    ollama: { host: 'http://localhost:11434' },
  },
  storage: {
    path: '.ra/sessions',
    format: 'jsonl',
    maxSessions: 100,
    ttlDays: 30,
  },
  maxIterations: 50,
  middleware: {},
}
