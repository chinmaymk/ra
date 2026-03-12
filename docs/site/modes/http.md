# HTTP Server

A lightweight streaming HTTP server built on `Bun.serve()`. Exposes the full agent loop as an API with SSE streaming and synchronous endpoints.

```bash
ra --http                        # default port 3000
ra --http --http-port 8080       # custom port
ra --http --http-token secret    # with authentication
```

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/chat` | POST | SSE stream — real-time token streaming |
| `/chat/sync` | POST | Blocking JSON — waits for the full response |
| `/sessions` | GET | List stored sessions |

## Authentication

When `--http-token` is set, all requests require a Bearer token:

```
Authorization: Bearer <token>
```

Requests without a valid token receive a `401 Unauthorized` response.

## Request body

Both `/chat` and `/chat/sync` accept the same request body:

```json
{
  "messages": [
    { "role": "user", "content": "Hello" }
  ],
  "sessionId": "optional-session-id"
}
```

Pass `sessionId` to resume a previous conversation. Omit it to start a new session.

## Streaming response (`/chat`)

The streaming endpoint returns Server-Sent Events (SSE):

```
data: {"type":"text","delta":"Hello"}
data: {"type":"text","delta":" there!"}
data: {"type":"thinking","delta":"Let me consider..."}
data: {"type":"tool_call_start","id":"tc_1","name":"Read"}
data: {"type":"tool_call_delta","id":"tc_1","argsDelta":"{\"path\":\"src/index.ts\"}"}
data: {"type":"tool_call_end","id":"tc_1"}
data: {"type":"AskUserQuestion","question":"Which file should I modify?","sessionId":"ses_abc123"}
data: {"type":"done","usage":{"inputTokens":150,"outputTokens":42}}
```

The `AskUserQuestion` event signals that the agent is waiting for user input. Send a follow-up request with the same `sessionId` to continue.

## Synchronous response (`/chat/sync`)

Returns the full response as JSON after the agent loop completes:

```json
{
  "response": "Hello there!",
  "sessionId": "ses_abc123"
}
```

## Configuration

```yaml
http:
  port: 3000
  token: my-secret-token
```

Or via CLI flags:

```bash
ra --http --http-port 8080 --http-token secret
```

## Example

```bash
# Streaming
curl -N http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer secret" \
  -d '{"messages": [{"role": "user", "content": "Hello"}]}'

# Synchronous
curl http://localhost:3000/chat/sync \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer secret" \
  -d '{"messages": [{"role": "user", "content": "Hello"}]}'
```

## See also

- [HTTP API Reference](/api/) — full endpoint specification
- [Sessions](/core/sessions) — session persistence and resume
- [Configuration](/configuration/) — HTTP config fields
