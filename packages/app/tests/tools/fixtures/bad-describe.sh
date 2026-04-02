#!/bin/bash
# A script whose --describe output is invalid JSON.

if [ "$1" = "--describe" ]; then
  echo "not valid json"
  exit 0
fi

echo "should not get here"
