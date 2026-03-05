#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$DIR/ra.config.yaml"

echo "=== Code Review Agent — ra recipe demo ==="
echo ""

# Demo 1: Review a git diff
echo "--- Demo 1: Review staged changes ---"
echo ""
git diff --cached | ra --config "$CONFIG" "Review this diff"

echo ""
echo "--- Demo 2: Review last commit ---"
echo ""
git diff HEAD~1 | ra --config "$CONFIG" "Review this diff"

echo ""
echo "--- Demo 3: Review a specific file ---"
echo ""
echo "Usage: cat src/file.ts | ra --config $CONFIG 'Review this file for security issues'"

echo ""
echo "--- Demo 4: Review a GitHub PR (requires GITHUB_TOKEN) ---"
echo ""
echo "Usage: gh pr diff 42 | ra --config $CONFIG 'Review this PR'"
