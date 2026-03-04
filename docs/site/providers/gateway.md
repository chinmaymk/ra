# Gateway

**Provider value:** `gateway`

A dedicated provider for OpenAI-compatible AI gateways. Use this when routing all model traffic through a centralized proxy like Tailscale Aperture, Databricks AI Gateway, or LiteLLM.

The gateway provider sends standard OpenAI chat completion requests — the gateway handles routing to the correct backend model.

## Setup

```bash
export RA_GATEWAY_URL=https://ai-gateway.tailscale.net/v1
ra --provider gateway --model claude-sonnet-4-6 "Hello"
```

## Env vars

| Variable | Required | Description |
|----------|----------|-------------|
| `RA_GATEWAY_URL` | Yes | Gateway base URL |
| `RA_GATEWAY_API_KEY` | No | API key (sent as `Authorization: Bearer`) |
| `RA_GATEWAY_HEADERS` | No | JSON object of custom headers |

## CLI flags

```bash
ra --provider gateway \
   --gateway-url https://ai-gateway.tailscale.net/v1 \
   --gateway-header "X-Custom-Auth: token123" \
   --model claude-sonnet-4-6 "Hello"
```

Multiple `--gateway-header` flags are supported:

```bash
ra --provider gateway \
   --gateway-url https://gateway.example.com/v1 \
   --gateway-header "X-Team: platform" \
   --gateway-header "X-Environment: prod" \
   --model gpt-4o "Hello"
```

## Config file

```yaml
provider: gateway
model: claude-sonnet-4-6

providers:
  gateway:
    url: https://ai-gateway.tailscale.net/v1
    apiKey: ${RA_GATEWAY_API_KEY}
    headers:
      X-Team: platform
```

## Tailscale Aperture

[Tailscale Aperture](https://tailscale.com/kb/1215/aperture) provides an AI gateway that runs on your tailnet. It authenticates requests via Tailscale identity and proxies to upstream providers.

```bash
export RA_GATEWAY_URL=https://ai-gateway.tailscale.net/v1
ra --provider gateway --model claude-sonnet-4-6 "Hello"
```

No API key needed — Tailscale handles auth via your network identity.

## Databricks AI Gateway

[Databricks AI Gateway](https://docs.databricks.com/en/generative-ai/external-models/index.html) provides governed access to models.

```bash
export RA_GATEWAY_URL=https://<workspace>.databricks.com/serving-endpoints
export RA_GATEWAY_API_KEY=dapi...
ra --provider gateway --model databricks-claude-sonnet "Hello"
```

## LiteLLM

```bash
export RA_GATEWAY_URL=http://localhost:4000/v1
export RA_GATEWAY_API_KEY=sk-litellm-key
ra --provider gateway --model claude-sonnet-4-6 "Hello"
```

## Custom headers

Gateways often need extra headers for routing, tenant isolation, or cost tracking. Pass them via env var (JSON) or CLI flags:

```bash
# JSON env var
export RA_GATEWAY_HEADERS='{"X-Team":"platform","X-Cost-Center":"eng-123"}'

# CLI flags
ra --provider gateway --gateway-header "X-Team: platform" ...
```

## Using existing providers with a gateway

You can also point individual providers at a gateway using their `baseURL` and `headers` options, without switching to the gateway provider:

```bash
# Route Anthropic calls through a proxy
export RA_ANTHROPIC_BASE_URL=https://ai-gateway.tailscale.net/anthropic/v1
ra --provider anthropic --model claude-sonnet-4-6 "Hello"
```
