import { defineConfig } from 'vitepress'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const MIN_VERSION = '0.0.5'

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0)
  }
  return 0
}

function generateVersionsJson() {
  try {
    const tags = execSync("git tag -l 'v*'", { encoding: 'utf-8' })
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((t) => t.replace(/^v/, ''))
      .filter((v) => compareVersions(v, MIN_VERSION) <= 0)
      .sort(compareVersions)

    const latest = tags[0] || ''
    const data = { latest, versions: tags }
    const publicDir = path.resolve(__dirname, '../public')
    fs.mkdirSync(publicDir, { recursive: true })
    fs.writeFileSync(path.join(publicDir, 'versions.json'), JSON.stringify(data, null, 2) + '\n')
  } catch {
    // Not in a git repo or no tags — skip
  }
}

generateVersionsJson()

export default defineConfig({
  title: 'ra',
  description: 'The predictable, observable agent harness.',
  base: '/ra/',
  appearance: 'dark',
  vite: {
    define: {
      __DOCS_VERSION__: JSON.stringify(process.env.DOCS_VERSION || 'dev'),
    },
  },
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
    nav: [],
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
          { text: 'Cron', link: '/modes/cron' },
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
          { text: 'Memory', link: '/tools/#memory' },
          { text: 'Observability', link: '/observability/' },
        ],
      },
      {
        text: 'Providers',
        items: [
          { text: 'Anthropic', link: '/providers/anthropic' },
          { text: 'OpenAI', link: '/providers/openai' },
          { text: 'OpenAI Completions', link: '/providers/openai-completions' },
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
