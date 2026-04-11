# src/web/

Backend state for the web dashboard interface (`src/interfaces/web.ts`). HTTP routing lives in `web.ts`; this directory owns the long-lived state and side effects.

## Files

| File | Purpose |
|------|---------|
| `session-manager.ts` | `SessionManager` — owns all `ManagedSession`s for the dashboard. Creates per-session `AgentLoop`s via `createSessionLoop`, streams chunks/tool events to SSE subscribers, persists messages and session metadata to disk so state survives `ra web` restarts. |
| `worktree-manager.ts` | `WorktreeManager` — thin wrapper over `git worktree add/remove/list` for sessions that opt in to running in an isolated branch. Worktrees live under `<baseDir>/worktrees/<sessionId>`. |
| `panels/` | Config-driven session sidebar panels (`loadWebPanels`, builtin `diff`, optional file modules). Routes: `GET /api/web/panels`, `GET /api/sessions/:id/panels/:panelId/...`. |

## SessionManager responsibilities

- **Lifecycle**: `create` → `send` → `stop` → `delete`. Status transitions through `idle | running | needs-input | error | done`.
- **Streaming**: each subscriber (SSE client) receives `SessionEvent`s — status changes, stream chunks, tool start/result, token usage, errors. Multiple clients can subscribe to the same session.
- **Persistence**: messages + session metadata are serialized to disk so `ra web` can be restarted without losing in-flight conversations. `restore()` rehydrates sessions at startup; messages are lazy-loaded on first access (`messagesLoaded`).
- **Worktrees**: optional. When `create({ worktree: true })`, the session's `cwd` is set to a fresh git worktree so tool calls that modify files don't touch the main checkout.
- **Multipart content**: `buildMultipartContent` builds `ContentPart[]` from text + base64 image attachments so the dashboard can send screenshots/pasted images.

## Adding session-scoped features

1. Extend `ManagedSession` / `SessionEvent` if you need new state or events.
2. Emit events via the subscriber set — don't poll.
3. Expose over HTTP in `src/interfaces/web.ts` under `/api/sessions/:id/...`.
4. Consume in `packages/web/` via `lib/api.ts` and `hooks/useSession.ts`.
