#!/usr/bin/env bash
set -uo pipefail

ARGS=("--cli")

# Provider
if [ -n "${INPUT_PROVIDER:-}" ]; then
  ARGS+=("--provider" "$INPUT_PROVIDER")
fi

# Model
if [ -n "${INPUT_MODEL:-}" ]; then
  ARGS+=("--model" "$INPUT_MODEL")
fi

# System prompt
if [ -n "${INPUT_SYSTEM_PROMPT:-}" ]; then
  ARGS+=("--system-prompt" "$INPUT_SYSTEM_PROMPT")
fi

# Skills (comma-separated → multiple --skill flags)
if [ -n "${INPUT_SKILLS:-}" ]; then
  IFS=',' read -ra SKILL_LIST <<< "$INPUT_SKILLS"
  for skill in "${SKILL_LIST[@]}"; do
    ARGS+=("--skill" "$(echo "$skill" | xargs)")
  done
fi

# Skill dirs (comma-separated → multiple --skill-dir flags)
if [ -n "${INPUT_SKILL_DIRS:-}" ]; then
  IFS=',' read -ra DIR_LIST <<< "$INPUT_SKILL_DIRS"
  for dir in "${DIR_LIST[@]}"; do
    ARGS+=("--skill-dir" "$(echo "$dir" | xargs)")
  done
fi

# Files (comma-separated → multiple --file flags)
if [ -n "${INPUT_FILES:-}" ]; then
  IFS=',' read -ra FILE_LIST <<< "$INPUT_FILES"
  for f in "${FILE_LIST[@]}"; do
    ARGS+=("--file" "$(echo "$f" | xargs)")
  done
fi

# Max iterations
if [ -n "${INPUT_MAX_ITERATIONS:-}" ]; then
  ARGS+=("--max-iterations" "$INPUT_MAX_ITERATIONS")
fi

# Thinking level
if [ -n "${INPUT_THINKING:-}" ]; then
  ARGS+=("--thinking" "$INPUT_THINKING")
fi

# Config file
if [ -n "${INPUT_CONFIG:-}" ]; then
  ARGS+=("--config" "$INPUT_CONFIG")
fi

# Tool timeout
if [ -n "${INPUT_TOOL_TIMEOUT:-}" ]; then
  ARGS+=("--tool-timeout" "$INPUT_TOOL_TIMEOUT")
fi

# Builtin tools
if [ "${INPUT_BUILTIN_TOOLS:-true}" = "true" ]; then
  ARGS+=("--builtin-tools")
fi

# Memory
if [ "${INPUT_MEMORY:-false}" = "true" ]; then
  ARGS+=("--memory")
fi

# Provider connection options
if [ -n "${INPUT_ANTHROPIC_BASE_URL:-}" ]; then
  ARGS+=("--anthropic-base-url" "$INPUT_ANTHROPIC_BASE_URL")
fi
if [ -n "${INPUT_OPENAI_BASE_URL:-}" ]; then
  ARGS+=("--openai-base-url" "$INPUT_OPENAI_BASE_URL")
fi
if [ -n "${INPUT_GOOGLE_BASE_URL:-}" ]; then
  ARGS+=("--google-base-url" "$INPUT_GOOGLE_BASE_URL")
fi
if [ -n "${INPUT_OLLAMA_HOST:-}" ]; then
  ARGS+=("--ollama-host" "$INPUT_OLLAMA_HOST")
fi
if [ -n "${INPUT_AZURE_ENDPOINT:-}" ]; then
  ARGS+=("--azure-endpoint" "$INPUT_AZURE_ENDPOINT")
fi
if [ -n "${INPUT_AZURE_DEPLOYMENT:-}" ]; then
  ARGS+=("--azure-deployment" "$INPUT_AZURE_DEPLOYMENT")
fi

# Capture output
OUTPUT_FILE="$(mktemp)"

echo "::group::Running ra"
echo "ra ${ARGS[*]} <prompt>"

EXIT_CODE=0
ra "${ARGS[@]}" "$INPUT_PROMPT" | tee "$OUTPUT_FILE" || EXIT_CODE=$?

echo "::endgroup::"

# Set outputs (multiline-safe using delimiter)
echo "exit-code=${EXIT_CODE}" >> "$GITHUB_OUTPUT"
{
  echo "result<<RA_OUTPUT_EOF"
  cat "$OUTPUT_FILE"
  echo "RA_OUTPUT_EOF"
} >> "$GITHUB_OUTPUT"

rm -f "$OUTPUT_FILE"

# Fail or warn based on fail-on-error setting
if [ "$EXIT_CODE" -ne 0 ]; then
  if [ "${INPUT_FAIL_ON_ERROR:-true}" = "true" ]; then
    echo "::error::ra exited with code $EXIT_CODE"
    exit "$EXIT_CODE"
  else
    echo "::warning::ra exited with code $EXIT_CODE (fail-on-error is false, continuing)"
  fi
fi
