#!/usr/bin/env bash
# Detect project environment and inject as context
set -euo pipefail

echo "## Environment"
echo ""

# OS and shell
echo "- Platform: $(uname -s | tr '[:upper:]' '[:lower:]')"
echo "- Shell: ${SHELL:-unknown}"

# Git info
if git rev-parse --is-inside-work-tree &>/dev/null; then
  echo "- Git repository: yes"
  BRANCH=$(git branch --show-current 2>/dev/null || echo "detached")
  echo "- Branch: $BRANCH"
  DIRTY=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  echo "- Uncommitted changes: $DIRTY files"
else
  echo "- Git repository: no"
fi

# Package manager and language detection
echo ""
echo "## Project"
if [ -f "package.json" ]; then
  NAME=$(python3 -c "import json; print(json.load(open('package.json')).get('name','unknown'))" 2>/dev/null || echo "unknown")
  echo "- Name: $NAME"
  if [ -f "bun.lockb" ] || [ -f "bun.lock" ]; then
    echo "- Runtime: bun"
  elif [ -f "pnpm-lock.yaml" ]; then
    echo "- Package manager: pnpm"
  elif [ -f "yarn.lock" ]; then
    echo "- Package manager: yarn"
  elif [ -f "package-lock.json" ]; then
    echo "- Package manager: npm"
  fi
  # Scripts
  SCRIPTS=$(python3 -c "import json; scripts=json.load(open('package.json')).get('scripts',{}); [print(f'  - {k}: {v}') for k,v in list(scripts.items())[:10]]" 2>/dev/null || true)
  if [ -n "$SCRIPTS" ]; then
    echo "- Scripts:"
    echo "$SCRIPTS"
  fi
elif [ -f "pyproject.toml" ]; then
  echo "- Language: Python"
  echo "- Config: pyproject.toml"
elif [ -f "Cargo.toml" ]; then
  echo "- Language: Rust"
  echo "- Config: Cargo.toml"
elif [ -f "go.mod" ]; then
  echo "- Language: Go"
  echo "- Config: go.mod"
fi

# Check for common config files
echo ""
echo "## Config Files"
for f in tsconfig.json .eslintrc* .prettierrc* Makefile Dockerfile docker-compose* .github/workflows/*.yml; do
  # Use find to handle globs
  found=$(find . -maxdepth 2 -name "$(basename "$f")" -not -path '*/node_modules/*' 2>/dev/null | head -3)
  if [ -n "$found" ]; then
    echo "$found" | while read -r match; do
      echo "- $match"
    done
  fi
done
