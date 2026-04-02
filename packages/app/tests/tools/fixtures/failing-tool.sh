#!/bin/bash
# A shell tool that always fails during execution.

if [ "$1" = "--describe" ]; then
  cat << 'EOF'
{
  "name": "FailingTool",
  "description": "Always fails",
  "parameters": {}
}
EOF
  exit 0
fi

echo "something went wrong" >&2
exit 1
