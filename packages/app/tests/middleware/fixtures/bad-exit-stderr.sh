#!/bin/sh
# Exits with code 2 and writes reason to stderr
cat > /dev/null
echo "something went wrong in the script" >&2
exit 2
