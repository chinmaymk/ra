#!/usr/bin/env bash
set -euo pipefail

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

# Capture output
OUTPUT_FILE="$(mktemp)"

echo "::group::Running ra"
echo "ra ${ARGS[*]} <prompt>"

ra "${ARGS[@]}" "$INPUT_PROMPT" | tee "$OUTPUT_FILE"

echo "::endgroup::"

# Set output (multiline-safe using delimiter)
{
  echo "result<<RA_OUTPUT_EOF"
  cat "$OUTPUT_FILE"
  echo "RA_OUTPUT_EOF"
} >> "$GITHUB_OUTPUT"

rm -f "$OUTPUT_FILE"
