export const HELP = `
ra - AI agent CLI

USAGE
  ra [options] [prompt]

OPTIONS
  --provider <name>                   Provider (anthropic, openai, google, ollama)
  --model <name>                      Model name
  --system-prompt <text>              System prompt text or path to file
  --max-iterations <n>                Max agent loop iterations
  --config <path>                     Path to config file
  --skill <name>                      Skill to activate for this run (repeatable)
  --skill-dir <path>                  Directory to load skills from (repeatable)
  --file <path>                       File to attach (repeatable)
  --resume                            Resume the most recent session
  --resume=<session-id>               Resume a specific session by ID

INTERFACE
  --cli                               Oneshot mode: run prompt and exit
  --repl                              Interactive REPL mode (default)
  --http                              Start HTTP API server
  --mcp                               Start MCP HTTP server (default port: 3001)
  --mcp-stdio                         Start MCP stdio server (for Claude Desktop/Cursor)
  --inspector                         Start web inspector for sessions & memory

HTTP SERVER
  --http-port <port>                  HTTP server port (default: 3000)
  --http-token <token>                Bearer token for HTTP auth

INSPECTOR
  --inspector-port <port>             Inspector server port (default: 3002)

MCP SERVER
  --mcp-server-enabled                Enable MCP HTTP server alongside main interface
  --mcp-server-tool-name <name>       MCP tool name
  --mcp-server-tool-description <d>   MCP tool description

MEMORY
  --memory                            Enable persistent memory across conversations
  --list-memories                     List all stored memories
  --memories <query>                  Search memories by keyword
  --forget <query>                    Forget memories matching query

DATA & STORAGE
  --data-dir <path>                   Root directory for all runtime data (default: .ra)
  --storage-max-sessions <n>          Max stored sessions
  --storage-ttl-days <n>              Session TTL in days

THINKING
  --thinking <level>                  Enable extended thinking: low | medium | high

PROVIDER OPTIONS
  --anthropic-base-url <url>          Anthropic API base URL
  --openai-base-url <url>             OpenAI API base URL
  --ollama-host <url>                 Ollama host URL

  --builtin-tools                     Enable built-in tools (filesystem, shell, network)
  --show-context                      Show discovered context files and exit
  --show-config                       Show resolved configuration and exit
  --exec <script>                     Execute a JS/TS file and exit
  --version, -v                       Print version and exit
  --help, -h                          Print this help message

SKILL MANAGEMENT
  ra skill install <source>           Install skill from npm, GitHub, or URL
  ra skill remove <name>              Remove an installed skill
  ra skill list                       List installed skills

  Sources:
    ra skill install code-review             npm package "code-review"
    ra skill install npm:ra-skill-lint@1.0   npm with version
    ra skill install github:user/repo        GitHub repository
    ra skill install https://example.com/s.tgz  URL tarball

ENV VARS
  Config files and defaults support Docker Compose–style interpolation:
    \${VAR}              required — errors if unset
    \${VAR:-default}     use default if unset or empty
    \${VAR-default}      use default if unset

  Provider API keys are resolved from standard env vars by default:
    ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY
    OLLAMA_HOST, AWS_REGION
    AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT, AZURE_OPENAI_API_KEY

  To override any config field via env, use \${} in ra.config.yml:
    agent:
      model: \${MODEL:-claude-sonnet-4-6}
      maxIterations: \${MAX_ITERS:-50}

STDIN
  When input is piped, ra reads stdin and auto-switches to CLI mode.
  If a prompt argument is given, the prompt comes first followed by stdin.
  If no prompt argument, stdin becomes the prompt.

EXAMPLES
  ra "What is the capital of France?"
  ra --provider openai --model gpt-4o "Summarize this file" --file report.pdf
  cat file.ts | ra "review this code"
  git diff | ra "summarize these changes"
  echo "hello" | ra
  ra --repl
  ra --http --http-port 8080
  ra --mcp --mcp-server-port 4000
  ra --mcp-stdio
  ra --mcp-server-enabled --mcp-server-port 4000 --repl
`.trim()
