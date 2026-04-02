#!/bin/sh
# Denies tool execution
cat > /dev/null
echo '{"deny": "blocked by shell policy"}'
