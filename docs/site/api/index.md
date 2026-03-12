# HTTP API Reference

## Starting the server

```bash
ra --http                        # default port 3000
ra --http --http-port 8080       # custom port
ra --http --http-token secret    # with authentication
```

## Authentication

When a token is configured, all requests require a Bearer token header:

```
Authorization: Bearer <token>
```

Requests without a valid token receive `401 Unauthorized`.

## POST /chat

Stream a response via Server-Sent Events (SSE).

**Request:**

```json
{
  "messages": [
    { "role": "user", "content": "Hello" }
  ],
  "sessionId": "optional-session-id"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `messages` | array | Yes | Array of message objects with `role` and `content` |
| `sessionId` | string | No | Resume a previous session. Omit to start new |

**Response** (SSE stream):

```
data: {"type":"text","delta":"Hello"}
data: {"type":"text","delta":"!"}
data: {"type":"done","usage":{"inputTokens":150,"outputTokens":42}}
```

**SSE event types:**

| Type | Fields | Description |
|------|--------|-------------|
| `text` | `delta` | Text content token |
| `thinking` | `delta` | Thinking/reasoning token |
| `tool_call_start` | `id`, `name` | Tool invocation begins |
| `tool_call_delta` | `id`, `argsDelta` | Tool argument streaming |
| `tool_call_end` | `id` | Tool invocation complete |
| `AskUserQuestion` | `question`, `sessionId` | Agent needs user input — loop suspended |
| `done` | `usage` (optional) | Stream complete |

When `AskUserQuestion` is emitted, the agent loop is suspended. Send a new `/chat` request with the same `sessionId` to continue the conversation.

## POST /chat/sync

Same request body as `/chat`. Returns the full response as JSON after the agent loop completes.

**Response:**

```json
{
  "response": "Hello!",
  "sessionId": "ses_abc123"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `response` | string | The agent's complete text response |
| `sessionId` | string | Session ID for resuming later |

## GET /sessions

List stored sessions.

**Response:**

```json
{
  "sessions": [
    {
      "id": "ses_abc123",
      "createdAt": "2026-01-01T00:00:00Z",
      "messageCount": 12
    }
  ]
}
```

## Examples

**Streaming with curl:**

```bash
curl -N http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer secret" \
  -d '{"messages": [{"role": "user", "content": "Hello"}]}'
```

**Synchronous with curl:**

```bash
curl http://localhost:3000/chat/sync \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer secret" \
  -d '{"messages": [{"role": "user", "content": "Hello"}]}'
```

**Resuming a session:**

```bash
curl http://localhost:3000/chat/sync \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Continue"}], "sessionId": "ses_abc123"}'
```

## See also

- [HTTP Server](/modes/http) — how to start and configure the server
- [Sessions](/core/sessions) — session persistence and storage
- [Configuration](/configuration/) — HTTP config fields
