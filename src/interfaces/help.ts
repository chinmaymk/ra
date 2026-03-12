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
  --resume <session-id>               Resume a previous session

INTERFACE
  --cli                               Oneshot mode: run prompt and exit
  --repl                              Interactive REPL mode (default)
  --http                              Start HTTP API server
  --mcp                               Start MCP HTTP server (default port: 3001)
  --mcp-stdio                         Start MCP stdio server (for Claude Desktop/Cursor)

HTTP SERVER
  --http-port <port>                  HTTP server port (default: 3000)
  --http-token <token>                Bearer token for HTTP auth

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
  RA_PROVIDER, RA_MODEL, RA_INTERFACE, RA_SYSTEM_PROMPT, RA_MAX_ITERATIONS
  RA_HTTP_PORT, RA_HTTP_TOKEN
  RA_MCP_SERVER_ENABLED, RA_MCP_SERVER_PORT
  RA_MCP_SERVER_TOOL_NAME, RA_MCP_SERVER_TOOL_DESCRIPTION
  RA_DATA_DIR, RA_STORAGE_MAX_SESSIONS, RA_STORAGE_TTL_DAYS
  RA_SKILL_DIRS=dir1,dir2  RA_SKILLS=skill1,skill2
  RA_ANTHROPIC_API_KEY, RA_ANTHROPIC_BASE_URL
  RA_OPENAI_API_KEY, RA_OPENAI_BASE_URL
  RA_GOOGLE_API_KEY, RA_OLLAMA_HOST
  RA_BUILTIN_TOOLS
  RA_THINKING
  RA_MEMORY_ENABLED, RA_MEMORY_MAX_MEMORIES
  RA_MEMORY_TTL_DAYS, RA_MEMORY_INJECT_LIMIT

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
