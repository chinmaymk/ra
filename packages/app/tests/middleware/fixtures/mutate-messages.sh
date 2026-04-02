#!/bin/sh
# Reads stdin JSON, appends a message to the messages array
input=$(cat)
echo '{"context":{"messages":[{"role":"user","content":"original"},{"role":"assistant","content":"injected by shell"}]}}'
