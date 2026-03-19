import { defineConfig } from 'vitepress'
import fs from 'node:fs'
import path from 'node:path'

const base = process.env.DOCS_BASE ?? '/ra/'
const docsVersion = process.env.DOCS_VERSION ?? 'dev'

// Build version nav dropdown from versions.json (written by build-versioned.sh)
function buildVersionNav() {
  const versionsPath = path.resolve(__dirname, 'dist', 'versions.json')
  let versions: { latest: string; versions: string[] } | null = null
  try {
    versions = JSON.parse(fs.readFileSync(versionsPath, 'utf-8'))
  } catch {
    // versions.json doesn't exist yet (first build or dev mode)
  }

  if (!versions || versions.versions.length === 0) {
    return []
  }

  const label = docsVersion === 'dev' ? 'dev' : `v${docsVersion}`
  const items = [
    { text: 'dev', link: '/ra/dev/', target: '_self' },
    ...versions.versions.map(v => ({
      text: `v${v}${v === versions!.latest ? ' (latest)' : ''}`,
      link: v === versions!.latest ? '/ra/' : `/ra/v/${v}/`,
      target: '_self',
    })),
  ]

  return [{ text: label, items }]
}

export default defineConfig({
  title: 'ra',
  description: 'One Loop. Infinite Agents. A small, hackable agent.',
  base: base as `/${string}/`,
  appearance: 'dark',
  head: [
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap' }],
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/ra/favicon.svg' }],
  ],
  transformPageData(pageData) {
    const filePath = path.resolve(__dirname, '..', pageData.relativePath)
    try {
      pageData.rawMarkdown = fs.readFileSync(filePath, 'utf-8')
    } catch {
      pageData.rawMarkdown = ''
    }
  },
  themeConfig: {
    logo: '/logo.svg',
    nav: buildVersionNav(),
    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'Install', link: '/getting-started/install' },
          { text: 'Quick Start', link: '/getting-started/quick-start' },
        ],
      },
      {
        text: 'Core',
        items: [
          { text: 'What is ra?', link: '/concepts/' },
          { text: 'The Agent Loop', link: '/core/agent-loop' },
          { text: 'Context Control', link: '/core/context-control' },
          { text: 'Sessions', link: '/core/sessions' },
          { text: 'File Attachments', link: '/core/file-attachments' },
        ],
      },
      {
        text: 'Interfaces',
        items: [
          { text: 'CLI (One-Shot)', link: '/modes/cli' },
          { text: 'REPL', link: '/modes/repl' },
          { text: 'HTTP Server', link: '/modes/http' },
          { text: 'MCP', link: '/modes/mcp' },
          { text: 'Inspector', link: '/modes/inspector' },
          { text: 'GitHub Actions', link: '/modes/github-actions' },
        ],
      },
      {
        text: 'Features',
        items: [
          { text: 'Built-in Tools', link: '/tools/' },
          { text: 'Skills', link: '/skills/' },
          { text: 'Middleware', link: '/middleware/' },
          { text: 'Permissions', link: '/permissions/' },
          { text: 'Observability', link: '/observability/' },
        ],
      },
      {
        text: 'Providers',
        items: [
          { text: 'Anthropic', link: '/providers/anthropic' },
          { text: 'OpenAI', link: '/providers/openai' },
          { text: 'Azure OpenAI', link: '/providers/azure' },
          { text: 'Google Gemini', link: '/providers/google' },
          { text: 'AWS Bedrock', link: '/providers/bedrock' },
          { text: 'Ollama', link: '/providers/ollama' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Configuration', link: '/configuration/' },
          { text: 'HTTP API', link: '/api/' },
          { text: 'Recipes', link: '/recipes/' },
          { text: 'Dynamic Prompts', link: '/recipes/dynamic-prompts' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/chinmaymk/ra' },
    ],
    search: { provider: 'local' },
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026',
    },
    editLink: {
      pattern: 'https://github.com/chinmaymk/ra/edit/main/docs/site/:path',
      text: 'Edit this page on GitHub',
    },
  },
})
