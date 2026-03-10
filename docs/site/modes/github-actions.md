# GitHub Actions

Run ra in your CI/CD workflows. The action downloads the binary, builds the CLI command from your inputs, and captures the output — no install step needed.

## Basic usage

```yaml
- uses: chinmaymk/ra@latest
  with:
    prompt: "Review this PR for bugs and security issues"
  env:
    RA_ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Inputs

### Core

| Input | Description | Default |
|-------|-------------|---------|
| `prompt` | The prompt to send to the agent | **(required)** |
| `provider` | LLM provider (`anthropic`, `openai`, `google`, `ollama`, `bedrock`, `azure`) | `anthropic` |
| `model` | Model name (e.g. `claude-sonnet-4-6`, `gpt-4o`) | Provider default |
| `system-prompt` | System prompt text or path to a file | — |
| `max-iterations` | Maximum agent loop iterations | `50` |
| `tool-timeout` | Tool execution timeout in milliseconds | — |
| `thinking` | Extended thinking level (`low`, `medium`, `high`) | — |
| `builtin-tools` | Enable built-in tools | `true` |

### Skills

| Input | Description |
|-------|-------------|
| `skills` | Comma-separated list of skills to activate |
| `skill-dirs` | Comma-separated list of directories to load skills from |

### Files

| Input | Description |
|-------|-------------|
| `files` | Comma-separated list of files to attach to the prompt |

### Memory

| Input | Description | Default |
|-------|-------------|---------|
| `memory` | Enable persistent memory | `false` |

### Provider connection

| Input | Description |
|-------|-------------|
| `anthropic-base-url` | Custom base URL for Anthropic API |
| `openai-base-url` | Custom base URL for OpenAI API |
| `google-base-url` | Custom base URL for Google API |
| `ollama-host` | Ollama server host |
| `azure-endpoint` | Azure OpenAI endpoint |
| `azure-deployment` | Azure OpenAI deployment name |

### Action-specific

| Input | Description | Default |
|-------|-------------|---------|
| `config` | Path to ra config file | — |
| `version` | ra version to use (e.g. `latest`) | `latest` |
| `fail-on-error` | Fail the workflow if ra exits non-zero | `true` |

## Outputs

| Output | Description |
|--------|-------------|
| `exit-code` | The exit code from the ra process |
| `result` | The agent output text |

## Examples

### Code review on pull requests

```yaml
name: Code Review
on: [pull_request]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Get diff
        id: diff
        run: echo "diff=$(git diff origin/${{ github.base_ref }}...HEAD)" >> "$GITHUB_OUTPUT"

      - uses: chinmaymk/ra@latest
        with:
          prompt: |
            Review this diff for bugs, security issues, and style problems:
            ${{ steps.diff.outputs.diff }}
          provider: anthropic
          model: claude-sonnet-4-6
          skills: code-review
        env:
          RA_ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Using a custom config file

```yaml
- uses: chinmaymk/ra@latest
  with:
    prompt: "Analyze the codebase and suggest improvements"
    config: ./ra.config.yml
  env:
    RA_ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Using OpenAI

```yaml
- uses: chinmaymk/ra@latest
  with:
    prompt: "Summarize the changes in this release"
    provider: openai
    model: gpt-4.1
  env:
    RA_OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

### Capturing output

```yaml
- uses: chinmaymk/ra@latest
  id: agent
  with:
    prompt: "Generate a changelog from recent commits"
  env:
    RA_ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}

- name: Use the result
  run: echo "${{ steps.agent.outputs.result }}"
```

### Pinning a specific version

```yaml
- uses: chinmaymk/ra@latest  # pin to a release tag
- uses: chinmaymk/ra@main    # or track the main branch
- uses: chinmaymk/ra@abc123  # or pin to a commit SHA
```

## API keys

Pass provider API keys as environment variables using GitHub secrets:

```yaml
env:
  RA_ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  RA_OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
  RA_GOOGLE_API_KEY: ${{ secrets.GOOGLE_API_KEY }}
```

For AWS Bedrock, configure AWS credentials using the standard `aws-actions/configure-aws-credentials` action before the ra step.

## See also

- [CLI](/modes/cli) — the same interface ra uses under the hood
- [Configuration](/configuration/) — all config options
- [Skills](/skills/) — reusable instruction bundles
- [Recipes](/recipes/) — pre-built agent configurations
