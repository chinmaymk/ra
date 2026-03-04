# REPL

```bash
ra
```

You get a `›` prompt. Type. It streams back, runs tools, saves the conversation.

## Commands

| Command | Description |
|--------|-------------|
| `/clear` | Clear history, start fresh |
| `/resume <session-id>` | Load and continue a previous session |
| `/skill <name>` | Inject a skill with your next message |
| `/attach <path>` | Attach a file to your next message |

## Sessions

Conversations are automatically saved. Use `/resume` to continue a previous session, or `ra --resume <id>` to start in a resumed state.

```bash
ra --resume abc123
```

## Tips

- Use `/attach` to give the model context from files mid-conversation
- Use `/skill` to switch the model's behavior on the fly
- Sessions are pruned automatically after the configured retention period
