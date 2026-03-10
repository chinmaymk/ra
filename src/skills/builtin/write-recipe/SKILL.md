---
name: write-recipe
description: How to create ra recipes — complete agent configurations with skills, middleware, and config.
---

You are creating a recipe for ra. A recipe is a complete agent configuration that bundles skills, middleware, a system prompt, and settings into a portable directory. Follow this guide exactly.

## Directory Structure

```
my-recipe/
  ra.config.yml       # required — the recipe configuration
  system-prompt.md     # optional — system prompt loaded from file
  skills/              # optional — recipe-local skills
    my-skill/
      SKILL.md
  middleware/           # optional — middleware hooks
    log-calls.ts
    validate-output.ts
```

## Config File Format

The config file is YAML. Here is a complete example with all commonly used fields:

```yaml
provider: anthropic
model: claude-sonnet-4-20250514

systemPrompt: ./system-prompt.md

skillDirs:
  - ./skills

skills:
  - architect

middleware:
  beforeModelCall:
    - ./middleware/log-calls.ts
  afterToolExecution:
    - ./middleware/validate-output.ts

maxIterations: 50
builtinTools: true
```

### Config Fields

| Field | Type | Purpose |
|-------|------|---------|
| `provider` | string | LLM provider: `anthropic`, `openai`, `google`, `ollama`, `bedrock`, `azure` |
| `model` | string | Model identifier for the chosen provider |
| `systemPrompt` | string | Inline text or path to a markdown file (e.g. `./system-prompt.md`) |
| `skillDirs` | string[] | Directories to scan for available skills |
| `skills` | string[] | Skills to always activate (must be found in skillDirs) |
| `middleware` | object | Hook name to file path arrays (see write-middleware skill) |
| `maxIterations` | number | Maximum agent loop iterations before stopping |
| `builtinTools` | boolean | Whether to enable built-in tools (file read/write, bash, etc.) |
| `toolTimeout` | number | Timeout in ms for tool execution |
| `thinking` | string | Thinking mode: `low`, `medium`, or `high` |

## Key Rules

- **Run via config flag.** Start a recipe with `ra --config path/to/ra.config.yml`. The config file's directory becomes the base for resolving relative paths.
- **Use relative paths.** All paths in the config (systemPrompt, skillDirs, middleware files) should be relative to the config file's location. This keeps the recipe portable.
- **`skillDirs` vs `skills`.** `skillDirs` tells ra where to find skills. `skills` tells ra which of those skills to always activate. A skill must be discoverable in a skillDir to be listed in skills.
- **Middleware hooks are TypeScript files.** Each file exports a default async function. See the write-middleware skill for details.
- **System prompt from file.** Set `systemPrompt` to a relative path like `./system-prompt.md` to load the prompt from a file. This keeps long prompts out of the config.

## System Prompt

Write the system prompt in a separate markdown file for readability:

```markdown
# system-prompt.md

You are a specialized agent for analyzing CSV data files.

## Capabilities
- Read and parse CSV files
- Generate summary statistics
- Create data visualizations

## Rules
- Always validate the file exists before processing
- Report errors clearly with the file name and line number
- Output results in markdown tables
```

Then reference it in the config:

```yaml
systemPrompt: ./system-prompt.md
```

## Testing a Recipe

**Interactive mode:**

```sh
ra --config ./my-recipe/ra.config.yml
```

**One-shot mode:**

```sh
ra --config ./my-recipe/ra.config.yml -p "Analyze sales.csv and summarize the trends"
```

**Verify skill loading:**

Start the recipe in interactive mode and run `/skills` to confirm the expected skills are loaded and active.

## Recipe Design Tips

- Start with the system prompt. Define the agent's role and constraints before adding skills.
- Keep skills focused. One skill per capability. The recipe composes them.
- Test middleware in isolation. Run a simple prompt and check that hooks fire as expected before building complex chains.
- Pin the model. Recipes should specify an exact model to ensure consistent behavior.
- Document what the recipe does. Add a comment at the top of `ra.config.yml` or a short description in the system prompt.
