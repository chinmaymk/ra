# Docs Solarized Dark Theme Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Apply Solarized Dark theme with cyan accent to the VitePress docs site.

**Architecture:** Override VitePress CSS variables in `style.css`, set `appearance: 'dark'` and add Google Fonts in `config.ts`, and create a `>_` logo SVG in `public/`.

**Tech Stack:** VitePress 1.6, CSS custom properties, Google Fonts (JetBrains Mono), SVG

---

### Task 1: Apply Solarized Dark CSS

**Files:**
- Modify: `docs/site/.vitepress/theme/style.css`

**Step 1: Replace the entire contents of `docs/site/.vitepress/theme/style.css` with:**

```css
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap');

/* Solarized Dark palette */
/* base03: #002b36 | base02: #073642 | base01: #586e75 | base00: #657b83 */
/* base0:  #839496 | base1:  #93a1a1 | base2:  #eee8d5 | base3:  #fdf6e3 */
/* yellow: #b58900 | orange: #cb4b16 | red: #dc322f | magenta: #d33682  */
/* violet: #6c71c4 | blue:   #268bd2 | cyan: #2aa198 | green: #859900   */

:root {
  --vp-font-family-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
}

.dark {
  /* Backgrounds */
  --vp-c-bg: #002b36;
  --vp-c-bg-soft: #073642;
  --vp-c-bg-mute: #0a3d4a;
  --vp-c-bg-elv: #073642;
  --vp-c-bg-alt: #001f29;

  /* Text */
  --vp-c-text-1: #93a1a1;
  --vp-c-text-2: #839496;
  --vp-c-text-3: #586e75;

  /* Brand — Solarized cyan */
  --vp-c-brand-1: #2aa198;
  --vp-c-brand-2: #239990;
  --vp-c-brand-3: #1c7a72;
  --vp-c-brand-soft: rgba(42, 161, 152, 0.14);

  /* Borders & dividers */
  --vp-c-divider: #073642;
  --vp-c-border: #0d4a57;
  --vp-c-gutter: #001f29;

  /* Nav */
  --vp-nav-bg-color: #001f29;
  --vp-nav-screen-bg-color: #001f29;

  /* Sidebar */
  --vp-sidebar-bg-color: #001f29;

  /* Code blocks */
  --vp-code-block-bg: #073642;
  --vp-code-color: #93a1a1;
  --vp-code-bg: rgba(7, 54, 66, 0.8);

  /* Inline code */
  --vp-c-default-soft: rgba(7, 54, 66, 0.8);

  /* Custom containers */
  --vp-c-tip-1: #2aa198;
  --vp-c-tip-2: #2aa198;
  --vp-c-tip-soft: rgba(42, 161, 152, 0.12);

  --vp-c-warning-1: #b58900;
  --vp-c-warning-2: #b58900;
  --vp-c-warning-soft: rgba(181, 137, 0, 0.12);

  --vp-c-danger-1: #dc322f;
  --vp-c-danger-2: #dc322f;
  --vp-c-danger-soft: rgba(220, 50, 47, 0.12);

  --vp-c-caution-1: #cb4b16;
  --vp-c-caution-2: #cb4b16;
  --vp-c-caution-soft: rgba(203, 75, 22, 0.12);
}

/* Home page hero */
.dark .VPHero .name {
  background: linear-gradient(120deg, #2aa198 20%, #268bd2 80%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* Code block: terminal-style top bar */
.dark .vp-code-group .tabs,
.dark div[class*='language-'] {
  border: 1px solid #073642;
  border-radius: 8px;
}

/* Local search modal */
.dark .VPLocalSearchBox {
  --vp-local-search-bg: #002b36;
  --vp-local-search-result-bg: #073642;
  --vp-local-search-highlight-bg: rgba(42, 161, 152, 0.2);
  --vp-local-search-highlight-text: #2aa198;
}
```

**Step 2: Verify build passes:**

```bash
cd /Users/chinmaymk/github/ra/docs/site && bun run build 2>&1 | tail -5
```

Expected: `build complete in X.XXs`

**Step 3: Commit:**

```bash
cd /Users/chinmaymk/github/ra
git add docs/site/.vitepress/theme/style.css
git commit -m "feat(docs): apply Solarized Dark theme with cyan brand accent"
```

---

### Task 2: Update config for dark mode default + Google Fonts

**Files:**
- Modify: `docs/site/.vitepress/config.ts`

**Step 1: Replace the contents of `docs/site/.vitepress/config.ts` with:**

```ts
import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'ra',
  description: 'raw agent. role agent. run-anything agent.',
  base: '/ra/',
  appearance: 'dark',
  head: [
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap' }],
  ],
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

**Step 2: Verify build passes:**

```bash
cd /Users/chinmaymk/github/ra/docs/site && bun run build 2>&1 | tail -5
```

Expected: `build complete in X.XXs`

**Step 3: Commit:**

```bash
cd /Users/chinmaymk/github/ra
git add docs/site/.vitepress/config.ts
git commit -m "feat(docs): set dark mode default and load JetBrains Mono from Google Fonts"
```

---

### Task 3: Create logo SVG

**Files:**
- Create: `docs/site/public/logo.svg`

**Step 1: Create `docs/site/public/logo.svg`:**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <rect width="32" height="32" rx="6" fill="#073642"/>
  <text x="4" y="22" font-family="'JetBrains Mono', 'Fira Code', monospace" font-size="14" font-weight="600" fill="#2aa198">ra</text>
</svg>
```

**Step 2: Verify build passes:**

```bash
cd /Users/chinmaymk/github/ra/docs/site && bun run build 2>&1 | tail -5
```

Expected: `build complete in X.XXs`

**Step 3: Commit:**

```bash
cd /Users/chinmaymk/github/ra
git add docs/site/public/logo.svg
git commit -m "feat(docs): add ra logo SVG in Solarized Dark cyan"
```
