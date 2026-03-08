# REPL

The default mode when you run `ra` without a prompt. Full interactive sessions with tool use, file attachments, and session history.

```bash
ra
```

You get a `›` prompt. Type a message, and ra streams back the response, runs tools, and saves the conversation automatically.

## Commands

| Command | Description |
|---------|-------------|
| `/clear` | Clear history, start fresh |
| `/resume <session-id>` | Load and continue a previous session |
| `/skill <name>` | Activate a skill for the next message |
| `/skill-run <skill> <script>` | Run a skill script and attach output to next message |
| `/skill-ref <skill> <file>` | Load a skill reference into context |
| `/attach <path>` | Attach a file to the next message |
| `/context` | Show discovered context files |

## Example session

```
ra
› How does the auth module work?
› /skill code-review
› Review the login handler for security issues
› /attach src/auth.ts
› What changes would you make to this file?
› /resume abc-123           # resume a previous session
› /clear                    # start fresh
```

## Sessions

Conversations are automatically saved after each turn. Resume with `/resume` inside the REPL, or start in a resumed state from the shell:

```bash
ra --resume abc-123
```

Sessions are pruned automatically after the configured retention period. See [Sessions](/core/sessions) for configuration.

## Tips

- Use `/attach` to give the model context from files mid-conversation
- Use `/skill` to switch the model's behavior on the fly without restarting
- Thinking output streams in real time when `--thinking` is enabled — watch the model reason before responding
- Pipe content in: `cat file.txt | ra` auto-switches to CLI mode, but `ra` without input starts the REPL
