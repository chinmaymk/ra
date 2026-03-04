# Azure OpenAI

**Provider value:** `azure`

Azure OpenAI runs the same models as OpenAI but through your own Azure resource, with Azure's auth and compliance guarantees. ra uses `AzureOpenAI` from the `openai` SDK and supports both API key auth and `DefaultAzureCredential` from `@azure/identity`.

## Setup

**Option 1: API key**

```bash
export RA_AZURE_ENDPOINT=https://myresource.openai.azure.com/
export RA_AZURE_DEPLOYMENT=my-gpt4o
export RA_AZURE_API_KEY=your-azure-api-key
ra --provider azure "Hello"
```

**Option 2: DefaultAzureCredential (recommended for Azure-hosted workloads)**

When `RA_AZURE_API_KEY` is not set, ra falls back to `DefaultAzureCredential`, which tries these in order:

- `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` / `AZURE_TENANT_ID` env vars
- Workload identity (AKS)
- Managed identity (Azure VMs, App Service, Container Apps)
- Azure CLI (`az login`)
- Azure Developer CLI (`azd auth login`)

```bash
export RA_AZURE_ENDPOINT=https://myresource.openai.azure.com/
export RA_AZURE_DEPLOYMENT=my-gpt4o
ra --provider azure "Hello"
```

## Env vars

Credentials are env-only — never passed as CLI flags to keep them out of shell history.

| Variable | Required | Description |
|----------|----------|-------------|
| `RA_AZURE_ENDPOINT` | Yes | Your Azure OpenAI resource endpoint, e.g. `https://myresource.openai.azure.com/` |
| `RA_AZURE_DEPLOYMENT` | Yes | Deployment name (the model you deployed in Azure AI Studio) |
| `RA_AZURE_API_KEY` | No | API key auth. Omit to use `DefaultAzureCredential` |
| `RA_AZURE_API_VERSION` | No | Azure OpenAI API version, e.g. `2024-12-01-preview` |

## CLI flags

Non-sensitive options can also be set via CLI:

| Flag | Description |
|------|-------------|
| `--azure-endpoint` | Azure resource endpoint |
| `--azure-deployment` | Deployment name |

## Config file

```yaml
provider: azure
providers:
  azure:
    endpoint: https://myresource.openai.azure.com/
    deployment: my-gpt4o
    apiVersion: 2024-12-01-preview
```

## Deployment vs model

In Azure OpenAI, you deploy a model under a name you choose (e.g. `my-gpt4o`). ra uses the deployment name for all API calls — the `--model` flag is ignored when using Azure. Set your deployment via `RA_AZURE_DEPLOYMENT` or `--azure-deployment`.

## Thinking tokens

Supported levels: `low`, `medium`, `high` (requires a reasoning-capable deployment).

```bash
ra --provider azure --thinking medium "Analyze this architecture"
```
