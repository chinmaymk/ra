# AWS Bedrock

**Provider value:** `bedrock`

## Setup

**Option 1: Bearer token**

```bash
export RA_BEDROCK_API_KEY=your-bearer-token
export RA_BEDROCK_REGION=us-east-1
ra --provider bedrock "Hello"
```

**Option 2: AWS credential chain**

If `RA_BEDROCK_API_KEY` is not set, ra falls back to the standard AWS credential chain:

- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` env vars
- `~/.aws/credentials` file
- IAM instance roles

```bash
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export RA_BEDROCK_REGION=us-east-1
ra --provider bedrock "Hello"
```

## Env vars

| Variable | Required | Description |
|----------|----------|-------------|
| `RA_BEDROCK_API_KEY` | No | Bearer token (if not using AWS credential chain) |
| `RA_BEDROCK_REGION` | Yes | AWS region (e.g. `us-east-1`) |

## Thinking tokens

Supported levels: `low`, `medium`, `high`.

```bash
ra --provider bedrock --thinking medium "Analyze this architecture"
```
