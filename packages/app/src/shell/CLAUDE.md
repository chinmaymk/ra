# src/shell/

Shared shell script infrastructure used by both the tool loader and middleware loader.

## Files

| File | Purpose |
|------|---------|
| `detect.ts` | `SHELL_EXTENSIONS`, `isShellEntry()`, `isShellPath()`, `hasShellPrefix()` — detect shell script entries |
| `exec.ts` | `parseShellEntry()`, `resolveCommand()`, `runShellProcess()` — parse and execute shell commands |
| `index.ts` | Re-exports from detect and exec |

## Shell Script Detection

Entries are detected as shell scripts in two ways:
1. **Explicit prefix**: `shell: ./script.sh` or `shell: python3 ./check.py --flag`
2. **Auto-detection by extension**: `.sh`, `.bash`, `.zsh`, `.py`, `.rb`, `.pl`, `.php`, `.lua`, `.r`, `.R`, `.bat`, `.cmd`, `.ps1`

## Process Execution

`runShellProcess()` spawns a child process with `detached: true` (new process group) and:
- Pipes `input` string to stdin
- Collects stdout and stderr
- Respects an `AbortSignal` — kills the process tree (SIGTERM → SIGKILL after 3s grace)
- Returns `{ stdout, stderr, exitCode }`

## Consumers

- **Middleware** (`middleware/shell.ts`): sends context JSON to stdin, reads mutation JSON from stdout
- **Tools** (`tools/shell-tool.ts`): sends tool input JSON to stdin, reads result from stdout; uses `--describe` flag for tool metadata
