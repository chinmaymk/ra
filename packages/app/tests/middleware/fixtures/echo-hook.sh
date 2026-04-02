#!/bin/sh
# Reads stdin JSON and echoes back the hook name on stderr, no stdout mutations
input=$(cat)
hook=$(echo "$input" | grep -o '"hook":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "hook=$hook" >&2
