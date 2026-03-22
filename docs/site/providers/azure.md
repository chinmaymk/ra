# Azure OpenAI

**Provider value:** `azure`

Azure OpenAI runs the same models as OpenAI but through your own Azure resource, with Azure's authentication and compliance guarantees. ra uses `AzureOpenAI` from the `openai` SDK and supports both API key and `DefaultAzureCredential` authentication.

## Setup

**Option 1: API key**

```bash
export AZURE_OPENAI_API_KEY=your-azure-api-key
export AZURE_OPENAI_ENDPOINT=https://myresource.openai.azure.com/
export AZURE_OPENAI_DEPLOYMENT=my-gpt4o
ra --provider azure "Hello"
```

**Option 2: DefaultAzureCredential** (recommended for Azure-hosted workloads)

When `AZURE_OPENAI_API_KEY` is not set, ra falls back to `DefaultAzureCredential`, which tries these in order:

1. `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` / `AZURE_TENANT_ID` env vars
2. Workload identity (AKS)
3. Managed identity (Azure VMs, App Service, Container Apps)
4. Azure CLI (`az login`)
5. Azure Developer CLI (`azd auth login`)

```bash
export AZURE_OPENAI_ENDPOINT=https://myresource.openai.azure.com/
export AZURE_OPENAI_DEPLOYMENT=my-gpt4o
ra --provider azure "Hello"
```

## Environment variables

Credentials are env-only — never passed as CLI flags to keep them out of shell history.

| Variable | Required | Description |
|----------|----------|-------------|
| `AZURE_OPENAI_ENDPOINT` | Yes | Azure OpenAI resource endpoint |
| `AZURE_OPENAI_DEPLOYMENT` | Yes | Deployment name (as configured in Azure AI Studio) |
| `AZURE_OPENAI_API_KEY` | No | API key auth. Omit to use `DefaultAzureCredential` |

The API version can be set in a config file:

```yaml
app:
  providers:
    azure:
      apiVersion: 2024-12-01-preview
```

## CLI flags

Non-sensitive options can also be set via CLI:

| Flag | Description |
|------|-------------|
| `--azure-endpoint` | Azure resource endpoint |
| `--azure-deployment` | Deployment name |

## Config file

```yaml
app:
  providers:
    azure:
      endpoint: https://myresource.openai.azure.com/
      deployment: my-gpt4o
      apiVersion: 2024-12-01-preview
agent:
  provider: azure
```

## Deployment vs model

In Azure OpenAI, you deploy a model under a name you choose (e.g. `my-gpt4o`). ra uses the deployment name for all API calls — the `--model` flag is ignored when using Azure. Set your deployment via `AZURE_OPENAI_DEPLOYMENT` or `--azure-deployment`.

## Extended thinking

Supported modes: `off`, `low`, `medium`, `high`, `adaptive` (requires a reasoning-capable deployment).

```bash
ra --provider azure --thinking medium "Analyze this architecture"
```

## See also

- [Context Control](/core/context-control) — extended thinking details
- [Configuration](/configuration/) — provider credentials reference
