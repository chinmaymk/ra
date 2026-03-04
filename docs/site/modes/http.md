# HTTP Server

```bash
ra --http
```

Listens on your configured port (default `3000`). Optional Bearer token auth.

## Endpoints

| Method + path | Description |
|---------------|-------------|
| `POST /chat/sync` | JSON body `{ "messages": [...] }` → `{ "response": "..." }` |
| `POST /chat` | Same body, streams via SSE: `data: {"type":"text","delta":"..."}` then `data: {"type":"done"}` |
| `GET /sessions` | List stored sessions |

## Authentication

Set a token in your config or via env. All requests must include:

```
Authorization: Bearer <token>
```

## Example

```bash
curl -X POST http://localhost:3000/chat/sync \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Hello"}]}'
```

See [HTTP API reference](/api/) for full schema.
