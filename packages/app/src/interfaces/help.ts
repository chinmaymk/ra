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
  --recipe <name>                     Use an installed recipe as agent config base
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

SECRETS
  --profile <name>                    Select a secrets profile (default: "default")

  ra secrets set <NAME> <value>       Store a secret in the active profile
  ra secrets set <NAME> <value> --profile work
  ra secrets get <NAME>               Print the value (for piping)
  ra secrets list                     Show secrets in the active profile (masked)
  ra secrets list --all               Show secrets across every profile
  ra secrets remove <NAME>            Remove a secret
  ra secrets profiles                 List all profile names
  ra secrets path                     Print the secrets file path

  Storage: ~/.ra/secrets.json (mode 0600). Real env vars always win
  over stored secrets, so OPENAI_API_KEY=foo ra ... still works.

LOGIN
  ra login codex                     Sign in with ChatGPT subscription (OAuth)
  ra login codex --device-code       Sign in via device code (headless/SSH)
  ra login claude                    Sign in via Claude Code (OAuth)

SKILL MANAGEMENT
  ra skill install <source>           Install skill from GitHub, npm, or URL
  ra skill remove <name>              Remove an installed skill
  ra skill list                       List installed skills

  Sources:
    ra skill install user/repo               GitHub repository (default)
    ra skill install npm:ra-skill-lint@1.0   npm with version
    ra skill install https://example.com/s.tgz  URL tarball

RECIPE MANAGEMENT
  ra recipe install <source>          Install recipe from GitHub, npm, or URL
  ra recipe remove <name>             Remove an installed recipe
  ra recipe list                      List installed recipes

  Sources:
    ra recipe install user/repo              GitHub repo (default)
    ra recipe install npm:ra-recipe-foo      npm package
    ra recipe install github:user/repo       GitHub (explicit)

  Repos should contain a recipes/ folder with subdirectories, each having
  a ra.config.{yaml,yml,json,toml}. Falls back to root-level config.

  Usage:
    ra --recipe owner/recipe-name "prompt"   Use installed recipe
    ra --recipe ./local/recipe "prompt"      Use local recipe directory
    agent:
      recipe: owner/recipe-name              Reference in ra.config.yaml

ENV VARS
  Every CLI flag has a matching \`RA_*\` environment variable. The flag
  name is uppercased and dashes become underscores:
    --provider openai           ↔ RA_PROVIDER=openai
    --http-port 4000            ↔ RA_HTTP_PORT=4000
    --openai-base-url https://x ↔ RA_OPENAI_BASE_URL=https://x
  CLI flags take precedence over env vars when both are set.

  Provider credentials and connection options are also resolved from
  ecosystem-standard env vars (the same names each vendor's SDK reads):
    ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY
    ANTHROPIC_BASE_URL, OPENAI_BASE_URL, OLLAMA_HOST
    AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN
    AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT, AZURE_OPENAI_API_KEY

  Precedence: CLI flag > process.env > ~/.ra/secrets.json > config file > defaults
  See SECRETS below for the on-disk store.

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
