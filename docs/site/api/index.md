# HTTP API Reference

Start the server:

```bash
ra --http                        # default port 3000
ra --http --http-port 8080       # custom port
ra --http --http-token secret    # with auth
```

## Authentication

When a token is set, all requests require:

```
Authorization: Bearer <token>
```

## POST /chat

Stream a response via SSE.

**Request:**
```json
{
  "messages": [
    { "role": "user", "content": "Hello" }
  ]
}
```

**Response (SSE stream):**
```
data: {"type":"text","delta":"Hello"}
data: {"type":"text","delta":"!"}
data: {"type":"done"}
```

## POST /chat/sync

Same request body. Returns the full response as JSON.

**Response:**
```json
{
  "response": "Hello!"
}
```

## GET /sessions

List stored sessions.

**Response:**
```json
{
  "sessions": [
    { "id": "abc123", "createdAt": "2026-01-01T00:00:00Z", "messageCount": 12 }
  ]
}
```

## Example

```bash
curl -X POST http://localhost:3000/chat/sync \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer secret" \
  -d '{"messages": [{"role": "user", "content": "Hello"}]}'
```
