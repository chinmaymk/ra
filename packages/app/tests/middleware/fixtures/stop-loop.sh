#!/bin/sh
# Reads stdin, outputs JSON that tells the loop to stop
cat > /dev/null
echo '{"stop": "stopped by shell"}'
