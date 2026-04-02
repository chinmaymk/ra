# Creating Recipes

A recipe is a directory with a `ra.config.yaml` and optional skills, middleware, and documentation. This guide covers the layout, authoring, and sharing of recipes.

## Directory layout

```
my-recipe/
  ra.config.yaml          # Required: agent configuration
  skills/                 # Optional: skill definitions
    my-skill/
      SKILL.md            # Skill prompt with YAML frontmatter
      references/         # Optional: files the model can consult
      scripts/            # Optional: scripts the model can run
  tools/                  # Optional: custom tools (TS/JS/shell)
    deploy.ts
    health-check.sh
  middleware/             # Optional: middleware hooks
    token-budget.ts
  README.md               # Optional: usage instructions
```

The only required file is `ra.config.yaml`. Everything else is optional.

## Config file

A recipe config uses the same format as any `ra.config.yaml`:

```yaml
agent:
  provider: anthropic
  model: claude-sonnet-4-6
  systemPrompt: |
    You are a helpful coding assistant.

  tools:
    builtin: true
  skillDirs:
    - ./skills
  middleware:
    afterModelResponse:
      - ./middleware/token-budget.ts
  maxIterations: 50
  thinking: medium
  compaction:
    enabled: true
    threshold: 0.8
```

Paths in `skillDirs`, `tools.custom`, `middleware`, and `systemPrompt` (when pointing to a file) are resolved relative to the recipe directory, not the working directory. This means recipes are portable.

### Environment variable interpolation

Use `${}` syntax for configurable values:

```yaml
agent:
  provider: ${PROVIDER:-anthropic}
  model: ${MODEL:-claude-sonnet-4-6}
app:
  mcpServers:
    - name: github
      transport: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-github"]
      env:
        GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN:-}"
```

`${VAR:-default}` uses the default when unset or empty. `${VAR}` errors if unset.

## Adding skills

Create a `SKILL.md` file inside a subdirectory of `skills/`:

```markdown
---
name: code-review
description: Reviews code for bugs, style, and correctness
---

You are a senior code reviewer. Analyze the provided code for:

1. **Correctness** — logic errors, edge cases, off-by-one
2. **Security** — injection, XSS, unsafe operations
3. **Performance** — unnecessary allocations, O(n²) loops
4. **Readability** — naming, structure, comments

Output findings grouped by severity: critical, warning, suggestion, nitpick.
```

The YAML frontmatter (`name`, `description`) is required. The body is the skill prompt injected into the conversation.

### References

Add files to `skills/<name>/references/` that the model can consult on demand. These aren't injected automatically — the model reads them when relevant.

```
skills/code-review/
  SKILL.md
  references/
    review-guide.md       # Detailed checklist
    style-rules.md        # Project conventions
```

### Scripts

Add executable scripts to `skills/<name>/scripts/` for the model to run via the Bash tool:

```
skills/debugger/
  SKILL.md
  scripts/
    collect-logs.sh       # Gather diagnostic info
```

## Adding custom tools

Add tool files to a `tools/` directory and reference them in your config. Both TypeScript and shell scripts are supported:

```
my-recipe/
  ra.config.yaml
  tools/
    deploy.ts
    health-check.sh
```

```yaml
agent:
  tools:
    custom:
      - ./tools/deploy.ts
      - ./tools/health-check.sh
```

Shell script tools self-describe via `--describe` and receive input on stdin. See [Custom Tools](/tools/custom#shell-script-tools) for the full protocol.

## Adding middleware

Create TypeScript files in `middleware/` and reference them in your config:

```ts
// middleware/token-budget.ts
export default async (ctx) => {
  const budget = parseInt(process.env.RA_TOKEN_BUDGET || '200000', 10)
  const used = (ctx.loop.usage.inputTokens + ctx.loop.usage.outputTokens)

  if (used > budget) {
    ctx.stop(`Token budget exceeded: ${used} / ${budget}`)
  }
}
```

```yaml
agent:
  middleware:
    afterModelResponse:
      - ./middleware/token-budget.ts
```

See [Middleware](/middleware/) for all available hooks and the context object shape.

## Publishing recipes

### Repository layout

For a repo with a single recipe, put `ra.config.yaml` at the root:

```
my-recipe-repo/
  ra.config.yaml
  skills/
  README.md
```

For a repo with multiple recipes, use a `recipes/` directory:

```
my-recipes-repo/
  recipes/
    coding-agent/
      ra.config.yaml
      skills/
    review-agent/
      ra.config.yaml
      skills/
  README.md
```

The installer auto-detects both layouts. Multi-recipe repos install each recipe as `owner/recipe-name`.

### GitHub

Push your repo to GitHub. Users install with:

```bash
ra recipe install user/my-recipe-repo
```

For multi-recipe repos, all recipes are installed at once under `user/recipe-name`.

### npm

Publish as an npm package. Users install with:

```bash
ra recipe install npm:my-recipe@1.0
```

### URL

Host a `.tar.gz` archive anywhere. Users install with:

```bash
ra recipe install https://example.com/my-recipe.tar.gz
```

## Testing locally

Run a recipe directly without installing:

```bash
# Point --config at the recipe config
ra --config ./my-recipe/ra.config.yaml

# Or use --recipe with a local path
ra --recipe ./my-recipe "test prompt"
```

Verify skills load correctly:

```bash
ra --config ./my-recipe/ra.config.yaml --show-config
```

## Example: minimal recipe

A recipe that reviews code with a token budget:

```
mini-reviewer/
  ra.config.yaml
  skills/
    review/
      SKILL.md
  middleware/
    token-budget.ts
```

**`ra.config.yaml`:**
```yaml
agent:
  provider: ${PROVIDER:-anthropic}
  model: ${MODEL:-claude-sonnet-4-6}
  skillDirs:
    - ./skills
  middleware:
    afterModelResponse:
      - ./middleware/token-budget.ts
  maxIterations: 10
  compaction:
    enabled: true
    threshold: 0.8
```

**`skills/review/SKILL.md`:**
```markdown
---
name: review
description: Concise code review
---

Review the provided code. For each issue found, output:
- **Severity**: critical | warning | suggestion
- **Location**: file and line
- **Issue**: what's wrong
- **Fix**: how to fix it
```

**`middleware/token-budget.ts`:**
```ts
export default async (ctx) => {
  const budget = parseInt(process.env.RA_TOKEN_BUDGET || '200000', 10)
  const used = (ctx.loop.usage.inputTokens + ctx.loop.usage.outputTokens)
  if (used > budget) ctx.stop(`Token budget exceeded: ${used} / ${budget}`)
}
```

**Usage:**
```bash
git diff | ra --config mini-reviewer/ra.config.yaml "Review this diff"
```

## See also

- [Recipes](/recipes/) — pre-built recipes and usage patterns
- [Skills](/skills/) — skill format and loading
- [Middleware](/middleware/) — hook types and context
- [Configuration](/configuration/) — all config fields
