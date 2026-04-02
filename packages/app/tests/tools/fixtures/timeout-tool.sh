#!/bin/bash
# A shell tool with a custom timeout.

if [ "$1" = "--describe" ]; then
  cat << 'EOF'
{
  "name": "TimeoutTool",
  "description": "Has a custom timeout",
  "parameters": {},
  "timeout": 5000
}
EOF
  exit 0
fi

read -r input
echo "done"
