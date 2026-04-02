#!/bin/bash
# A shell tool that adds two numbers. Uses inputSchema directly.

if [ "$1" = "--describe" ]; then
  cat << 'EOF'
{
  "name": "AddTool",
  "description": "Adds two numbers together",
  "inputSchema": {
    "type": "object",
    "properties": {
      "a": { "type": "number", "description": "First number" },
      "b": { "type": "number", "description": "Second number" }
    },
    "required": ["a", "b"]
  }
}
EOF
  exit 0
fi

read -r input
a=$(echo "$input" | grep -o '"a":[0-9]*' | head -1 | cut -d':' -f2)
b=$(echo "$input" | grep -o '"b":[0-9]*' | head -1 | cut -d':' -f2)
echo $(( a + b ))
