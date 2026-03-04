# Azure AI Provider Design

**Date:** 2026-03-04
**Status:** Approved

## Summary

Add Azure OpenAI support by extending the existing `OpenAIProvider` class with an `AzureProvider` subclass that uses the `@azure/openai` SDK. This reuses all message/tool/content mapping logic and only overrides the client initialization and model routing.

## Motivation

Azure OpenAI exposes the same API surface as OpenAI but requires different authentication (API key, MSI, DefaultAzureCredential) and routing (endpoint + deployment name instead of model name). The `@azure/openai` SDK is a drop-in extension of the `openai` package, making the subclass approach natural.

## Approach

`AzureProvider extends OpenAIProvider`. Two minimal changes to `OpenAIProvider` enable this:

- `private client` → `protected client`
- `private buildParams` → `protected buildParams`

Everything else (stream, chat, mapMessages, mapTools, mapContentParts, mapResponseToMessage) is inherited unchanged.

## AzureProvider Overrides

1. **Constructor** — builds `AzureOpenAI` client from `@azure/openai`:
   - If `apiKey` is provided: API key auth
   - If `apiKey` is absent: `DefaultAzureCredential` from `@azure/identity` (covers MSI, env vars, Azure CLI, workload identity)

2. **`buildParams`** — replaces `request.model` with `this.deployment` so Azure routes to the correct deployment regardless of what `--model` is set to.

3. **`name`** — `'azure'`

## Configuration

### `AzureProviderOptions`

| Field | Type | Required | Description |
|---|---|---|---|
| `endpoint` | `string` | yes | e.g. `https://myresource.openai.azure.com/` |
| `deployment` | `string` | yes | Deployment name (maps to model in API calls) |
| `apiKey` | `string` | no | API key auth; omit to use DefaultAzureCredential |
| `apiVersion` | `string` | no | Azure OpenAI API version; no default |

### Defaults

```ts
azure: { endpoint: '', deployment: '', apiKey: '' }
// apiVersion: undefined — no default, user sets explicitly
```

### Config Layers (defaults < file < env < CLI)

**Environment variables** (API key is env-only to avoid leaking in shell history):
- `RA_AZURE_API_KEY`
- `RA_AZURE_ENDPOINT`
- `RA_AZURE_DEPLOYMENT`
- `RA_AZURE_API_VERSION`

**CLI flags** (non-sensitive only):
- `--azure-endpoint <url>`
- `--azure-deployment <name>`

**Config file** — full `providers.azure` block supported via JSON/YAML/TOML:
```yaml
provider: azure
providers:
  azure:
    endpoint: https://myresource.openai.azure.com/
    deployment: my-gpt4o
    apiVersion: 2024-12-01-preview
```

## Files Changed

| File | Change |
|---|---|
| `src/providers/openai.ts` | `private` → `protected` for `client` and `buildParams` |
| `src/providers/azure.ts` | New file — `AzureProvider` class |
| `src/config/types.ts` | Add `'azure'` to `ProviderName`; add `azure` to providers map |
| `src/config/defaults.ts` | Add `azure` defaults |
| `src/config/index.ts` | Add 4 env vars |
| `src/providers/registry.ts` | Add `AzureProvider` to type map and switch |
| `src/interfaces/parse-args.ts` | Add 2 CLI flags |
| `package.json` | Add `@azure/openai` and `@azure/identity` |

## Usage Examples

```bash
# API key auth
RA_AZURE_API_KEY=xxx \
RA_AZURE_ENDPOINT=https://myresource.openai.azure.com/ \
ra --provider azure --azure-deployment gpt-4o

# DefaultAzureCredential (MSI / Azure CLI / env)
RA_AZURE_ENDPOINT=https://myresource.openai.azure.com/ \
ra --provider azure --azure-deployment gpt-4o
```
