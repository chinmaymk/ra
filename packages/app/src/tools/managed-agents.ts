import yaml from 'js-yaml'
import type { ITool, Logger } from '@chinmaymk/ra'
import { createServer, type AddressInfo } from 'node:net'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

interface ManagedAgent {
  name: string
  port: number
  process: ReturnType<typeof Bun.spawn>
  sessionId: string | undefined
  dir: string
  instructions: string
}

export interface ManagedAgentOptions {
  dataDir: string
  defaultModel: string
  defaultProvider: string
  maxAgents?: number
  logger?: Logger
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      server.close(() => resolve(addr.port))
    })
    server.on('error', reject)
  })
}

function getRaCommand(): { command: string; baseArgs: string[] } {
  const isDevMode = /\.(ts|js|mjs|cjs)$/.test(process.argv[1] ?? '')
  return isDevMode
    ? { command: process.argv[0]!, baseArgs: [process.argv[1]!] }
    : { command: process.argv[0]!, baseArgs: [] }
}

async function waitForReady(port: number, timeoutMs = 30000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/sessions`, {
        signal: AbortSignal.timeout(2000),
      })
      if (res.ok) return
    } catch {
      await new Promise(r => setTimeout(r, 500))
    }
  }
  throw new Error(`Agent HTTP server failed to become ready within ${timeoutMs}ms`)
}

export function managedAgentTools(options: ManagedAgentOptions): { tools: ITool[]; shutdown: () => Promise<void> } {
  const agents = new Map<string, ManagedAgent>()
  const maxAgents = options.maxAgents ?? 4
  const log = options.logger

  const killAll = () => {
    for (const agent of agents.values()) {
      agent.process.kill()
    }
    agents.clear()
  }

  const shutdown = async () => {
    killAll()
  }

  process.on('exit', killAll)

  // ── CreateAgent ────────────────────────────────────────────────────

  const createAgent: ITool = {
    name: 'CreateAgent',
    description:
      'Create and start a new persistent agent process with its own configuration, system prompt, and optional skills. ' +
      'The agent runs as a separate ra instance with an HTTP interface and maintains conversation state across messages. ' +
      'Use this to spawn long-lived specialist agents (e.g. a security auditor, a test writer). ' +
      'After creation, use MessageAgent to talk to it and DestroyAgent to stop it.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Unique name for this agent (lowercase alphanumeric and hyphens). Used to reference it in MessageAgent and DestroyAgent.',
        },
        instructions: {
          type: 'string',
          description: 'System prompt that defines the agent\'s role, expertise, and behavior. This is the core of the agent\'s identity.',
        },
        model: {
          type: 'string',
          description: 'Model to use. Defaults to the parent agent\'s model.',
        },
        provider: {
          type: 'string',
          description: 'Provider to use (anthropic, openai, google, ollama, bedrock, azure). Defaults to the parent agent\'s provider.',
        },
        skills: {
          type: 'array',
          description: 'Optional inline skill definitions that are written as SKILL.md files for the agent.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Skill name (lowercase with hyphens).' },
              description: { type: 'string', description: 'One-line description of the skill.' },
              content: { type: 'string', description: 'Skill body in markdown (without frontmatter — that is generated automatically).' },
            },
            required: ['name', 'description', 'content'],
          },
        },
      },
      required: ['name', 'instructions'],
    },
    async execute(input: unknown) {
      const { name, instructions, model, provider, skills } = input as {
        name: string
        instructions: string
        model?: string
        provider?: string
        skills?: { name: string; description: string; content: string }[]
      }

      if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
        throw new Error('Agent name must be lowercase alphanumeric with hyphens, starting with a letter or digit.')
      }
      if (agents.has(name)) {
        throw new Error(`Agent "${name}" already exists. Destroy it first or choose a different name.`)
      }
      if (agents.size >= maxAgents) {
        const existing = [...agents.keys()].join(', ')
        throw new Error(`Maximum ${maxAgents} agents reached (${existing}). Destroy one first.`)
      }

      const agentDir = join(options.dataDir, 'agents', name)
      await mkdir(agentDir, { recursive: true })

      // Write skill files
      const skillNames: string[] = []
      if (skills?.length) {
        for (const skill of skills) {
          const skillDir = join(agentDir, 'skills', skill.name)
          await mkdir(skillDir, { recursive: true })
          const frontmatter = `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n`
          await writeFile(join(skillDir, 'SKILL.md'), frontmatter + skill.content, 'utf-8')
          skillNames.push(skill.name)
        }
      }

      const port = await findFreePort()
      const agentModel = model ?? options.defaultModel
      const agentProvider = provider ?? options.defaultProvider

      const config: Record<string, unknown> = {
        app: {
          interface: 'http',
          http: { port },
          dataDir: join(agentDir, '.ra'),
          ...(skillNames.length > 0 ? { skillDirs: ['./skills'], skills: skillNames } : {}),
        },
        agent: {
          provider: agentProvider,
          model: agentModel,
          systemPrompt: instructions,
          maxIterations: 50,
          tools: { builtin: true },
          compaction: { enabled: true, threshold: 0.8 },
        },
      }

      const configPath = join(agentDir, 'ra.config.yaml')
      await writeFile(configPath, yaml.dump(config, { lineWidth: -1 }), 'utf-8')

      // Spawn ra process
      const { command, baseArgs } = getRaCommand()
      const proc = Bun.spawn([command, ...baseArgs, '--config', configPath], {
        cwd: agentDir,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env },
      })

      try {
        await waitForReady(port)
      } catch {
        proc.kill()
        await rm(agentDir, { recursive: true, force: true }).catch(() => {})
        throw new Error(`Failed to start agent "${name}". The process exited before the HTTP server became ready.`)
      }

      agents.set(name, { name, port, process: proc, sessionId: undefined, dir: agentDir, instructions })
      log?.info('managed agent created', { name, port, model: agentModel, provider: agentProvider, skills: skillNames })

      return [
        `Agent "${name}" created and running.`,
        `  Model: ${agentModel}`,
        `  Provider: ${agentProvider}`,
        `  Port: ${port}`,
        skillNames.length > 0 ? `  Skills: ${skillNames.join(', ')}` : null,
        '',
        'Use MessageAgent to send it messages.',
      ].filter(Boolean).join('\n')
    },
  }

  // ── MessageAgent ───────────────────────────────────────────────────

  const messageAgent: ITool = {
    name: 'MessageAgent',
    description:
      'Send a message to a running persistent agent and receive its response. ' +
      'The agent maintains full conversation history — each message builds on previous ones. ' +
      'The agent can use tools (file I/O, shell, search) to complete its work before responding.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: 'Name of the agent to message (as specified in CreateAgent).',
        },
        message: {
          type: 'string',
          description: 'The message to send. Be specific — include file paths, requirements, and expected output format.',
        },
      },
      required: ['agent', 'message'],
    },
    async execute(input: unknown) {
      const { agent: agentName, message } = input as { agent: string; message: string }

      const agent = agents.get(agentName)
      if (!agent) {
        const existing = agents.size > 0 ? ` Running agents: ${[...agents.keys()].join(', ')}` : ' No agents are running.'
        throw new Error(`Agent "${agentName}" not found.${existing}`)
      }

      // Check if process is still alive
      if (agent.process.exitCode !== null) {
        agents.delete(agentName)
        throw new Error(`Agent "${agentName}" has exited (code ${agent.process.exitCode}). Create a new one.`)
      }

      const body: Record<string, unknown> = {
        messages: [{ role: 'user', content: message }],
      }
      if (agent.sessionId) {
        body.sessionId = agent.sessionId
      }

      const res = await fetch(`http://127.0.0.1:${agent.port}/chat/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const text = await res.text().catch(() => 'unknown error')
        throw new Error(`Agent "${agentName}" returned HTTP ${res.status}: ${text}`)
      }

      const result = await res.json() as { response: string; sessionId: string }
      agent.sessionId = result.sessionId

      log?.info('managed agent messaged', { name: agentName, sessionId: result.sessionId })

      return result.response
    },
  }

  // ── ListAgents ─────────────────────────────────────────────────────

  const listAgents: ITool = {
    name: 'ListAgents',
    description: 'List all running persistent agents with their status, model, and port.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    async execute() {
      if (agents.size === 0) return 'No agents are running.'

      const lines: string[] = []
      for (const agent of agents.values()) {
        const alive = agent.process.exitCode === null
        const status = alive ? 'running' : `exited (code ${agent.process.exitCode})`
        lines.push(`- ${agent.name}: ${status}, port ${agent.port}`)
        if (!alive) agents.delete(agent.name)
      }
      return lines.join('\n')
    },
  }

  // ── DestroyAgent ───────────────────────────────────────────────────

  const destroyAgent: ITool = {
    name: 'DestroyAgent',
    description:
      'Stop and remove a persistent agent. Kills the process and cleans up its configuration directory. ' +
      'Use this when an agent is no longer needed.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: 'Name of the agent to destroy.',
        },
      },
      required: ['agent'],
    },
    async execute(input: unknown) {
      const { agent: agentName } = input as { agent: string }

      const agent = agents.get(agentName)
      if (!agent) {
        throw new Error(`Agent "${agentName}" not found.`)
      }

      agent.process.kill()
      agents.delete(agentName)
      await rm(agent.dir, { recursive: true, force: true }).catch(() => {})

      log?.info('managed agent destroyed', { name: agentName })
      return `Agent "${agentName}" destroyed.`
    },
  }

  return {
    tools: [createAgent, messageAgent, listAgents, destroyAgent],
    shutdown,
  }
}
