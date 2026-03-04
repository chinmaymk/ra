# HTTP Server

A lightweight server built on `Bun.serve()`.

```bash
ra --http                        # default port 3000
ra --http --http-port 8080       # custom port
ra --http --http-token secret    # with auth
```

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /chat` | SSE stream — `data: {"type":"text","delta":"..."}` |
| `POST /chat/sync` | Blocking JSON — `{ "response": "..." }` |
| `GET /sessions` | List stored sessions |

## Authentication

When `--http-token` is set, all requests require:

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
