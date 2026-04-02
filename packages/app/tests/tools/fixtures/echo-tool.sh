#!/bin/bash
# A simple shell tool that echoes back the input message.

if [ "$1" = "--describe" ]; then
  cat << 'EOF'
{
  "name": "EchoTool",
  "description": "Echoes back the provided message",
  "parameters": {
    "message": { "type": "string", "description": "Message to echo" }
  }
}
EOF
  exit 0
fi

# Read tool input from stdin
read -r input
message=$(echo "$input" | grep -o '"message":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "echo: $message"
