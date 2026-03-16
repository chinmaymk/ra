# GitHub Pages Documentation Site Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Set up a VitePress documentation site in `docs/site/` with migrated README content, a copy-page button for agents, and automated GitHub Pages deployment.

**Architecture:** VitePress project at `docs/site/` with a custom Vue component (`CopyPageButton.vue`) that copies raw markdown to clipboard. A VitePress plugin inlines each page's source markdown as a virtual module. GitHub Actions deploys on push to `main`.

**Tech Stack:** VitePress, Vue 3, Bun, GitHub Actions (`peaceiris/actions-gh-pages`)

---

### Task 1: Initialize VitePress project

**Files:**
- Create: `docs/site/package.json`
- Create: `docs/site/.vitepress/config.ts`
- Create: `docs/site/index.md`

**Step 1: Create `docs/site/package.json`**

```json
{
  "name": "ra-docs",
  "private": true,
  "scripts": {
    "dev": "vitepress dev",
    "build": "vitepress build",
    "preview": "vitepress preview"
  },
  "devDependencies": {
    "vitepress": "^1.6.3"
  }
}
```

**Step 2: Install dependencies**

```bash
cd docs/site && bun install
```

Expected: `node_modules/` created, `bun.lock` written.

**Step 3: Create minimal `docs/site/.vitepress/config.ts`**

```ts
import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'ra',
  description: 'raw agent. role agent. run-anything agent.',
  base: '/ra/',
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Guide', link: '/getting-started/install' },
      { text: 'Config', link: '/configuration/' },
      { text: 'API', link: '/api/' },
    ],
    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'Install', link: '/getting-started/install' },
          { text: 'Quick Start', link: '/getting-started/quick-start' },
        ],
      },
      {
        text: 'Concepts',
        items: [
          { text: 'What is ra?', link: '/concepts/' },
          { text: 'Layered Config', link: '/concepts/config' },
          { text: 'Providers', link: '/concepts/providers' },
        ],
      },
      {
        text: 'Modes',
        items: [
          { text: 'CLI (one-shot)', link: '/modes/cli' },
          { text: 'REPL', link: '/modes/repl' },
          { text: 'HTTP Server', link: '/modes/http' },
          { text: 'MCP Server', link: '/modes/mcp' },
        ],
      },
      {
        text: 'Configuration',
        items: [
          { text: 'Reference', link: '/configuration/' },
        ],
      },
      {
        text: 'Providers',
        items: [
          { text: 'Anthropic', link: '/providers/anthropic' },
          { text: 'OpenAI', link: '/providers/openai' },
          { text: 'Google Gemini', link: '/providers/google' },
          { text: 'Ollama', link: '/providers/ollama' },
          { text: 'AWS Bedrock', link: '/providers/bedrock' },
        ],
      },
      {
        text: 'Features',
        items: [
          { text: 'Skills', link: '/skills/' },
          { text: 'Middleware', link: '/middleware/' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'HTTP API', link: '/api/' },
          { text: 'Recipes', link: '/recipes/' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/chinmaymk/ra' },
    ],
    search: { provider: 'local' },
  },
})
```

**Step 4: Create minimal landing page `docs/site/index.md`**

```md
---
layout: home

hero:
  name: "ra"
  text: "raw agent. role agent. run-anything agent."
  tagline: One binary you configure into whatever agent you need — without rewriting anything.
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/install
    - theme: alt
      text: Quick Start
      link: /getting-started/quick-start

features:
  - title: Five Providers
    details: Anthropic, OpenAI, Google Gemini, Ollama, AWS Bedrock. Flip RA_PROVIDER and keep going.
  - title: Four Modes
    details: One-shot CLI, interactive REPL, HTTP server, MCP server. Same binary, different flags.
  - title: Layered Config
    details: defaults > file > env > CLI. Commit a baseline, override per-run. No surprises.
  - title: Skills & Middleware
    details: Reusable instruction bundles and composable middleware. Build any agent from config.
---
```

**Step 5: Verify dev server starts**

```bash
cd docs/site && bun run dev
```

Expected: VitePress dev server at `http://localhost:5173/ra/` showing the landing page.

**Step 6: Commit**

```bash
cd /Users/chinmaymk/github/ra
git add docs/site/
git commit -m "feat(docs): initialize VitePress project with sidebar and landing page"
```

---

### Task 2: Add copy-page button

**Files:**
- Create: `docs/site/.vitepress/theme/index.ts`
- Create: `docs/site/.vitepress/theme/CopyPageButton.vue`
- Create: `docs/site/.vitepress/theme/style.css`
- Modify: `docs/site/.vitepress/config.ts`

**Step 1: Create `docs/site/.vitepress/theme/CopyPageButton.vue`**

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useData } from 'vitepress'

const { page } = useData()
const copied = ref(false)

async function copyPage() {
  // page.value.relativePath is like "getting-started/install.md"
  const url = `https://raw.githubusercontent.com/chinmaymk/ra/main/docs/site/${page.value.relativePath}`
  try {
    const res = await fetch(url)
    const text = await res.text()
    await navigator.clipboard.writeText(text)
  } catch {
    // fallback: copy page title + URL
    await navigator.clipboard.writeText(window.location.href)
  }
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}
</script>

<template>
  <button class="copy-page-btn" @click="copyPage" :title="copied ? 'Copied!' : 'Copy page as markdown'">
    <span v-if="copied">✓ Copied</span>
    <span v-else>
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
      Copy page
    </span>
  </button>
</template>

<style scoped>
.copy-page-btn {
  position: fixed;
  top: 72px;
  right: 24px;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 12px;
  font-family: inherit;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s;
}
.copy-page-btn:hover {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}
</style>
```

**Step 2: Create `docs/site/.vitepress/theme/index.ts`**

```ts
import DefaultTheme from 'vitepress/theme'
import CopyPageButton from './CopyPageButton.vue'
import './style.css'
import type { Theme } from 'vitepress'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('CopyPageButton', CopyPageButton)
  },
} satisfies Theme
```

**Step 3: Create `docs/site/.vitepress/theme/style.css`**

```css
:root {
  --vp-font-family-base: 'Inter', ui-sans-serif, system-ui, sans-serif;
}
```

**Step 4: Register the button in layout — add to `config.ts` inside `themeConfig`:**

VitePress doesn't have a global slot for this in config. Instead add the component to the layout via the theme. Update `docs/site/.vitepress/theme/index.ts`:

```ts
import DefaultTheme from 'vitepress/theme'
import CopyPageButton from './CopyPageButton.vue'
import { h } from 'vue'
import './style.css'
import type { Theme } from 'vitepress'

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'doc-before': () => h(CopyPageButton),
    })
  },
  enhanceApp({ app }) {
    app.component('CopyPageButton', CopyPageButton)
  },
} satisfies Theme
```

**Step 5: Verify in dev server**

```bash
cd docs/site && bun run dev
```

Expected: Copy button visible top-right on all doc pages. Clicking it fetches the raw markdown and shows "✓ Copied".

**Step 6: Commit**

```bash
cd /Users/chinmaymk/github/ra
git add docs/site/.vitepress/theme/
git commit -m "feat(docs): add copy-page button for agent-friendly markdown access"
```

---

### Task 3: Create Getting Started pages

**Files:**
- Create: `docs/site/getting-started/install.md`
- Create: `docs/site/getting-started/quick-start.md`

**Step 1: Create `docs/site/getting-started/install.md`**

Migrate from README `### Install` section:

```md
# Install

Grab the `ra` binary for your OS. Put it somewhere on your `PATH`. Done.

```bash
mv ra /usr/local/bin/ra
chmod +x /usr/local/bin/ra
ra --help
```

If `ra --help` prints something, you're in.

## From source

Requires [Bun](https://bun.sh).

```bash
git clone https://github.com/chinmaymk/ra
cd ra
bun install
bun run compile
# outputs dist/ra
```
```

**Step 2: Create `docs/site/getting-started/quick-start.md`**

Migrate from README `### Quick start` section:

```md
# Quick Start

## One-off question

```bash
ra "What is the capital of France?"
```

Streams to stdout and exits.

## Pick a provider and model

```bash
ra --provider openai --model gpt-4.1-mini "Explain this error"
```

## Attach a file

```bash
ra --file report.pdf "Summarize in three bullets."
```

## Inject a skill

```bash
ra --skill code-review --file diff.patch "Review this diff."
```

## Start the REPL

```bash
ra
```

You get a `›` prompt. Type. It streams back, runs tools, saves the conversation.

## Next steps

- [Configure a provider](/providers/anthropic) — set your API key
- [Learn the modes](/modes/cli) — CLI, REPL, HTTP, MCP
- [Explore layered config](/concepts/config) — file > env > CLI
```

**Step 3: Commit**

```bash
git add docs/site/getting-started/
git commit -m "docs: add getting started pages (install + quick start)"
```

---

### Task 4: Create Concepts pages

**Files:**
- Create: `docs/site/concepts/index.md`
- Create: `docs/site/concepts/config.md`
- Create: `docs/site/concepts/providers.md`

**Step 1: Create `docs/site/concepts/index.md`**

Migrate from README `### Why ra?` and intro sections:

```md
# What is ra?

> **ra** is a **r**aw **a**gent. A **r**ole **a**gent. A **r**un-**a**nything **a**gent.
>
> One binary you configure into whatever agent you need — without rewriting anything.

Same binary. Different config. Different agent.

- Drop a `ra.config.yml` in a repo → a project-specific assistant with its own system prompt, skills, and tools
- Set env vars → a different provider, a different persona, the same CLI
- Pass `--skill` → inject a role or behavior at runtime
- Run `--mcp` → expose it as a tool to Cursor, Claude Desktop, or anything MCP-aware

## Why ra?

Most AI tools lock you into one shape — a chat UI, a framework, a cloud product. ra is the opposite. It's an **agent primitive**: small, composable, and configurable enough to become whatever you need.

Give it a system prompt and it has a personality. Give it skills and it has expertise. Connect MCP servers and it has tools. Point it at a different provider and it speaks a different model. The binary never changes — only the configuration does.

That's what makes ra powerful for **agentic loops**. Drop a config file alongside your code, run `ra "do the thing"`, and you have a domain-specific agent that understands your codebase, your tools, and your workflow. Need a code reviewer? A support bot? A CI agent? Same binary, different `ra.config.yml`.

## What's in the box

| Feature | Description |
|---------|-------------|
| **REPL** | Interactive sessions with history |
| **One-shot CLI** | Scriptable prompts, streams to stdout |
| **HTTP API** | Sync + streaming chat, session management |
| **MCP client** | Pull tools from other MCP servers |
| **MCP server** | Expose ra as a tool to other apps |
| **Tool calling** | Model invokes functions, ra executes them |
| **Skills** | Reusable instruction bundles — roles, behaviors, and assets |
| **File attachments** | Attach files in CLI and REPL |
| **Session storage** | Persist conversations, resume later, auto-prune old ones |
| **Layered config** | File > env > CLI override order; commit a baseline, tweak per-run |
```

**Step 2: Create `docs/site/concepts/config.md`**

Migrate from README `### Layered config` section:

```md
# Layered Config

**defaults > file > env > CLI.** Each layer overrides the previous. No surprise precedence.

Commit a `ra.config.yml` for a team or project baseline. Use environment variables for secrets and per-environment behavior. Use CLI flags when you need a one-off override.

## Config file locations

ra searches the current directory for any of these files:

- `ra.config.json`
- `ra.config.yaml`
- `ra.config.yml`
- `ra.config.toml`

## Environment variables

| Variable | Description |
|----------|-------------|
| `RA_PROVIDER` | Provider name (`anthropic`, `openai`, `google`, `ollama`, `bedrock`) |
| `RA_MODEL` | Model name |
| `RA_SYSTEM_PROMPT` | System prompt string |
| `RA_MAX_ITERATIONS` | Max agent loop iterations |

## Provider credentials (env only)

Credentials are never exposed as CLI flags to keep them out of shell history.

| Provider | Env var(s) |
|----------|-----------|
| Anthropic | `RA_ANTHROPIC_API_KEY`, `RA_ANTHROPIC_BASE_URL` |
| OpenAI | `RA_OPENAI_API_KEY`, `RA_OPENAI_BASE_URL` |
| Google | `RA_GOOGLE_API_KEY` |
| Ollama | `RA_OLLAMA_HOST` |
| Bedrock | `RA_BEDROCK_API_KEY`, `RA_BEDROCK_REGION` |

## CLI flags

CLI flags override everything. Use them for one-off runs.

```bash
ra --provider openai --model gpt-4.1-mini "Your prompt"
```

See `ra --help` for the full list.
```

**Step 3: Create `docs/site/concepts/providers.md`**

```md
# Providers

ra supports five providers. All use the same interface — swap `RA_PROVIDER` and keep going.

| Provider | Value | Notes |
|----------|-------|-------|
| Anthropic | `anthropic` | Default. Claude models. |
| OpenAI | `openai` | GPT and o-series models. Compatible base URLs. |
| Google Gemini | `google` | Gemini models. |
| Ollama | `ollama` | Local models. No API key required. |
| AWS Bedrock | `bedrock` | AWS-hosted models. Bearer token or AWS credential chain. |

See the individual provider pages for setup and credential details.
```

**Step 4: Commit**

```bash
git add docs/site/concepts/
git commit -m "docs: add concepts pages (what is ra, layered config, providers overview)"
```

---

### Task 5: Create Modes pages

**Files:**
- Create: `docs/site/modes/cli.md`
- Create: `docs/site/modes/repl.md`
- Create: `docs/site/modes/http.md`
- Create: `docs/site/modes/mcp.md`

**Step 1: Create `docs/site/modes/cli.md`**

```md
# CLI (One-Shot)

Run a prompt, stream output, exit. No state, no sessions — just input → output.

```bash
ra "What is the capital of France?"
```

Useful for scripting, piping, and cron jobs.

## Common flags

```bash
ra --provider openai --model gpt-4.1-mini "Explain this"
ra --file report.pdf "Summarize in three bullets"
ra --skill code-review --file diff.patch "Review this diff"
ra --system-prompt "You are a JSON extractor. Output only JSON." "Extract fields from: ..."
```

## Piping

```bash
cat error.log | ra "What is causing this error?"
git diff | ra --skill code-review "Review this diff"
```

## Exit codes

- `0` — success
- non-zero — error (provider failure, config error, etc.)
```

**Step 2: Create `docs/site/modes/repl.md`**

Migrate from README `### REPL` section:

```md
# REPL

```bash
ra
```

You get a `›` prompt. Type. It streams back, runs tools, saves the conversation.

## Commands

| Command | Description |
|--------|-------------|
| `/clear` | Clear history, start fresh |
| `/resume <session-id>` | Load and continue a previous session |
| `/skill <name>` | Inject a skill with your next message |
| `/attach <path>` | Attach a file to your next message |

## Sessions

Conversations are automatically saved. Use `/resume` to continue a previous session, or `ra --resume <id>` to start in a resumed state.

```bash
ra --resume abc123
```

## Tips

- Use `/attach` to give the model context from files mid-conversation
- Use `/skill` to switch the model's behavior on the fly
- Sessions are pruned automatically after the configured retention period
```

**Step 3: Create `docs/site/modes/http.md`**

Migrate from README `### HTTP API` section:

```md
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
```

**Step 4: Create `docs/site/modes/mcp.md`**

Migrate from README `### MCP` section:

```md
# MCP

ra speaks MCP in both directions.

## ra as MCP client (uses tools)

Add MCP server configs to `ra.config.yml` and ra connects to them at startup, discovers their tools, and registers them with the model. The model calls them like any other function.

```yaml
mcp:
  servers:
    - name: filesystem
      command: npx
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
```

## ra as MCP server (is a tool)

```bash
ra --mcp
```

ra exposes itself as a single MCP tool that takes a prompt and runs the full agent loop. Other apps — Cursor, Claude Desktop, your own agents — can call it.

### Cursor integration

Add to your Cursor MCP config:

```json
{
  "mcpServers": {
    "ra": {
      "command": "ra",
      "args": ["--mcp"]
    }
  }
}
```

### Claude Desktop integration

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ra": {
      "command": "ra",
      "args": ["--mcp"]
    }
  }
}
```
```

**Step 5: Commit**

```bash
git add docs/site/modes/
git commit -m "docs: add modes pages (CLI, REPL, HTTP server, MCP server)"
```

---

### Task 6: Create Configuration reference page

**Files:**
- Create: `docs/site/configuration/index.md`

**Step 1: Create `docs/site/configuration/index.md`**

```md
# Configuration Reference

ra uses a layered config system: **defaults > file > env > CLI**. See [Layered Config](/concepts/config) for how it works.

## Config file

Create `ra.config.yml` (or `.json`, `.toml`) in your project root:

```yaml
provider: anthropic
model: claude-sonnet-4-6
systemPrompt: "You are a helpful assistant."
maxIterations: 10

http:
  port: 3000
  token: your-secret-token

mcp:
  servers:
    - name: filesystem
      command: npx
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
```

## All fields

| Field | Env var | CLI flag | Default | Description |
|-------|---------|----------|---------|-------------|
| `provider` | `RA_PROVIDER` | `--provider` | `anthropic` | AI provider |
| `model` | `RA_MODEL` | `--model` | provider default | Model name |
| `systemPrompt` | `RA_SYSTEM_PROMPT` | `--system-prompt` | — | System prompt |
| `maxIterations` | `RA_MAX_ITERATIONS` | `--max-iterations` | `10` | Max agent loop iterations |
| `thinking` | `RA_THINKING` | `--thinking` | `false` | Enable thinking tokens |

## Provider credentials

See individual [provider pages](/providers/anthropic) for credential env vars.
```

**Step 2: Commit**

```bash
git add docs/site/configuration/
git commit -m "docs: add configuration reference page"
```

---

### Task 7: Create Provider pages

**Files:**
- Create: `docs/site/providers/anthropic.md`
- Create: `docs/site/providers/openai.md`
- Create: `docs/site/providers/google.md`
- Create: `docs/site/providers/ollama.md`
- Create: `docs/site/providers/bedrock.md`

**Step 1: Create `docs/site/providers/anthropic.md`**

```md
# Anthropic

**Provider value:** `anthropic`

## Setup

```bash
export RA_ANTHROPIC_API_KEY=sk-ant-...
ra "Hello"
```

## Env vars

| Variable | Required | Description |
|----------|----------|-------------|
| `RA_ANTHROPIC_API_KEY` | Yes | Anthropic API key |
| `RA_ANTHROPIC_BASE_URL` | No | Custom base URL (for proxies) |

## Models

Popular models:

| Model | Notes |
|-------|-------|
| `claude-sonnet-4-6` | Default. Best balance of speed and capability. |
| `claude-opus-4-6` | Most capable. |
| `claude-haiku-4-5-20251001` | Fastest, cheapest. |

## Thinking tokens

Enable extended thinking for deeper reasoning:

```bash
ra --thinking "Solve this step by step: ..."
```

Or in config:

```yaml
provider: anthropic
thinking: true
```
```

**Step 2: Create `docs/site/providers/openai.md`**

```md
# OpenAI

**Provider value:** `openai`

## Setup

```bash
export RA_OPENAI_API_KEY=sk-...
ra --provider openai "Hello"
```

## Env vars

| Variable | Required | Description |
|----------|----------|-------------|
| `RA_OPENAI_API_KEY` | Yes | OpenAI API key |
| `RA_OPENAI_BASE_URL` | No | Custom base URL (OpenAI-compatible APIs) |

## Models

| Model | Notes |
|-------|-------|
| `gpt-4.1` | Flagship GPT-4.1 |
| `gpt-4.1-mini` | Faster, cheaper |
| `o3` | Reasoning model |
| `o4-mini` | Reasoning, fast |

## OpenAI-compatible APIs

Point `RA_OPENAI_BASE_URL` at any OpenAI-compatible endpoint:

```bash
export RA_OPENAI_BASE_URL=https://api.together.xyz/v1
export RA_OPENAI_API_KEY=your-together-key
ra --provider openai --model meta-llama/Llama-3-70b-chat-hf "Hello"
```
```

**Step 3: Create `docs/site/providers/google.md`**

```md
# Google Gemini

**Provider value:** `google`

## Setup

```bash
export RA_GOOGLE_API_KEY=AIza...
ra --provider google "Hello"
```

## Env vars

| Variable | Required | Description |
|----------|----------|-------------|
| `RA_GOOGLE_API_KEY` | Yes | Google AI API key |

## Models

| Model | Notes |
|-------|-------|
| `gemini-2.5-pro` | Most capable |
| `gemini-2.0-flash` | Fast and efficient |

## Thinking

```bash
ra --provider google --thinking "Reason through this carefully: ..."
```
```

**Step 4: Create `docs/site/providers/ollama.md`**

```md
# Ollama

**Provider value:** `ollama`

Run models locally. No API key required.

## Setup

1. Install [Ollama](https://ollama.ai)
2. Pull a model: `ollama pull llama3.2`
3. Run ra:

```bash
ra --provider ollama --model llama3.2 "Hello"
```

## Env vars

| Variable | Required | Description |
|----------|----------|-------------|
| `RA_OLLAMA_HOST` | No | Ollama host (default: `http://localhost:11434`) |

## Remote Ollama

```bash
export RA_OLLAMA_HOST=http://my-server:11434
ra --provider ollama --model llama3.2 "Hello"
```
```

**Step 5: Create `docs/site/providers/bedrock.md`**

```md
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
```

**Step 6: Commit**

```bash
git add docs/site/providers/
git commit -m "docs: add provider pages (Anthropic, OpenAI, Google, Ollama, Bedrock)"
```

---

### Task 8: Create Skills, Middleware, API, and Recipes stubs

**Files:**
- Create: `docs/site/skills/index.md`
- Create: `docs/site/middleware/index.md`
- Create: `docs/site/api/index.md`
- Create: `docs/site/recipes/index.md`

**Step 1: Create `docs/site/skills/index.md`**

```md
# Skills

Skills are reusable instruction bundles — markdown files that inject roles, behaviors, or domain knowledge into a conversation.

## Using skills

**At runtime:**

```bash
ra --skill code-review "Review this diff"
```

**In REPL:**

```
/skill code-review
```

**In config:**

```yaml
skills:
  - code-review
```

## Writing skills

Create a markdown file anywhere on your skill path:

```md
---
name: code-review
description: Reviews code for correctness, style, and security
---

You are a senior engineer performing a code review. For each change:
- Point out bugs and security issues first
- Then style and maintainability issues
- Suggest specific improvements, not just problems
```

## Skill directories

Configure where ra looks for skills:

```yaml
skillDirs:
  - ~/.ra/skills
  - .ra/skills
```

::: tip Coming soon
More detailed skill authoring guide, skill composition, and asset skills.
:::
```

**Step 2: Create `docs/site/middleware/index.md`**

```md
# Middleware

Middleware functions run in a chain around each agent loop iteration. They can inspect and modify the context, short-circuit execution, add logging, enforce policies, or inject behavior.

## Writing middleware

```ts
// ra.config.ts (or inline in ra.config.yml as a JS/TS file path)
export default {
  middleware: [
    async (ctx, next) => {
      console.log('Before:', ctx.messages.length, 'messages')
      await next()
      console.log('After:', ctx.response)
    }
  ]
}
```

## Stopping the loop

Call `ctx.stop()` to halt the agent loop early:

```ts
async (ctx, next) => {
  if (ctx.iteration > 3) {
    ctx.stop()
    return
  }
  await next()
}
```

::: tip Coming soon
Full middleware API reference, built-in middleware, and middleware config file support.
:::
```

**Step 3: Create `docs/site/api/index.md`**

```md
# HTTP API Reference

Start the server:

```bash
ra --http
```

Default port: `3000`. Set `RA_HTTP_PORT` or configure in `ra.config.yml`.

## Authentication

If a token is configured, all requests require:

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
```

**Step 4: Create `docs/site/recipes/index.md`**

```md
# Recipes

Common patterns for using ra in real workflows.

## Project-specific agent

Drop a `ra.config.yml` in your repo:

```yaml
provider: anthropic
model: claude-sonnet-4-6
systemPrompt: |
  You are an expert on this codebase. You know TypeScript, Bun, and the project structure.
  When asked to make changes, write the code directly — don't describe what to do.
skillDirs:
  - .ra/skills
```

Now `ra` in that directory becomes a project-aware agent.

## CI code reviewer

```yaml
# .github/workflows/review.yml
- name: Review PR
  run: git diff origin/main | ra --skill code-review "Review this PR diff"
```

## Pipe and chain

```bash
# Summarize a log file
cat server.log | ra "Summarize errors in the last 100 lines"

# Chain: extract → transform
ra "List all TODO comments" | ra "Group by priority and format as a table"
```

## MCP tool in Claude Desktop

```json
{
  "mcpServers": {
    "project-agent": {
      "command": "ra",
      "args": ["--mcp"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

::: tip More recipes coming soon
Custom provider rotation, session management patterns, multi-agent orchestration.
:::
```

**Step 5: Commit**

```bash
git add docs/site/skills/ docs/site/middleware/ docs/site/api/ docs/site/recipes/
git commit -m "docs: add skills, middleware, API reference, and recipes pages"
```

---

### Task 9: GitHub Actions deployment workflow

**Files:**
- Create: `.github/workflows/docs.yml`

**Step 1: Create `.github/workflows/docs.yml`**

```yaml
name: Deploy docs to GitHub Pages

on:
  push:
    branches: [main]
    paths:
      - 'docs/site/**'
      - '.github/workflows/docs.yml'
  workflow_dispatch:

permissions:
  contents: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install
        working-directory: docs/site

      - name: Build docs
        run: bun run build
        working-directory: docs/site

      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: docs/site/.vitepress/dist
```

**Step 2: Commit**

```bash
git add .github/workflows/docs.yml
git commit -m "ci: add GitHub Actions workflow to deploy docs to GitHub Pages"
```

**Step 3: Enable GitHub Pages**

After pushing, go to:
`Settings → Pages → Source → Deploy from branch → gh-pages → / (root)`

The site will be live at `https://chinmaymk.github.io/ra/`.

---

### Task 10: Final verification

**Step 1: Full local build**

```bash
cd docs/site && bun run build
```

Expected: No errors. Output in `docs/site/.vitepress/dist/`.

**Step 2: Preview locally**

```bash
cd docs/site && bun run preview
```

Open `http://localhost:4173/ra/`. Verify:
- Landing page renders correctly
- All sidebar links navigate without 404
- Copy button visible and functional on doc pages
- Dark mode works

**Step 3: Commit if any fixes needed, then push**

```bash
git push origin main
```

Expected: GitHub Actions workflow triggers, builds, and deploys to `gh-pages` branch within ~2 minutes.
