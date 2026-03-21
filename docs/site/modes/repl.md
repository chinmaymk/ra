# REPL

The default mode when you run `ra` without a prompt. Full interactive sessions with tool use, file attachments, and session history.

```bash
ra
```

You get a `›` prompt. Type a message and ra streams the response, runs tools as the model requests, and saves the conversation automatically.

## Commands

| Command | Description |
|---------|-------------|
| `/clear` | Clear history and start a fresh session |
| `/resume [session-id]` | Resume a session (latest if no ID given) |
| `/skill <name>` | Activate a skill for the next message |
| `/skill-run <skill> <script>` | Run a skill script and attach output to the next message |
| `/skill-ref <skill> <file>` | Load a skill reference into context |
| `/attach <path>` | Attach a file to the next message |
| `/context` | Show discovered context files |
| `/memories [n]` | Show stored memories (default: last 20) |
| `/forget <query>` | Delete memories matching a search query |

## Example session

```
ra
› How does the auth module work?
› /skill code-review
› Review the login handler for security issues
› /attach src/auth.ts
› What changes would you make to this file?
› /resume                   # resume the latest session
› /resume abc-123           # resume a specific session
› /clear                    # start fresh
```

## Sessions

Conversations are saved automatically after each turn. Resume with `/resume` inside the REPL (resumes the latest session), or start in a resumed state from the shell:

```bash
ra --resume              # resume the latest session
ra --resume=abc-123      # resume a specific session
```

Sessions are pruned automatically after the configured retention period. See [Sessions](/core/sessions) for configuration.

## Tips

- Use `/attach` to give the model context from files mid-conversation. See [File Attachments](/core/file-attachments) for supported formats.
- Use `/skill` to switch the model's behavior on the fly without restarting. See [Skills](/skills/) for available skills.
- Thinking output streams in real time when `--thinking` is enabled — watch the model reason before responding.
- Pipe content in: `cat file.txt | ra` auto-switches to CLI mode, but `ra` without input starts the REPL.

## See also

- [CLI](/modes/cli) — for one-shot, non-interactive usage
- [Sessions](/core/sessions) — session persistence and storage
- [Skills](/skills/) — creating and using skills
