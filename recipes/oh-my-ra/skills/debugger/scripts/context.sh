#!/bin/bash
# Gather debugging context when /debugger is activated
echo "## Debug Context"
echo ""

# Recent git changes (likely source of bugs)
echo "### Recent Changes (last 5 commits)"
git log --oneline -5 2>/dev/null
echo ""

echo "### Files Changed in Last Commit"
git diff --name-only HEAD~1 2>/dev/null | head -20
echo ""

# Check for uncommitted changes
echo "### Uncommitted Changes"
git diff --stat 2>/dev/null | tail -5
echo ""

# Find test files
echo "### Test Files"
find . -name '*.test.*' -o -name '*.spec.*' -o -name 'test_*' 2>/dev/null | grep -v node_modules | head -20
echo ""

# Check for recent test failures (if test output exists)
if [ -f "test-results.json" ] || [ -f "test-output.txt" ]; then
  echo "### Recent Test Output"
  cat test-results.json test-output.txt 2>/dev/null | tail -20
fi

echo "---"
echo "Use this context to identify likely sources of the bug."
