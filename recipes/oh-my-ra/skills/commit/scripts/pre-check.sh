#!/bin/bash
# Quick pre-commit check when /commit is activated
echo "## Pre-Commit Status"
echo ""

echo "### Staged Files"
staged=$(git diff --cached --name-only 2>/dev/null)
if [ -z "$staged" ]; then
  echo "No files staged. You need to stage changes first."
else
  echo "$staged"
  echo ""
  echo "### Staged Diff Stats"
  git diff --cached --stat 2>/dev/null
fi
echo ""

echo "### Unstaged Changes"
unstaged=$(git diff --name-only 2>/dev/null)
if [ -z "$unstaged" ]; then
  echo "No unstaged changes."
else
  echo "$unstaged"
  echo ""
  echo "**Warning:** These changes will NOT be included in the commit."
fi
echo ""

echo "### Untracked Files"
git ls-files --others --exclude-standard 2>/dev/null | head -10
echo ""

# Check for potential issues in staged files
echo "### Quick Checks"
if git diff --cached 2>/dev/null | grep -q 'console\.log\|debugger\|TODO\|FIXME\|HACK'; then
  echo "⚠ Staged files contain debug artifacts (console.log, debugger, TODO, FIXME, HACK)"
  git diff --cached 2>/dev/null | grep -n 'console\.log\|debugger\|TODO\|FIXME\|HACK' | head -5
else
  echo "✓ No debug artifacts found in staged changes"
fi

if git diff --cached 2>/dev/null | grep -q '<<<<<<\|>>>>>>\|======'; then
  echo "⚠ Merge conflict markers found in staged files!"
else
  echo "✓ No merge conflict markers"
fi

echo ""
echo "---"
